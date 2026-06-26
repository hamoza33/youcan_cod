import {
  CountryCode,
  GmcStatus,
  ImportStatus,
  JobStatus,
  JobType,
  LogLevel,
  LogSource,
  Prisma,
  ProductSourceStatus,
  SeoStatus,
  StockStatus,
  VisibilityStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db';
import { logEvent } from '@/lib/logger';
import { CodDropProduct, CodNetworkClient, codImageUrls, isCountryProduct } from '@/lib/integrations/cod-network/client';
import { enqueueJob } from '@/lib/jobs/queue';
import { generateSeoMetadata } from '@/lib/seo/generator';
import { type PricingFormula } from '@/lib/pricing/formula';
import { codBasePrice, codProductCost, numeric } from '@/lib/products/cod-pricing';
import { buildYouCanProductPayload } from '@/lib/products/youcan-payload';
import { selectAccurateProductImages, REQUIRED_PRODUCT_IMAGE_COUNT, buildProductImageSearchQuery } from '@/lib/products/image-enrichment';
import { validateBeforeYouCanImport, shouldMarkNeedsReview } from '@/lib/products/import-validation';
import { requireCleanCodSku } from '@/lib/products/sku';
import { ensureMappedCategory } from '@/lib/categories/youcan-sync';
import { YouCanClient, youCanPrimaryVariantId, youCanProductPublicUrl } from '@/lib/integrations/youcan/client';
import { buildMerchantProductInput } from '@/lib/products/gmc-payload';
import { GoogleMerchantClient } from '@/lib/integrations/google-merchant/client';
import { getOptionalConfig } from '@/lib/settings/config';
import { getSettingValue } from '@/lib/settings/runtime';
import { toJsonValue } from '@/lib/http/client';

export async function discoverCodProducts(country: CountryCode = CountryCode.SA) {
  const syncRun = await prisma.syncRun.create({
    data: { type: JobType.DISCOVER_COD_PRODUCTS, status: JobStatus.RUNNING, country, startedAt: new Date() },
  });
  const client = await CodNetworkClient.create();
  let discovered = 0;
  let failed = 0;

  try {
    const products = await client.listAvailableProducts({ country });
    for (const product of products) {
      try {
        const saved = await upsertCodDropProduct(product, country);
        discovered += 1;
        await enqueueJob('ensure-cod-sku', { codProductId: saved.id, country });
      } catch (error) {
        failed += 1;
        await logEvent({ source: LogSource.COD, level: LogLevel.ERROR, message: 'Failed to upsert COD product', context: toJsonValue({ error: String(error), product }) });
      }
    }
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: JobStatus.COMPLETED, discovered, failed, finishedAt: new Date() },
    });
    return { discovered, failed };
  } catch (error) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: JobStatus.FAILED, error: String(error), finishedAt: new Date() },
    });
    throw error;
  }
}

export async function ensureCodSku(codProductId: string) {
  const product = await prisma.codProduct.findUniqueOrThrow({ where: { id: codProductId } });
  if (product.codSku) {
    const cleanSku = requireCleanCodSku(product.codSku);
    if (cleanSku !== product.codSku) {
      await prisma.codProduct.update({ where: { id: codProductId }, data: { codSku: cleanSku } });
    }
    await prisma.productMapping.upsert({
      where: { codSku: cleanSku },
      update: { codProductId, codSku: cleanSku, googleOfferId: cleanSku },
      create: { codProductId, codSku: cleanSku, googleOfferId: cleanSku },
    });
    await enqueueJob('enrich-seo', { codProductId });
    return cleanSku;
  }

  const client = await CodNetworkClient.create();
  const result = await client.ensureSellerProduct((product.rawPayload ?? {}) as CodDropProduct);
  const cleanSku = requireCleanCodSku(result.sku);

  const formula = await getPricingFormula();
  const sellerProduct = result.sellerProduct as Record<string, unknown>;
  const sellerImageUrls = codImageUrls(result.sellerProduct);
  await prisma.codProduct.update({
    where: { id: codProductId },
    data: {
      codSku: cleanSku,
      sourceStatus: ProductSourceStatus.SKU_CONFIRMED,
      productCost: codProductCost(sellerProduct),
      price: codBasePrice(sellerProduct, formula),
      stockQuantity: numeric(sellerProduct.quantity),
      stockStatus: numeric(sellerProduct.quantity) === 0 ? StockStatus.OUT_OF_STOCK : StockStatus.IN_STOCK,
      imageUrls: mergeImageUrls(sellerImageUrls, product.imageUrls),
      rawPayload: toJsonValue(result.sellerProduct),
      lastCodSyncAt: new Date(),
      lastError: null,
    },
  });

  await prisma.productMapping.upsert({
    where: { codSku: cleanSku },
    update: { codProductId, codSku: cleanSku, googleOfferId: cleanSku },
    create: { codProductId, codSku: cleanSku, googleOfferId: cleanSku },
  });

  await logEvent({ source: LogSource.COD, message: `Confirmed COD SKU ${cleanSku}`, codProductId });
  await enqueueJob('enrich-seo', { codProductId });
  return cleanSku;
}

