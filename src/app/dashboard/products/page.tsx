import Image from 'next/image';
import Link from 'next/link';
import { CountryCode, GmcStatus, ImportStatus, Prisma, StockStatus, VisibilityStatus } from '@prisma/client';
import { Badge } from '@/components/badge';
import { PageHeader } from '@/components/page-header';
import { ProductToolbar } from '@/components/product-toolbar';
import { RowActions } from '@/components/row-actions';
import { ExternalProductButton, ProductBulkControls, ProductSelectAllCheckbox, ProductSelectCheckbox, VisibilityToggle } from '@/components/product-bulk-controls';
import { prisma } from '@/lib/db';
import { formatCurrency, truncate } from '@/lib/utils';
import { getRuntimeSettings, settingString, settingStringArray } from '@/lib/settings/runtime';
import { GCC_COUNTRY_CODES } from '@/lib/settings/registry';
import { externalProductLinks } from '@/lib/products/external-links';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const productInclude = { category: true, mapping: true, seoMetadata: true } satisfies Prisma.CodProductInclude;

export const dynamic = 'force-dynamic';

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const settings = await getRuntimeSettings();
  const enabledCountries = normalizeCountries(settingStringArray(settings, 'country.enabled'));
  const country = enumFilter<CountryCode>(params.country, CountryCode);
  const products = await prisma.codProduct.findMany({
    where: {
      country: country ?? undefined,
      categoryId: typeof params.category === 'string' && params.category ? params.category : undefined,
      stockStatus: enumFilter<StockStatus>(params.stock, StockStatus),
      importStatus: enumFilter<ImportStatus>(params.import, ImportStatus),
      gmcStatus: enumFilter<GmcStatus>(params.gmc, GmcStatus),
    },
    include: productInclude,
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  const youCanStoreUrl = settingString(settings, 'youCan.storeUrl');
  const codTemplate = settingString(settings, 'codNetwork.productPageUrlTemplate');

  return (
    <>
      <PageHeader
        title="Imported products"
        description="Manage COD Network GCC discovery, account-specific SKU mapping, YouCan imports, SEO status, stock, visibility, and Google Merchant Center submissions."
        actions={<ProductToolbar enabledCountries={enabledCountries} selectedCountry={country} />}
      />

      <form className="mb-4 grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-soft md:grid-cols-3 xl:grid-cols-6">
        <FilterSelect name="country" label="All GCC countries" values={Object.values(CountryCode)} defaultValue={country} />
        <select name="category" defaultValue={String(params.category ?? '')} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm">
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <FilterSelect name="stock" label="All stock" values={Object.values(StockStatus)} defaultValue={params.stock} />
        <FilterSelect name="import" label="All imports" values={Object.values(ImportStatus)} defaultValue={params.import} />
        <FilterSelect name="gmc" label="All GMC" values={Object.values(GmcStatus)} defaultValue={params.gmc} />
        <button className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Apply filters</button>
      </form>

      <ProductBulkControls products={products.map((product) => ({ id: product.id }))} categories={categories.map((category) => ({ id: category.id, name: category.name }))}>
        <div className="rounded-3xl border border-slate-200 bg-white shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <label className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <ProductSelectAllCheckbox />
              Select all visible
            </label>
            <p className="text-xs font-semibold text-slate-500">Compact view: all fields and actions wrap inside the page, with no sideways scrolling.</p>
          </div>

          <div className="divide-y divide-slate-100">
            {products.map((product) => {
              const links = externalProductLinks(product, { youCanStoreUrl, codTemplate });
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
                      <StatusBadge value={product.gmcStatus} />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <ExternalProductButton href={links.youCanUrl} label="YouCan" />
                      <ExternalProductButton href={links.codUrl} label="COD" />
                    </div>
                    <RowActions productId={product.id} />
                  </div>
                </article>
              );
            })}
            {products.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-500">
                No products imported yet. Choose one or more GCC countries and start discovery.
              </div>
            ) : null}
          </div>
        </div>
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

function enumFilter<T extends string>(value: unknown, enumObject: Record<string, T>): T | undefined {
  return typeof value === 'string' && Object.values(enumObject).includes(value as T) ? (value as T) : undefined;
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
      : value.includes('FAILED') || value.includes('ERROR') || value.includes('DISAPPROVED') || value.includes('OUT_OF_STOCK')
        ? 'red'
        : value.includes('PENDING') || value.includes('QUEUED') || value.includes('GENERATING') || value.includes('IMPORTING')
          ? 'amber'
          : 'slate';
  return <Badge tone={tone}>{value.replaceAll('_', ' ')}</Badge>;
}
