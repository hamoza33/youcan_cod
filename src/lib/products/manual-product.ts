import { CountryCode, ProductSourceStatus, SeoStatus, StockStatus, VisibilityStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { calculatePrice } from '@/lib/pricing/formula';
import { normalizeSlug } from '@/lib/seo/generator';
import { toJsonValue } from '@/lib/http/client';

export type ManualProductInput = {
  codProductId?: string;
  codDropProductId?: string;
  codSku: string;
  name: string;
  description?: string;
  price?: number;
  compareAtPrice?: number;
  productCost?: number;
  currency?: string;
  stockQuantity?: number;
  imageUrls?: string[];
  categorySlug?: string;
  visible?: boolean;
  seo?: Partial<{
    productType: string;
    useCase: string;
    title: string;
    description: string;
    slug: string;
    metaTitle: string;
    metaDescription: string;
    keywords: string[];
    safeSellingPoints: string[];
    complianceNotes: string;
    sourceSummary: string;
  }>;
};

export async function upsertManualProduct(input: ManualProductInput) {
  const codSku = normalizeRequired(input.codSku, 'codSku');
  const name = normalizeRequired(input.name, 'name');
  const codProductId = input.codProductId?.trim() || `manual-${codSku}`;
  const currency = input.currency?.trim() || 'SAR';
  const productCost = toPositiveNumber(input.productCost);
  const explicitPrice = toPositiveNumber(input.price);
  const pricingFormula = await getPricingFormula();
  const price = explicitPrice ?? (productCost != null ? calculatePrice(productCost, pricingFormula) : undefined);

  if (price == null || price <= 0) {
    throw new Error('Manual product import requires a positive price or productCost.');
  }

  const category = await resolveCategory(input.categorySlug);
  const stockQuantity = Number.isInteger(input.stockQuantity) ? input.stockQuantity : undefined;
  const stockStatus = stockQuantity === 0 ? StockStatus.OUT_OF_STOCK : StockStatus.IN_STOCK;
  const imageUrls = normalizeImageUrls(input.imageUrls ?? []);

  const existingBySku = await prisma.codProduct.findUnique({ where: { codSku } });
  const existingByProductId = await prisma.codProduct.findUnique({ where: { codProductId_country: { codProductId, country: CountryCode.SA } } });
  if (existingBySku && existingByProductId && existingBySku.id !== existingByProductId.id) {
    throw new Error(`Manual product ${codProductId} and SKU ${codSku} match different existing records. Resolve the duplicate before importing.`);
  }

  const data = {
    codProductId,
    codDropProductId: input.codDropProductId?.trim() || codProductId,
    codSku,
    country: CountryCode.SA,
    sourceStatus: ProductSourceStatus.SKU_CONFIRMED,
    seoStatus: SeoStatus.READY,
    stockStatus,
    visibilityStatus: input.visible === false ? VisibilityStatus.HIDDEN : VisibilityStatus.VISIBLE,
    name,
    rawName: name,
    description: input.description?.trim() || null,
    rawDescription: input.description?.trim() || null,
    productCost,
    price,
    compareAtPrice: toPositiveNumber(input.compareAtPrice),
    currency,
    stockQuantity,
    imageUrls,
    categoryId: category?.id ?? null,
    rawPayload: toJsonValue({ source: 'manual', ...input, codSku, codProductId, imageUrls }),
    lastCodSyncAt: new Date(),
    lastError: null,
  };

  const product = existingBySku ?? existingByProductId
    ? await prisma.codProduct.update({ where: { id: (existingBySku ?? existingByProductId)!.id }, data })
    : await prisma.codProduct.create({ data });

  const seo = buildManualSeo(input, product.id, name, input.description, category?.slug);
  await prisma.seoMetadata.upsert({
    where: { codProductId: product.id },
    update: seo,
    create: { codProductId: product.id, ...seo },
  });

  await prisma.productMapping.upsert({
    where: { codSku },
    update: { codProductId: product.id, codSku, googleOfferId: codSku },
    create: { codProductId: product.id, codSku, googleOfferId: codSku },
  });

  return prisma.codProduct.findUniqueOrThrow({
    where: { id: product.id },
    include: { seoMetadata: true, category: true, mapping: true },
  });
}

async function resolveCategory(categorySlug?: string) {
  if (categorySlug) {
    const category = await prisma.category.findUnique({ where: { slug: categorySlug } });
    if (!category) throw new Error(`Unknown category slug: ${categorySlug}`);
    return category;
  }
  return prisma.category.findFirst({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
}

async function getPricingFormula() {
  const setting = await prisma.setting.findUnique({ where: { key: 'pricing.defaultFormula' } });
  return (setting?.value as { type: 'markup_percent' | 'fixed_markup'; value: number; roundTo?: number } | null) ?? { type: 'markup_percent', value: 60, roundTo: 0.99 };
}

function buildManualSeo(input: ManualProductInput, productId: string, name: string, description?: string, categorySlug?: string | null) {
  const seo = input.seo ?? {};
  const title = clean(seo.title) || name;
  const fullDescription = clean(seo.description) || clean(description) || `${title} متوفر الآن للطلب داخل السعودية.`;
  const metaTitle = truncate(clean(seo.metaTitle) || title, 60);
  const metaDescription = truncate(clean(seo.metaDescription) || fullDescription, 155);
  const slug = normalizeSlug(clean(seo.slug) || title || productId);

  return {
    productType: clean(seo.productType) || 'Manual product',
    useCase: clean(seo.useCase) || 'Manual product import for YouCan store.',
    title,
    description: fullDescription,
    slug,
    metaTitle,
    metaDescription,
    keywords: seo.keywords?.filter(Boolean) ?? [],
    safeSellingPoints: seo.safeSellingPoints?.filter(Boolean) ?? [],
    categorySuggestion: categorySlug ?? input.categorySlug ?? null,
    complianceNotes: clean(seo.complianceNotes) || 'Manual content. Avoid exaggerated or unverifiable claims before advertising.',
    sourceSummary: clean(seo.sourceSummary) || 'Created from manually supplied product fields.',
    aiProvider: 'manual',
    aiModel: 'manual-fallback',
    rawAiResponse: toJsonValue({ source: 'manual-fallback', seo }),
  };
}

function normalizeRequired(value: string | undefined, field: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Manual product import requires ${field}.`);
  return normalized;
}

function normalizeImageUrls(urls: string[]) {
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
}

function toPositiveNumber(value: unknown) {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function clean(value?: string) {
  return value?.trim() || undefined;
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : value.slice(0, maxLength - 1).trimEnd();
}
