'use client';

import { useTransition } from 'react';
import { RefreshCw, Send, Sparkles, UploadCloud } from 'lucide-react';
import { triggerProductJob } from '@/app/dashboard/products/actions';

export function RowActions({ productId }: { productId: string }) {
  const [pending, startTransition] = useTransition();
  const run = (job: Parameters<typeof triggerProductJob>[1]) => startTransition(() => triggerProductJob(productId, job));

  return (
    <div className="flex flex-wrap gap-1.5">
      <button disabled={pending} onClick={() => run('ensure-cod-sku')} className="rounded-xl border px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
        <RefreshCw className="inline h-3 w-3" /> COD
      </button>
      <button disabled={pending} onClick={() => run('enrich-seo')} className="rounded-xl border px-2 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-50">
        <Sparkles className="inline h-3 w-3" /> SEO
      </button>
      <button disabled={pending} onClick={() => run('import-youcan')} className="rounded-xl border px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
        <Send className="inline h-3 w-3" /> YouCan
      </button>
      <button disabled={pending} onClick={() => run('push-gmc')} className="rounded-xl border px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
        <UploadCloud className="inline h-3 w-3" /> GMC
      </button>
    </div>
  );
}
