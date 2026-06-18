'use client';

import { useMemo, useTransition } from 'react';
import { RefreshCw, Search, Send, Sparkles, Tags, UploadCloud } from 'lucide-react';
import { CountryCode } from '@prisma/client';
import { triggerDiscoveryForCountries, triggerStockSyncForCountries, triggerYouCanCategorySync } from '@/app/dashboard/products/actions';
import { GCC_COUNTRY_CODES } from '@/lib/settings/registry';

export function ProductToolbar({ enabledCountries = [CountryCode.SA], selectedCountry }: { enabledCountries?: CountryCode[]; selectedCountry?: CountryCode }) {
  const [pending, startTransition] = useTransition();
  const countries = useMemo(() => {
    if (selectedCountry) return [selectedCountry];
    return enabledCountries.length ? enabledCountries : [...GCC_COUNTRY_CODES];
  }, [enabledCountries, selectedCountry]);
  const label = countries.length === 1 ? countries[0] : `${countries.length} countries`;

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-brand-700 disabled:opacity-60"
        disabled={pending || countries.length === 0}
        onClick={() => startTransition(() => triggerDiscoveryForCountries(countries))}
      >
        <Search className="h-4 w-4" /> Discover {label} products
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        disabled={pending || countries.length === 0}
        onClick={() => startTransition(() => triggerStockSyncForCountries(countries))}
      >
        <RefreshCw className="h-4 w-4" /> Sync {label} stock
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        disabled={pending}
        onClick={() => startTransition(() => triggerYouCanCategorySync())}
      >
        <Tags className="h-4 w-4" /> Sync YouCan categories
      </button>
      <a href="#selected-product-count" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        <Sparkles className="h-4 w-4" /> Bulk SEO
      </a>
      <a href="#selected-product-count" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        <UploadCloud className="h-4 w-4" /> Push GMC
      </a>
      <a href="#selected-product-count" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        <Send className="h-4 w-4" /> Import YouCan
      </a>
    </div>
  );
}
