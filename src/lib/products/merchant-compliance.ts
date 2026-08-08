export type MerchantComplianceDecision = {
  excluded: boolean;
  reasons: string[];
};

type ProductText = {
  name?: string | null;
  rawName?: string | null;
  description?: string | null;
  rawDescription?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

const WEAPON_PATTERN = /\b(?:airsoft|firearm|gun|guns|pistol|rifle|revolver|shotgun|weapon)\b|(?:مسدس|بندقية|سلاح|أسلحة)/iu;
const MASSAGE_GUN_PATTERN = /\bmassage\s+gun\b|مسدس\s+(?:تدليك|مساج)/iu;
const TOBACCO_PATTERN = /\b(?:ashtray|cigar(?:ette)?s?|hookah|rolling\s+papers?|shisha|smoking\s+pipe|tobacco|vapes?|vaping)\b|(?:أرجيلة|ارجيلة|تبغ|تدخين|سجائر?|سيجار|شيشة|فيب|منفضة\s+سجائر)/iu;
const ADULT_PATTERN = /\b(?:delay\s+(?:cream|gel|spray)|erectile|intimate\s+stimulant|libido|male\s+enhancement|penis|sex\s+toy|sexual\s+enhancement)\b|(?:تكبير\s+العضو|تأخير\s+القذف|مقوي\s+جنسي|منشط\s+جنسي)/iu;

/**
 * Conservative storefront and Merchant filter for products Google explicitly
 * prohibits or routinely classifies as restricted adult inventory. It runs on
 * both source and generated copy so renaming a prohibited product cannot bypass
 * the guardrail.
 */
export function assessMerchantCompliance(product: ProductText): MerchantComplianceDecision {
  const text = normalize([
    product.name,
    product.rawName,
    product.description,
    product.rawDescription,
    product.seoTitle,
    product.seoDescription,
  ].filter(Boolean).join(' '));
  const reasons: string[] = [];

  if (WEAPON_PATTERN.test(text) && !MASSAGE_GUN_PATTERN.test(text)) reasons.push('weapons or gun-related product');
  if (TOBACCO_PATTERN.test(text)) reasons.push('tobacco or smoking-related product');
  if (ADULT_PATTERN.test(text)) reasons.push('adult or sexual-enhancement product');

  return { excluded: reasons.length > 0, reasons };
}

export function blockingMerchantIssueReasons(issues: unknown): string[] {
  if (!Array.isArray(issues)) return [];
  const reasons = new Set<string>();
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    const value = issue as Record<string, unknown>;
    if (String(value.severity ?? '').toUpperCase() !== 'DISAPPROVED') continue;
    const signal = `${String(value.code ?? '')} ${String(value.description ?? '')}`.toLowerCase();
    if (/guns?_parts|guns? and parts/.test(signal)) reasons.add('Google guns and parts policy');
    if (/tobacco/.test(signal)) reasons.add('Google tobacco policy');
    if (/promotional.*overlay|overlay.*image/.test(signal)) reasons.add('promotional overlay on image');
    if (/product_page.*unavailable|landing_page.*(?:unavailable|error)|website.*crawl/.test(signal)) reasons.add('product page unavailable');
    if (/restricted_nfs|sexual_interests/.test(signal)) reasons.add('restricted adult content');
  }
  return [...reasons];
}

function normalize(value: string) {
  return value.toLowerCase().normalize('NFKC').replace(/[\u064b-\u065f\u0670]/g, ' ').replace(/\s+/g, ' ').trim();
}
