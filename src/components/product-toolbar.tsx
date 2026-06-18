'use client';

import { useTransition } from 'react';
import { RefreshCw, Search, Send, Sparkles, Tags, UploadCloud } from 'lucide-react';
import { CountryCode } from '@prisma/client';
import { triggerDiscovery, triggerStockSync, triggerYouCanCategorySync } from '@/app/dashboard/products/actions';

export function ProductToolbar({ country = CountryCode.SA }: { country?: CountryCode }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <button
        className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-brand-700 disabled:opacity-60"
        disabled={pending}
        onClick={() => startTransition(() => triggerDiscovery(country))}
      >
        <Search className="h-4 w-4" /> Discover {country} products
      </button>
      <button
        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        disabled={pending}
        onClick={() => startTransition(() => triggerStockSync(country))}
      >
        <RefreshCw className="h-4 w-4" /> Sync {country} stock
      </button>
      <button
        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        disabled={pending}
        onClick={() => startTransition(() => triggerYouCanCategorySync())}
      >
        <Tags className="h-4 w-4" /> Sync YouCan categories
      </button>
      <button className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        <Sparkles className="h-4 w-4" /> Bulk SEO
      </button>
      <button className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        <UploadCloud className="h-4 w-4" /> Push GMC
      </button>
      <button className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        <Send className="h-4 w-4" /> Import YouCan
      </button>
    </div>
  );
}
