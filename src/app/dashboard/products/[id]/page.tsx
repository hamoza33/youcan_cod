import Image from 'next/image';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { VisibilityStatus } from '@prisma/client';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { prisma } from '@/lib/db';
import { updateProductAction } from '@/app/dashboard/products/actions';
import { formatDate } from '@/lib/utils';

 type Params = Promise<{ id: string }>;

export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const product = await prisma.codProduct.findUniqueOrThrow({
    where: { id },
    include: { seoMetadata: true, category: true, mapping: true, logs: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });
  const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });

  return (
    <>
      <PageHeader
        title="Product editor"
        description="Edit price, visibility, category, and SEO content for a single COD product before re-importing to YouCan or Google Merchant Center."
        actions={
          <div className="flex flex-wrap gap-2">
            {product.mapping?.youCanPublicUrl ? (
              <Link className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white" href={product.mapping.youCanPublicUrl} target="_blank">
                <ExternalLink className="h-4 w-4" /> View on YouCan
              </Link>
            ) : null}
            <Link className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold" href="/dashboard/products">Back to products</Link>
          </div>
        }
      />

      <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-ink">Product images</h2>
            <p className="mt-1 text-sm text-slate-500">{product.imageUrls.length} image(s) stored for this product. Broken image errors appear in recent logs/errors.</p>
          </div>
          {product.imageUrls.length < 4 ? <Badge tone="amber">Below 4 image target</Badge> : <Badge tone="green">Image target met</Badge>}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {product.imageUrls.map((url, index) => (
            <a key={`${url}-${index}`} href={url} target="_blank" className="group block overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
              <div className="relative aspect-square">
                <Image src={url} alt={`${product.name} image ${index + 1}`} fill className="object-cover transition group-hover:scale-105" sizes="(max-width: 1024px) 50vw, 220px" />
              </div>
              <div className="truncate px-3 py-2 text-xs text-slate-500">Image {index + 1}</div>
            </a>
          ))}
          {product.imageUrls.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-rose-200 bg-rose-50 p-6 text-sm font-semibold text-rose-700">No images found for this product.</div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <form action={updateProductAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
          <input type="hidden" name="id" value={product.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm font-semibold text-slate-700">
              Price
              <input name="price" defaultValue={String(product.price ?? '')} className="w-full rounded-2xl border border-slate-200 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-700">
              Visibility
              <select name="visibilityStatus" defaultValue={product.visibilityStatus} className="w-full rounded-2xl border border-slate-200 px-3 py-2">
                {Object.values(VisibilityStatus).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-700 md:col-span-2">
              Category
              <select name="categoryId" defaultValue={product.categoryId ?? ''} className="w-full rounded-2xl border border-slate-200 px-3 py-2">
                <option value="">No category</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.youCanCategoryId ? ' · YouCan' : ' · not mapped'}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-700 md:col-span-2">
              SEO title
              <input name="title" defaultValue={product.seoMetadata?.title ?? product.name} className="w-full rounded-2xl border border-slate-200 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-700 md:col-span-2">
              SEO description
              <textarea name="description" defaultValue={product.seoMetadata?.description ?? ''} rows={12} className="w-full rounded-2xl border border-slate-200 px-3 py-2 font-mono text-xs" />
              <span className="text-xs text-slate-400">Length: {product.seoMetadata?.description.length ?? 0} characters</span>
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-700">
              Meta title
              <input name="metaTitle" defaultValue={product.seoMetadata?.metaTitle ?? ''} className="w-full rounded-2xl border border-slate-200 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-700">
              Meta description
              <textarea name="metaDescription" defaultValue={product.seoMetadata?.metaDescription ?? ''} rows={4} className="w-full rounded-2xl border border-slate-200 px-3 py-2" />
            </label>
          </div>
          <button className="mt-6 rounded-2xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white">Save changes</button>
        </form>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="font-bold text-ink">Identifiers</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="COD Product ID" value={product.codProductId} />
              <Row label="COD SKU" value={product.codSku ?? '—'} />
              <Row label="YouCan ID" value={product.mapping?.youCanProductId ?? '—'} />
              <Row label="YouCan URL" value={product.mapping?.youCanPublicUrl ?? '—'} />
              <Row label="Google Product ID" value={product.mapping?.googleProductId ?? '—'} />
            </dl>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="font-bold text-ink">Statuses</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge>{product.importStatus}</Badge>
              <Badge>{product.seoStatus}</Badge>
              <Badge>{product.gmcStatus}</Badge>
              <Badge>{product.stockStatus}</Badge>
            </div>
            {product.lastError ? <p className="mt-4 rounded-2xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">{product.lastError}</p> : null}
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="font-bold text-ink">Recent logs</h2>
            <div className="mt-4 space-y-3">
              {product.logs.map((log) => (
                <div key={log.id} className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
                  <div className="flex justify-between gap-2 font-semibold"><span>{log.source}</span><span>{formatDate(log.createdAt)}</span></div>
                  <p className="mt-1">{log.message}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs text-slate-700">{value}</dd>
    </div>
  );
}
