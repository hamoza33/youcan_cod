import { LogLevel, LogSource } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logEvent } from '@/lib/logger';
import { toJsonValue } from '@/lib/http/client';

const SERPAPI_PROVIDER = 'SERPAPI';
const DEFAULT_MONTHLY_LIMIT = 250;

type SerpApiAccountResponse = {
  error?: string;
  plan_name?: string;
  searches_per_month?: number;
  this_month_usage?: number;
  plan_searches_left?: number;
  total_searches_left?: number;
};

class SerpApiRequestError extends Error {
  constructor(message: string, public readonly status?: number, public readonly payload?: unknown) {
    super(message);
    this.name = 'SerpApiRequestError';
  }
}

export class SerpApiKeyPoolExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SerpApiKeyPoolExhaustedError';
  }
}

export async function requestSerpApiWithKeyPool<T>(input: {
  provider: string;
  buildUrl: (apiKey: string) => string;
  context?: Record<string, unknown>;
  extractError?: (response: T) => string | undefined;
}) {
  const keys = await usableSerpApiKeys();
  if (!keys.length) {
    await logEvent({
      source: LogSource.SEARCH,
      level: LogLevel.ERROR,
      message: 'No active SerpApi keys are available for image search.',
      context: toJsonValue({ provider: input.provider, ...safeContext(input.context) }),
    });
    throw new SerpApiKeyPoolExhaustedError('No active SerpApi keys are available. Add an active key in Settings > SerpApi keys.');
  }

  const failures: Array<{ id: string; label: string; error: string }> = [];
  for (const [index, key] of keys.entries()) {
    const usage = await markKeyAttempt(key.id);
    try {
      if (index > 0) {
        await logEvent({
          source: LogSource.SEARCH,
          level: LogLevel.WARN,
          message: `Switching to SerpApi key "${key.label}" for ${input.provider}.`,
          context: toJsonValue({ keyId: key.id, keyLabel: key.label, provider: input.provider, ...safeContext(input.context) }),
        });
      }

      const response = await fetchSerpApiJson<T>(input.buildUrl(key.apiKey));
      const apiError = input.extractError?.(response);
      if (apiError) throw new SerpApiRequestError(apiError);

      await prisma.imageSearchApiKey.update({
        where: { id: key.id },
        data: { lastError: null, lastErrorAt: null },
      });
      return response;
    } catch (error) {
      const message = errorMessage(error);
      failures.push({ id: key.id, label: key.label, error: message });
      await prisma.imageSearchApiKey.update({
        where: { id: key.id },
        data: { lastError: message, lastErrorAt: new Date() },
      });
      await logEvent({
        source: LogSource.SEARCH,
        level: LogLevel.WARN,
        message: `SerpApi key "${key.label}" failed after usage ${usage.monthlyUsage}/${usage.monthlyLimit}; trying the next key.`,
        context: toJsonValue({ keyId: key.id, keyLabel: key.label, provider: input.provider, error: message, ...safeContext(input.context) }),
      });
    }
  }

  await logEvent({
    source: LogSource.SEARCH,
    level: LogLevel.ERROR,
    message: `All active SerpApi keys failed for ${input.provider}.`,
    context: toJsonValue({ provider: input.provider, failures, ...safeContext(input.context) }),
  });
  throw new SerpApiKeyPoolExhaustedError(`All active SerpApi keys failed for ${input.provider}.`);
}

export async function syncSerpApiAccountUsage(keyId: string) {
  const key = await prisma.imageSearchApiKey.findUniqueOrThrow({ where: { id: keyId } });
  const response = await fetchSerpApiJson<SerpApiAccountResponse>(`https://serpapi.com/account.json?${new URLSearchParams({ api_key: key.apiKey })}`);
  if (response.error) throw new Error(response.error);

  const currentMonth = usageMonth();
  const remoteMonthlyLimit = numberValue(response.searches_per_month);
  const remoteMonthlyUsage = numberValue(response.this_month_usage);
  const remoteSearchesLeft = numberValue(response.plan_searches_left);
  const remoteTotalSearchesLeft = numberValue(response.total_searches_left);
  const existingMonthlyUsage = key.resetMonth === currentMonth ? key.monthlyUsage : 0;

  return prisma.imageSearchApiKey.update({
    where: { id: key.id },
    data: {
      resetMonth: currentMonth,
      monthlyLimit: remoteMonthlyLimit ?? key.monthlyLimit,
      monthlyUsage: remoteMonthlyUsage == null ? existingMonthlyUsage : Math.max(existingMonthlyUsage, remoteMonthlyUsage),
      remoteMonthlyLimit,
      remoteMonthlyUsage,
      remoteSearchesLeft,
      remoteTotalSearchesLeft,
      remotePlanName: stringValue(response.plan_name),
      remoteSyncedAt: new Date(),
      lastError: null,
      lastErrorAt: null,
    },
  });
}

