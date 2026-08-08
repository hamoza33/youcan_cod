import { LogSource } from '@prisma/client';
import { requestJson } from '@/lib/http/client';
import { getConfig } from '@/lib/settings/config';

export type YouCanProductImage = {
  name: string;
  order?: number;
  type: 1 | 2;
};

export type YouCanVariant = {
  id?: string;
  variations?: Record<string, string>;
  price?: number;
  weight?: number;
  sku?: string;
  barcode?: string;
  inventory?: number;
  is_default?: boolean;
  is_selected?: boolean;
  image?: string;
  [key: string]: unknown;
};

export type YouCanProductPayload = {
  name: string;
  description?: string;
  visibility?: boolean;
  has_variants: boolean;
  track_inventory?: boolean;
  inventory?: number;
  sku?: string;
  price: number;
  compare_at_price?: number;
  cost_price?: number;
  categories?: string[];
  variant_options?: Array<{ name: string; type: number; values: string[] }>;
  variants?: YouCanVariant[];
  images?: YouCanProductImage[];
  meta?: {
    title?: string;
    description?: string;
    images?: string[];
  };
  slug?: string;
  has_related_products?: boolean;
  related_products?: string[];
};

export type YouCanProductUpdatePayload = Pick<YouCanProductPayload, 'name' | 'has_variants' | 'price'> & Partial<Omit<YouCanProductPayload, 'name' | 'has_variants' | 'price'>>;

export type YouCanProduct = {
  id: string;
  name: string;
  slug?: string;
  public_url?: string | null;
  url?: string | null;
  price?: number;
  sku?: string;
  variants?: YouCanVariant[] | { data?: YouCanVariant[] };
  images?: Array<{ id?: string; url?: string; name?: string }>;
  [key: string]: unknown;
};

export type YouCanCategory = {
  id: string;
  name: string;
  slug?: string;
  [key: string]: unknown;
};

export type YouCanCategoryPayload = {
  name: string;
  slug?: string;
  description?: string;
  parent_id?: string;
  show_on_collection?: boolean;
  meta?: {
    title?: string;
    description?: string;
  };
};

type YouCanCategoryCreateResponse = YouCanCategory | { data?: YouCanCategory };

type YouCanCategoryResponse = YouCanCategory[] | { data?: YouCanCategory[]; links?: { next?: string | null }; meta?: { pagination?: { current_page?: number; total_pages?: number; links?: { next?: string | null } } } };

type YouCanListResponse =
  | YouCanProduct[]
  | {
      data?: YouCanProduct[];
      links?: { next?: string | null };
      meta?: {
        pagination?: {
          current_page?: number;
          total_pages?: number;
          links?: { next?: string | null };
        };
      };
    };

type YouCanProductResponse = YouCanProduct | { data?: YouCanProduct };

