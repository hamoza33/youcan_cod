import type { YouCanVariant } from '@/lib/integrations/youcan/client';
import { arabicQuantityValue } from '@/lib/products/arabic-content';
import { calculateQuantityPrice } from '@/lib/pricing/formula';

type QuantityPriceRule = {
  quantity: number;
  discountPercent: unknown;
  label: string;
};

export function priceYouCanQuantityVariants(input: {
  variants: YouCanVariant[];
  unitPrice: number;
  rules: QuantityPriceRule[];
  singleQuantityLabel?: string | null;
}) {
  const singleLabels = new Set([
    normalizeLabel(input.singleQuantityLabel),
    normalizeLabel(input.rules.find((rule) => rule.quantity === 1)?.label),
    normalizeLabel(arabicQuantityValue(1)),
  ].filter(Boolean));
  const multiRules = input.rules.filter((rule) => rule.quantity > 1);
  const unmatchedVariantIds: string[] = [];

  const variants = input.variants.map((variant) => {
    const labels = Object.values(variant.variations ?? {}).map(normalizeLabel).filter(Boolean);
    const isSingle = labels.some((label) => singleLabels.has(label)) || (labels.length === 0 && variant.is_default === true);
    const matchedRule = multiRules.find((rule) => {
      const acceptedLabels = [normalizeLabel(rule.label), normalizeLabel(arabicQuantityValue(rule.quantity))].filter(Boolean);
      return labels.some((label) => acceptedLabels.includes(label));
    });
    const price = isSingle
      ? input.unitPrice
      : matchedRule
        ? calculateQuantityPrice(input.unitPrice, matchedRule.quantity, Number(matchedRule.discountPercent))
        : Number(variant.price ?? input.unitPrice);

    if (!isSingle && !matchedRule) unmatchedVariantIds.push(String(variant.id ?? labels.join('|') ?? 'unknown'));
    return {
      ...(variant.id ? { id: variant.id } : { variations: variant.variations }),
      price,
    };
  });

  return { variants, unmatchedVariantIds };
}

function normalizeLabel(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}