export async function enrichSeo(codProductId: string, force = false) {
  const product = await prisma.codProduct.findUniqueOrThrow({ where: { id: codProductId }, include: { seoMetadata: true } });
  if (product.seoMetadata && !force) {
    await enqueueJob('import-youcan', { codProductId });
    return product.seoMetadata;
  }

  await prisma.codProduct.update({ where: { id: codProductId }, data: { seoStatus: SeoStatus.GENERATING } });
  const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  const generated = await generateSeoMetadata({ product, categories });
  const category = (await ensureMappedCategory(generated.categorySlug)) ?? categories.find((item) => item.slug === generated.categorySlug) ?? categories[0] ?? null;
  const selectedImageUrls = generated.selectedImageUrls?.length ? generated.selectedImageUrls : product.imageUrls;

  const seo = await prisma.seoMetadata.upsert({
    where: { codProductId },
    update: {
      productType: generated.productType,
      useCase: generated.useCase,
      title: generated.title,
      description: generated.description,
      slug: generated.slug,
      metaTitle: generated.metaTitle,
      metaDescription: generated.metaDescription,
      keywords: generated.keywords,
      safeSellingPoints: generated.safeSellingPoints,
      categorySuggestion: generated.categorySlug,
      complianceNotes: generated.complianceNotes,
      sourceSummary: generated.sourceSummary,
      aiProvider: generated.aiProvider,
      aiModel: generated.aiModel,
      rawAiResponse: toJsonValue(generated.rawAiResponse),
    },
    create: {
      codProductId,
      productType: generated.productType,
      useCase: generated.useCase,
      title: generated.title,
      description: generated.description,
      slug: generated.slug,
      metaTitle: generated.metaTitle,
      metaDescription: generated.metaDescription,
      keywords: generated.keywords,
      safeSellingPoints: generated.safeSellingPoints,
      categorySuggestion: generated.categorySlug,
      complianceNotes: generated.complianceNotes,
      sourceSummary: generated.sourceSummary,
      aiProvider: generated.aiProvider,
      aiModel: generated.aiModel,
      rawAiResponse: toJsonValue(generated.rawAiResponse),
    },
  });

  await prisma.codProduct.update({
    where: { id: codProductId },
    data: { seoStatus: SeoStatus.READY, categoryId: category?.id, imageUrls: selectedImageUrls, lastSeoGeneratedAt: new Date(), lastError: null },
  });

  await enqueueJob('import-youcan', { codProductId });
  return seo;
}

