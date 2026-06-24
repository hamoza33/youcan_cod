import { config as loadDotEnv } from 'dotenv';
import { ImportStatus, SeoStatus } from '@prisma/client';
import { cleanCodSku, isCleanCodSku } from '@/lib/products/sku';

const SKU_VALIDATION_ERROR = 'Variant/product SKU must be the clean COD SKU only';
const MISSING_SEO_ERROR = 'Cannot import to YouCan before SEO metadata is generated';

type PrismaHandle = Awaited<ReturnType<typeof loadRuntimeModules>>['prisma'];
type EnrichSeo = Awaited<ReturnType<typeof loadRuntimeModules>>['enrichSeo'];
type ImportToYouCan = Awaited<ReturnType<typeof loadRuntimeModules>>['importToYouCan'];

type RecoveryAction =
  | 'clean-sku-then-retry-import'
  | 'retry-import'
  | 'generate-seo-then-import'
  | 'manual-fix-category'
  | 'manual-fix-images'
  | 'manual-fix-credentials'
  | 'manual-review-unknown'
  | 'skip-no-known-recovery';

type RecoveryResult = {
  id: string;
  codProductId: string;
  codSku: string | null;
  cleanedCodSku?: string | null;
  name: string;
  originalError: string | null;
  cause: string;
  fix: string;
  action: RecoveryAction;
  ok: boolean;
  finalImportStatus?: ImportStatus;
  finalSeoStatus?: SeoStatus;
  youCanProductId?: string | null;
  youCanPublicUrl?: string | null;
  error?: string;
};

