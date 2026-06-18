'use client';

import { createContext, useContext, useMemo, useState, useTransition } from 'react';
import { ChevronDown, ExternalLink, Eye, EyeOff, Percent, Tags } from 'lucide-react';
import { bulkAction, toggleProductVisibility } from '@/app/dashboard/products/actions';

type SelectionContextValue = {
  selectedSet: Set<string>;
  selectedCount: number;
  allSelected: boolean;
  toggleOne: (id: string) => void;
  toggleAll: () => void;
};

const ProductSelectionContext = createContext<SelectionContextValue | null>(null);

export type ProductRowForBulk = {
  id: string;
};

export function ProductBulkControls({
  products,
  categories,
  children,
}: {
  products: ProductRowForBulk[];
  categories: Array<{ id: string; name: string }>;
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [percent, setPercent] = useState('');
  const [fixedPrice, setFixedPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [pending, startTransition] = useTransition();
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = products.length > 0 && selected.length === products.length;

  function toggleAll() {
    setSelected(allSelected ? [] : products.map((product) => product.id));
  }

  function toggleOne(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function run(input: Parameters<typeof bulkAction>[0]) {
    startTransition(async () => {
      await bulkAction(input);
      setSelected([]);
    });
  }

  function runSelected(action: Parameters<typeof bulkAction>[0]['action']) {
    if (!selected.length) return;
    run({ ids: selected, action });
  }

  function runPercent() {
    const value = Number(percent);
    if (!selected.length || !Number.isFinite(value) || value < -99) return;
    run({ ids: selected, action: 'price-percent', percent: value });
  }

  function runFixedPrice() {
    const value = Number(fixedPrice);
    if (!selected.length || !Number.isFinite(value) || value < 0) return;
    run({ ids: selected, action: 'price-fixed', fixedPrice: value });
  }

  function runCategory() {
    if (!selected.length || !categoryId) return;
    run({ ids: selected, action: 'category', categoryId });
  }

  return (
    <ProductSelectionContext.Provider value={{ selectedSet, selectedCount: selected.length, allSelected, toggleOne, toggleAll }}>
      <section id="selected-product-count" className="mb-4 scroll-mt-6 rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 font-semibold text-slate-700">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Select visible
            </label>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {selected.length} selected
            </span>
            <span className="hidden text-xs text-slate-500 sm:inline">Select rows to reveal bulk actions.</span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            aria-expanded={expanded}
          >
            Bulk actions
            <ChevronDown className={`h-4 w-4 transition ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {(expanded || selected.length > 0) ? (
          <div className="border-t border-slate-100 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button type="button" disabled={pending || !selected.length} onClick={() => runSelected('show')} className="inline-flex items-center gap-1 rounded-2xl border px-3 py-2 font-semibold text-emerald-700 disabled:opacity-50">
                <Eye className="h-4 w-4" /> Show in YouCan
              </button>
              <button type="button" disabled={pending || !selected.length} onClick={() => runSelected('hide')} className="inline-flex items-center gap-1 rounded-2xl border px-3 py-2 font-semibold text-slate-700 disabled:opacity-50">
                <EyeOff className="h-4 w-4" /> Hide in YouCan
              </button>
              <button type="button" disabled={pending || !selected.length} onClick={() => runSelected('regenerate-seo')} className="rounded-2xl border px-3 py-2 font-semibold text-purple-700 disabled:opacity-50">Regenerate SEO</button>
              <button type="button" disabled={pending || !selected.length} onClick={() => runSelected('import-youcan')} className="rounded-2xl border px-3 py-2 font-semibold text-blue-700 disabled:opacity-50">Re-import YouCan</button>
              <button type="button" disabled={pending || !selected.length} onClick={() => runSelected('push-gmc')} className="rounded-2xl border px-3 py-2 font-semibold text-emerald-700 disabled:opacity-50">Push GMC</button>
            </div>

            {expanded ? (
              <>
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  <div className="flex gap-2">
                    <input value={percent} onChange={(event) => setPercent(event.target.value)} placeholder="% price change" className="min-w-0 flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm" />
                    <button type="button" disabled={pending || !selected.length} onClick={runPercent} className="inline-flex items-center gap-1 rounded-2xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      <Percent className="h-4 w-4" /> Apply
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input value={fixedPrice} onChange={(event) => setFixedPrice(event.target.value)} placeholder="Fixed base price" className="min-w-0 flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm" />
                    <button type="button" disabled={pending || !selected.length} onClick={runFixedPrice} className="rounded-2xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Set</button>
                  </div>
                  <div className="flex gap-2">
                    <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="min-w-0 flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm">
                      <option value="">Bulk category...</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                    <button type="button" disabled={pending || !selected.length || !categoryId} onClick={runCategory} className="inline-flex items-center gap-1 rounded-2xl border px-3 py-2 text-sm font-semibold disabled:opacity-50">
                      <Tags className="h-4 w-4" /> Apply
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">Bulk price changes update the base price, then queue YouCan imports so all discount quantity variants are recalculated from the existing discount rules.</p>
              </>
            ) : null}
          </div>
        ) : null}
      </section>
      {children}
    </ProductSelectionContext.Provider>
  );
}

export function ProductSelectAllCheckbox() {
  const context = useContext(ProductSelectionContext);
  if (!context) return null;
  return (
    <input
      aria-label="Select all visible products"
      type="checkbox"
      checked={context.allSelected}
      onChange={context.toggleAll}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

export function ProductSelectCheckbox({ productId }: { productId: string }) {
  const context = useContext(ProductSelectionContext);
  if (!context) return null;
  return (
    <input
      aria-label="Select product"
      type="checkbox"
      checked={context.selectedSet.has(productId)}
      onChange={() => context.toggleOne(productId)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

export function ClickableProductRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <tr
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('a,button,input,select,textarea,label')) return;
        window.location.href = href;
      }}
      className="cursor-pointer align-top hover:bg-slate-50/60"
    >
      {children}
    </tr>
  );
}

export function VisibilityToggle({ productId, visible }: { productId: string; visible: boolean }) {
  const [checked, setChecked] = useState(visible);
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(event) => {
        event.stopPropagation();
        const next = !checked;
        setChecked(next);
        startTransition(async () => {
          try {
            await toggleProductVisibility(productId, next);
          } catch {
            setChecked(!next);
          }
        });
      }}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${checked ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'} disabled:opacity-60`}
    >
      {checked ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
      {checked ? 'Visible' : 'Hidden'}
    </button>
  );
}

export function ExternalProductButton({ href, label }: { href?: string; label: string }) {
  if (!href) {
    return <span className="rounded-xl border border-dashed px-2 py-1 text-xs font-semibold text-slate-400">{label} N/A</span>;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
      <ExternalLink className="h-3 w-3" /> {label}
    </a>
  );
}