export async function syncAllSerpApiAccountUsage() {
  const keys = await prisma.imageSearchApiKey.findMany({ where: { provider: SERPAPI_PROVIDER }, orderBy: { createdAt: 'asc' } });
  const results = [];
  for (const key of keys) {
    try {
      results.push(await syncSerpApiAccountUsage(key.id));
    } catch (error) {
      await prisma.imageSearchApiKey.update({ where: { id: key.id }, data: { lastError: errorMessage(error), lastErrorAt: new Date() } });
      await logEvent({
        source: LogSource.SEARCH,
        level: LogLevel.WARN,
        message: `Failed to sync SerpApi account credits for "${key.label}".`,
        context: toJsonValue({ keyId: key.id, keyLabel: key.label, error: errorMessage(error) }),
      });
    }
  }
  return results;
}

export function usageMonth(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function maskSerpApiKey(apiKey: string) {
  if (apiKey.length <= 12) return `${apiKey.slice(0, 3)}…${apiKey.slice(-3)}`;
  return `${apiKey.slice(0, 6)}…${apiKey.slice(-6)}`;
}

async function usableSerpApiKeys() {
  await importLegacyEnvKeyIfNeeded();
  const currentMonth = usageMonth();
  const keys = await prisma.imageSearchApiKey.findMany({
    where: { provider: SERPAPI_PROVIDER, isActive: true },
    orderBy: [{ monthlyUsage: 'asc' }, { createdAt: 'asc' }],
  });

  const normalized = await Promise.all(keys.map(async (key) => {
    if (key.resetMonth === currentMonth) return key;
    return prisma.imageSearchApiKey.update({
      where: { id: key.id },
      data: { resetMonth: currentMonth, monthlyUsage: 0, lastError: null, lastErrorAt: null },
    });
  }));

  return normalized
    .filter((key) => key.monthlyLimit > 0 && key.monthlyUsage < key.monthlyLimit)
    .filter((key) => key.remoteTotalSearchesLeft == null || key.remoteTotalSearchesLeft > 0)
    .sort((a, b) => {
      const usageDelta = a.monthlyUsage - b.monthlyUsage;
      if (usageDelta !== 0) return usageDelta;
      const aUsed = a.lastUsedAt?.getTime() ?? 0;
      const bUsed = b.lastUsedAt?.getTime() ?? 0;
      if (aUsed !== bUsed) return aUsed - bUsed;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
}

async function markKeyAttempt(keyId: string) {
  return prisma.imageSearchApiKey.update({
    where: { id: keyId },
    data: {
      monthlyUsage: { increment: 1 },
      totalUsage: { increment: 1 },
      lastUsedAt: new Date(),
    },
    select: { monthlyUsage: true, monthlyLimit: true },
  });
}

async function importLegacyEnvKeyIfNeeded() {
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) return;
  const existing = await prisma.imageSearchApiKey.findUnique({ where: { apiKey } });
  if (existing) return;
  const count = await prisma.imageSearchApiKey.count({ where: { provider: SERPAPI_PROVIDER } });
  if (count > 0) return;
  await prisma.imageSearchApiKey.create({
    data: {
      provider: SERPAPI_PROVIDER,
      label: 'Legacy SERPAPI_API_KEY',
      apiKey,
      monthlyLimit: DEFAULT_MONTHLY_LIMIT,
      resetMonth: usageMonth(),
    },
  });
}

async function fetchSerpApiJson<T>(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  const payload = text ? safeJson(text) : null;
  if (!response.ok) {
    throw new SerpApiRequestError(`SerpApi request failed with ${response.status} ${response.statusText}`, response.status, payload);
  }
  return payload as T;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function safeContext(context?: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(context ?? {}).filter(([key]) => !/api.?key|token|secret|password/i.test(key)));
}

function errorMessage(error: unknown) {
  if (error instanceof SerpApiRequestError) return `${error.message}${error.payload ? `: ${JSON.stringify(error.payload).slice(0, 300)}` : ''}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
