import { Worker } from 'bullmq';
import { CountryCode, ImportStatus, JobStatus, JobType, LogLevel, LogSource, SeoStatus } from '@prisma/client';
import { createRedisConnection, QUEUE_NAME, type AutomationJobData, type AutomationJobName } from '@/lib/jobs/queue';
import { discoverCodProducts, enrichSeo, ensureCodSku, importToYouCan, pushToGmc, refreshGmcStatus, regenerateProductImages, syncStock } from '@/lib/jobs/pipeline';
import { syncYouCanCategories } from '@/lib/categories/youcan-sync';
import { prisma } from '@/lib/db';
import { logEvent } from '@/lib/logger';
import { getSettingValue } from '@/lib/settings/runtime';

const jobTypeMap: Record<AutomationJobName, JobType> = {
  'discover-cod-products': JobType.DISCOVER_COD_PRODUCTS,
  'ensure-cod-sku': JobType.ENSURE_COD_SKU,
  'enrich-seo': JobType.ENRICH_SEO,
  'regenerate-images': JobType.BULK_EDIT,
  'import-youcan': JobType.IMPORT_YOUCAN,
  'push-gmc': JobType.PUSH_GMC,
  'sync-stock': JobType.SYNC_STOCK,
  'refresh-gmc-status': JobType.REFRESH_GMC_STATUS,
  'sync-youcan-categories': JobType.SYNC_YOUCAN_CATEGORIES,
};

async function startWorker() {
  const worker = new Worker<AutomationJobData, unknown, AutomationJobName>(
    QUEUE_NAME,
    async (job) => {
      const importJob = await prisma.importJob.create({
        data: {
          type: jobTypeMap[job.name],
          status: JobStatus.RUNNING,
          codProductId: job.data.codProductId,
          attempts: job.attemptsMade + 1,
          payload: job.data,
          startedAt: new Date(),
        },
      });

      try {
        const result = await runAutomationJob(job.name, job.data);
        await prisma.importJob.update({
          where: { id: importJob.id },
          data: { status: JobStatus.COMPLETED, result: result as object, finishedAt: new Date() },
        });
        return result;
      } catch (error) {
        await prisma.importJob.update({
          where: { id: importJob.id },
          data: { status: JobStatus.FAILED, error: String(error), finishedAt: new Date() },
        });
        if (job.data.codProductId) {
          await prisma.codProduct.update({
            where: { id: job.data.codProductId },
            data: {
              lastError: String(error),
              importStatus: job.name === 'import-youcan' ? ImportStatus.FAILED : undefined,
              seoStatus: job.name === 'enrich-seo' ? SeoStatus.FAILED : undefined,
            },
          });
        }
        await logEvent({ source: LogSource.SYSTEM, level: LogLevel.ERROR, message: `Job ${job.name} failed`, codProductId: job.data.codProductId, context: { error: String(error) } });
        throw error;
      }
    },
    { connection: createRedisConnection(), concurrency: await workerConcurrency() },
  );

  worker.on('ready', () => {
    console.log(`Worker listening on queue ${QUEUE_NAME}`);
  });

  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.name} failed`, error);
  });
}

async function workerConcurrency() {
  return Math.max(1, await getSettingValue<number>('worker.concurrency').catch(() => Number(process.env.WORKER_CONCURRENCY ?? 4)));
}

async function runAutomationJob(name: AutomationJobName, data: AutomationJobData) {
  switch (name) {
    case 'discover-cod-products': {
      const defaultCountry = await getSettingValue<CountryCode>('country.default').catch(() => CountryCode.SA);
      return discoverCodProducts(data.country ?? defaultCountry);
    }
    case 'ensure-cod-sku':
      if (!data.codProductId) throw new Error('codProductId is required');
      return ensureCodSku(data.codProductId);
    case 'enrich-seo':
      if (!data.codProductId) throw new Error('codProductId is required');
      return enrichSeo(data.codProductId, data.force);
    case 'regenerate-images':
      if (!data.codProductId) throw new Error('codProductId is required');
      return regenerateProductImages(data.codProductId);
    case 'import-youcan':
      if (!data.codProductId) throw new Error('codProductId is required');
      return importToYouCan(data.codProductId);
    case 'push-gmc':
      if (!data.codProductId) throw new Error('codProductId is required');
      return pushToGmc(data.codProductId);
    case 'sync-stock':
      return syncStock(data.country);
    case 'refresh-gmc-status':
      if (!data.codProductId) throw new Error('codProductId is required');
      return refreshGmcStatus(data.codProductId);
    case 'sync-youcan-categories':
      return syncYouCanCategories();
  }
}

startWorker().catch((error) => {
  console.error('Worker failed to start', error);
  process.exit(1);
});
