const DISALLOWED_SKU_WORDS = /(?:قطعة|قطع|اشتري|buy|bundle|pack|qty|quantity)/i;
const QUANTITY_SUFFIX = /(?:[-_\s]*(?:Q|X)\d+)$/i;

export function cleanCodSku(value: string | null | undefined) {
  const sku = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(QUANTITY_SUFFIX, '')
    .replace(/[-_]+$/g, '');

  return sku || undefined;
}

export function requireCleanCodSku(value: string | null | undefined, field = 'COD SKU') {
  const sku = cleanCodSku(value);
  if (!sku || !isCleanCodSku(sku)) {
    throw new Error(`${field} must be the clean COD SKU only.`);
  }
  return sku;
}

export function isCleanCodSku(value: string | null | undefined) {
  if (!value || value.trim() !== value) return false;
  if (/\s/.test(value)) return false;
  if (DISALLOWED_SKU_WORDS.test(value)) return false;
  if (QUANTITY_SUFFIX.test(value)) return false;
  return /^[A-Z0-9][A-Z0-9_-]*$/i.test(value);
}
