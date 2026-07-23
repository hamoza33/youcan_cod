import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  COD_NETWORK_BASE_URL: z.string().url().default('https://api.cod.network/v2'),
  COD_NETWORK_API_TOKEN: z.string().optional(),
  COD_NETWORK_CATALOG_ENDPOINT: z.string().default('/seller/marketplace/products'),
  COD_NETWORK_ACCOUNT_PRODUCTS_ENDPOINT: z.string().default('/seller/drop-products'),
  COD_NETWORK_ADD_PRODUCT_ENDPOINT: z.string().optional(),
  COD_NETWORK_PRODUCT_PAGE_URL_TEMPLATE: z.string().optional(),
  YOUCAN_BASE_URL: z.string().url().default('https://api.youcan.shop'),
  YOUCAN_API_TOKEN: z.string().optional(),
  YOUCAN_CLIENT_ID: z.string().optional(),
  YOUCAN_CLIENT_SECRET: z.string().optional(),
  YOUCAN_REDIRECT_URI: z.string().url().optional(),
  YOUCAN_REFRESH_TOKEN: z.string().optional(),
  YOUCAN_STORE_URL: z.string().url().optional(),
  YOUCAN_TEXT_BUTTON_VARIANT_TYPE: z.coerce.number().default(2),
  YOUCAN_QUANTITY_OPTION_NAME: z.string().default('الكمية'),
  YOUCAN_SINGLE_QUANTITY_LABEL: z.string().default('قطعة واحدة'),
  GOOGLE_MERCHANT_ACCOUNT_ID: z.string().optional(),
  GOOGLE_MERCHANT_DATA_SOURCE_ID: z.string().optional(),
  GOOGLE_MERCHANT_ENABLED: z.enum(['true', 'false']).default('false'),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  AI_PROVIDER_NAME: z.string().default('DuckCoding'),
  AI_BASE_URL: z.string().url().default('https://www.duckcoding.ai/'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-4-8'),
  AI_PROVIDER_ORDER: z.string().default('openai,anthropic'),
  ANTHROPIC_PROVIDER_NAME: z.string().default('Anthropic'),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-sonnet-latest'),
  WEB_SEARCH_PROVIDER: z.string().default('manual'),
  WEB_SEARCH_API_KEY: z.string().optional(),
  SERPER_API_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),
  BRIGHTDATA_API_KEY: z.string().optional(),
  BRIGHTDATA_SERP_ZONE: z.string().default('serp_api1'),
  IMAGE_ENRICHMENT_TARGET_COUNT: z.coerce.number().int().min(1).max(5).default(5),
  IMAGE_ENRICHMENT_MAX_CANDIDATES: z.coerce.number().int().min(10).max(60).default(35),
  IMAGE_VALIDATION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(5000),
  ADMIN_PASSWORD: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
  GMC_FEED_LABEL: z.string().default('SA'),
  GMC_CONTENT_LANGUAGE: z.string().default('ar'),
  GMC_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default('SAR'),
  COD_NETWORK_WEBHOOK_SECRET: z.string().optional(),
  IMPORT_DEFAULT_COUNTRY: z.string().default('SA'),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv() {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
}

export function getOptionalEnv() {
  return envSchema.partial().parse(process.env);
}
