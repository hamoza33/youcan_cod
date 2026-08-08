import { Category, CodProduct, ProductMapping, SeoMetadata, StockStatus } from '@prisma/client';
import { MerchantProductInput, priceToMicros } from '@/lib/integrations/google-merchant/client';

export function buildMerchantProductInput(input: {
  product: CodProduct;
  mapping: ProductMapping;
  seo: SeoMetadata;
  category?: Category | null;
  appBaseUrl: string;
  contentLanguage?: string;
  feedLabel?: string;
  currencyCode?: string;
}): MerchantProductInput {
  const price = Number(input.product.price ?? input.product.productCost ?? 0);
  const offerId = input.mapping.codSku;
  const link = input.mapping.youCanPublicUrl || `${input.appBaseUrl.replace(/\/$/, '')}/products/${input.seo.slug}`;
  const imageLink = input.product.imageUrls[0];

  if (!imageLink) {
    throw new Error(`Cannot push ${offerId} to Google Merchant Center without a product image.`);
  }

  return {
    offerId,
    contentLanguage: input.contentLanguage ?? 'ar',
    feedLabel: input.feedLabel ?? 'SA',
    productAttributes: {
      title: input.seo.metaTitle || input.seo.title,
      description: input.seo.metaDescription || input.seo.description,
      link,
      imageLink,
      additionalImageLinks: input.product.imageUrls.slice(1, 10),
      availability: input.product.stockStatus === StockStatus.OUT_OF_STOCK ? 'OUT_OF_STOCK' : 'IN_STOCK',
      price: { amountMicros: priceToMicros(price), currencyCode: input.currencyCode ?? 'SAR' },
      condition: 'NEW',
      googleProductCategory: input.category?.googleProductCategory ?? undefined,
      customLabel0: 'COD Network',
      customLabel1: input.category?.slug,
    },
  };
}
