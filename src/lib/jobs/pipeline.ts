import {
  CountryCode,
  GmcStatus,
  ImportStatus,
  JobStatus,
  JobType,
  LogLevel,
  LogSource,
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
import { validateBeforeYouCanImport, shouldMarkNeedsReview } from '@/lib/products/import-validation';
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
    await prisma.productMapping.upsert({
      where: { codSku: product.codSku },
      update: { codProductId, codSku: product.codSku },
      create: { codProductId, codSku: product.codSku, googleOfferId: product.codSku },
    });
    await enqueueJob('enrich-seo', { codProductId });
    return product.codSku;
  }

  const client = await CodNetworkClient.create();
  const result = await client.ensureSellerProduct((product.rawPayload ?? {}) as CodDropProduct);

  const formula = await getPricingFormula();
  const sellerProduct = result.sellerProduct as Record<string, unknown>;
  const sellerImageUrls = codImageUrls(result.sellerProduct);
  await prisma.codProduct.update({
    where: { id: codProductId },
    data: {
      codSku: result.sku,
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
    where: { codSku: result.sku },
    update: { codProductId, codSku: result.sku },
    create: { codProductId, codSku: result.sku, googleOfferId: result.sku },
  });

  await logEvent({ source: LogSource.COD, message: `Confirmed COD SKU ${result.sku}`, codProductId });
  await enqueueJob('enrich-seo', { codProductId });
  return result.sku;
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
  const product = await prisma.codProduct.findUniqueOrThrow({
    where: { id: codProductId },
    include: { seoMetadata: true, category: true, mapping: true },
  });

  if (!product.codSku) throw new Error('Cannot import to YouCan before COD SKU is confirmed.');
  if (!product.seoMetadata) throw new Error('Cannot import to YouCan before SEO metadata is generated.');

  await prisma.codProduct.update({ where: { id: codProductId }, data: { importStatus: ImportStatus.IMPORTING } });

  try {
    const category = product.category?.youCanCategoryId ? product.category : await ensureMappedCategory(product.seoMetadata.categorySuggestion);
    const importProduct = category?.id === product.categoryId ? product : { ...product, category, categoryId: category?.id ?? product.categoryId };
    if (category?.id && category.id !== product.categoryId) {
      await prisma.codProduct.update({ where: { id: codProductId }, data: { categoryId: category.id } });
    }
    const validation = await validateBeforeYouCanImport({ product: importProduct, sku: product.codSku });
    if (!validation.ok) {
      await prisma.codProduct.update({
        where: { id: codProductId },
        data: { importStatus: ImportStatus.FAILED, seoStatus: shouldMarkNeedsReview(validation.errors), lastError: validation.errors.join(' | ') },
      });
      throw new Error(`Pre-import validation failed: ${validation.errors.join(' | ')}`);
    }
    if (validation.validImageUrls.join('|') !== product.imageUrls.join('|')) {
      await prisma.codProduct.update({ where: { id: codProductId }, data: { imageUrls: validation.validImageUrls } });
    }
    const productForPayload = { ...importProduct, imageUrls: validation.validImageUrls };
    const env = await getOptionalConfig();
    const discountRules = await prisma.discountRule.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    const payload = buildYouCanProductPayload({
      product: productForPayload,
      sku: product.codSku,
      seo: product.seoMetadata,
      category,
      discountRules,
      visible: product.visibilityStatus === VisibilityStatus.VISIBLE,
      appBaseUrl: env.APP_BASE_URL,
      textButtonVariantType: Number(env.YOUCAN_TEXT_BUTTON_VARIANT_TYPE ?? 2),
    });

    const youcan = await YouCanClient.create();
    const youcanProduct = await youcan.createOrUpdateBySku(product.codSku, payload, product.mapping?.youCanProductId ?? undefined);

    const publicUrl = youCanProductPublicUrl(youcanProduct, env.YOUCAN_STORE_URL, youcanProduct.slug ?? product.seoMetadata.slug);
    const variantId = youCanPrimaryVariantId(youcanProduct, product.codSku);
    await prisma.productMapping.upsert({
      where: { codSku: product.codSku },
      update: {
        codProductId,
        youCanProductId: youcanProduct.id,
        youCanVariantId: variantId,
        youCanSlug: youcanProduct.slug ?? product.seoMetadata.slug,
        youCanPublicUrl: publicUrl,
      },
      create: {
        codProductId,
        codSku: product.codSku,
        youCanProductId: youcanProduct.id,
        youCanVariantId: variantId,
        youCanSlug: youcanProduct.slug ?? product.seoMetadata.slug,
        youCanPublicUrl: publicUrl,
        googleOfferId: product.codSku,
      },
    });

    await prisma.codProduct.update({
      where: { id: codProductId },
      data: { importStatus: ImportStatus.IMPORTED, lastYouCanSyncAt: new Date(), lastError: null },
    });

    await logEvent({ source: LogSource.YOUCAN, message: `Imported/updated YouCan product ${youcanProduct.id}`, codProductId });
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
