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
import { CodDropProduct, CodNetworkClient, type CodSellerProduct, codImageUrls, isCountryProduct } from '@/lib/integrations/cod-network/client';
import { enqueueJob } from '@/lib/jobs/queue';
import { generateSeoMetadata } from '@/lib/seo/generator';
import { calculateQuantityPrice, roundSellingPriceToNine, type PricingFormula } from '@/lib/pricing/formula';
import { codBasePrice, codProductCost, numeric } from '@/lib/products/cod-pricing';
import { arabicQuantityValue } from '@/lib/products/arabic-content';
import { buildYouCanProductPayload } from '@/lib/products/youcan-payload';
import { priceYouCanQuantityVariants } from '@/lib/products/youcan-variant-pricing';
import { selectAccurateProductImages, REQUIRED_PRODUCT_IMAGE_COUNT, buildProductImageSearchQuery } from '@/lib/products/image-enrichment';
import { validateBeforeYouCanImport, shouldMarkNeedsReview } from '@/lib/products/import-validation';
import { requireCleanCodSku } from '@/lib/products/sku';
import { ensureMappedCategory } from '@/lib/categories/youcan-sync';
import { YouCanClient, type YouCanProduct, type YouCanProductUpdatePayload, type YouCanVariant, youCanPrimaryVariantId, youCanProductPublicUrl, youCanProductVariants } from '@/lib/integrations/youcan/client';
import { buildMerchantProductInput } from '@/lib/products/gmc-payload';
import { GoogleMerchantClient, priceToMicros } from '@/lib/integrations/google-merchant/client';
import { deriveGmcStatusDetails, merchantIssues, persistedGmcStatus } from '@/lib/products/gmc-status';
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
    currencyCode: env.GMC_CURRENCY ?? 'SAR',
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
  const env = await getOptionalConfig();
  const targetCountries = country ? [country] : await enabledStockSyncCountries();
  const gmcConnected = isGmcConnected(env);
  const sellerProducts = await client.listSellerProducts();
  const youcan = await YouCanClient.create();
  let discovered = 0;
  let queuedNewProducts = 0;
  let updated = 0;
  let visible = 0;
  let hidden = 0;
  let youCanUpdated = 0;
  let youCanQueued = 0;
  let gmcQueued = 0;
  let failed = 0;

  for (const syncCountry of targetCountries) {
    const discovery = await discoverNewProductsForStockSync(client, syncCountry);
    discovered += discovery.discovered;
    queuedNewProducts += discovery.queued;
    failed += discovery.failed;
  }

  for (const seller of sellerProducts) {
    if (!seller.sku) continue;
    const matchedCountries = matchingSyncCountries(seller, targetCountries);
    if (!matchedCountries.length) continue;

    const product = await findProductForSellerProduct(seller, matchedCountries[0]);
    if (!product) {
      const created = await createLocalProductFromSellerProduct(seller, matchedCountries[0]);
      if (created) {
        discovered += 1;
        queuedNewProducts += 1;
        await logEvent({ source: LogSource.COD, message: 'Created local product from seller product during Sync Stock', codProductId: created.id, context: toJsonValue({ sku: seller.sku }) });
      }
      continue;
    }

    try {
      const quantity = sellerQuantityForCountry(seller, product.country);
      const stockStatus = sellerStockStatus(seller, quantity, product.stockStatus);
      const visibilityStatus = stockStatus === StockStatus.IN_STOCK
        ? VisibilityStatus.VISIBLE
        : stockStatus === StockStatus.OUT_OF_STOCK
          ? VisibilityStatus.HIDDEN
          : product.visibilityStatus;
      await prisma.codProduct.update({
        where: { id: product.id },
        data: {
          stockQuantity: quantity ?? product.stockQuantity,
          stockStatus,
          visibilityStatus,
          lastCodSyncAt: new Date(),
          lastError: null,
        },
      });

      updated += 1;
      if (visibilityStatus === VisibilityStatus.VISIBLE) visible += 1;
      else hidden += 1;

      const youCanResult = await pushStockVisibilityToYouCan(product.id, youcan);
      if (youCanResult.updated) youCanUpdated += 1;
      if (youCanResult.queuedImport) youCanQueued += 1;

      if (gmcConnected && product.mapping?.youCanProductId && product.seoMetadata) {
        await enqueueJob('push-gmc', { codProductId: product.id, force: true });
        gmcQueued += 1;
      }
    } catch (error) {
      failed += 1;
      await prisma.codProduct.update({ where: { id: product.id }, data: { lastError: String(error) } });
      await logEvent({ source: LogSource.SYNC, level: LogLevel.ERROR, message: 'Stock-only sync failed for product', codProductId: product.id, context: toJsonValue({ error: String(error), sku: seller.sku }) });
    }
  }

  await logEvent({
    source: LogSource.SYNC,
    message: `Sync Stock updated ${updated} product(s), found ${discovered} new product(s), hid ${hidden}, showed ${visible}.`,
    context: toJsonValue({ updated, discovered, queuedNewProducts, youCanUpdated, youCanQueued, gmcQueued, gmcSkipped: !gmcConnected, failed, countries: targetCountries }),
  });
  return { updated, discovered, queuedNewProducts, youCanUpdated, youCanQueued, gmcQueued, gmcSkipped: !gmcConnected, visible, hidden, failed };
}