export async function importToYouCan(codProductId: string, options: { enqueueGmc?: boolean } = {}) {
  let product = await prisma.codProduct.findUniqueOrThrow({
    where: { id: codProductId },
    include: { seoMetadata: true, category: true, mapping: true },
  });

  if (!product.codSku) throw new Error('Cannot import to YouCan before COD SKU is confirmed.');
  if (!product.seoMetadata) throw new Error('Cannot import to YouCan before SEO metadata is generated.');

  await prisma.codProduct.update({ where: { id: codProductId }, data: { importStatus: ImportStatus.IMPORTING } });

  try {
    const sku = requireCleanCodSku(product.codSku);
    const category = product.category?.youCanCategoryId ? product.category : await ensureMappedCategory(product.seoMetadata.categorySuggestion);
    const enrichedImageUrls = await enrichImagesForImport(product);
    product = await updateProductForImport(codProductId, {
      categoryId: category?.id ?? product.categoryId,
      imageUrls: enrichedImageUrls,
      codSku: sku,
    });
    const seo = product.seoMetadata;
    if (!seo) throw new Error('Cannot import to YouCan before SEO metadata is ready.');
    const importProduct = { ...product, category: category ?? product.category, categoryId: category?.id ?? product.categoryId, seoMetadata: seo, codSku: sku };
    const validation = await validateBeforeYouCanImport({ product: importProduct, sku });
    if (!validation.ok) {
      await prisma.codProduct.update({
        where: { id: codProductId },
        data: { importStatus: ImportStatus.FAILED, seoStatus: shouldMarkNeedsReview(validation.errors), lastError: validation.errors.join(' | ') },
      });
      throw new Error(`Pre-import validation failed: ${validation.errors.join(' | ')}`);
    }
    if (validation.validImageUrls.join('|') !== product.imageUrls.join('|')) {
      product = await updateProductForImport(codProductId, { imageUrls: validation.validImageUrls });
    }
    const productForPayload = { ...importProduct, imageUrls: validation.validImageUrls };
    const env = await getOptionalConfig();
    const discountRules = await prisma.discountRule.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    const relatedProductIds = await relatedYouCanProductIds(codProductId, category?.id ?? product.categoryId, category?.youCanCategoryId, product.mapping?.youCanProductId);
    const payload = buildYouCanProductPayload({
      product: productForPayload,
      sku,
      seo,
      category,
      discountRules,
      visible: product.visibilityStatus === VisibilityStatus.VISIBLE,
      appBaseUrl: env.APP_BASE_URL,
      textButtonVariantType: Number(env.YOUCAN_TEXT_BUTTON_VARIANT_TYPE ?? 2),
      quantityOptionName: await getSettingValue<string>('youCan.quantityOptionName').catch(() => undefined),
      singleQuantityLabel: await getSettingValue<string>('youCan.singleQuantityLabel').catch(() => undefined),
      relatedProductIds,
    });

    const youcan = await YouCanClient.create();
    const youcanProduct = await youcan.createOrUpdateBySku(sku, payload, product.mapping?.youCanProductId ?? undefined);

    const publicUrl = youCanProductPublicUrl(youcanProduct, env.YOUCAN_STORE_URL, youcanProduct.slug ?? seo.slug);
    const variantId = youCanPrimaryVariantId(youcanProduct, sku);
    await prisma.productMapping.upsert({
      where: { codSku: sku },
      update: {
        codProductId,
        youCanProductId: youcanProduct.id,
        youCanVariantId: variantId,
        youCanSlug: youcanProduct.slug ?? seo.slug,
        youCanPublicUrl: publicUrl,
      },
      create: {
        codProductId,
        codSku: sku,
        youCanProductId: youcanProduct.id,
        youCanVariantId: variantId,
        youCanSlug: youcanProduct.slug ?? seo.slug,
        youCanPublicUrl: publicUrl,
        googleOfferId: sku,
      },
    });

    await prisma.codProduct.update({
      where: { id: codProductId },
      data: { importStatus: ImportStatus.IMPORTED, lastYouCanSyncAt: new Date(), lastError: null },
    });

    await logEvent({ source: LogSource.YOUCAN, message: `Imported/updated YouCan product ${youcanProduct.id}`, codProductId, context: toJsonValue({ imageCount: validation.validImageUrls.length, visible: product.visibilityStatus === VisibilityStatus.VISIBLE, relatedProductIds }) });
    if ((options.enqueueGmc ?? true) && env.GOOGLE_MERCHANT_ENABLED === 'true') {
      await enqueueJob('push-gmc', { codProductId });
    }
    return youcanProduct;
  } catch (error) {
    await prisma.codProduct.update({
      where: { id: codProductId },
      data: { importStatus: ImportStatus.FAILED, lastError: String(error) },
    });
    throw error;
  }
}

