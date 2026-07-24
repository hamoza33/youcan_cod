import { CountryCode, LogSource } from '@prisma/client';
import { ApiError, requestJson } from '@/lib/http/client';
import { getConfig } from '@/lib/settings/config';
import { countryMatches } from '@/lib/countries';
import { codRecommendedPrice } from '@/lib/products/cod-pricing';

export class MissingCodEndpointError extends Error {
  constructor() {
    super(
      'Missing COD Network add/select product endpoint. Set COD_NETWORK_ADD_PRODUCT_ENDPOINT after providing official COD Network documentation for adding a drop product to the seller account and retrieving the account-specific SKU.',
    );
    this.name = 'MissingCodEndpointError';
  }
}

export type CodMedia = {
  url?: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
};

export type CodDropProduct = {
  id: string | number;
  name: string;
  sku?: string;
  product_cost?: number | string;
  price?: number | string;
  currency?: string;
  quantity?: number;
  country?: string | { name?: string; iso_code?: string; code?: string };
  country_name?: string;
  country_iso_code?: string;
  recommended_selling_price?: number | string;
  recommended_price?: number | string;
  selling_price?: number | string;
  backup_price?: number | string;
  up_sell_and_backup_prices?: unknown;
  media?: CodMedia[];
  image?: string;
  image_url?: string;
  path_image?: string;
  description?: string;
  notes?: string | null;
  related?: unknown;
  [key: string]: unknown;
};

export type CodSellerProduct = {
  id: string | number;
  sku: string;
  name?: string;
  price?: number | string;
  currency?: string;
  status?: string;
  stocks?: Array<{ country?: string; country_iso_code?: string; quantity?: number }>;
  country_iso_code?: string;
  recommended_selling_price?: number | string;
  recommended_price?: number | string;
  selling_price?: number | string;
  backup_price?: number | string;
  product_cost?: number | string;
  up_sell_and_backup_prices?: unknown;
  quantity?: number;
  image_url?: string;
  path_image?: string;
  image?: string;
  [key: string]: unknown;
};

type CodListResponse<T> = T[] | { data?: T[]; meta?: { pagination?: { current_page?: number; total_pages?: number; links?: { next?: string | null } } } };

export type CodEnsureSellerProductResult = {
  sellerProduct: CodSellerProduct;
  sku: string;
};

