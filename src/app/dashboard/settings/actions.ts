'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { SETTINGS, SETTINGS_BY_KEY } from '@/lib/settings/registry';
import { getRuntimeSettings, getSettingValue, settingNumber, settingStringArray, upsertSettingValue } from '@/lib/settings/runtime';
import { enqueueJob, refreshStockSyncScheduler } from '@/lib/jobs/queue';
import { syncAllSerpApiAccountUsage, syncSerpApiAccountUsage, usageMonth } from '@/lib/products/serpapi-key-pool';
import { testAiProvider } from '@/lib/ai/provider-chain';

const SECRET_KEEP_VALUE = '__KEEP_SECRET__';

export async function saveSettings(formData: FormData) {
  for (const definition of SETTINGS) {
    const rawValue = definition.input === 'countries' ? formData.getAll(definition.key) : formData.get(definition.key);
    if (definition.isSecret && (rawValue == null || String(rawValue) === SECRET_KEEP_VALUE)) continue;
    const value = definition.input === 'json' ? parseJson(rawValue as FormDataEntryValue | null, definition.defaultValue) : rawValue;
    await upsertSettingValue(definition.key, value ?? definition.defaultValue);
  }
  await syncStockSchedulerFromSettings();
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard/products');
}

export async function updateAllGmcCurrencies(formData: FormData) {
  const currency = normalizeCurrency(formData.get('gmc.currency'));
  await upsertSettingValue('gmc.currency', currency);
  const products = await prisma.codProduct.findMany({
    where: { mapping: { is: { googleProductId: { not: null } } } },
    select: { id: true },
  });
  for (const product of products) {
    await enqueueJob('sync-product-gmc-currency', { codProductId: product.id, force: true });
  }
  await prisma.logEvent.create({
    data: {
      source: 'GMC',
      level: 'INFO',
      message: `Queued GMC currency-only updates for ${products.length} existing product(s): ${currency}.`,
      context: { productCount: products.length, currency },
    },
  });
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

export async function saveDiscountRules() {
  await persistDiscountRules();
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard/products');
}

export async function triggerBulkDiscountVariantUpdate() {
  await persistDiscountRules();
  await enqueueJob('bulk-update-discount-variants', { force: true });
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard/products');
}

async function persistDiscountRules() {
  const canonicalRules = [
    { quantity: 1, discountPercent: 0, label: 'أريد واحدة فقط', sortOrder: 10 },
    { quantity: 3, discountPercent: 33, label: 'أريد اثنان + واحدة مجانا', sortOrder: 20 },
    { quantity: 5, discountPercent: 40, label: 'أريد ثلاثة + اثنين مجانا', sortOrder: 30 },
  ] as const;

  await prisma.$transaction(async (tx) => {
    await tx.discountRule.deleteMany({
      where: {
        NOT: {
          OR: canonicalRules.map((rule) => ({ quantity: rule.quantity, discountPercent: rule.discountPercent })),
        },
      },
    });
    for (const rule of canonicalRules) {
      await tx.discountRule.upsert({
        where: { quantity_discountPercent: { quantity: rule.quantity, discountPercent: rule.discountPercent } },
        update: { label: rule.label, sortOrder: rule.sortOrder, isActive: true },
        create: { ...rule, isActive: true },
      });
    }
  });
}

export async function readSecretSetting(key: string) {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition?.isSecret) throw new Error('Only secret settings can be revealed this way.');
  return String(await getSettingValue(key) ?? '');
}

export async function addSerpApiKey(formData: FormData) {
  const apiKey = String(formData.get('apiKey') ?? '').trim();
  if (!apiKey) return;
  const label = String(formData.get('label') ?? '').trim() || `SerpApi key ${await prisma.imageSearchApiKey.count({ where: { provider: 'SERPAPI' } }) + 1}`;
  const monthlyLimit = normalizeMonthlyLimit(formData.get('monthlyLimit'));
  await prisma.imageSearchApiKey.upsert({
    where: { apiKey },
    update: { label, monthlyLimit, isActive: true, lastError: null, lastErrorAt: null },
    create: { provider: 'SERPAPI', label, apiKey, monthlyLimit, resetMonth: usageMonth(), isActive: true },
  });
  revalidatePath('/dashboard/settings');
}

export async function updateSerpApiKey(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await prisma.imageSearchApiKey.update({
    where: { id },
    data: {
      label: String(formData.get('label') ?? '').trim() || 'SerpApi key',
      monthlyLimit: normalizeMonthlyLimit(formData.get('monthlyLimit')),
      isActive: formData.get('isActive') === 'true',
    },
  });
  revalidatePath('/dashboard/settings');
}

export async function deleteSerpApiKey(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await prisma.imageSearchApiKey.delete({ where: { id } });
  revalidatePath('/dashboard/settings');
}

export async function syncSerpApiKeyUsage(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (id) {
    await syncSerpApiAccountUsage(id).catch(async (error) => {
      await prisma.imageSearchApiKey.update({ where: { id }, data: { lastError: String(error), lastErrorAt: new Date() } });
    });
  } else {
    await syncAllSerpApiAccountUsage();
  }
  revalidatePath('/dashboard/settings');
}

export async function testAiProviderAction(providerInput: 'openai' | 'anthropic' | 'chain') {
  const provider = providerInput === 'openai' || providerInput === 'anthropic' || providerInput === 'chain' ? providerInput : 'chain';
  try {
    const result = await testAiProvider(provider);
    await prisma.logEvent.create({
      data: {
        source: 'AI',
        level: 'INFO',
        message: `AI provider test succeeded for ${provider}.`,
        context: { result },
      },
    });
    revalidatePath('/dashboard/settings');
    revalidatePath('/dashboard/logs');
    return { ...result, ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.logEvent.create({
      data: {
        source: 'AI',
        level: 'ERROR',
        message: `AI provider test failed for ${provider}.`,
        context: { error: message },
      },
    });
    revalidatePath('/dashboard/settings');
    revalidatePath('/dashboard/logs');
    return { ok: false as const, provider, error: message };
  }
}

function normalizeMonthlyLimit(value: FormDataEntryValue | null) {
  const number = Number(value ?? 250);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 250;
}

async function syncStockSchedulerFromSettings() {
  const settings = await getRuntimeSettings();
  await refreshStockSyncScheduler({
    enabledCountries: settingStringArray(settings, 'country.enabled'),
    intervalHours: settingNumber(settings, 'sync.stockIntervalHours', 0),
  });
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

function normalizeCurrency(value: FormDataEntryValue | null) {
  const currency = String(value ?? 'SAR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('GMC currency must be a three-letter ISO 4217 code.');
  return currency;
}