async function discoverNewProductsForStockSync(client: CodNetworkClient, country: CountryCode) {
  let discovered = 0;
  let queued = 0;
  let failed = 0;
  let products: CodDropProduct[] = [];
  try {
    products = await client.listAvailableProducts({ country });
  } catch (error) {
    await logEvent({ source: LogSource.COD, level: LogLevel.ERROR, message: 'Failed to discover new COD products during Sync Stock; continuing with existing seller stock.', context: toJsonValue({ country, error: String(error) }) });
    return { discovered, queued, failed: failed + 1 };
  }

  for (const product of products) {
    const codProductId = String(product.id);
    const existing = await prisma.codProduct.findUnique({
      where: { codProductId_country: { codProductId, country } },
      select: { id: true },
    });
    if (existing) continue;

    try {
      const saved = await upsertCodDropProduct(product, country);
      discovered += 1;
      queued += 1;
      await enqueueJob('ensure-cod-sku', { codProductId: saved.id, country, force: true });
    } catch (error) {
      failed += 1;
      await logEvent({ source: LogSource.COD, level: LogLevel.ERROR, message: 'Failed to add newly discovered COD product during Sync Stock', context: toJsonValue({ error: String(error), product }) });
    }
  }
  return { discovered, queued, failed };
}

async function findProductForSellerProduct(seller: CodSellerProduct, country: CountryCode) {
  const bySku = await prisma.codProduct.findUnique({
    where: { codSku: seller.sku },
    include: { mapping: true, seoMetadata: true },
  });
  if (bySku) return bySku;

  const codProductId = sellerDropProductReference(seller);
  if (!codProductId) return null;
  return prisma.codProduct.findUnique({
    where: { codProductId_country: { codProductId, country } },
    include: { mapping: true, seoMetadata: true },
  });
}

async function createLocalProductFromSellerProduct(seller: CodSellerProduct, country: CountryCode) {
  const codProductId = sellerDropProductReference(seller);
  if (!codProductId || !seller.sku) return null;
  const quantity = sellerQuantityForCountry(seller, country);
  const stockStatus = sellerStockStatus(seller, quantity, StockStatus.UNKNOWN);
  const formula = await getPricingFormula();
  const price = codBasePrice(seller as Record<string, unknown>, formula);
  const name = typeof seller.name === 'string' && seller.name.trim() ? seller.name.trim() : `COD product ${codProductId}`;

  const product = await prisma.codProduct.upsert({
    where: { codProductId_country: { codProductId, country } },
    update: {
      codSku: seller.sku,
      stockQuantity: quantity,
      stockStatus,
      visibilityStatus: stockStatus === StockStatus.OUT_OF_STOCK ? VisibilityStatus.HIDDEN : VisibilityStatus.VISIBLE,
      lastCodSyncAt: new Date(),
    },
    create: {
      codProductId,
      codDropProductId: codProductId,
      codSku: seller.sku,
      country,
      sourceStatus: ProductSourceStatus.SKU_CONFIRMED,
      rawName: name,
      name,
      productCost: codProductCost(seller as Record<string, unknown>),
      price,
      currency: seller.currency ?? 'SAR',
      stockQuantity: quantity,
      stockStatus,
      visibilityStatus: stockStatus === StockStatus.OUT_OF_STOCK ? VisibilityStatus.HIDDEN : VisibilityStatus.VISIBLE,
      imageUrls: codImageUrls(seller),
      rawPayload: toJsonValue(seller),
      lastCodSyncAt: new Date(),
    },
  });

  await prisma.productMapping.upsert({
    where: { codSku: seller.sku },
    update: { codProductId: product.id, codSku: seller.sku, googleOfferId: seller.sku },
    create: { codProductId: product.id, codSku: seller.sku, googleOfferId: seller.sku },
  });
  await enqueueJob('enrich-seo', { codProductId: product.id, country, force: true });
  return product;
}

