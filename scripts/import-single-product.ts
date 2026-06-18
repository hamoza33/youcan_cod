import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

let disconnectPrisma: (() => Promise<void>) | undefined;

function buildInputSchema() {
  return z.object({
    codProductId: z.string().optional(),
    codDropProductId: z.string().optional(),
    codSku: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    price: z.coerce.number().positive().optional(),
    compareAtPrice: z.coerce.number().positive().optional(),
    productCost: z.coerce.number().positive().optional(),
    currency: z.string().default('SAR'),
    stockQuantity: z.coerce.number().int().nonnegative().optional(),
    imageUrls: z.array(z.string()).default([]),
    categorySlug: z.string().optional(),
    visible: z.boolean().default(true),
    seo: z.record(z.unknown()).optional(),
    pushGmc: z.boolean().default(process.env.GOOGLE_MERCHANT_ENABLED === 'true'),
  });
}

type SingleProductInput = z.infer<ReturnType<typeof buildInputSchema>>;

async function main() {
  loadRuntimeEnv();
  const input = buildInputSchema().parse(readInput());

  const [{ GmcStatus }, { prisma }, { upsertManualProduct }, { importToYouCan, pushToGmc }] = await Promise.all([
    import('@prisma/client'),
    import('@/lib/db'),
    import('@/lib/products/manual-product'),
    import('@/lib/jobs/pipeline'),
  ]);
  disconnectPrisma = () => prisma.$disconnect();

  const product = await upsertManualProduct(input);
  console.log(`Prepared local product ${product.id} with SKU ${product.codSku}`);

  const youCanProduct = await importToYouCan(product.id, { enqueueGmc: false });
  const refreshed = await prisma.codProduct.findUniqueOrThrow({ where: { id: product.id }, include: { mapping: true } });

  console.log(JSON.stringify({
    ok: true,
    codProductId: refreshed.id,
    codSku: refreshed.codSku,
    youCanProductId: refreshed.mapping?.youCanProductId,
    youCanVariantId: refreshed.mapping?.youCanVariantId,
    youCanSlug: refreshed.mapping?.youCanSlug,
    youCanPublicUrl: refreshed.mapping?.youCanPublicUrl,
    importStatus: refreshed.importStatus,
    youCanResponse: {
      id: youCanProduct.id,
      slug: youCanProduct.slug,
      public_url: youCanProduct.public_url,
    },
  }, null, 2));

  if (input.pushGmc) {
    const gmcResponse = await pushToGmc(product.id);
    const withGmc = await prisma.codProduct.findUniqueOrThrow({ where: { id: product.id }, include: { mapping: true } });
    console.log(JSON.stringify({
      gmcSubmitted: true,
      gmcStatus: withGmc.gmcStatus,
      googleProductId: withGmc.mapping?.googleProductId,
      response: gmcResponse,
    }, null, 2));
  } else if (process.env.GOOGLE_MERCHANT_ENABLED !== 'true') {
    await prisma.codProduct.update({ where: { id: product.id }, data: { gmcStatus: GmcStatus.NOT_SUBMITTED } });
    console.log('Google Merchant push skipped because GOOGLE_MERCHANT_ENABLED is not true.');
  }
}

function loadRuntimeEnv() {
  if (process.env.ENV_FILE) {
    loadDotEnv({ path: process.env.ENV_FILE });
    return;
  }
  loadDotEnv({ path: '.env' });
  loadDotEnv({ path: '.env.production', override: false });
}

function readInput(): SingleProductInput {
  const jsonArgIndex = process.argv.findIndex((arg) => arg === '--json');
  if (jsonArgIndex >= 0) {
    const json = process.argv[jsonArgIndex + 1];
    if (!json) throw new Error('--json requires a JSON object argument.');
    return JSON.parse(json) as SingleProductInput;
  }

  if (process.env.PRODUCT_JSON) {
    return JSON.parse(process.env.PRODUCT_JSON) as SingleProductInput;
  }

  return {
    codProductId: process.env.PRODUCT_COD_ID,
    codDropProductId: process.env.PRODUCT_DROP_ID,
    codSku: requireEnv('PRODUCT_SKU'),
    name: requireEnv('PRODUCT_NAME'),
    description: process.env.PRODUCT_DESCRIPTION,
    price: envNumber('PRODUCT_PRICE'),
    compareAtPrice: envNumber('PRODUCT_COMPARE_AT_PRICE'),
    productCost: envNumber('PRODUCT_COST'),
    currency: process.env.PRODUCT_CURRENCY ?? 'SAR',
    stockQuantity: envNumber('PRODUCT_STOCK'),
    imageUrls: splitList(process.env.PRODUCT_IMAGE_URLS),
    categorySlug: process.env.PRODUCT_CATEGORY_SLUG,
    visible: process.env.PRODUCT_VISIBLE !== 'false',
    pushGmc: process.env.PRODUCT_PUSH_GMC === 'true',
  };
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. Set it or pass --json '{...}'.`);
  return value;
}

function envNumber(name: string) {
  const value = process.env[name];
  if (value == null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be numeric.`);
  return number;
}

function splitList(value?: string) {
  return value?.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) ?? [];
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma?.();
  });
