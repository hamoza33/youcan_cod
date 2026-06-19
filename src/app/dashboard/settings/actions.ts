'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { SETTINGS, SETTINGS_BY_KEY } from '@/lib/settings/registry';
import { arabicQuantityValue } from '@/lib/products/arabic-content';
import { getSettingValue, upsertSettingValue } from '@/lib/settings/runtime';

const SECRET_KEEP_VALUE = '__KEEP_SECRET__';

export async function saveSettings(formData: FormData) {
  for (const definition of SETTINGS) {
    const rawValue = definition.input === 'countries' ? formData.getAll(definition.key) : formData.get(definition.key);
    if (definition.isSecret && (rawValue == null || String(rawValue) === SECRET_KEEP_VALUE)) continue;
    const value = definition.input === 'json' ? parseJson(rawValue as FormDataEntryValue | null, definition.defaultValue) : rawValue;
    await upsertSettingValue(definition.key, value ?? definition.defaultValue);
  }
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard/products');
}

export async function saveCategories(formData: FormData) {
  const ids = formData.getAll('category.id').map(String);
  for (const id of ids) {
    await prisma.category.update({
      where: { id },
      data: {
        name: String(formData.get(`category.${id}.name`) ?? '').trim() || undefined,
        youCanCategoryId: emptyToNull(formData.get(`category.${id}.youCanCategoryId`)),
        googleProductCategory: emptyToNull(formData.get(`category.${id}.googleProductCategory`)),
        isActive: formData.get(`category.${id}.isActive`) === 'true',
        sortOrder: Number(formData.get(`category.${id}.sortOrder`) ?? 0),
      },
    });
  }
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard/products');
}

export async function saveDiscountRules(formData: FormData) {
  const ids = formData.getAll('discount.id').map(String);
  for (const id of ids) {
    await prisma.discountRule.update({
      where: { id },
      data: {
        quantity: Number(formData.get(`discount.${id}.quantity`) ?? 1),
        discountPercent: Number(formData.get(`discount.${id}.discountPercent`) ?? 0),
        label: String(formData.get(`discount.${id}.label`) ?? '').trim() || arabicQuantityValue(Number(formData.get(`discount.${id}.quantity`) ?? 1)),
        isActive: formData.get(`discount.${id}.isActive`) === 'true',
        sortOrder: Number(formData.get(`discount.${id}.sortOrder`) ?? 0),
      },
    });
  }

  const newQuantity = Number(formData.get('discount.new.quantity') ?? 0);
  const newDiscountPercent = Number(formData.get('discount.new.discountPercent') ?? 0);
  if (newQuantity > 1 && Number.isFinite(newDiscountPercent) && newDiscountPercent >= 0) {
    const label = String(formData.get('discount.new.label') ?? '').trim() || arabicQuantityValue(newQuantity);
    await prisma.discountRule.create({
      data: {
        quantity: newQuantity,
        discountPercent: newDiscountPercent,
        label,
        isActive: true,
        sortOrder: Number(formData.get('discount.new.sortOrder') ?? 100),
      },
    }).catch(async () => {
      await prisma.discountRule.updateMany({ where: { quantity: newQuantity }, data: { discountPercent: newDiscountPercent, label, isActive: true } });
    });
  }
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard/products');
}

export async function readSecretSetting(key: string) {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition?.isSecret) throw new Error('Only secret settings can be revealed this way.');
  return String(await getSettingValue(key) ?? '');
}

function parseJson(value: FormDataEntryValue | null, fallback: unknown) {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function emptyToNull(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}