async function pushStockVisibilityToYouCan(codProductId: string, youcan?: YouCanClient) {
  const product = await prisma.codProduct.findUniqueOrThrow({
    where: { id: codProductId },
    include: { mapping: true, seoMetadata: true, category: true },
  });
  const sku = product.codSku ?? product.mapping?.codSku;

  if (!sku) return { updated: false, queuedImport: false };

  const client = youcan ?? await YouCanClient.create();
  let remote: YouCanProduct | undefined;
  let youCanProductId = product.mapping?.youCanProductId ?? undefined;

  if (youCanProductId) {
    remote = await client.getProduct(youCanProductId, { include: ['variants'] });
  } else {
    remote = await client.findProductBySku(sku);
    youCanProductId = remote?.id;
  }

  if (!remote || !youCanProductId) {
    if (product.seoMetadata) {
      await enqueueJob('import-youcan', { codProductId: product.id, force: true });
      return { updated: false, queuedImport: true };
    }
    return { updated: false, queuedImport: false };
  }

  const visible = product.visibilityStatus === VisibilityStatus.VISIBLE && product.stockStatus !== StockStatus.OUT_OF_STOCK;
  const payload = buildStockVisibilityPayload(remote, {
    fallbackName: product.seoMetadata?.title ?? product.name,
    fallbackPrice: Number(product.price ?? 0),
    fallbackSku: sku,
    quantity: product.stockQuantity,
    visible,
  });
  const updated = await client.updateProduct(youCanProductId, payload);
  const publicUrl = product.mapping?.youCanPublicUrl ?? youCanProductPublicUrl(updated, (await getOptionalConfig()).YOUCAN_STORE_URL, product.mapping?.youCanSlug ?? product.seoMetadata?.slug);
  await prisma.productMapping.upsert({
    where: { codSku: sku },
    update: {
      codProductId: product.id,
      codSku: sku,
      youCanProductId: updated.id,
      youCanVariantId: youCanPrimaryVariantId(updated, sku) ?? product.mapping?.youCanVariantId,
      youCanSlug: product.mapping?.youCanSlug ?? updated.slug ?? product.seoMetadata?.slug,
      youCanPublicUrl: publicUrl,
      googleOfferId: product.mapping?.googleOfferId ?? sku,
    },
    create: {
      codProductId: product.id,
      codSku: sku,
      youCanProductId: updated.id,
      youCanVariantId: youCanPrimaryVariantId(updated, sku),
      youCanSlug: updated.slug ?? product.seoMetadata?.slug,
      youCanPublicUrl: publicUrl,
      googleOfferId: sku,
    },
  });
  await prisma.codProduct.update({ where: { id: product.id }, data: { importStatus: ImportStatus.UPDATED, lastYouCanSyncAt: new Date(), lastError: null } });
  await logEvent({ source: LogSource.YOUCAN, message: `Updated YouCan stock/visibility for ${updated.id}`, codProductId: product.id, context: toJsonValue({ visible, stockQuantity: product.stockQuantity }) });
  return { updated: true, queuedImport: false };
}

