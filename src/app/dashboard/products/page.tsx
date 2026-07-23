import Image from 'next/image';
import Link from 'next/link';
import { CountryCode, GmcStatus, ImportStatus, Prisma, SeoStatus, StockStatus, VisibilityStatus } from '@prisma/client';
import { Badge } from '@/components/badge';
import { PageHeader } from '@/components/page-header';
import { ProductToolbar } from '@/components/product-toolbar';
import { RowActions } from '@/components/row-actions';
import { ExternalProductButton, ProductBulkControls, ProductSelectAllCheckbox, ProductSelectCheckbox, VisibilityToggle } from '@/components/product-bulk-controls';
import { prisma } from '@/lib/db';
import { formatCurrency, formatDate, truncate } from '@/lib/utils';
import { getRuntimeSettings, settingString, settingStringArray } from '@/lib/settings/runtime';
import { GCC_COUNTRY_CODES } from '@/lib/settings/registry';
import { externalProductLinks } from '@/lib/products/external-links';
import { deriveGmcStatusDetails } from '@/lib/products/gmc-status';

type RawSearchParams = Record<string, string | string[] | undefined>;
type SearchParams = Promise<RawSearchParams>;

type ProductListFilters = {
  q?: string;
  country?: CountryCode;
  category?: string;
  stock?: StockStatus;
  seo?: SeoStatus;
  importStatus?: ImportStatus;
  gmc?: GmcStatus;
};

const PRODUCT_PAGE_SIZE = 50;
const productInclude = { category: true, mapping: true, seoMetadata: true, gmcSubmissions: { orderBy: { createdAt: 'desc' as const }, take: 1 } } satisfies Prisma.CodProductInclude;