export class CodNetworkClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly catalogEndpoint: string;
  private readonly accountProductsEndpoint: string;
  private readonly addProductEndpoint?: string;

  private constructor(config: { baseUrl: string; token?: string; catalogEndpoint: string; accountProductsEndpoint: string; addProductEndpoint?: string }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
    this.catalogEndpoint = config.catalogEndpoint;
    this.accountProductsEndpoint = config.accountProductsEndpoint;
    this.addProductEndpoint = config.addProductEndpoint;
  }

  static async create() {
    const env = await getConfig();
    return new CodNetworkClient({
      baseUrl: env.COD_NETWORK_BASE_URL,
      token: env.COD_NETWORK_API_TOKEN,
      catalogEndpoint: env.COD_NETWORK_CATALOG_ENDPOINT,
      accountProductsEndpoint: env.COD_NETWORK_ACCOUNT_PRODUCTS_ENDPOINT,
      addProductEndpoint: env.COD_NETWORK_ADD_PRODUCT_ENDPOINT,
    });
  }

  async listAvailableProducts(input: { country: CountryCode; sku?: string; name?: string; limit?: number }) {
    const params = new URLSearchParams();
    params.set('limit', String(input.limit ?? 100));
    if (input.sku) params.set('sku', input.sku);
    if (input.name) params.set('name', input.name);
    const products = await this.getPaginated<CodDropProduct>(this.endpointUrl(this.catalogEndpoint), params);
    return products.filter((product) => isCountryProduct(product, input.country));
  }

  async listSellerProducts() {
    const params = new URLSearchParams({ limit: '100' });
    return this.getPaginated<CodSellerProduct>(this.endpointUrl(this.accountProductsEndpoint), params);
  }

  async findSellerProductByDropProduct(dropProduct: CodDropProduct) {
    const sellerProducts = await this.listSellerProducts();
    const dropId = String(dropProduct.id);
    const dropSku = dropProduct.sku ? String(dropProduct.sku) : undefined;
    return sellerProducts.find((product) => {
      const productAny = product as Record<string, unknown>;
      return (
        String(productAny.drop_product_id ?? productAny.dropProductId ?? productAny.product_id ?? productAny.marketplace_product_id ?? '') === dropId ||
        (dropSku ? String(product.sku) === dropSku : false)
      );
    });
  }

  async ensureSellerProduct(dropProduct: CodDropProduct): Promise<CodEnsureSellerProductResult> {
    const existing = await this.findSellerProductByDropProduct(dropProduct);
    if (existing?.sku) {
      return { sellerProduct: existing, sku: existing.sku };
    }

    const endpoint = this.addProductEndpoint;
    if (!endpoint) {
      throw new MissingCodEndpointError();
    }

    const url = this.endpointUrl(endpoint);
    let created: CodSellerProduct | { data?: CodSellerProduct };
    try {
      created = await this.post<CodSellerProduct | { data?: CodSellerProduct }>(url, buildAddProductPayload(dropProduct));
    } catch (error) {
      // COD Network returns 422 when a catalog item was already dropped, but its
      // seller record uses a different numeric id and exposes no catalog id.
      // Recover that existing record by an exact normalized product-name match.
      if (isAlreadyDroppedError(error)) {
        const recovered = await this.findSellerProductByExactName(dropProduct);
        if (recovered?.sku) return { sellerProduct: recovered, sku: recovered.sku };
      }
      throw error;
    }
    const sellerProduct: CodSellerProduct = isWrappedSellerProduct(created) ? created.data : (created as CodSellerProduct);

    if (!sellerProduct.sku) {
      const refreshed = await this.findSellerProductByDropProduct(dropProduct);
      if (refreshed?.sku) return { sellerProduct: refreshed, sku: refreshed.sku };
      throw new Error('COD Network did not return a seller SKU after adding/selecting the product.');
    }

    return { sellerProduct, sku: sellerProduct.sku };
  }

  private async findSellerProductByExactName(dropProduct: CodDropProduct) {
    const expectedName = normalizeProductName(dropProduct.name);
    if (!expectedName) return undefined;
    const matches = (await this.listSellerProducts()).filter((product) =>
      normalizeProductName(product.name) === expectedName && isCountryProduct(product, dropProductCountry(dropProduct)),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  private async getPaginated<T>(url: string, params: URLSearchParams) {
    const items: T[] = [];
    let page = Number(params.get('page') ?? 1);
    let totalPages = 1;

    do {
      params.set('page', String(page));
      const response = await this.get<CodListResponse<T>>(`${url}?${params}`);
      const data = Array.isArray(response) ? response : response.data ?? [];
      items.push(...data);
      totalPages = Array.isArray(response) ? page : response.meta?.pagination?.total_pages ?? page;
      page += 1;
    } while (page <= totalPages);

    return items;
  }

  private endpointUrl(endpoint: string) {
    return endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  }

  private headers() {
    if (!this.token) {
      throw new Error('COD_NETWORK_API_TOKEN is missing. Add it to the environment before running live COD sync.');
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  private get<T>(url: string) {
    return requestJson<T>(url, { headers: this.headers(), source: LogSource.COD });
  }

  private post<T>(url: string, body: unknown) {
    return requestJson<T>(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      source: LogSource.COD,
    });
  }
}

export function isCountryProduct(product: CodDropProduct | CodSellerProduct, country: CountryCode) {
  const countryObject = typeof product.country === 'object' && product.country !== null ? product.country as { iso_code?: string; code?: string } : undefined;
  const iso = product.country_iso_code ?? countryObject?.iso_code ?? countryObject?.code;
  if (iso) return countryMatches(iso, country);
  const countryValue = typeof product.country === 'string' ? product.country : product.country_name;
  if (!countryValue) return country === CountryCode.SA;
  return countryMatches(countryValue, country);
}

export function codImageUrls(product: CodDropProduct | CodSellerProduct) {
  const mediaUrls = 'media' in product && Array.isArray(product.media)
    ? product.media.map((media) => media.url ?? media.name)
    : [];
  return [product.image, product.image_url, product.path_image, ...mediaUrls].filter((url): url is string => Boolean(url));
}

function buildAddProductPayload(dropProduct: CodDropProduct) {
  const recommendedPrice = codRecommendedPrice(dropProduct as Record<string, unknown>) ?? 99;
  return {
    product_id: dropProduct.id,
    up_sell_and_backup_prices: [
      {
        quantity: 1,
        price: recommendedPrice,
        backup_price: null,
      },
    ],
  };
}

function isWrappedSellerProduct(value: CodSellerProduct | { data?: CodSellerProduct }): value is { data: CodSellerProduct } {
  return typeof value === 'object' && value !== null && 'data' in value && Boolean(value.data);
}

function isAlreadyDroppedError(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 422) return false;
  const payload = error.payload as { errors?: { product_id?: unknown }; message?: unknown } | null;
  const details = JSON.stringify(payload?.errors?.product_id ?? payload?.message ?? '').toLowerCase();
  return details.includes('already dropped');
}

function normalizeProductName(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[^a-z0-9\p{L}]+/gu, ' ').replace(/\s+/g, ' ').trim() : '';
}

function dropProductCountry(product: CodDropProduct) {
  const value = product.country_iso_code ?? (typeof product.country === 'string' ? product.country : product.country?.iso_code ?? product.country?.code) ?? product.country_name;
  const normalized = String(value ?? 'SA').toUpperCase();
  return (['SA', 'AE', 'KW', 'QA', 'BH', 'OM'].includes(normalized) ? normalized : 'SA') as CountryCode;
}
