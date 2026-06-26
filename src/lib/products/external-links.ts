import { CodProduct, ProductMapping, SeoMetadata } from '@prisma/client';

type ProductForLinks = Pick<CodProduct, 'codProductId' | 'codDropProductId' | 'codSku' | 'country' | 'rawPayload'> & {
  mapping?: Pick<ProductMapping, 'youCanPublicUrl' | 'youCanSlug'> | null;
  seoMetadata?: Pick<SeoMetadata, 'slug'> | null;
};

export function youCanProductUrl(product: ProductForLinks, storeUrl?: string | null) {
  if (product.mapping?.youCanPublicUrl) return product.mapping.youCanPublicUrl;
  const slug = product.mapping?.youCanSlug ?? product.seoMetadata?.slug;
  if (!storeUrl || !slug) return undefined;
  return `${storeUrl.replace(/\/$/, '')}/products/${slug}`;
}

export function codProductUrl(product: ProductForLinks, template?: string | null) {
  const normalizedTemplate = template?.trim() || 'https://seller.cod.network/cod-drop/{codDropProductId}/show';
  return normalizedTemplate
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
