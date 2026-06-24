import { LogLevel, LogSource, SeoStatus, type Category, type CodProduct, type SeoMetadata } from '@prisma/client';
import { logEvent } from '@/lib/logger';
import { isLikelyArabic } from '@/lib/products/arabic-content';
import { validateImageUrls } from '@/lib/products/image-validation';
import { TEXT_BUTTON_VARIANT_TYPE } from '@/lib/products/youcan-payload';
import { isCleanCodSku } from '@/lib/products/sku';

export type ImportValidationInput = {
  product: CodProduct & { seoMetadata: SeoMetadata | null; category: Category | null };
  sku: string;
};

export async function validateBeforeYouCanImport(input: ImportValidationInput) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { product, sku } = input;

  if (!isCleanCodSku(sku)) {
    errors.push('Variant/product SKU must be the clean COD SKU only.');
  }
  if (!product.codSku) errors.push('Product must be added to COD seller list and have a confirmed COD SKU before YouCan import.');
  if (!product.seoMetadata) errors.push('SEO metadata is missing.');
  if (product.seoMetadata) {
    if (!isLikelyArabic(product.seoMetadata.title)) errors.push('Product title must be Arabic.');
    if (!isLikelyArabic(product.seoMetadata.description)) errors.push('Product description must be Arabic.');
    const len = product.seoMetadata.description.length;
    if (len < 1000 || len > 1500) errors.push(`Arabic formatted description must be 1000-1500 characters. Current length: ${len}.`);
    if (!product.seoMetadata.metaTitle || !isLikelyArabic(product.seoMetadata.metaTitle)) errors.push('Arabic meta title is required.');
    if (!product.seoMetadata.metaDescription || !isLikelyArabic(product.seoMetadata.metaDescription)) errors.push('Arabic meta description is required.');
    if (!product.seoMetadata.keywords.length) errors.push('Arabic keywords are required.');
  }
  if (!product.category?.youCanCategoryId) {
    errors.push('Product must be assigned to an existing synced YouCan category.');
  }
  if (!Number.isFinite(TEXT_BUTTON_VARIANT_TYPE) || TEXT_BUTTON_VARIANT_TYPE <= 0) {
    errors.push('YouCan textual button variant type is not configured correctly.');
  }

  const validation = await validateImageUrls(product.imageUrls, { max: 5, candidates: 12 });
  if (validation.valid.length < 4) {
    errors.push(`At least 4 valid exact product images are required before YouCan import. Current valid image count: ${validation.valid.length}.`);
  }

  for (const warning of warnings) {
    await logEvent({ source: LogSource.SYSTEM, level: LogLevel.WARN, message: warning, codProductId: product.id, context: { validation: validation.results } });
  }

  if (errors.length) {
    await logEvent({ source: LogSource.SYSTEM, level: LogLevel.ERROR, message: 'Pre-import validation failed', codProductId: product.id, context: { errors, warnings, validation: validation.results } });
    return { ok: false as const, errors, warnings, validImageUrls: validation.valid };
  }

  return { ok: true as const, errors, warnings, validImageUrls: validation.valid };
}

export function shouldMarkNeedsReview(errors: string[]) {
  return errors.some((error) => /category|description|title|SEO|Arabic/i.test(error)) ? SeoStatus.NEEDS_REVIEW : undefined;
}