function buildStockVisibilityPayload(remote: YouCanProduct, input: { fallbackName: string; fallbackPrice: number; fallbackSku: string; quantity: number | null; visible: boolean }): YouCanProductUpdatePayload {
  const variants = youCanProductVariants(remote);
  const hasVariants = booleanValue(remote.has_variants) ?? variants.length > 0;
  const payload: YouCanProductUpdatePayload = {
    name: stringValue(remote.name) ?? input.fallbackName,
    has_variants: hasVariants,
    price: numberValue(remote.price) ?? input.fallbackPrice,
    visibility: input.visible,
    track_inventory: true,
  };

  if (hasVariants) {
    const variantOptionsValue = (remote as { variant_options?: unknown }).variant_options;
    const variantOptions = Array.isArray(variantOptionsValue)
      ? variantOptionsValue as Array<{ name: string; type: number; values: string[] }>
      : undefined;
    if (variantOptions) payload.variant_options = variantOptions;
    payload.variants = variants.map((variant) => preserveVariantForStockUpdate(variant, input.quantity, input.fallbackSku, input.fallbackPrice));
  } else {
    payload.inventory = input.quantity ?? undefined;
    payload.sku = stringValue(remote.sku) ?? input.fallbackSku;
  }

  return payload;
}

function preserveVariantForStockUpdate(variant: YouCanVariant, quantity: number | null, fallbackSku: string, fallbackPrice: number): YouCanVariant {
  return {
    ...variant,
    price: numberValue(variant.price) ?? fallbackPrice,
    sku: stringValue(variant.sku) ?? fallbackSku,
    inventory: quantity ?? undefined,
  };
}

function matchingSyncCountries(seller: CodSellerProduct, countries: CountryCode[]) {
  const matching = countries.filter((syncCountry) => (
    isCountryProduct(seller, syncCountry)
    || seller.stocks?.some((stock) => isCountryProduct({ id: seller.id, sku: seller.sku, country_iso_code: stock.country_iso_code, country: stock.country }, syncCountry))
  ));
  return matching.length ? matching : countries.length === 1 ? countries : [];
}

async function enabledStockSyncCountries() {
  const configured = await getSettingValue<CountryCode[]>('country.enabled').catch(() => [CountryCode.SA]);
  const allowed = new Set(Object.values(CountryCode));
  const countries = (Array.isArray(configured) ? configured : [CountryCode.SA]).filter((value): value is CountryCode => allowed.has(value));
  return countries.length ? countries : [CountryCode.SA];
}

function sellerQuantityForCountry(seller: CodSellerProduct, country?: CountryCode) {
  if (country && seller.stocks?.length) {
    const stock = seller.stocks.find((item) => isCountryProduct({ id: seller.id, sku: seller.sku, country_iso_code: item.country_iso_code, country: item.country }, country));
    const quantity = numeric(stock?.quantity);
    if (quantity != null) return Math.max(0, Math.round(quantity));
  }
  const quantity = numeric(seller.quantity);
  return quantity == null ? undefined : Math.max(0, Math.round(quantity));
}

function sellerStockStatus(seller: CodSellerProduct, quantity: number | undefined, fallback: StockStatus) {
  const statusText = String((seller as Record<string, unknown>).status ?? (seller as Record<string, unknown>).stock_status ?? (seller as Record<string, unknown>).availability ?? '').toLowerCase();
  if (quantity === 0 || /out.?of.?stock|sold.?out|unavailable|disabled|inactive|draft/.test(statusText)) return StockStatus.OUT_OF_STOCK;
  if ((quantity != null && quantity > 0) || /in.?stock|available|active|published/.test(statusText)) return StockStatus.IN_STOCK;
  return fallback;
}

function sellerDropProductReference(seller: CodSellerProduct) {
  const record = seller as Record<string, unknown>;
  return stringValue(record.drop_product_id ?? record.dropProductId ?? record.product_id ?? record.marketplace_product_id ?? record.codProductId ?? seller.id);
}

function isGmcConnected(env: Partial<Awaited<ReturnType<typeof getOptionalConfig>>>) {
  return env.GOOGLE_MERCHANT_ENABLED === 'true'
    && Boolean(env.GOOGLE_MERCHANT_ACCOUNT_ID)
    && Boolean(env.GOOGLE_MERCHANT_DATA_SOURCE_ID)
    && Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON || env.GOOGLE_APPLICATION_CREDENTIALS);
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || undefined : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  return undefined;
}