async function updateProductForImport(codProductId: string, data: Prisma.CodProductUncheckedUpdateInput) {
  return prisma.codProduct.update({
    where: { id: codProductId },
    data,
    include: { seoMetadata: true, category: true, mapping: true },
  });
}

async function enrichImagesForImport(product: { name: string; rawName: string | null; description: string | null; rawDescription: string | null; imageUrls: string[]; seoMetadata?: { title: string } | null }) {
  const enriched = await selectAccurateProductImages({
    title: product.seoMetadata?.title ?? product.rawName ?? product.name,
    rawName: product.rawName,
    existingImageUrls: product.imageUrls,
    searchResults: [],
  });
  if (enriched.length < REQUIRED_PRODUCT_IMAGE_COUNT) {
    throw new Error(`Image enrichment failed: found ${enriched.length} valid exact product images, but at least ${REQUIRED_PRODUCT_IMAGE_COUNT} are required before importing to YouCan.`);
  }
  return enriched.slice(0, 5);
}

export async function regenerateProductImages(codProductId: string) {
  const product = await prisma.codProduct.findUniqueOrThrow({
    where: { id: codProductId },
    include: { seoMetadata: true, mapping: true },
  });
  const title = product.seoMetadata?.title ?? product.rawName ?? product.name;
  const query = buildProductImageSearchQuery({ title, rawName: product.rawName });
  const regenerated = await selectAccurateProductImages({
    title,
    rawName: product.rawName,
    existingImageUrls: product.imageUrls,
    searchResults: [],
    forceSearch: true,
  });

  if (regenerated.length < REQUIRED_PRODUCT_IMAGE_COUNT) {
    throw new Error(`Image regeneration failed: found ${regenerated.length} valid exact product images, but at least ${REQUIRED_PRODUCT_IMAGE_COUNT} are required.`);
  }

  await prisma.codProduct.update({
    where: { id: codProductId },
    data: { imageUrls: regenerated.slice(0, 5), lastError: null },
  });
  await logEvent({
    source: LogSource.SEARCH,
    message: `Regenerated ${Math.min(regenerated.length, 5)} product image(s).`,
    codProductId,
    context: toJsonValue({ query, imageCount: regenerated.length }),
  });

  if (product.mapping?.youCanProductId) {
    await enqueueJob('import-youcan', { codProductId, force: true });
  }

  return { imageCount: regenerated.length, images: regenerated.slice(0, 5) };
}

async function relatedYouCanProductIds(codProductId: string, categoryId?: string | null, youCanCategoryId?: string | null, currentYouCanProductId?: string | null) {
  const baseWhere = {
    id: { not: codProductId },
    importStatus: ImportStatus.IMPORTED,
    mapping: { is: { youCanProductId: { not: null } } },
  };
  const sameCategoryProducts = categoryId
    ? await prisma.codProduct.findMany({
      where: { ...baseWhere, categoryId },
      include: { mapping: true },
      orderBy: { updatedAt: 'desc' },
      take: 3,
    })
    : [];

  let ids = sameCategoryProducts
    .map((product) => product.mapping?.youCanProductId)
    .filter((id): id is string => Boolean(id) && id !== currentYouCanProductId)
    .slice(0, 3);

  let fallbackCount = 0;
  if (ids.length < 3 && youCanCategoryId) {
    const youcan = await YouCanClient.create();
    const remoteIds = await youcan.listProductIdsByCategory(youCanCategoryId, { limit: 100, maxPages: 3 });
    const remoteFallbackIds = remoteIds.filter((id) => id !== currentYouCanProductId && !ids.includes(id)).slice(0, 3 - ids.length);
    fallbackCount += remoteFallbackIds.length;
    ids = [...ids, ...remoteFallbackIds];
  }

  if (ids.length < 3) {
    const fallbackProducts = await prisma.codProduct.findMany({
      where: { ...baseWhere, id: { notIn: [codProductId, ...sameCategoryProducts.map((product) => product.id)] } },
      include: { mapping: true },
      orderBy: { updatedAt: 'desc' },
      take: 3 - ids.length,
    });
    const localFallbackIds = fallbackProducts
      .map((product) => product.mapping?.youCanProductId)
      .filter((id): id is string => typeof id === 'string' && id !== currentYouCanProductId && !ids.includes(id));
    fallbackCount += localFallbackIds.length;
    ids = [...ids, ...localFallbackIds].slice(0, 3);
  }

  if (sameCategoryProducts.length < 3) {
    await logEvent({
      source: LogSource.YOUCAN,
      level: LogLevel.WARN,
      message: `Only ${sameCategoryProducts.length} local same-category related product(s) available; using ${fallbackCount} fallback product(s).`,
      codProductId,
      context: toJsonValue({ categoryId, youCanCategoryId, relatedProductIds: ids }),
    });
  }
  return ids;
}