export const dynamic = 'force-dynamic';

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const settings = await getRuntimeSettings();
  const enabledCountries = normalizeCountries(settingStringArray(settings, 'country.enabled'));
  const filters: ProductListFilters = {
    q: stringFilter(params.q),
    country: enumFilter<CountryCode>(params.country, CountryCode),
    category: stringFilter(params.category),
    stock: enumFilter<StockStatus>(params.stock, StockStatus),
    seo: enumFilter<SeoStatus>(params.seo, SeoStatus),
    importStatus: enumFilter<ImportStatus>(params.import, ImportStatus),
    gmc: enumFilter<GmcStatus>(params.gmc, GmcStatus),
  };
  const productWhere: Prisma.CodProductWhereInput = {
    country: filters.country,
    categoryId: filters.category,
    stockStatus: filters.stock,
    seoStatus: filters.seo,
    importStatus: filters.importStatus,
    gmcStatus: filters.gmc,
    OR: filters.q ? productSearchWhere(filters.q) : undefined,
  };
  const requestedPage = pageFilter(params.page);
  const totalProducts = await prisma.codProduct.count({ where: productWhere });
  const totalPages = Math.max(1, Math.ceil(totalProducts / PRODUCT_PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const products = await prisma.codProduct.findMany({
    where: productWhere,
    include: productInclude,
    orderBy: { updatedAt: 'desc' },
    skip: (currentPage - 1) * PRODUCT_PAGE_SIZE,
    take: PRODUCT_PAGE_SIZE,
  });
  const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  const youCanStoreUrl = settingString(settings, 'youCan.storeUrl');
  const codTemplate = settingString(settings, 'codNetwork.productPageUrlTemplate');
  const googleMerchantAccountId = settingString(settings, 'googleMerchant.accountId');
  const visibleProductIds = products.map((product) => product.id);
  const activeFilterCount = activeFilters(filters);

  return (
    <>
      <PageHeader
        title="Imported products"
        description="Manage COD Network GCC discovery, account-specific SKU mapping, YouCan imports, SEO status, stock, visibility, and Google Merchant Center submissions."
        actions={<ProductToolbar enabledCountries={enabledCountries} selectedCountry={filters.country} visibleProductIds={visibleProductIds} />}
      />

      <nav id="product-sections" className="sticky top-2 z-10 mb-4 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-soft backdrop-blur" aria-label="Product page sections">
        <a href="#page-actions" className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Actions</a>
        <a href="#product-filters" className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Filters</a>
        <a href="#selected-actions" className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Selected / bulk</a>
        <a href="#product-list" className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Product list</a>
      </nav>

      <div id="page-actions" className="scroll-mt-20" />
      <form id="product-filters" action="/dashboard/products" className="mb-4 grid scroll-mt-20 gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-soft md:grid-cols-3 xl:grid-cols-8">
        <input type="hidden" name="page" value="1" />
        <input
          name="q"
          defaultValue={filters.q ?? ''}
          aria-label="Search products"
          placeholder="Search title, COD ID, SKU..."
          className="rounded-2xl border border-slate-200 px-3 py-2 text-sm md:col-span-3 xl:col-span-2"
        />
        <FilterSelect name="country" label="All GCC countries" values={Object.values(CountryCode)} defaultValue={filters.country} />
        <select name="category" defaultValue={filters.category ?? ''} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm">
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <FilterSelect name="stock" label="All stock" values={Object.values(StockStatus)} defaultValue={filters.stock} />
        <FilterSelect name="seo" label="All SEO" values={Object.values(SeoStatus)} defaultValue={filters.seo} />
        <FilterSelect name="import" label="All imports" values={Object.values(ImportStatus)} defaultValue={filters.importStatus} />
        <FilterSelect name="gmc" label="All GMC" values={Object.values(GmcStatus)} defaultValue={filters.gmc} />
        <div className="flex gap-2 md:col-span-3 xl:col-span-8">
          <button className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Apply filters</button>
          <Link href="/dashboard/products" className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Clear
          </Link>
        </div>
      </form>

      <ProductBulkControls
        products={products.map((product) => ({ id: product.id }))}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        filters={filters}
        totalMatching={totalProducts}
      >
        <div id="product-list" className="scroll-mt-20 rounded-3xl border border-slate-200 bg-white shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <label className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <ProductSelectAllCheckbox />
              Select visible page
            </label>
            <p className="text-xs font-semibold text-slate-500">Compact view: showing 50 products per page with all fields and actions wrapped inside the page.</p>
          </div>

          <div className="divide-y divide-slate-100">
            {products.map((product) => {
              const links = externalProductLinks(product, { youCanStoreUrl, codTemplate, googleMerchantAccountId });
              const latestGmc = product.gmcSubmissions[0];
              const gmcDetails = deriveGmcStatusDetails({
                response: latestGmc?.responsePayload,
                destinationStatuses: latestGmc?.destinationStatuses,
                issues: latestGmc?.issues,
                fallback: product.gmcStatus,
              });
              return (
                <article key={product.id} className="grid gap-3 px-4 py-3 text-sm transition hover:bg-slate-50/70 lg:grid-cols-[auto_4rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="flex items-start pt-2">
                    <ProductSelectCheckbox productId={product.id} />
                  </div>

                  <Link href={`/dashboard/products/${product.id}`} className="group block">
                    <div className="relative h-16 w-16 overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-100">
                      {product.imageUrls[0] ? <Image src={product.imageUrls[0]} alt="" fill className="object-cover transition group-hover:scale-105" /> : null}
                    </div>
                    <div className="mt-1 text-center text-[10px] font-semibold text-slate-400">{product.imageUrls.length} img</div>
                  </Link>

                  <div className="min-w-0">
                    <Link href={`/dashboard/products/${product.id}`} className="font-bold leading-5 text-ink hover:text-brand-600">
                      {truncate(product.seoMetadata?.title ?? product.name, 95)}
                    </Link>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-1">{product.country}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1">COD ID {product.codProductId}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1">SKU {product.codSku ?? '—'}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1">YouCan {product.mapping?.youCanProductId ?? '—'}</span>
                    </div>
                    {product.lastError ? <p className="mt-2 rounded-2xl bg-rose-50 px-3 py-2 text-xs font-semibold leading-5 text-rose-700">{truncate(product.lastError, 160)}</p> : null}
                  </div>

                  <div className="grid min-w-0 grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-2">
                    <InfoCell label="Category" value={product.category?.name ?? '—'} />
                    <InfoCell label="Price" value={formatCurrency(Number(product.price ?? 0), product.currency)} strong />
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Stock</p>
                      <StatusBadge value={product.stockStatus} />
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Visibility</p>
                      <VisibilityToggle productId={product.id} visible={product.visibilityStatus === VisibilityStatus.VISIBLE} />
                    </div>
                  </div>

                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      <StatusBadge value={product.seoStatus} />
                      <StatusBadge value={product.importStatus} />
                      <StatusBadge value={gmcDetails.state} />
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-2.5 py-2 text-[11px] leading-4 text-slate-600" title={gmcDetails.summary}>
                      <p className="font-bold">GMC {gmcDetails.state.replaceAll('_', ' ')}</p>
                      <p className="mt-0.5 line-clamp-2">{gmcDetails.summary}</p>
                      <p className="mt-1 text-slate-400">Last checked: {formatDate(latestGmc?.checkedAt ?? product.lastGmcSyncAt)}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <ExternalProductButton href={links.youCanUrl} label="YouCan" />
                      <ExternalProductButton href={links.codUrl} label="COD" />
                      <ExternalProductButton href={links.gmcUrl} label="GMC" />
                    </div>
                    <RowActions productId={product.id} />
                  </div>
                </article>
              );
            })}
            {products.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-500">
                {activeFilterCount ? 'No products match the current filters. Clear filters or broaden your search.' : 'No products imported yet. Choose one or more GCC countries and start discovery.'}
              </div>
            ) : null}
          </div>
        </div>
        <PaginationControls
          currentPage={currentPage}
          filters={filters}
          pageSize={PRODUCT_PAGE_SIZE}
          totalPages={totalPages}
          totalProducts={totalProducts}
        />
      </ProductBulkControls>
    </>
  );
}

