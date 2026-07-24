import { Decimal } from '@prisma/client/runtime/library';

export type PricingFormula = {
  type: 'markup_percent' | 'fixed_markup';
  value: number;
  roundTo?: number;
};

export function calculatePrice(cost: Decimal | number | string | null | undefined, formula: PricingFormula) {
  const base = Number(cost ?? 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const raw = formula.type === 'fixed_markup' ? base + formula.value : base * (1 + formula.value / 100);
  if (formula.roundTo == null) return roundMoney(raw);
  const floor = Math.floor(raw);
  return roundMoney(floor + formula.roundTo);
}

export function applyDiscount(price: number, discountPercent: number) {
  return roundMoney(price * (1 - discountPercent / 100));
}

/**
 * Normalizes a selling price to the nearest positive whole-SAR amount ending in 9.
 * Examples: 119.4 -> 119, 238.8 -> 239, 358.2 -> 359.
 */
export function roundSellingPriceToNine(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(9, Math.round((value - 9) / 10) * 10 + 9);
}

/** Calculates a quantity variant from the already-finalized one-unit selling price. */
export function calculateQuantityPrice(unitPrice: number, quantity: number, discountPercent: number) {
  return roundSellingPriceToNine(unitPrice * quantity * (1 - discountPercent / 100));
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
