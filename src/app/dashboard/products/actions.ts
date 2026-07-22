'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs/queue';
import { roundMoney } from '@/lib/pricing/formula';
import { CountryCode, GmcStatus, ImportStatus, Prisma, SeoStatus, StockStatus, VisibilityStatus } from '@prisma/client';

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

const processBatchSchema = z.array(z.string().min(1)).min(1).max(50);

export async function triggerProcessBatch(productIds: string[]) {
  const ids = processBatchSchema.parse(productIds);
  const products = await prisma.codProduct.findMany({
    where: { id: { in: ids } },
    select: { id: true, codSku: true, seoStatus: true, importStatus: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  await Promise.all(
    ids.map(async (id) => {
      const product = productById.get(id);
      if (!product) return;
      if (!product.codSku) {
        await enqueueJob('ensure-cod-sku', { codProductId: id, force: true });
        return;
      }
      if (product.seoStatus !== SeoStatus.READY) {
        await enqueueJob('enrich-seo', { codProductId: id, force: true });
        return;
      }
      if (product.importStatus !== ImportStatus.IMPORTED && product.importStatus !== ImportStatus.UPDATED) {
        await enqueueJob('import-youcan', { codProductId: id, force: true });
      }
    }),
  );

  revalidatePath('/dashboard/products');
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

const priceOnlySchema = z.object({
  scope: z.enum(['selected', 'all-filtered']),
  ids: z.array(z.string().min(1)).max(50).default([]),
  percent: z.number().min(-99).max(1000),
  filters: z.object({
    q: z.string().optional(),
    country: z.nativeEnum(CountryCode).optional(),
    category: z.string().optional(),
    stock: z.nativeEnum(StockStatus).optional(),
    seo: z.nativeEnum(SeoStatus).optional(),
    importStatus: z.nativeEnum(ImportStatus).optional(),
    gmc: z.nativeEnum(GmcStatus).optional(),
  }).default({}),
});

export async function priceOnlyPercentageAction(input: z.infer<typeof priceOnlySchema>) {
  const data = priceOnlySchema.parse(input);
  if (data.scope === 'selected' && data.ids.length === 0) throw new Error('Select at least one product.');
  const where: Prisma.CodProductWhereInput = data.scope === 'selected'
    ? { id: { in: data.ids } }
    : {
      country: data.filters.country,
      categoryId: data.filters.category,
      stockStatus: data.filters.stock,
      seoStatus: data.filters.seo,
      importStatus: data.filters.importStatus,
      gmcStatus: data.filters.gmc,
      OR: data.filters.q ? productSearchWhere(data.filters.q) : undefined,
    };
  const products = await prisma.codProduct.findMany({ where, select: { id: true, price: true } });
  const multiplier = 1 + data.percent / 100;

  await prisma.$transaction(products.map((product) => prisma.codProduct.update({
    where: { id: product.id },
    data: { price: roundMoney(Number(product.price ?? 0) * multiplier), lastError: null },
  })));
  // External writes happen only in worker jobs, never in this server action.
  await Promise.all(products.map((product) => enqueueJob('sync-product-price', { codProductId: product.id, force: true })));
  revalidatePath('/dashboard/products');
  return { queued: products.length, scope: data.scope };
}

function productSearchWhere(query: string): Prisma.CodProductWhereInput[] {
  return [
    { name: { contains: query, mode: 'insensitive' } },
    { rawName: { contains: query, mode: 'insensitive' } },
    { codSku: { contains: query, mode: 'insensitive' } },
    { codProductId: { contains: query, mode: 'insensitive' } },
    { mapping: { is: { codSku: { contains: query, mode: 'insensitive' } } } },
    { mapping: { is: { youCanProductId: { contains: query, mode: 'insensitive' } } } },
    { seoMetadata: { is: { title: { contains: query, mode: 'insensitive' } } } },
  ];
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
