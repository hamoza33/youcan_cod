import { getEnv as parseEnv, getOptionalEnv as parseOptionalEnv, type AppEnv } from '@/lib/env';
import { getRuntimeSettings, legacyEnvSettingKey, settingBoolean, settingNumber, settingString } from '@/lib/settings/runtime';

export type RuntimeConfig = AppEnv;

export async function getConfig(): Promise<AppEnv> {
  const env = parseEnv();
  const settings = await getRuntimeSettings();

  return {
    ...env,
    COD_NETWORK_BASE_URL: settingString(settings, 'codNetwork.baseUrl') || env.COD_NETWORK_BASE_URL,
    COD_NETWORK_API_TOKEN: settingString(settings, 'codNetwork.apiToken') || env.COD_NETWORK_API_TOKEN,
    COD_NETWORK_CATALOG_ENDPOINT: settingString(settings, 'codNetwork.catalogEndpoint') || env.COD_NETWORK_CATALOG_ENDPOINT,
    COD_NETWORK_ACCOUNT_PRODUCTS_ENDPOINT: settingString(settings, 'codNetwork.accountProductsEndpoint') || env.COD_NETWORK_ACCOUNT_PRODUCTS_ENDPOINT,
    COD_NETWORK_ADD_PRODUCT_ENDPOINT: settingString(settings, 'codNetwork.addProductEndpoint') || env.COD_NETWORK_ADD_PRODUCT_ENDPOINT,
    COD_NETWORK_PRODUCT_PAGE_URL_TEMPLATE: settingString(settings, 'codNetwork.productPageUrlTemplate') || env.COD_NETWORK_PRODUCT_PAGE_URL_TEMPLATE,
    COD_NETWORK_WEBHOOK_SECRET: settingString(settings, 'codNetwork.webhookSecret') || env.COD_NETWORK_WEBHOOK_SECRET,
    YOUCAN_BASE_URL: settingString(settings, 'youCan.baseUrl') || env.YOUCAN_BASE_URL,
    YOUCAN_API_TOKEN: settingString(settings, 'youCan.apiToken') || env.YOUCAN_API_TOKEN,
    YOUCAN_CLIENT_ID: settingString(settings, 'youCan.clientId') || env.YOUCAN_CLIENT_ID,
    YOUCAN_CLIENT_SECRET: settingString(settings, 'youCan.clientSecret') || env.YOUCAN_CLIENT_SECRET,
    YOUCAN_REDIRECT_URI: settingString(settings, 'youCan.redirectUri') || env.YOUCAN_REDIRECT_URI,
    YOUCAN_REFRESH_TOKEN: settingString(settings, 'youCan.refreshToken') || env.YOUCAN_REFRESH_TOKEN,
    YOUCAN_STORE_URL: settingString(settings, 'youCan.storeUrl') || env.YOUCAN_STORE_URL,
    YOUCAN_TEXT_BUTTON_VARIANT_TYPE: settingNumber(settings, 'youCan.textButtonVariantType', env.YOUCAN_TEXT_BUTTON_VARIANT_TYPE),
    GOOGLE_MERCHANT_ACCOUNT_ID: settingString(settings, 'googleMerchant.accountId') || env.GOOGLE_MERCHANT_ACCOUNT_ID,
    GOOGLE_MERCHANT_DATA_SOURCE_ID: settingString(settings, 'googleMerchant.dataSourceId') || env.GOOGLE_MERCHANT_DATA_SOURCE_ID,
    GOOGLE_MERCHANT_ENABLED: settingBoolean(settings, 'googleMerchant.enabled') ? 'true' : 'false',
    GOOGLE_APPLICATION_CREDENTIALS: settingString(settings, 'googleMerchant.applicationCredentials') || env.GOOGLE_APPLICATION_CREDENTIALS,
    GOOGLE_SERVICE_ACCOUNT_JSON: settingString(settings, 'googleMerchant.serviceAccountJson') || env.GOOGLE_SERVICE_ACCOUNT_JSON,
    AI_PROVIDER_NAME: settingString(settings, 'ai.provider') || env.AI_PROVIDER_NAME,
    AI_BASE_URL: settingString(settings, 'ai.baseUrl') || env.AI_BASE_URL,
    AI_API_KEY: settingString(settings, 'ai.apiKey') || env.AI_API_KEY,
    AI_MODEL: settingString(settings, 'ai.model') || env.AI_MODEL,
    WEB_SEARCH_PROVIDER: settingString(settings, 'webSearch.provider') || env.WEB_SEARCH_PROVIDER,
    WEB_SEARCH_API_KEY: settingString(settings, 'webSearch.apiKey') || env.WEB_SEARCH_API_KEY,
    SERPAPI_API_KEY: settingString(settings, 'image.serpApiKey') || env.SERPAPI_API_KEY,
    BRIGHTDATA_API_KEY: settingString(settings, 'image.brightDataApiKey') || env.BRIGHTDATA_API_KEY,
    BRIGHTDATA_SERP_ZONE: settingString(settings, 'image.brightDataSerpZone') || env.BRIGHTDATA_SERP_ZONE,
    IMAGE_ENRICHMENT_TARGET_COUNT: settingNumber(settings, 'image.enrichmentTargetCount', env.IMAGE_ENRICHMENT_TARGET_COUNT),
    IMAGE_ENRICHMENT_MAX_CANDIDATES: settingNumber(settings, 'image.enrichmentMaxCandidates', env.IMAGE_ENRICHMENT_MAX_CANDIDATES),
    IMAGE_VALIDATION_TIMEOUT_MS: settingNumber(settings, 'image.validationTimeoutMs', env.IMAGE_VALIDATION_TIMEOUT_MS),
    APP_BASE_URL: settingString(settings, 'app.baseUrl') || env.APP_BASE_URL,
    ADMIN_PASSWORD: settingString(settings, 'app.adminPassword') || env.ADMIN_PASSWORD,
    IMPORT_DEFAULT_COUNTRY: settingString(settings, 'country.default') || env.IMPORT_DEFAULT_COUNTRY,
  };
}

export async function getOptionalConfig(): Promise<Partial<AppEnv>> {
  const env = parseOptionalEnv();
  try {
    return await getConfig();
  } catch {
    return env;
  }
}

export async function getConfigString(envKey: keyof AppEnv, fallback = '') {
  const settingKey = legacyEnvSettingKey(String(envKey));
  if (!settingKey) return String(parseOptionalEnv()[envKey] ?? fallback);
  const settings = await getRuntimeSettings();
  return settingString(settings, settingKey) || String(parseOptionalEnv()[envKey] ?? fallback);
}