export async function updateAllDiscountVariantsOnYouCan() {
  const products = await prisma.codProduct.findMany({
    where: {
      importStatus: { in: [ImportStatus.IMPORTED, ImportStatus.UPDATED] },
      mapping: { is: { youCanProductId: { not: null } } },
      codSku: { not: null },
    },
    include: { mapping: true, seoMetadata: true },
  });
  const youcan = await YouCanClient.create();
  let updated = 0;
  let failed = 0;

  for (const product of products) {
    try {
      if (!product.mapping?.youCanProductId || !product.codSku) continue;
      const remote = await youcan.getProduct(product.mapping.youCanProductId, { include: ['variants'] });
      const payload = await buildDiscountVariantUpdatePayload(remote, product);
      const response = await youcan.updateProduct(product.mapping.youCanProductId, payload);
      await prisma.productMapping.update({
        where: { id: product.mapping.id },
        data: {
          youCanVariantId: youCanPrimaryVariantId(response, product.codSku) ?? product.mapping.youCanVariantId,
          youCanSlug: product.mapping.youCanSlug ?? response.slug ?? product.seoMetadata?.slug,
          youCanPublicUrl: product.mapping.youCanPublicUrl ?? youCanProductPublicUrl(response, (await getOptionalConfig()).YOUCAN_STORE_URL, product.mapping.youCanSlug ?? product.seoMetadata?.slug),
        },
      });
      await prisma.codProduct.update({ where: { id: product.id }, data: { importStatus: ImportStatus.UPDATED, lastYouCanSyncAt: new Date(), lastError: null } });
      updated += 1;
    } catch (error) {
      failed += 1;
      await prisma.codProduct.update({ where: { id: product.id }, data: { lastError: String(error) } });
      await logEvent({ source: LogSource.YOUCAN, level: LogLevel.ERROR, message: 'Failed to update discount variant labels on YouCan', codProductId: product.id, context: toJsonValue({ error: String(error) }) });
    }
  }

  await logEvent({ source: LogSource.YOUCAN, message: `Bulk discount variant update finished: ${updated} updated, ${failed} failed`, context: toJsonValue({ total: products.length, updated, failed }) });
  return { total: products.length, updated, failed };
}

async function buildDiscountVariantUpdatePayload(
  remote: YouCanProduct,
  product: { codSku: string | null; name: string; price: Prisma.Decimal | null; stockQuantity: number | null; visibilityStatus: VisibilityStatus; stockStatus: StockStatus; seoMetadata?: { title: string } | null },
): Promise<YouCanProductUpdatePayload> {
  const discountRules = await prisma.discountRule.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  const activeRules = discountRules.filter((rule) => rule.quantity > 1).sort((a, b) => a.quantity - b.quantity);
  const optionName = (await getSettingValue<string>('youCan.quantityOptionName').catch(() => ''))?.trim() || 'الكمية';
  const singleQuantityLabel = (await getSettingValue<string>('youCan.singleQuantityLabel').catch(() => ''))?.trim() || arabicQuantityValue(1);
  const price = roundSellingPriceToNine(Number(product.price ?? remote.price ?? 0));
  const visible = product.visibilityStatus === VisibilityStatus.VISIBLE && product.stockStatus !== StockStatus.OUT_OF_STOCK;
  const sku = product.codSku ?? stringValue(remote.sku) ?? '';

  if (activeRules.length === 0) {
    return {
      name: stringValue(remote.name) ?? product.seoMetadata?.title ?? product.name,
      has_variants: false,
      price,
      visibility: visible,
      track_inventory: true,
      inventory: product.stockQuantity ?? undefined,
      sku,
    };
  }

  return {
    name: stringValue(remote.name) ?? product.seoMetadata?.title ?? product.name,
    has_variants: true,
    price,
    visibility: visible,
    track_inventory: true,
    variant_options: [{ name: optionName, type: Number((await getOptionalConfig()).YOUCAN_TEXT_BUTTON_VARIANT_TYPE ?? 2), values: [singleQuantityLabel, ...activeRules.map((rule) => rule.label?.trim() || arabicQuantityValue(rule.quantity))] }],
    variants: [
      {
        variations: { [optionName]: singleQuantityLabel },
        price,
        sku,
        inventory: product.stockQuantity ?? undefined,
        is_default: true,
        is_selected: true,
      },
      ...activeRules.map((rule) => ({
        variations: { [optionName]: rule.label?.trim() || arabicQuantityValue(rule.quantity) },
        price: calculateQuantityPrice(price, rule.quantity, Number(rule.discountPercent)),
        sku,
        inventory: product.stockQuantity ?? undefined,
        is_default: false,
        is_selected: false,
      })),
    ],
  };
}