export async function pushToGmc(codProductId: string) {
  const env = await getOptionalConfig();
  const product = await prisma.codProduct.findUniqueOrThrow({
    where: { id: codProductId },
    include: { seoMetadata: true, category: true, mapping: true },
  });
  if (!product.mapping || !product.seoMetadata) throw new Error('Cannot push to GMC before mapping and SEO exist.');
  const appBaseUrl = env.APP_BASE_URL ?? env.YOUCAN_STORE_URL;
  if (!appBaseUrl) throw new Error('APP_BASE_URL or YOUCAN_STORE_URL is required to build Google Merchant product links.');

  await prisma.codProduct.update({ where: { id: codProductId }, data: { gmcStatus: GmcStatus.PENDING } });
  const merchant = await GoogleMerchantClient.create();
  const payload = buildMerchantProductInput({
    product,
    mapping: product.mapping,
    seo: product.seoMetadata,
    category: product.category,
    appBaseUrl,
    contentLanguage: env.GMC_CONTENT_LANGUAGE ?? 'ar',
    feedLabel: env.GMC_FEED_LABEL ?? 'SA',
  });
  const response = await merchant.insertProduct(payload);
  const productId = response.product ? String(response.product).split('/').pop() : merchant.buildProductId(payload);

  await prisma.gmcSubmission.create({
    data: {
      codProductId,
      offerId: payload.offerId,
      productId,
      accountId: env.GOOGLE_MERCHANT_ACCOUNT_ID,
      dataSourceId: env.GOOGLE_MERCHANT_DATA_SOURCE_ID,
      feedLabel: payload.feedLabel,
      contentLanguage: payload.contentLanguage,
      status: GmcStatus.PENDING,
      requestPayload: toJsonValue(payload),
      responsePayload: toJsonValue(response),
    },
  });

  await prisma.productMapping.update({ where: { id: product.mapping.id }, data: { googleProductId: productId, googleOfferId: payload.offerId } });
  await prisma.codProduct.update({ where: { id: codProductId }, data: { gmcStatus: GmcStatus.PENDING, lastGmcSyncAt: new Date(), lastError: null } });
  await logEvent({ source: LogSource.GMC, message: `Submitted ${payload.offerId} to Google Merchant Center`, codProductId });
  return response;
}

export async function syncStock(country?: CountryCode) {
  const client = await CodNetworkClient.create();
  const sellerProducts = await client.listSellerProducts();
  const env = await getOptionalConfig();
  const formula = await getPricingFormula();
  let updated = 0;

  for (const seller of sellerProducts) {
    if (!seller.sku) continue;
    if (country && !isCountryProduct(seller, country)) continue;
    const quantity = seller.stocks?.find((stock) => !country || isCountryProduct({ id: seller.id, sku: seller.sku, country_iso_code: stock.country_iso_code, country: stock.country }, country))?.quantity ?? numeric(seller.quantity);
    const stockStatus = quantity === 0 ? StockStatus.OUT_OF_STOCK : StockStatus.IN_STOCK;
    const product = await prisma.codProduct.findUnique({ where: { codSku: seller.sku } });
    if (!product) continue;
    const price = codBasePrice(seller as Record<string, unknown>, formula) || Number(product.price ?? 0);
    const sellerImageUrls = codImageUrls(seller);
    await prisma.codProduct.update({
      where: { id: product.id },
      data: { stockQuantity: quantity, stockStatus, price, imageUrls: mergeImageUrls(product.imageUrls, sellerImageUrls), lastCodSyncAt: new Date() },
    });
    updated += 1;
    await enqueueJob('import-youcan', { codProductId: product.id, force: true });
    if (env.GOOGLE_MERCHANT_ENABLED === 'true') {
      await enqueueJob('push-gmc', { codProductId: product.id, force: true });
    }
  }

  await logEvent({ source: LogSource.SYNC, message: `Stock sync updated ${updated} products` });
  return { updated };
}