function FilterSelect({ name, label, values, defaultValue }: { name: string; label: string; values: string[]; defaultValue: unknown }) {
  return (
    <select name={name} defaultValue={typeof defaultValue === 'string' ? defaultValue : ''} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm">
      <option value="">{label}</option>
      {values.map((value) => <option key={value} value={value}>{value}</option>)}
    </select>
  );
}

function InfoCell({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 truncate ${strong ? 'font-bold text-ink' : 'font-semibold text-slate-600'}`}>{value}</p>
    </div>
  );
}

function PaginationControls({
  currentPage,
  filters,
  pageSize,
  totalPages,
  totalProducts,
}: {
  currentPage: number;
  filters: ProductListFilters;
  pageSize: number;
  totalPages: number;
  totalProducts: number;
}) {
  const firstVisibleProduct = totalProducts === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisibleProduct = Math.min(totalProducts, currentPage * pageSize);
  const pages = paginationItems(currentPage, totalPages);

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-soft" aria-label="Products pagination">
      <p className="text-sm font-semibold text-slate-600">
        Showing {firstVisibleProduct}–{lastVisibleProduct} of {totalProducts} products · {pageSize} per page
      </p>
      <p className="text-xs font-semibold text-slate-500">
        Page {currentPage} of {totalPages} · {activeFilters(filters) ? `${activeFilters(filters)} active filter${activeFilters(filters) === 1 ? '' : 's'}` : 'No filters applied'}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <PaginationLink page={currentPage - 1} filters={filters} disabled={currentPage <= 1}>Previous</PaginationLink>
        {pages.map((page, index) => (
          page === 'ellipsis'
            ? <span key={`ellipsis-${index}`} className="px-2 text-sm font-bold text-slate-400">…</span>
            : <PaginationLink key={page} page={page} filters={filters} active={page === currentPage}>{page}</PaginationLink>
        ))}
        <PaginationLink page={currentPage + 1} filters={filters} disabled={currentPage >= totalPages}>Next</PaginationLink>
      </div>
    </nav>
  );
}

function PaginationLink({
  active = false,
  children,
  disabled = false,
  filters,
  page,
}: {
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  filters: ProductListFilters;
  page: number;
}) {
  const className = `inline-flex min-h-9 min-w-9 items-center justify-center rounded-2xl border px-3 py-2 text-sm font-bold transition ${
    active
      ? 'border-slate-900 bg-slate-900 text-white'
      : disabled
        ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300'
        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
  }`;

  if (disabled || active) {
    return <span className={className} aria-current={active ? 'page' : undefined}>{children}</span>;
  }

  return <Link href={productsPageHref(filters, page)} className={className}>{children}</Link>;
}

function paginationItems(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  const pageNumbers = new Set<number>([1, totalPages]);
  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page >= 1 && page <= totalPages) pageNumbers.add(page);
  }

  const sortedPages = [...pageNumbers].sort((a, b) => a - b);
  return sortedPages.flatMap((page, index) => {
    const previousPage = sortedPages[index - 1];
    return previousPage && page - previousPage > 1 ? ['ellipsis' as const, page] : [page];
  });
}

function productsPageHref(filters: ProductListFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.country) params.set('country', filters.country);
  if (filters.category) params.set('category', filters.category);
  if (filters.stock) params.set('stock', filters.stock);
  if (filters.seo) params.set('seo', filters.seo);
  if (filters.importStatus) params.set('import', filters.importStatus);
  if (filters.gmc) params.set('gmc', filters.gmc);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/dashboard/products?${query}` : '/dashboard/products';
}

function enumFilter<T extends string>(value: unknown, enumObject: Record<string, T>): T | undefined {
  return typeof value === 'string' && Object.values(enumObject).includes(value as T) ? (value as T) : undefined;
}

function stringFilter(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function productSearchWhere(query: string): Prisma.CodProductWhereInput[] {
  return [
    { name: { contains: query, mode: 'insensitive' } },
    { rawName: { contains: query, mode: 'insensitive' } },
    { codSku: { contains: query, mode: 'insensitive' } },
    { codProductId: { contains: query, mode: 'insensitive' } },
    { mapping: { is: { codSku: { contains: query, mode: 'insensitive' } } } },
    { mapping: { is: { youCanProductId: { contains: query, mode: 'insensitive' } } } },
    { seoMetadata: { is: { title: { contains: query, mode: 'insensitive' } } } },
  ];
}

function pageFilter(value: unknown) {
  if (typeof value !== 'string') return 1;
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function activeFilters(filters: ProductListFilters) {
  return Object.values(filters).filter(Boolean).length;
}

function normalizeCountries(values: string[]) {
  const allowed = new Set(Object.values(CountryCode));
  const countries = values.filter((value): value is CountryCode => allowed.has(value as CountryCode));
  return countries.length ? countries : [...GCC_COUNTRY_CODES];
}

function StatusBadge({ value }: { value: string }) {
  const tone =
    value.includes('APPROVED') || value.includes('READY') || value.includes('IMPORTED') || value.includes('IN_STOCK') || value.includes('VISIBLE')
      ? 'green'
      : value.includes('LIMITED')
        ? 'amber'
        : value.includes('FAILED') || value.includes('ERROR') || value.includes('DISAPPROVED') || value.includes('OUT_OF_STOCK')
        ? 'red'
        : value.includes('PENDING') || value.includes('QUEUED') || value.includes('GENERATING') || value.includes('IMPORTING')
          ? 'amber'
          : 'slate';
  return <Badge tone={tone}>{value.replaceAll('_', ' ')}</Badge>;
}
