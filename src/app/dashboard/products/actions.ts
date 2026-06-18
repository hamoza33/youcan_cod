'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs/queue';
import { CountryCode, VisibilityStatus } from '@prisma/client';

const productIdSchema = z.string().min(1);

export async function triggerProductJob(productId: string, job: 'ensure-cod-sku' | 'enrich-seo' | 'import-youcan' | 'push-gmc' | 'refresh-gmc-status') {
  const codProductId = productIdSchema.parse(productId);
  await enqueueJob(job, { codProductId, country: 'SA', force: true });
  revalidatePath('/dashboard/products');
  revalidatePath(`/dashboard/products/${codProductId}`);
}

export async function triggerDiscovery(country: CountryCode | string = CountryCode.SA) {
  const parsedCountry = z.nativeEnum(CountryCode).parse(country);
  await enqueueJob('discover-cod-products', { country: parsedCountry });
  revalidatePath('/dashboard/products');
}

export async function triggerStockSync(country: CountryCode | string = CountryCode.SA) {
  const parsedCountry = z.nativeEnum(CountryCode).parse(country);
  await enqueueJob('sync-stock', { country: parsedCountry });
  revalidatePath('/dashboard/products');
}

export async function triggerYouCanCategorySync() {
  await enqueueJob('sync-youcan-categories', {});
  revalidatePath('/dashboard/products');
  revalidatePath('/dashboard/settings');
}

const updateProductSchema = z.object({
  id: z.string(),
  price: z.coerce.number().nonnegative().optional(),
  categoryId: z.string().optional().nullable(),
  visibilityStatus: z.nativeEnum(VisibilityStatus).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
});

export async function updateProductAction(formData: FormData) {
  const data = updateProductSchema.parse({
    id: formData.get('id'),
    price: formData.get('price'),
    categoryId: formData.get('categoryId') || null,
    visibilityStatus: formData.get('visibilityStatus'),
    title: formData.get('title') || undefined,
    description: formData.get('description') || undefined,
    metaTitle: formData.get('metaTitle') || undefined,
    metaDescription: formData.get('metaDescription') || undefined,
  });

  await prisma.codProduct.update({
    where: { id: data.id },
    data: {
      price: data.price,
      categoryId: data.categoryId,
      visibilityStatus: data.visibilityStatus,
    },
  });

  if (data.title || data.description || data.metaTitle || data.metaDescription) {
    await prisma.seoMetadata.update({
      where: { codProductId: data.id },
      data: {
        title: data.title,
        description: data.description,
        metaTitle: data.metaTitle,
        metaDescription: data.metaDescription,
      },
    });
  }

  revalidatePath('/dashboard/products');
  revalidatePath(`/dashboard/products/${data.id}`);
}

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1),
  action: z.enum(['show', 'hide', 'regenerate-seo', 'push-gmc', 'import-youcan', 'category', 'price-percent']),
  categoryId: z.string().optional(),
  percent: z.number().optional(),
});

export async function bulkAction(input: z.infer<typeof bulkSchema>) {
  const data = bulkSchema.parse(input);
  if (data.action === 'show' || data.action === 'hide') {
    await prisma.codProduct.updateMany({
      where: { id: { in: data.ids } },
      data: { visibilityStatus: data.action === 'show' ? VisibilityStatus.VISIBLE : VisibilityStatus.HIDDEN },
    });
  }
  if (data.action === 'category' && data.categoryId) {
    await prisma.codProduct.updateMany({ where: { id: { in: data.ids } }, data: { categoryId: data.categoryId } });
  }
  if (data.action === 'price-percent' && data.percent != null) {
    const products = await prisma.codProduct.findMany({ where: { id: { in: data.ids } } });
    await Promise.all(
      products.map((product) =>
        prisma.codProduct.update({
          where: { id: product.id },
          data: { price: Number(product.price ?? 0) * (1 + data.percent! / 100) },
        }),
      ),
    );
  }
  if (['regenerate-seo', 'push-gmc', 'import-youcan'].includes(data.action)) {
    const job = data.action === 'regenerate-seo' ? 'enrich-seo' : data.action === 'push-gmc' ? 'push-gmc' : 'import-youcan';
    await Promise.all(data.ids.map((codProductId) => enqueueJob(job, { codProductId, country: 'SA', force: true })));
  }
  revalidatePath('/dashboard/products');
}