export async function refreshGmcStatus(codProductId: string) {
  const product = await prisma.codProduct.findUniqueOrThrow({ where: { id: codProductId }, include: { mapping: true } });
  if (!product.mapping?.googleProductId) {
    const error = 'Cannot refresh GMC status: this product has not been submitted to Merchant Center.';
    await prisma.codProduct.update({ where: { id: codProductId }, data: { lastError: error } });
    throw new Error(error);
  }
  const merchant = await GoogleMerchantClient.create();
  const response = await merchant.getProductStatus(product.mapping.googleProductId);
  const details = deriveGmcStatusDetails({ response, fallback: product.gmcStatus });
  const status = persistedGmcStatus(details);
  const checkedAt = new Date();
  await prisma.codProduct.update({ where: { id: codProductId }, data: { gmcStatus: status, lastGmcSyncAt: checkedAt, lastError: null } });
  await prisma.gmcSubmission.updateMany({
    where: { codProductId, productId: product.mapping.googleProductId },
    data: {
      status,
      responsePayload: toJsonValue(response),
      destinationStatuses: toJsonValue(response.destinationStatuses ?? null),
      issues: toJsonValue(merchantIssues(response)),
      checkedAt,
    },
  });
  await logEvent({ source: LogSource.GMC, message: `Refreshed GMC status: ${details.state}`, codProductId, context: toJsonValue(details) });
  return { response, details };
}

/** Updates only the GMC price currency for an already-submitted product. */
export async function syncProductGmcCurrency(codProductId: string) {
  const product = await prisma.codProduct.findUniqueOrThrow({
    where: { id: codProductId },
    include: { mapping: true },
  });
  if (!product.mapping?.googleProductId) {
    const error = 'GMC currency not synced: product has not been submitted/mapped.';
    await prisma.codProduct.update({ where: { id: codProductId }, data: { lastError: error } });
    throw new Error(error);
  }

  const env = await getOptionalConfig();
  const currency = normalizeCurrencyCode(env.GMC_CURRENCY ?? 'SAR');
  const merchant = await GoogleMerchantClient.create();
  const current = await merchant.getProductStatus(product.mapping.googleProductId);
  const amountMicros = merchantAmountMicros(current);
  await merchant.patchProductCurrency({
    productInputId: merchantProductInputId(product.mapping.googleProductId),
    price: { amountMicros, currencyCode: currency },
  });
  const syncedAt = new Date();
  await prisma.codProduct.update({ where: { id: codProductId }, data: { lastGmcSyncAt: syncedAt, lastError: null } });
  await logEvent({
    source: LogSource.GMC,
    message: `GMC currency-only update completed: ${currency}`,
    codProductId,
    context: toJsonValue({ currency, amountMicros, updateMask: 'productAttributes.price' }),
  });
  return { currency, amountMicros, updated: true };
}

