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

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
