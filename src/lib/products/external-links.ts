import { CodProduct, ProductMapping, SeoMetadata } from '@prisma/client';

type ProductForLinks = Pick<CodProduct, 'codProductId' | 'codDropProductId' | 'codSku' | 'country' | 'rawPayload'> & {
  mapping?: Pick<ProductMapping, 'youCanPublicUrl' | 'youCanSlug' | 'googleOfferId' | 'googleProductId'> | null;
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

export function googleMerchantProductUrl(product: ProductForLinks, accountId?: string | null) {
  if (!accountId || !product.mapping?.googleProductId) return undefined;
  const productId = merchantProductId(product.mapping.googleProductId);
  const [language = 'ar', feedLabel = product.country, ...offerParts] = productId.split('~');
  const offerId = product.mapping.googleOfferId ?? offerParts.join('~') ?? product.codSku;
  if (!offerId) return undefined;
  const query = new URLSearchParams({
    a: accountId,
    offerId,
    language,
    channel: '0',
    feedLabel: feedLabel || product.country,
  });
  return `https://merchants.google.com/mc/items/details?${query.toString()}`;
}

export function externalProductLinks(product: ProductForLinks, options: { youCanStoreUrl?: string | null; codTemplate?: string | null; googleMerchantAccountId?: string | null } = {}) {
  return {
    youCanUrl: youCanProductUrl(product, options.youCanStoreUrl),
    codUrl: codProductUrl(product, options.codTemplate),
    gmcUrl: googleMerchantProductUrl(product, options.googleMerchantAccountId),
  };
}

function merchantProductId(productId: string) {
  const marker = '/products/';
  const index = productId.indexOf(marker);
  return index >= 0 ? productId.slice(index + marker.length) : productId;
}