async function main() {
  loadRuntimeEnv();
  requireDatabaseUrl();
  const { prisma, enrichSeo, importToYouCan } = await loadRuntimeModules();
  const limit = Number(arg('--limit') ?? 0);
  const dryRun = hasArg('--dry-run');
  const products = await prisma.codProduct.findMany({
    where: { OR: [{ lastError: { not: null } }, { importStatus: ImportStatus.FAILED }, { seoStatus: SeoStatus.FAILED }] },
    include: { seoMetadata: true, category: true, mapping: true },
    orderBy: { updatedAt: 'desc' },
    take: limit > 0 ? limit : undefined,
  });

  const results: RecoveryResult[] = [];
  for (const product of products) {
    const originalError = product.lastError;
    const classification = classify(product);
    if (dryRun) {
      results.push({
        id: product.id,
        codProductId: product.codProductId,
        codSku: product.codSku,
        cleanedCodSku: classification.cleanedCodSku ?? null,
        name: product.name,
        originalError,
        cause: classification.cause,
        fix: classification.fix,
        action: classification.action,
        ok: true,
      });
      continue;
    }

    results.push(await recoverProduct({ prisma, enrichSeo, importToYouCan, product, classification, originalError }));
  }

  const summary = results.reduce<Record<string, number>>((counts, result) => {
    const key = `${result.action}:${result.ok ? 'ok' : 'failed'}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  console.log(JSON.stringify({ dryRun, found: products.length, summary, results }, null, 2));
}

async function recoverProduct(input: {
  prisma: PrismaHandle;
  enrichSeo: EnrichSeo;
  importToYouCan: ImportToYouCan;
  product: Awaited<ReturnType<PrismaHandle['codProduct']['findMany']>>[number] & {
    seoMetadata: unknown | null;
    category: { youCanCategoryId: string | null } | null;
    mapping: { youCanProductId: string | null; youCanPublicUrl: string | null } | null;
  };
  classification: ReturnType<typeof classify>;
  originalError: string | null;
}): Promise<RecoveryResult> {
  const { prisma, enrichSeo, importToYouCan, product, classification, originalError } = input;
  try {
    if (classification.action === 'clean-sku-then-retry-import') {
      if (!classification.cleanedCodSku) throw new Error('Could not derive a clean COD SKU for this product.');
      await prisma.codProduct.update({ where: { id: product.id }, data: { codSku: classification.cleanedCodSku } });
      await prisma.productMapping.upsert({
        where: { codSku: classification.cleanedCodSku },
        update: { codProductId: product.id, codSku: classification.cleanedCodSku, googleOfferId: classification.cleanedCodSku },
        create: { codProductId: product.id, codSku: classification.cleanedCodSku, googleOfferId: classification.cleanedCodSku },
      });
      await importToYouCan(product.id);
    }

    if (classification.action === 'generate-seo-then-import') {
      await enrichSeo(product.id, true);
      await importToYouCan(product.id);
    }

    if (classification.action === 'retry-import') {
      await importToYouCan(product.id);
    }

    if (classification.action.startsWith('manual-') || classification.action === 'skip-no-known-recovery') {
      throw new Error(`Not auto-fixable: ${classification.fix}`);
    }

    const refreshed = await prisma.codProduct.findUniqueOrThrow({ where: { id: product.id }, include: { mapping: true } });
    return {
      id: product.id,
      codProductId: product.codProductId,
      codSku: refreshed.codSku,
      cleanedCodSku: classification.cleanedCodSku ?? refreshed.codSku,
      name: product.name,
      originalError,
      cause: classification.cause,
      fix: classification.fix,
      action: classification.action,
      ok: true,
      finalImportStatus: refreshed.importStatus,
      finalSeoStatus: refreshed.seoStatus,
      youCanProductId: refreshed.mapping?.youCanProductId,
      youCanPublicUrl: refreshed.mapping?.youCanPublicUrl,
    };
  } catch (error) {
    const refreshed = await prisma.codProduct.findUnique({ where: { id: product.id } });
    return {
      id: product.id,
      codProductId: product.codProductId,
      codSku: refreshed?.codSku ?? product.codSku,
      cleanedCodSku: classification.cleanedCodSku ?? null,
      name: product.name,
      originalError,
      cause: classification.cause,
      fix: classification.fix,
      action: classification.action,
      ok: false,
      finalImportStatus: refreshed?.importStatus,
      finalSeoStatus: refreshed?.seoStatus,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function classify(product: { lastError: string | null; codSku: string | null; seoMetadata: unknown | null; seoStatus: SeoStatus; importStatus: ImportStatus; category: { youCanCategoryId: string | null } | null; imageUrls: string[] }) {
  const error = product.lastError ?? '';
  const cleanedCodSku = cleanCodSku(product.codSku);
  if ((error.includes(SKU_VALIDATION_ERROR) || (product.codSku && !isCleanCodSku(product.codSku))) && cleanedCodSku && isCleanCodSku(cleanedCodSku)) {
    return {
      action: 'clean-sku-then-retry-import' as const,
      cleanedCodSku,
      cause: 'The stored SKU or generated variant SKU included quantity/bundle suffixes or non-COD text, so pre-import validation rejected it.',
      fix: `Store and send only the clean COD SKU (${cleanedCodSku}) for product SKU and every YouCan variant SKU, then retry import.`,
    };
  }
  if (error.includes(SKU_VALIDATION_ERROR)) {
    return {
      action: 'manual-review-unknown' as const,
      cleanedCodSku,
      cause: 'SKU validation failed, but no safe clean COD SKU could be derived automatically.',
      fix: 'Open the COD seller product, copy the exact account-specific COD SKU, update the local product, then retry YouCan import.',
    };
  }
  if (error.includes(MISSING_SEO_ERROR) || !product.seoMetadata || product.seoStatus === SeoStatus.FAILED) {
    return {
      action: 'generate-seo-then-import' as const,
      cleanedCodSku,
      cause: 'The product did not have ready Arabic SEO metadata, so YouCan import was blocked.',
      fix: 'Regenerate SEO through the AI provider fallback chain, then retry YouCan import.',
    };
  }
  if (/category|YouCan category/i.test(error) || !product.category?.youCanCategoryId) {
    return {
      action: 'manual-fix-category' as const,
      cleanedCodSku,
      cause: 'The product category is missing or not mapped to an existing YouCan category ID.',
      fix: 'Click Sync YouCan categories, map the product/category to a valid YouCan category, then retry import.',
    };
  }
  if (/image|images/i.test(error) || product.imageUrls.length < 4) {
    return {
      action: 'manual-fix-images' as const,
      cleanedCodSku,
      cause: 'The product has fewer than 4 valid exact product images or image enrichment could not find enough matches.',
      fix: 'Run Regenerate images or add valid exact product images, then retry import.',
    };
  }
  if (/TOKEN|API key|credentials|missing/i.test(error)) {
    return {
      action: 'manual-fix-credentials' as const,
      cleanedCodSku,
      cause: 'A required API credential or endpoint is missing.',
      fix: 'Configure the missing credential/endpoint in Settings or .env.production, restart the worker, then retry import.',
    };
  }
  if (product.importStatus === ImportStatus.FAILED) {
    return {
      action: 'retry-import' as const,
      cleanedCodSku,
      cause: 'The previous YouCan import failed after prerequisites appeared to be present.',
      fix: 'Retry the YouCan import with the corrected SKU/category/image/provider logic.',
    };
  }
  return {
    action: 'skip-no-known-recovery' as const,
    cleanedCodSku,
    cause: 'The product is included in the failed/error query but does not match an automatic recovery rule.',
    fix: 'Review the product lastError and logs manually before retrying.',
  };
}

async function loadRuntimeModules() {
  const [{ prisma }, { enrichSeo, importToYouCan }] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/jobs/pipeline'),
  ]);
  return { prisma, enrichSeo, importToYouCan };
}

function loadRuntimeEnv() {
  if (process.env.ENV_FILE) {
    loadDotEnv({ path: process.env.ENV_FILE });
    return;
  }
  loadDotEnv({ path: '.env' });
  loadDotEnv({ path: '.env.production', override: false });
}

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Create .env/.env.production or run with ENV_FILE=/path/to/env before recovering failed products.');
  }
}

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name: string) {
  return process.argv.includes(name);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => {
  if (process.env.DATABASE_URL) {
    const { prisma } = await import('@/lib/db');
    await prisma.$disconnect();
  }
});
