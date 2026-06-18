import { CountryCode } from '@prisma/client';

const aliases: Record<string, CountryCode> = {
  SA: CountryCode.SA,
  KSA: CountryCode.SA,
  SAU: CountryCode.SA,
  'SAUDI ARABIA': CountryCode.SA,
  السعودية: CountryCode.SA,
  AE: CountryCode.AE,
  UAE: CountryCode.AE,
  ARE: CountryCode.AE,
  'UNITED ARAB EMIRATES': CountryCode.AE,
  KW: CountryCode.KW,
  KWT: CountryCode.KW,
  KUWAIT: CountryCode.KW,
  QA: CountryCode.QA,
  QAT: CountryCode.QA,
  QATAR: CountryCode.QA,
  BH: CountryCode.BH,
  BHR: CountryCode.BH,
  BAHRAIN: CountryCode.BH,
  OM: CountryCode.OM,
  OMN: CountryCode.OM,
  OMAN: CountryCode.OM,
};

export function normalizeCountryCode(value: unknown, fallback: CountryCode = CountryCode.SA): CountryCode {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toUpperCase();
  return aliases[normalized] ?? fallback;
}

export function countryMatches(value: unknown, country: CountryCode) {
  if (!value) return country === CountryCode.SA;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return normalizeCountryCode(record.iso_code ?? record.code ?? record.name, country) === country;
  }
  return normalizeCountryCode(value, country) === country;
}

export function countryLabel(country: CountryCode) {
  switch (country) {
    case CountryCode.SA:
      return 'السعودية';
    case CountryCode.AE:
      return 'الإمارات';
    case CountryCode.KW:
      return 'الكويت';
    case CountryCode.QA:
      return 'قطر';
    case CountryCode.BH:
      return 'البحرين';
    case CountryCode.OM:
      return 'عُمان';
  }
}
