'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs/queue';
import { roundMoney } from '@/lib/pricing/formula';
import { CountryCode, VisibilityStatus } from '@prisma/client';

const productIdSchema = z.string().min(1);

export async function triggerProductJob(productId: string, job: 'ensure-cod-sku' | 'enrich-seo' | 'regenerate-images' | 'import-youcan' | 'push-gmc' | 'refresh-gmc-status') {
  const codProductId = productIdSchema.parse(productId);
  await enqueueJob(job, { codProductId, force: true });
  revalidatePath('/dashboard/products');
  revalidatePath(`/dashboard/products/${codProductId}`);
}

export async function triggerDiscovery(country: CountryCode | string = CountryCode.SA) {
  const parsedCountry = z.nativeEnum(CountryCode).parse(country);
  await enqueueJob('discover-cod-products', { country: parsedCountry });
  revalidatePath('/dashboard/products');
}

export async function triggerDiscoveryForCountries(countries: Array<CountryCode | string>) {
  const parsedCountries = z.array(z.nativeEnum(CountryCode)).min(1).parse(countries);
  await Promise.all(parsedCountries.map((country) => enqueueJob('discover-cod-products', { country })));
  revalidatePath('/dashboard/products');
}

export async function triggerStockSync(country: CountryCode | string = CountryCode.SA) {
  const parsedCountry = z.nativeEnum(CountryCode).parse(country);
  await enqueueJob('sync-stock', { country: parsedCountry });
  revalidatePath('/dashboard/products');
}

export async function triggerStockSyncForCountries(countries: Array<CountryCode | string>) {
  const parsedCountries = z.array(z.nativeEnum(CountryCode)).min(1).parse(countries);
  await Promise.all(parsedCountries.map((country) => enqueueJob('sync-stock', { country })));
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

  await enqueueJob('import-youcan', { codProductId: data.id, force: true });

  revalidatePath('/dashboard/products');
  revalidatePath(`/dashboard/products/${data.id}`);
}

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1),
  action: z.enum(['show', 'hide', 'regenerate-seo', 'regenerate-images', 'push-gmc', 'import-youcan', 'category', 'price-percent', 'price-fixed']),
  categoryId: z.string().optional(),
  percent: z.number().min(-99).max(1000).optional(),
  fixedPrice: z.number().nonnegative().optional(),
});

export async function bulkAction(input: z.infer<typeof bulkSchema>) {
  const data = bulkSchema.parse(input);
  if (data.action === 'show' || data.action === 'hide') {
    await prisma.codProduct.updateMany({
      where: { id: { in: data.ids } },
      data: { visibilityStatus: data.action === 'show' ? VisibilityStatus.VISIBLE : VisibilityStatus.HIDDEN },
    });
    await Promise.all(data.ids.map((codProductId) => enqueueJob('import-youcan', { codProductId, force: true })));
  }
  if (data.action === 'category' && data.categoryId) {
    await prisma.codProduct.updateMany({ where: { id: { in: data.ids } }, data: { categoryId: data.categoryId } });
    await Promise.all(data.ids.map((codProductId) => enqueueJob('import-youcan', { codProductId, force: true })));
  }
  if (data.action === 'price-percent' && data.percent != null) {
    const multiplier = Math.max(0, 1 + data.percent / 100);
    const products = await prisma.codProduct.findMany({ where: { id: { in: data.ids } } });
    await Promise.all(
      products.map(async (product) => {
        await prisma.codProduct.update({
          where: { id: product.id },
          data: { price: roundMoney(Number(product.price ?? 0) * multiplier) },
        });
        await enqueueJob('import-youcan', { codProductId: product.id, force: true });
      }),
    );
  }
  if (data.action === 'price-fixed' && data.fixedPrice != null) {
    await Promise.all(
      data.ids.map(async (id) => {
        await prisma.codProduct.update({ where: { id }, data: { price: roundMoney(data.fixedPrice!) } });
        await enqueueJob('import-youcan', { codProductId: id, force: true });
      }),
    );
  }
  if (['regenerate-seo', 'regenerate-images', 'push-gmc', 'import-youcan'].includes(data.action)) {
    const job = data.action === 'regenerate-seo'
      ? 'enrich-seo'
      : data.action === 'regenerate-images'
        ? 'regenerate-images'
        : data.action === 'push-gmc'
          ? 'push-gmc'
          : 'import-youcan';
    await Promise.all(data.ids.map((codProductId) => enqueueJob(job, { codProductId, force: true })));
  }
  revalidatePath('/dashboard/products');
}

export async function toggleProductVisibility(productId: string, visible: boolean) {
  const id = productIdSchema.parse(productId);
  await prisma.codProduct.update({
    where: { id },
    data: { visibilityStatus: visible ? VisibilityStatus.VISIBLE : VisibilityStatus.HIDDEN },
  });
  await enqueueJob('import-youcan', { codProductId: id, force: true });
  revalidatePath('/dashboard/products');
  revalidatePath(`/dashboard/products/${id}`);
}
