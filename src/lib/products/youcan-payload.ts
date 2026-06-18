import { Category, CodProduct, DiscountRule, SeoMetadata } from '@prisma/client';
import { YouCanProductPayload } from '@/lib/integrations/youcan/client';
import { applyDiscount } from '@/lib/pricing/formula';
import { arabicQuantityOptionName, arabicQuantityValue, enforceArabicDescriptionLength } from '@/lib/products/arabic-content';

export const TEXT_BUTTON_VARIANT_TYPE = Number(process.env.YOUCAN_TEXT_BUTTON_VARIANT_TYPE ?? 2);

export function buildYouCanProductPayload(input: {
  product: CodProduct;
  sku: string;
  seo: SeoMetadata;
  category?: Category | null;
  discountRules: DiscountRule[];
  visible: boolean;
}): YouCanProductPayload {
  const price = Number(input.product.price ?? input.product.productCost ?? 0);
  const imageUrls = proxiedImageUrls(input.product);
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
    compare_at_price: input.product.compareAtPrice ? Number(input.product.compareAtPrice) : undefined,
    cost_price: input.product.productCost ? Number(input.product.productCost) : undefined,
    categories: [input.category.youCanCategoryId],
    images: imageUrls.map((url, index) => ({ name: url, order: index + 1, type: 1 as const })),
    meta: { title: input.seo.metaTitle, description: input.seo.metaDescription, images: imageUrls.slice(0, 1) },
    slug: input.seo.slug,
  };

  if (activeRules.length === 0) {
    return {
      ...basePayload,
      has_variants: false,
      inventory: input.product.stockQuantity ?? undefined,
      sku: input.sku,
    };
  }

  const optionName = arabicQuantityOptionName();

  return {
    ...basePayload,
    has_variants: true,
    variant_options: [{ name: optionName, type: TEXT_BUTTON_VARIANT_TYPE, values: [arabicQuantityValue(1), ...activeRules.map((rule) => arabicQuantityValue(rule.quantity))] }],
    variants: [
      {
        variations: { [optionName]: arabicQuantityValue(1) },
        price,
        sku: input.sku,
        inventory: input.product.stockQuantity ?? undefined,
        image: imageUrls[0],
        is_default: true,
        is_selected: true,
      },
      ...activeRules.map((rule) => ({
        variations: { [optionName]: arabicQuantityValue(rule.quantity) },
        price: applyDiscount(price * rule.quantity, Number(rule.discountPercent)),
        sku: input.sku,
        inventory: input.product.stockQuantity ?? undefined,
        image: imageUrls[0],
        is_default: false,
        is_selected: false,
      })),
    ],
  };
}

function proxiedImageUrls(product: CodProduct) {
  const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) return product.imageUrls;
  return product.imageUrls.map((_url, index) => `${baseUrl}/api/images/cod/${product.id}/${index}`);
}