/** Pushes only price fields to already-mapped YouCan and GMC products. */
export async function syncProductPrice(codProductId: string) {
  const product = await prisma.codProduct.findUniqueOrThrow({
    where: { id: codProductId },
    include: { mapping: true },
  });
  const storedPrice = Number(product.price);
  if (!Number.isFinite(storedPrice) || storedPrice <= 0) throw new Error('Cannot sync price: local product price is invalid.');
  const price = roundSellingPriceToNine(storedPrice);
  if (price !== storedPrice) {
    await prisma.codProduct.update({ where: { id: codProductId }, data: { price } });
  }

  const failures: string[] = [];
  let youCanUpdated = false;
  let gmcUpdated = false;

  if (!product.mapping?.youCanProductId) {
    failures.push('YouCan price not synced: product has not been imported/mapped.');
  } else {
    try {
      const youcan = await YouCanClient.create();
      const remote = await youcan.getProduct(product.mapping.youCanProductId, { include: ['variants'] });
      const variants = youCanProductVariants(remote);
      const rules = await prisma.discountRule.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
      const singleQuantityLabel = (await getSettingValue<string>('youCan.singleQuantityLabel').catch(() => ''))?.trim() || arabicQuantityValue(1);
      const priced = priceYouCanQuantityVariants({ variants, unitPrice: price, rules, singleQuantityLabel });
      const pricedVariants = priced.variants;
      if (priced.unmatchedVariantIds.length) {
        await logEvent({
          source: LogSource.YOUCAN,
          level: LogLevel.WARN,
          message: 'Price-only update preserved unrecognized legacy YouCan variants',
          codProductId,
          context: toJsonValue({ unmatchedVariantIds: priced.unmatchedVariantIds }),
        });
      }
      await youcan.updateProduct(product.mapping.youCanProductId, {
        name: remote.name,
        has_variants: booleanValue(remote.has_variants) ?? variants.length > 0,
        price,
        ...(variants.length ? { variants: pricedVariants } : {}),
      });
      youCanUpdated = true;
      await prisma.codProduct.update({ where: { id: codProductId }, data: { importStatus: ImportStatus.UPDATED, lastYouCanSyncAt: new Date() } });
      await logEvent({ source: LogSource.YOUCAN, message: 'Price-only YouCan update completed', codProductId, context: toJsonValue({ price, variantCount: variants.length, mapping: 'quantity-label' }) });
    } catch (error) {
      failures.push(`YouCan price sync failed: ${String(error)}`);
    }
  }

  const googleProductInputId = product.mapping?.googleProductId;
  if (!googleProductInputId) {
    failures.push('GMC price not synced: product has not been submitted/mapped.');
  } else {
    try {
      const merchant = await GoogleMerchantClient.create();
      const env = await getOptionalConfig();
      const currency = normalizeCurrencyCode(env.GMC_CURRENCY ?? 'SAR');
      await merchant.patchProductPrice({
        productInputId: merchantProductInputId(googleProductInputId),
        price: { amountMicros: priceToMicros(price), currencyCode: currency },
      });
      gmcUpdated = true;
      await prisma.codProduct.update({ where: { id: codProductId }, data: { lastGmcSyncAt: new Date() } });
      await logEvent({ source: LogSource.GMC, message: 'Price-only GMC patch completed', codProductId, context: toJsonValue({ price, currency, updateMask: 'productAttributes.price' }) });
    } catch (error) {
      failures.push(`GMC price sync failed: ${String(error)}`);
    }
  }

  await prisma.codProduct.update({ where: { id: codProductId }, data: { lastError: failures.length ? failures.join(' | ') : null } });
  if (!youCanUpdated && !gmcUpdated) throw new Error(failures.join(' | '));
  if (failures.length) await logEvent({ source: LogSource.SYNC, level: LogLevel.WARN, message: 'Price-only sync partially completed', codProductId, context: toJsonValue({ failures }) });
  return { price, youCanUpdated, gmcUpdated, failures };
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

function merchantProductInputId(productId: string) {
  const marker = '/products/';
  const index = productId.indexOf(marker);
  return index >= 0 ? productId.slice(index + marker.length) : productId;
}

function normalizeCurrencyCode(value: string) {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Invalid GMC currency code: ${value}`);
  return currency;
}

function merchantAmountMicros(response: unknown) {
  const payload = objectValue(response);
  const attributes = objectValue(payload.productAttributes);
  const price = objectValue(attributes.price);
  const amountMicros = stringValue(price.amountMicros);
  if (!amountMicros || !/^\d+$/.test(amountMicros)) {
    throw new Error('Cannot update only GMC currency because the existing Merchant price amount could not be read. No update was sent.');
  }
  return amountMicros;
}
