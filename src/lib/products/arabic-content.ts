export const MONEY_BACK_GUARANTEE_AR = 'نضمن لك إمكانية استرجاع المنتج خلال 15 يومًا وفق سياسة الاسترجاع لدينا.';

export function ensureArabicGuarantee(description: string) {
  const normalized = description.trim();
  if (normalized.includes('15') && /استرجاع|استرداد|ضمان/.test(normalized)) {
    return normalized;
  }
  return `${normalized}\n\n${MONEY_BACK_GUARANTEE_AR}`;
}

export function enforceArabicDescriptionLength(description: string, min = 1000, max = 1500) {
  let normalized = ensureArabicGuarantee(description).trim();
  if (normalized.length < min) {
    normalized = expandDescription(normalized, min);
  }
  if (normalized.length <= max) return normalized;

  const guaranteeMatch = normalized.match(/(?:<p>)?[^<]*(?:15)[^<]*(?:استرجاع|استرداد|ضمان)[\s\S]*$/);
  const guarantee = guaranteeMatch?.[0]?.trim() || `<p>${MONEY_BACK_GUARANTEE_AR}</p>`;
  const allowance = Math.max(200, max - guarantee.length - 2);
  const body = closeOpenList(stripTrailingOpenTag(normalized.slice(0, allowance).trim()));
  return `${body}\n${guarantee}`.slice(0, max);
}

export function isLikelyArabic(value: string) {
  return /[؀-ۿ]/.test(value);
}

export function arabicQuantityOptionName() {
  return 'الكمية';
}

export function arabicQuantityValue(quantity: number) {
  if (quantity <= 1) return 'قطعة واحدة';
  if (quantity === 2) return 'قطعتان';
  if (quantity === 3) return 'ثلاث قطع';
  if (quantity === 5) return 'خمس قطع';
  return `${quantity} قطع`;
}

function expandDescription(value: string, min: number) {
  let output = value;
  const additions = [
    '<h3>معلومات إضافية</h3><p>تم إعداد هذا الوصف ليكون واضحًا ومناسبًا للتسوق الإلكتروني، مع التركيز على الكلمات المفتاحية المرتبطة بالمنتج وتجربة استخدام عملية وآمنة.</p>',
    '<ul><li><strong>اختيار عملي:</strong> مناسب للاستخدام اليومي حسب طبيعة المنتج.</li><li><strong>تفاصيل واضحة:</strong> يساعدك على معرفة المميزات الأساسية قبل الشراء.</li></ul>',
  ];
  for (const addition of additions) {
    if (output.length >= min) break;
    output = output.replace(MONEY_BACK_GUARANTEE_AR, `${addition}\n${MONEY_BACK_GUARANTEE_AR}`);
  }
  return output;
}

function closeOpenList(value: string) {
  const openUl = (value.match(/<ul>/g) ?? []).length;
  const closeUl = (value.match(/<\/ul>/g) ?? []).length;
  if (openUl > closeUl) return `${value}</ul>`;
  return value;
}

function stripTrailingOpenTag(value: string) {
  return value.replace(/<[^/>]*$/, '').trim();
}
