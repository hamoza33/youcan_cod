import Image from 'next/image';
import Link from 'next/link';
import { CountryCode, GmcStatus, ImportStatus, Prisma, StockStatus, VisibilityStatus } from '@prisma/client';
import { Badge } from '@/components/badge';
import { PageHeader } from '@/components/page-header';
import { ProductToolbar } from '@/components/product-toolbar';
import { RowActions } from '@/components/row-actions';
import { ClickableProductRow, ExternalProductButton, ProductBulkControls, ProductSelectAllCheckbox, ProductSelectCheckbox, VisibilityToggle } from '@/components/product-bulk-controls';
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

      <form className="mb-4 grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-soft md:grid-cols-5">
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
        <div className="table-scroll overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-soft">
          <table className="min-w-[1580px] w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">
                  <ProductSelectAllCheckbox />
                </th>
                <th className="px-4 py-3">Image</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3">COD Product ID</th>
                <th className="px-4 py-3">COD SKU</th>
                <th className="px-4 py-3">YouCan Product ID</th>
                <th className="px-4 py-3">GMC</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Stock</th>
                <th className="px-4 py-3">Visibility</th>
                <th className="px-4 py-3">SEO</th>
                <th className="px-4 py-3">Import</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((product) => {
                const links = externalProductLinks(product, { youCanStoreUrl, codTemplate });
                return (
                  <ClickableProductRow key={product.id} href={`/dashboard/products/${product.id}`}>
                    <td className="px-4 py-3"><ProductSelectCheckbox productId={product.id} /></td>
                    <td className="px-4 py-3">
                      <div className="relative h-14 w-14 overflow-hidden rounded-2xl bg-slate-100">
                        {product.imageUrls[0] ? (
                          <Image src={product.imageUrls[0]} alt="" fill className="object-cover" />
                        ) : null}
                      </div>
                      <div className="mt-1 text-center text-[10px] text-slate-400">{product.imageUrls.length} img</div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-600">{product.country}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{product.codProductId}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-ink">{product.codSku ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{product.mapping?.youCanProductId ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge value={product.gmcStatus} /></td>
                    <td className="max-w-xs px-4 py-3">
                      <Link href={`/dashboard/products/${product.id}`} className="font-semibold text-ink hover:text-brand-600">
                        {truncate(product.seoMetadata?.title ?? product.name, 70)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{product.category?.name ?? '—'}</td>
                    <td className="px-4 py-3 font-semibold">{formatCurrency(Number(product.price ?? 0), product.currency)}</td>
                    <td className="px-4 py-3"><StatusBadge value={product.stockStatus} /></td>
                    <td className="px-4 py-3"><VisibilityToggle productId={product.id} visible={product.visibilityStatus === VisibilityStatus.VISIBLE} /></td>
                    <td className="px-4 py-3"><StatusBadge value={product.seoStatus} /></td>
                    <td className="px-4 py-3"><StatusBadge value={product.importStatus} /></td>
                    <td className="max-w-xs px-4 py-3 text-xs text-rose-700">{truncate(product.lastError, 90)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <ExternalProductButton href={links.youCanUrl} label="YouCan" />
                        <ExternalProductButton href={links.codUrl} label="COD" />
                        <RowActions productId={product.id} />
                      </div>
                    </td>
                  </ClickableProductRow>
                );
              })}
              {products.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-4 py-12 text-center text-slate-500">
                    No products imported yet. Choose one or more GCC countries and start discovery.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
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
