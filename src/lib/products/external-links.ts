import { CodProduct, ProductMapping, SeoMetadata } from '@prisma/client';

type ProductForLinks = Pick<CodProduct, 'codProductId' | 'codDropProductId' | 'codSku' | 'country' | 'rawPayload'> & {
  mapping?: Pick<ProductMapping, 'youCanPublicUrl' | 'youCanSlug'> | null;
  seoMetadata?: Pick<SeoMetadata, 'slug'> | null;
};

const COD_URL_KEYS = [
  'url',
  'product_url',
  'productUrl',
  'marketplace_url',
  'marketplaceUrl',
  'public_url',
  'publicUrl',
  'link',
  'product_link',
  'landing_page',
  'landingPage',
];

export function youCanProductUrl(product: ProductForLinks, storeUrl?: string | null) {
  if (product.mapping?.youCanPublicUrl) return product.mapping.youCanPublicUrl;
  const slug = product.mapping?.youCanSlug ?? product.seoMetadata?.slug;
  if (!storeUrl || !slug) return undefined;
  return `${storeUrl.replace(/\/$/, '')}/products/${slug}`;
}

export function codProductUrl(product: ProductForLinks, template?: string | null) {
  const rawUrl = findUrlInRawPayload(product.rawPayload);
  if (rawUrl) return rawUrl;
  if (!template?.trim()) return undefined;
  return template
    .trim()
    .replaceAll('{codProductId}', encodeURIComponent(product.codProductId))
    .replaceAll('{codDropProductId}', encodeURIComponent(product.codDropProductId ?? product.codProductId))
    .replaceAll('{codSku}', encodeURIComponent(product.codSku ?? ''))
    .replaceAll('{country}', encodeURIComponent(product.country));
}

export function externalProductLinks(product: ProductForLinks, options: { youCanStoreUrl?: string | null; codTemplate?: string | null } = {}) {
  return {
    youCanUrl: youCanProductUrl(product, options.youCanStoreUrl),
    codUrl: codProductUrl(product, options.codTemplate),
  };
}

function findUrlInRawPayload(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || value == null) return undefined;
  if (typeof value === 'string') return isHttpUrl(value) ? value : undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUrlInRawPayload(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  for (const key of COD_URL_KEYS) {
    const candidate = record[key];
    if (typeof candidate === 'string' && isHttpUrl(candidate)) return candidate;
  }
  for (const nestedKey of ['product', 'data', 'item', 'marketplace', 'drop_product', 'dropProduct']) {
    const found = findUrlInRawPayload(record[nestedKey], depth + 1);
    if (found) return found;
  }
  return undefined;
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}
