import { Prisma, SettingKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { GCC_COUNTRY_CODES, SETTINGS_BY_KEY, type SettingDefinition } from '@/lib/settings/registry';
import { toJsonValue } from '@/lib/http/client';

export type RuntimeSettings = Record<string, unknown>;

const envToSettingKey = new Map(
  [...SETTINGS_BY_KEY.values()].filter((definition) => definition.envKey).map((definition) => [definition.envKey!, definition.key]),
);

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const settings = await prisma.setting.findMany();
  const map = new Map(settings.map((setting) => [setting.key, setting]));
  const result: RuntimeSettings = {};

  for (const definition of SETTINGS_BY_KEY.values()) {
    const stored = map.get(definition.key);
    const envValue = definition.envKey ? process.env[definition.envKey] : undefined;
    result[definition.key] = normalizeSettingValue(definition, stored?.value ?? undefined, envValue);
  }

  return result;
}

export async function getSettingValue<T = unknown>(key: string): Promise<T> {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition) throw new Error(`Unknown setting key: ${key}`);
  const setting = await prisma.setting.findUnique({ where: { key } });
  const envValue = definition.envKey ? process.env[definition.envKey] : undefined;
  return normalizeSettingValue(definition, setting?.value ?? undefined, envValue) as T;
}

export function settingString(settings: RuntimeSettings, key: string) {
  const value = settings[key];
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function settingBoolean(settings: RuntimeSettings, key: string) {
  const value = settings[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

export function settingNumber(settings: RuntimeSettings, key: string, fallback = 0) {
  const value = Number(settings[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function settingStringArray(settings: RuntimeSettings, key: string) {
  const value = settings[key];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

export async function getSettingString(key: string) {
  const value = await getSettingValue(key);
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export async function getSettingBoolean(key: string) {
  const value = await getSettingValue(key);
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

export async function getSettingNumber(key: string, fallback = 0) {
  const value = Number(await getSettingValue(key));
  return Number.isFinite(value) ? value : fallback;
}

export async function upsertSettingValue(key: string, value: unknown) {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition) throw new Error(`Unknown setting key: ${key}`);
  const normalized = normalizeInputValue(definition, value);
  return prisma.setting.upsert({
    where: { key },
    update: { value: toJsonValue(normalized), kind: SettingKind[definition.kind], isSecret: Boolean(definition.isSecret), description: definition.description },
    create: { key, value: toJsonValue(normalized), kind: SettingKind[definition.kind], isSecret: Boolean(definition.isSecret), description: definition.description },
  });
}

export async function ensureSettingDefaults() {
  for (const definition of SETTINGS_BY_KEY.values()) {
    await prisma.setting.upsert({
      where: { key: definition.key },
      update: {
        kind: SettingKind[definition.kind],
        isSecret: Boolean(definition.isSecret),
        description: definition.description,
      },
      create: {
        key: definition.key,
        value: toJsonValue(definition.defaultValue),
        kind: SettingKind[definition.kind],
        isSecret: Boolean(definition.isSecret),
        description: definition.description,
      },
    });
  }
}

export function legacyEnvSettingKey(envKey: string) {
  return envToSettingKey.get(envKey);
}

function normalizeSettingValue(definition: SettingDefinition, storedValue: Prisma.JsonValue | undefined, envValue: string | undefined) {
  const hasStoredValue = storedValue !== undefined && storedValue !== null && !(typeof storedValue === 'string' && storedValue === '');
  if (hasStoredValue) return coerceValue(definition, storedValue);
  if (envValue !== undefined && envValue !== '') return coerceValue(definition, envValue);
  return coerceValue(definition, definition.defaultValue);
}

function normalizeInputValue(definition: SettingDefinition, value: unknown) {
  if (definition.input === 'countries') {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    const allowed = new Set(GCC_COUNTRY_CODES.map(String));
    const normalized = [...new Set(values.map(String).filter((item) => allowed.has(item)))];
    return normalized.length ? normalized : definition.defaultValue;
  }
  return coerceValue(definition, value);
}

function coerceValue(definition: SettingDefinition, value: unknown): unknown {
  if (definition.kind === 'BOOLEAN') {
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true' || String(value) === '1';
  }
  if (definition.kind === 'NUMBER') {
    const number = Number(value);
    return Number.isFinite(number) ? number : Number(definition.defaultValue ?? 0);
  }
  if (definition.kind === 'JSON') {
    if (definition.input === 'countries') {
      const values = Array.isArray(value) ? value : typeof value === 'string' ? parseArrayString(value) : [];
      const allowed = new Set(GCC_COUNTRY_CODES.map(String));
      const normalized = [...new Set(values.map(String).filter((item) => allowed.has(item)))];
      return normalized.length ? normalized : definition.defaultValue;
    }
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return definition.defaultValue;
      }
    }
    return value ?? definition.defaultValue;
  }
  return value == null ? '' : String(value);
}

function parseArrayString(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value.split(',');
  } catch {
    return value.split(',');
  }
}
