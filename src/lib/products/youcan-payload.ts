import { Category, CodProduct, DiscountRule, SeoMetadata } from '@prisma/client';
import { YouCanProductPayload } from '@/lib/integrations/youcan/client';
import { calculateQuantityPrice, roundSellingPriceToNine } from '@/lib/pricing/formula';
import { arabicQuantityOptionName, arabicQuantityValue, enforceArabicDescriptionLength } from '@/lib/products/arabic-content';
import { requireCleanCodSku } from '@/lib/products/sku';

export const TEXT_BUTTON_VARIANT_TYPE = Number(process.env.YOUCAN_TEXT_BUTTON_VARIANT_TYPE ?? 2);

export function buildYouCanProductPayload(input: {
  product: CodProduct;
  sku: string;
  seo: SeoMetadata;
  category?: Category | null;
  discountRules: DiscountRule[];
  visible: boolean;
  appBaseUrl?: string | null;
  textButtonVariantType?: number;
  quantityOptionName?: string | null;
  singleQuantityLabel?: string | null;
  relatedProductIds?: string[];
}): YouCanProductPayload {
  const cleanSku = requireCleanCodSku(input.sku);
  const price = roundSellingPriceToNine(Number(input.product.price ?? input.product.productCost ?? 0));
  const imageUrls = proxiedImageUrls(input.product, input.appBaseUrl);
  const activeRules = input.discountRules.filter((rule) => rule.isActive && rule.quantity > 1).sort((a, b) => a.quantity - b.quantity);
  const description = enforceArabicDescriptionLength(input.seo.description);

  if (!input.category?.youCanCategoryId) {
    throw new Error('Cannot import to YouCan without a mapped existing YouCan category. Sync YouCan categories and map the product first.');
  }

  const basePayload = {
    name: input.seo.title,
    description,
    visibility: input.visible,
    track_inventory: true,
    price,
    // Keep structured-data pricing aligned with the price shown to shoppers.
    compare_at_price: null,
    cost_price: input.product.productCost ? Number(input.product.productCost) : undefined,
    categories: [input.category.youCanCategoryId],
    images: imageUrls.map((url, index) => ({ name: url, order: index + 1, type: 1 as const })),
    meta: { title: input.seo.metaTitle, description: input.seo.metaDescription, images: imageUrls },
    slug: input.seo.slug,
    has_related_products: Boolean(input.relatedProductIds?.length),
    related_products: input.relatedProductIds ?? [],
  };

  if (activeRules.length === 0) {
    return {
      ...basePayload,
      has_variants: false,
      inventory: input.product.stockQuantity ?? undefined,
      sku: cleanSku,
    };
  }

  const optionName = input.quantityOptionName?.trim() || arabicQuantityOptionName();
  const singleQuantityLabel = input.singleQuantityLabel?.trim() || arabicQuantityValue(1);
  const quantityLabel = (rule: DiscountRule) => rule.label?.trim() || arabicQuantityValue(rule.quantity);

  return {
    ...basePayload,
    has_variants: true,
    variant_options: [{ name: optionName, type: input.textButtonVariantType ?? TEXT_BUTTON_VARIANT_TYPE, values: [singleQuantityLabel, ...activeRules.map(quantityLabel)] }],
    variants: [
      {
        variations: { [optionName]: singleQuantityLabel },
        price,
        sku: cleanSku,
        inventory: input.product.stockQuantity ?? undefined,
        image: imageUrls[0],
        is_default: true,
        is_selected: true,
      },
      ...activeRules.map((rule) => ({
        variations: { [optionName]: quantityLabel(rule) },
        price: calculateQuantityPrice(price, rule.quantity, Number(rule.discountPercent)),
        sku: quantityVariantSku(cleanSku, rule.quantity),
        inventory: input.product.stockQuantity ?? undefined,
        image: imageUrls[0],
        is_default: false,
        is_selected: false,
      })),
    ],
  };
}

export function quantityVariantSku(baseSku: string, quantity: number) {
  return quantity === 1 ? baseSku : `${baseSku}-Q${quantity}`;
}

function proxiedImageUrls(product: CodProduct, appBaseUrl?: string | null) {
  const baseUrl = appBaseUrl?.replace(/\/$/, '') || process.env.APP_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) return product.imageUrls;
  return product.imageUrls.map((_url, index) => `${baseUrl}/api/images/cod/${product.id}/${index}`);
}