export async function refreshGmcStatus(codProductId: string) {
  const product = await prisma.codProduct.findUniqueOrThrow({ where: { id: codProductId }, include: { mapping: true } });
  if (!product.mapping?.googleProductId) throw new Error('No Google product ID exists for this product.');
  const merchant = await GoogleMerchantClient.create();
  const response = await merchant.getProductStatus(product.mapping.googleProductId);
  const status = deriveGmcStatus(response);
  await prisma.codProduct.update({ where: { id: codProductId }, data: { gmcStatus: status, lastGmcSyncAt: new Date() } });
  await prisma.gmcSubmission.updateMany({
    where: { codProductId, productId: product.mapping.googleProductId },
    data: {
      status,
      responsePayload: toJsonValue(response),
      destinationStatuses: toJsonValue(response.destinationStatuses ?? null),
      issues: toJsonValue(response.productStatus ?? null),
      checkedAt: new Date(),
    },
  });
  return response;
}

async function upsertCodDropProduct(product: CodDropProduct, country: CountryCode) {
  const productCost = codProductCost(product as Record<string, unknown>);
  const formula = await getPricingFormula();
  const price = codBasePrice(product as Record<string, unknown>, formula);
  const stockQuantity = typeof product.quantity === 'number' ? product.quantity : undefined;
  const codSku = typeof product.sku === 'string' && product.sku.trim() ? product.sku.trim() : undefined;
  const existing = await prisma.codProduct.findUnique({ where: { codProductId_country: { codProductId: String(product.id), country } }, select: { imageUrls: true } });
  const imageUrls = mergeImageUrls(codImageUrls(product), existing?.imageUrls ?? []);

  return prisma.codProduct.upsert({
    where: { codProductId_country: { codProductId: String(product.id), country } },
    update: {
      codSku,
      rawName: product.name,
      name: product.name,
      rawDescription: product.description,
      productCost,
      price,
      currency: product.currency ?? 'SAR',
      stockQuantity,
      stockStatus: stockQuantity === 0 ? StockStatus.OUT_OF_STOCK : StockStatus.IN_STOCK,
      imageUrls,
      rawPayload: toJsonValue(product),
      lastCodSyncAt: new Date(),
    },
    create: {
      codProductId: String(product.id),
      codDropProductId: String(product.id),
      codSku,
      country,
      rawName: product.name,
      name: product.name,
      rawDescription: product.description,
      productCost,
      price,
      currency: product.currency ?? 'SAR',
      stockQuantity,
      stockStatus: stockQuantity === 0 ? StockStatus.OUT_OF_STOCK : StockStatus.IN_STOCK,
      imageUrls,
      rawPayload: toJsonValue(product),
    },
  });
}

async function getPricingFormula(): Promise<PricingFormula> {
  return getSettingValue<PricingFormula>('pricing.defaultFormula').catch(() => ({ type: 'markup_percent', value: 60, roundTo: 0.99 }));
}

function mergeImageUrls(...groups: Array<unknown[] | null | undefined>) {
  return [...new Set(groups.flatMap((group) => group ?? []).map((url) => (typeof url === 'string' ? url.trim() : '')).filter(Boolean))];
}

function deriveGmcStatus(response: Record<string, unknown>): GmcStatus {
  const text = JSON.stringify(response).toLowerCase();
  if (text.includes('disapproved') || text.includes('rejected')) return GmcStatus.DISAPPROVED;
  if (text.includes('approved')) return GmcStatus.APPROVED;
  return GmcStatus.PENDING;
}
