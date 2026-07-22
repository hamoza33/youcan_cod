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
  | 'sync-product-price';

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

export async function refreshStockSyncScheduler(input: { enabledCountries: Array<CountryCode | string>; intervalHours: number }) {
  const automationQueue = getAutomationQueue();
  const schedulerId = 'sync-stock-automatic';
  if (!Number.isFinite(input.intervalHours) || input.intervalHours <= 0 || input.enabledCountries.length === 0) {
    await automationQueue.removeJobScheduler(schedulerId).catch(() => false);
    return { enabled: false, schedulerId };
  }

  const intervalMs = Math.max(1, Math.round(input.intervalHours)) * 60 * 60 * 1000;
  await automationQueue.upsertJobScheduler(
    schedulerId,
    { every: intervalMs, immediately: false },
    {
      name: 'sync-stock',
      data: { force: true },
      opts: {
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    },
  );
  return { enabled: true, schedulerId, intervalMs, countries: input.enabledCountries };
}
