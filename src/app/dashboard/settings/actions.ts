'use server';

import { revalidatePath } from 'next/cache';
import { SettingKind } from '@prisma/client';
import { prisma } from '@/lib/db';

export async function saveSettings(formData: FormData) {
  const entries = [
    ['country.default', formData.get('country.default') || 'SA', SettingKind.STRING],
    ['pricing.defaultFormula', parseJson(formData.get('pricing.defaultFormula'), { type: 'markup_percent', value: 60, roundTo: 0.99 }), SettingKind.JSON],
    ['visibility.default', formData.get('visibility.default') === 'true', SettingKind.BOOLEAN],
    ['sync.frequencyCron', formData.get('sync.frequencyCron') || '17 */2 * * *', SettingKind.STRING],
    ['ai.provider', formData.get('ai.provider') || 'DuckCoding', SettingKind.STRING],
    ['ai.baseUrl', formData.get('ai.baseUrl') || 'https://www.duckcoding.ai/', SettingKind.STRING],
    ['ai.model', formData.get('ai.model') || 'claude-opus-4-8', SettingKind.STRING],
    ['gmc.feedLabel', formData.get('gmc.feedLabel') || 'SA', SettingKind.STRING],
    ['gmc.contentLanguage', formData.get('gmc.contentLanguage') || 'ar', SettingKind.STRING],
  ] as const;

  for (const [key, value, kind] of entries) {
    await prisma.setting.upsert({
      where: { key },
      update: { value, kind },
      create: { key, value, kind },
    });
  }
  revalidatePath('/dashboard/settings');
}

function parseJson(value: FormDataEntryValue | null, fallback: unknown) {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}