export class YouCanClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  private constructor(config: { baseUrl: string; token?: string }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
  }

  static async create() {
    const env = await getConfig();
    return new YouCanClient({ baseUrl: env.YOUCAN_BASE_URL, token: env.YOUCAN_API_TOKEN });
  }

  async listProducts(params: { include?: string[]; page?: number; limit?: number; maxPages?: number } = {}) {
    const products: YouCanProduct[] = [];
    const search = new URLSearchParams();
    if (params.include?.length) search.set('include', params.include.join(','));
    if (params.limit) search.set('limit', String(params.limit));
    if (params.page) search.set('page', String(params.page));

    let page = params.page ?? 1;
    let url: string | undefined = this.apiUrl(`/products${search.size ? `?${search}` : ''}`);
    const maxPages = params.maxPages ?? (params.page ? 1 : 100);

    for (let fetchedPages = 0; url && fetchedPages < maxPages; fetchedPages += 1) {
      const response = await this.get<YouCanListResponse>(url);
      products.push(...unwrapProductList(response));

      if (params.page) break;

      const next = nextProductsUrl(response);
      if (next) {
        url = this.apiUrl(next);
        continue;
      }

      const pagination = Array.isArray(response) ? undefined : response.meta?.pagination;
      const totalPages = pagination?.total_pages;
      const currentPage = pagination?.current_page ?? page;
      if (totalPages && currentPage < totalPages) {
        page = currentPage + 1;
        search.set('page', String(page));
        url = this.apiUrl(`/products?${search}`);
      } else {
        url = undefined;
      }
    }

    return products;
  }

  async getProduct(id: string, params: { include?: string[] } = {}) {
    const search = new URLSearchParams();
    if (params.include?.length) search.set('include', params.include.join(','));
    const response = await this.get<YouCanProductResponse>(this.apiUrl(`/products/${id}${search.size ? `?${search}` : ''}`));
    return unwrapProduct(response, 'get product');
  }

  async listCategories(params: { page?: number; limit?: number; maxPages?: number } = {}) {
    const categories: YouCanCategory[] = [];
    const search = new URLSearchParams();
    if (params.limit) search.set('limit', String(params.limit));
    if (params.page) search.set('page', String(params.page));
    let page = params.page ?? 1;
    let url: string | undefined = this.apiUrl(`/categories${search.size ? `?${search}` : ''}`);
    const maxPages = params.maxPages ?? (params.page ? 1 : 50);

    for (let fetchedPages = 0; url && fetchedPages < maxPages; fetchedPages += 1) {
      const response = await this.get<YouCanCategoryResponse>(url);
      categories.push(...(Array.isArray(response) ? response : response.data ?? []));
      if (params.page) break;
      const next = Array.isArray(response) ? undefined : response.links?.next ?? response.meta?.pagination?.links?.next;
      if (next) {
        url = this.apiUrl(next);
        continue;
      }
      const pagination = Array.isArray(response) ? undefined : response.meta?.pagination;
      const totalPages = pagination?.total_pages;
      const currentPage = pagination?.current_page ?? page;
      if (totalPages && currentPage < totalPages) {
        page = currentPage + 1;
        search.set('page', String(page));
        url = this.apiUrl(`/categories?${search}`);
      } else {
        url = undefined;
      }
    }

    return categories;
  }

  async createCategory(payload: YouCanCategoryPayload) {
    const response = await this.post<YouCanCategoryCreateResponse>(`${this.baseUrl}/categories`, payload);
    return unwrapCategory(response, 'create category');
  }

  async findProductBySku(sku: string) {
    const normalizedSku = normalizeSku(sku);
    const products = await this.listProducts({ include: ['variants', 'images', 'categories'], limit: 100 });
    return products.find((product) => productHasSku(product, normalizedSku));
  }

  async listProductIdsByCategory(categoryId: string, params: { limit?: number; maxPages?: number } = {}) {
    const products = await this.listProducts({ include: ['categories'], limit: params.limit ?? 100, maxPages: params.maxPages ?? 3 });
    return products
      .filter((product) => youCanProductCategories(product).some((category) => String(category.id) === categoryId))
      .map((product) => product.id);
  }

  async createProduct(payload: YouCanProductPayload) {
    const response = await this.post<YouCanProductResponse>(`${this.baseUrl}/products`, payload);
    return unwrapProduct(response, 'create product');
  }

  async updateProduct(id: string, payload: YouCanProductUpdatePayload) {
    const response = await this.post<YouCanProductResponse>(`${this.baseUrl}/products/update/${id}`, payload);
    return unwrapProduct(response, 'update product');
  }

  async setProductVisibility(id: string, visible: boolean) {
    const current = await this.getProduct(id, { include: ['variants'] });
    if (current.visibility === visible) return current;
    const hasVariants = current.has_variants === true || current.has_variants === 1 || current.has_variants === '1' || current.has_variants === 'true';
    const variantOptions = Array.isArray(current.variant_options)
      ? current.variant_options as YouCanProductPayload['variant_options']
      : undefined;
    const variants = hasVariants ? youCanProductVariants(current).map((variant) => ({
      variations: variant.variations,
      price: Number(variant.price ?? current.price ?? 0),
      sku: variant.sku,
      inventory: variant.inventory,
      is_default: variant.is_default,
      is_selected: variant.is_selected,
    })) : undefined;
    return this.updateProduct(id, {
      name: current.name,
      price: Number(current.price ?? 0),
      has_variants: hasVariants,
      visibility: visible,
      variant_options: variantOptions,
      variants,
    });
  }

  async createOrUpdateBySku(sku: string, payload: YouCanProductPayload, existingId?: string) {
    if (existingId) {
      return this.updateProduct(existingId, payload);
    }
    const existing = await this.findProductBySku(sku);
    if (existing?.id) {
      return this.updateProduct(existing.id, payload);
    }
    return this.createProduct(payload);
  }

  private apiUrl(pathOrUrl: string) {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
    return `${this.baseUrl}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
  }

  private headers() {
    if (!this.token) {
      throw new Error('YOUCAN_API_TOKEN is missing. Add it to the environment before running YouCan import.');
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  private get<T>(url: string) {
    return requestJson<T>(url, { headers: this.headers(), source: LogSource.YOUCAN });
  }

  private post<T>(url: string, body: unknown) {
    return requestJson<T>(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      source: LogSource.YOUCAN,
    });
  }
}

export function productHasSku(product: YouCanProduct, sku: string) {
  const normalizedSku = normalizeSku(sku);
  if (normalizeSku(product.sku) === normalizedSku) return true;
  return youCanProductVariants(product).some((variant) => normalizeSku(variant.sku) === normalizedSku);
}

export function youCanProductVariants(product: YouCanProduct) {
  if (Array.isArray(product.variants)) return product.variants;
  return product.variants?.data ?? [];
}

export function youCanPrimaryVariantId(product: YouCanProduct, sku?: string) {
  const variants = youCanProductVariants(product);
  if (!variants.length) return undefined;
  const normalizedSku = sku ? normalizeSku(sku) : undefined;
  return (normalizedSku ? variants.find((variant) => normalizeSku(variant.sku) === normalizedSku)?.id : undefined) ?? variants[0]?.id;
}

export function youCanProductPublicUrl(product: YouCanProduct, storeUrl?: string, fallbackSlug?: string) {
  const directUrl = stringValue(product.public_url) ?? stringValue(product.url);
  if (directUrl) return directUrl;

  const slug = stringValue(product.slug) ?? fallbackSlug;
  if (!storeUrl || !slug) return undefined;
  return `${storeUrl.replace(/\/$/, '')}/products/${slug}`;
}

export function youCanProductCategories(product: YouCanProduct) {
  const categories = (product as { categories?: unknown }).categories;
  if (Array.isArray(categories)) return categories as Array<{ id?: string; slug?: string; name?: string }>;
  if (categories && typeof categories === 'object' && Array.isArray((categories as { data?: unknown }).data)) {
    return (categories as { data: Array<{ id?: string; slug?: string; name?: string }> }).data;
  }
  return [];
}

function unwrapProductList(response: YouCanListResponse) {
  return Array.isArray(response) ? response : response.data ?? [];
}

function nextProductsUrl(response: YouCanListResponse) {
  if (Array.isArray(response)) return undefined;
  return response.links?.next ?? response.meta?.pagination?.links?.next ?? undefined;
}

function unwrapProduct(response: YouCanProductResponse, operation: string): YouCanProduct {
  const product = isWrappedProduct(response) ? response.data : (response as YouCanProduct);
  if (!product?.id) {
    throw new Error(`YouCan ${operation} response did not include a product id.`);
  }
  return product;
}

function unwrapCategory(response: YouCanCategoryCreateResponse, operation: string): YouCanCategory {
  const category = isWrappedCategory(response) ? response.data : (response as YouCanCategory);
  if (!category?.id) {
    throw new Error(`YouCan ${operation} response did not include a category id.`);
  }
  return category;
}

function isWrappedProduct(value: YouCanProductResponse): value is { data: YouCanProduct } {
  return typeof value === 'object' && value !== null && 'data' in value && Boolean(value.data);
}

function isWrappedCategory(value: YouCanCategoryCreateResponse): value is { data: YouCanCategory } {
  return typeof value === 'object' && value !== null && 'data' in value && Boolean(value.data);
}

function normalizeSku(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
