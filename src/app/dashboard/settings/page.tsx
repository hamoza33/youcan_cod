import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { saveSettings } from '@/app/dashboard/settings/actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
  const map = new Map(settings.map((setting) => [setting.key, setting.value]));
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  const discounts = await prisma.discountRule.findMany({ orderBy: { sortOrder: 'asc' } });

  return (
    <>
      <PageHeader title="Settings" description="Configure credentials references, KSA scope, categories, pricing, discount variants, AI provider, web search, sync frequency, and deployment notes. Secrets must stay in environment variables, not in GitHub or database text fields." />

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <form action={saveSettings} className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
          <Section title="Country and sync">
            <Field label="Country selection">
              <select name="country.default" defaultValue="SA" className="input"><option value="SA">KSA / Saudi Arabia only</option></select>
            </Field>
            <Field label="Sync frequency cron">
              <input name="sync.frequencyCron" defaultValue={String(map.get('sync.frequencyCron') ?? '17 */2 * * *')} className="input" />
            </Field>
            <Field label="Default visibility">
              <select name="visibility.default" defaultValue={String(map.get('visibility.default') ?? true)} className="input"><option value="true">Visible by default</option><option value="false">Hidden by default</option></select>
            </Field>
          </Section>

          <Section title="Pricing and discounts">
            <Field label="Default pricing formula JSON">
              <textarea name="pricing.defaultFormula" defaultValue={JSON.stringify(map.get('pricing.defaultFormula') ?? { type: 'markup_percent', value: 60, roundTo: 0.99 }, null, 2)} rows={5} className="input font-mono text-xs" />
            </Field>
          </Section>

          <Section title="AI provider">
            <Field label="Provider name"><input name="ai.provider" defaultValue={String(map.get('ai.provider') ?? 'DuckCoding')} className="input" /></Field>
            <Field label="OpenAI-compatible base URL"><input name="ai.baseUrl" defaultValue={String(map.get('ai.baseUrl') ?? 'https://www.duckcoding.ai/')} className="input" /></Field>
            <Field label="Selected model"><input name="ai.model" defaultValue={String(map.get('ai.model') ?? 'claude-opus-4-8')} className="input" /></Field>
            <p className="text-xs text-slate-500">API key is read from <code>AI_API_KEY</code>. The official OpenAI endpoint is not hardcoded.</p>
          </Section>

          <Section title="Google Merchant Center">
            <Field label="Feed label"><input name="gmc.feedLabel" defaultValue={String(map.get('gmc.feedLabel') ?? 'SA')} className="input" /></Field>
            <Field label="Content language"><input name="gmc.contentLanguage" defaultValue={String(map.get('gmc.contentLanguage') ?? 'ar')} className="input" /></Field>
            <p className="text-xs text-slate-500">Merchant account ID, data source ID, and Google credentials are read from environment variables.</p>
          </Section>

          <button className="rounded-2xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white">Save settings</button>
        </form>

        <aside className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
            <h2 className="text-lg font-bold text-ink">Required environment secrets</h2>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              <li><code>COD_NETWORK_API_TOKEN</code></li>
              <li><code>COD_NETWORK_ADD_PRODUCT_ENDPOINT</code> after official docs are provided</li>
              <li><code>YOUCAN_API_TOKEN</code></li>
              <li><code>GOOGLE_MERCHANT_ACCOUNT_ID</code></li>
              <li><code>GOOGLE_MERCHANT_DATA_SOURCE_ID</code></li>
              <li><code>GOOGLE_SERVICE_ACCOUNT_JSON</code> or <code>GOOGLE_APPLICATION_CREDENTIALS</code></li>
              <li><code>AI_API_KEY</code></li>
              <li><code>SERPAPI_API_KEY</code> for Google Lens image enrichment</li>
              <li><code>BRIGHTDATA_API_KEY</code> for Google Images fallback</li>
            </ul>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
            <h2 className="text-lg font-bold text-ink">Predefined categories</h2>
            <div className="mt-4 space-y-2">
              {categories.map((category) => <div key={category.id} className="rounded-2xl bg-slate-50 p-3 text-sm"><b>{category.name}</b><br /><span className="text-xs text-slate-500">YouCan: {category.youCanCategoryId ?? 'not mapped'} · Google: {category.googleProductCategory ?? 'not mapped'}</span></div>)}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
            <h2 className="text-lg font-bold text-ink">Discount variant rules</h2>
            <div className="mt-4 space-y-2">
              {discounts.map((rule) => <div key={rule.id} className="rounded-2xl bg-slate-50 p-3 text-sm">{rule.label}</div>)}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-4"><h2 className="text-lg font-bold text-ink">{title}</h2>{children}</section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-2 text-sm font-semibold text-slate-700">{label}{children}</label>;
}
