'use client';

import { useState, useTransition } from 'react';
import { testAiProviderAction } from '@/app/dashboard/settings/actions';

type Provider = 'openai' | 'anthropic' | 'chain';
type TestResult = Awaited<ReturnType<typeof testAiProviderAction>>;

const tests: Array<{ provider: Provider; label: string }> = [
  { provider: 'openai', label: 'Test OpenAI-compatible' },
  { provider: 'anthropic', label: 'Test Anthropic-compatible' },
  { provider: 'chain', label: 'Test fallback chain' },
];

export function AiProviderTestButtons() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TestResult | null>(null);

  return (
    <div>
      <div className="mt-4 flex flex-wrap gap-2">
        {tests.map((test) => (
          <button
            key={test.provider}
            type="button"
            disabled={pending}
            onClick={() => startTransition(async () => setResult(await testAiProviderAction(test.provider)))}
            className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {test.label}
          </button>
        ))}
      </div>
      {result ? (
        <div className={`mt-3 rounded-2xl p-3 text-xs font-semibold leading-5 ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {result.ok ? (
            <p>Working: {result.provider} / {result.model} ({result.latencyMs}ms)</p>
          ) : (
            <p>Failed: {result.error}</p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Click a test button to send a tiny JSON request. The result appears here and is also saved to Automation logs.</p>
      )}
    </div>
  );
}
