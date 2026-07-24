import { Queue, type ConnectionOptions } from 'bullmq';
import { CountryCode } from '@prisma/client';
import { getEnv } from '@/lib/env';

export const QUEUE_NAME = 'cod-youcan-gmc-automation';

export type AutomationJobName =
  | 'discover-cod-products'
  | 'ensure-cod-sku'
  | 'enrich-seo'
  | 'regenerate-images'
  | 'import-youcan'
  | 'push-gmc'
  | 'sync-stock'
  | 'refresh-gmc-status'
  | 'sync-youcan-categories'
  | 'bulk-update-discount-variants'
  | 'sync-product-price'
  | 'sync-product-gmc-currency';

export type AutomationJobData = {
  codProductId?: string;
  country?: CountryCode;
  force?: boolean;
};

export function createRedisConnection(): ConnectionOptions {
  const parsed = new URL(getEnv().REDIS_URL);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname && parsed.pathname !== '/' ? Number(parsed.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  } as ConnectionOptions;
}

let queue: Queue<AutomationJobData, unknown, string> | null = null;

export function getAutomationQueue() {
  if (!queue) {
    queue = new Queue<AutomationJobData, unknown, string>(QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }
  return queue;
}

export async function enqueueJob(name: AutomationJobName, data: AutomationJobData = {}) {
  const automationQueue = getAutomationQueue();
  const uniqueSuffix = data.force ? `-${Date.now()}` : '';
  return automationQueue.add(name, data, {
    jobId: data.codProductId ? `${name}-${data.codProductId}${uniqueSuffix}` : `${name}-${Date.now()}`,
  });
}

export type StockSyncSchedule =
  | { mode: 'disabled'; enabledCountries: Array<CountryCode | string> }
  | { mode: 'interval'; enabledCountries: Array<CountryCode | string>; intervalHours: number }
  | { mode: 'daily'; enabledCountries: Array<CountryCode | string>; dailyTime: string; timezone: string };

export async function refreshStockSyncScheduler(input: StockSyncSchedule) {
  const automationQueue = getAutomationQueue();
  const schedulerId = 'sync-stock-automatic';
  if (input.mode === 'disabled' || input.enabledCountries.length === 0) {
    await automationQueue.removeJobScheduler(schedulerId).catch(() => false);
    return { enabled: false, schedulerId };
  }

  const repeat = input.mode === 'interval'
    ? { every: normalizeIntervalHours(input.intervalHours) * 60 * 60 * 1000, immediately: false }
    : dailyRepeatOptions(input.dailyTime, input.timezone);
  await automationQueue.upsertJobScheduler(
    schedulerId,
    repeat,
    {
      name: 'sync-stock',
      data: { force: true },
      opts: {
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    },
  );
  return { enabled: true, schedulerId, mode: input.mode, repeat, countries: input.enabledCountries };
}

export async function getStockSyncScheduler() {
  return getAutomationQueue().getJobScheduler('sync-stock-automatic');
}

function normalizeIntervalHours(value: number) {
  if (!Number.isFinite(value) || value < 1) throw new Error('Sync Stock interval must be at least 1 hour.');
  return Math.round(value);
}

function dailyRepeatOptions(time: string, timezone: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!match) throw new Error('Daily Sync Stock time must use HH:MM format.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('Daily Sync Stock time is invalid.');
  const tz = timezone.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format();
  } catch {
    throw new Error(`Invalid Sync Stock timezone: ${tz}`);
  }
  return { pattern: `${minute} ${hour} * * *`, tz, immediately: false };
}
