import { calculatePrice, roundSellingPriceToNine, type PricingFormula } from '@/lib/pricing/formula';

const recommendedPriceKeys = [
  'recommended_selling_price',
  'recommendedSellingPrice',
  'recommended_price',
  'recommendedPrice',
  'selling_price',
  'sellingPrice',
  'sale_price',
  'salePrice',
  'price',
  'backup_price',
  'backupPrice',
];

const costKeys = ['product_cost', 'productCost', 'cost_price', 'costPrice', 'cost'];

export function codRecommendedPrice(raw: Record<string, unknown>) {
  for (const key of recommendedPriceKeys) {
    const value = numeric(raw[key]);
    if (value && value > 0) return value;
  }

  const upSellPrices = raw.up_sell_and_backup_prices;
  if (Array.isArray(upSellPrices)) {
    for (const entry of upSellPrices) {
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        const value = numeric(record.price ?? record.selling_price ?? record.recommended_price);
        if (value && value > 0) return value;
      }
    }
  }

  return undefined;
}

export function codProductCost(raw: Record<string, unknown>) {
  for (const key of costKeys) {
    const value = numeric(raw[key]);
    if (value && value > 0) return value;
  }
  return undefined;
}

export function codBasePrice(raw: Record<string, unknown>, formula: PricingFormula) {
  return roundSellingPriceToNine(codRecommendedPrice(raw) ?? calculatePrice(codProductCost(raw), formula));
}

export function numeric(value: unknown) {
  if (value == null || value === '') return undefined;
  const match = typeof value === 'string' ? value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/) : null;
  const number = Number(match ? match[0] : value);
  return Number.isFinite(number) ? number : undefined;
}
