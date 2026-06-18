import { CountryCode, LogSource } from '@prisma/client';
import { getEnv } from '@/lib/env';
import { requestJson } from '@/lib/http/client';
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

  constructor() {
    const env = getEnv();
    this.baseUrl = env.COD_NETWORK_BASE_URL.replace(/\/$/, '');
    this.token = env.COD_NETWORK_API_TOKEN;
    this.catalogEndpoint = env.COD_NETWORK_CATALOG_ENDPOINT;
    this.accountProductsEndpoint = env.COD_NETWORK_ACCOUNT_PRODUCTS_ENDPOINT;
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

    const endpoint = process.env.COD_NETWORK_ADD_PRODUCT_ENDPOINT;
    if (!endpoint) {
      throw new MissingCodEndpointError();
    }

    const url = this.endpointUrl(endpoint);
    const created = await this.post<CodSellerProduct | { data?: CodSellerProduct }>(url, buildAddProductPayload(dropProduct));
    const sellerProduct: CodSellerProduct = isWrappedSellerProduct(created) ? created.data : (created as CodSellerProduct);

    if (!sellerProduct.sku) {
      const refreshed = await this.findSellerProductByDropProduct(dropProduct);
      if (refreshed?.sku) return { sellerProduct: refreshed, sku: refreshed.sku };
      throw new Error('COD Network did not return a seller SKU after adding/selecting the product.');
    }

    return { sellerProduct, sku: sellerProduct.sku };
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
