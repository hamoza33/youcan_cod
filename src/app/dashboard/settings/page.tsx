import { PageHeader } from '@/components/page-header';
import { SettingField } from '@/components/setting-field';
import { prisma } from '@/lib/db';
import { addSerpApiKey, deleteSerpApiKey, saveCategories, saveDiscountRules, saveSettings, syncSerpApiKeyUsage, updateSerpApiKey } from '@/app/dashboard/settings/actions';
import { groupedSettings, SETTINGS } from '@/lib/settings/registry';
import { ensureSettingDefaults, getRuntimeSettings } from '@/lib/settings/runtime';
import { maskSerpApiKey } from '@/lib/products/serpapi-key-pool';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await ensureSettingDefaults();
  const values = await getRuntimeSettings();
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  const discounts = await prisma.discountRule.findMany({ orderBy: { sortOrder: 'asc' } });
  const serpApiKeys = await prisma.imageSearchApiKey.findMany({ where: { provider: 'SERPAPI' }, orderBy: { createdAt: 'asc' } });
  const groups = groupedSettings();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Edit API keys, endpoints, countries, pricing, discounts, categories, AI, image search, YouCan, Google Merchant Center, and runtime project settings. Sensitive values are masked until you click the eye icon."
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_480px]">
        <form action={saveSettings} className="space-y-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
          {groups.map(({ group, definitions }) => (
            <Section key={group} title={group}>
              <div className="grid gap-4 md:grid-cols-2">
                {definitions.map((definition) => (
                  <div key={definition.key} className={definition.input === 'json' || definition.input === 'countries' ? 'md:col-span-2' : ''}>
                    <SettingField definition={definition} value={definition.isSecret ? null : values[definition.key]} />
                  </div>
                ))}
              </div>
            </Section>
          ))}

          <button className="rounded-2xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white">Save all project settings</button>
        </form>

        <aside className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
            <h2 className="text-lg font-bold text-ink">Editable configuration coverage</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {SETTINGS.length} runtime settings are exposed here. Empty dashboard values fall back to VPS environment variables, so deployment remains safe while still allowing quick edits from the dashboard.
            </p>
            <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-700">
              Do not paste secrets into Git. Values saved here are stored in the database and masked in the browser by default.
            </p>
          </div>

          <SerpApiKeysPanel keys={serpApiKeys} />

          <form action={saveCategories} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
            <h2 className="text-lg font-bold text-ink">Categories</h2>
            <p className="mt-2 text-sm text-slate-500">Edit category names, YouCan mapping IDs, Google categories, active status, and sort order.</p>
            <div className="mt-4 max-h-[560px] space-y-3 overflow-y-auto pr-1">
              {categories.map((category) => (
                <div key={category.id} className="rounded-2xl bg-slate-50 p-3 text-sm">
                  <input type="hidden" name="category.id" value={category.id} />
                  <div className="grid gap-2">
                    <input name={`category.${category.id}.name`} defaultValue={category.name} className="input" />
                    <input name={`category.${category.id}.youCanCategoryId`} defaultValue={category.youCanCategoryId ?? ''} placeholder="YouCan category ID" className="input font-mono text-xs" />
                    <input name={`category.${category.id}.googleProductCategory`} defaultValue={category.googleProductCategory ?? ''} placeholder="Google product category" className="input text-xs" />
                    <div className="grid grid-cols-2 gap-2">
                      <input name={`category.${category.id}.sortOrder`} type="number" defaultValue={category.sortOrder} className="input" />
                      <select name={`category.${category.id}.isActive`} defaultValue={String(category.isActive)} className="input">
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button className="mt-4 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold">Save categories</button>
          </form>

          <form action={saveDiscountRules} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
            <h2 className="text-lg font-bold text-ink">Discount variant rules</h2>
            <p className="mt-2 text-sm text-slate-500">Variant prices are recalculated from these rules whenever products are imported to YouCan. The label field is the YouCan button text, e.g. قطعة واحدة, خمس قطع.</p>
            <div className="mt-4 space-y-3">
              {discounts.map((rule) => (
                <div key={rule.id} className="rounded-2xl bg-slate-50 p-3 text-sm">
                  <input type="hidden" name="discount.id" value={rule.id} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input name={`discount.${rule.id}.quantity`} type="number" defaultValue={rule.quantity} className="input" />
                    <input name={`discount.${rule.id}.discountPercent`} type="number" step="0.01" defaultValue={String(rule.discountPercent)} className="input" />
                    <input name={`discount.${rule.id}.label`} defaultValue={rule.label} placeholder="YouCan variant label, e.g. خمس قطع" className="input sm:col-span-2" />
                    <input name={`discount.${rule.id}.sortOrder`} type="number" defaultValue={rule.sortOrder} className="input" />
                    <select name={`discount.${rule.id}.isActive`} defaultValue={String(rule.isActive)} className="input">
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                </div>
              ))}
              <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-sm">
                <p className="mb-2 font-bold text-ink">Add rule</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input name="discount.new.quantity" type="number" placeholder="Quantity" className="input" />
                  <input name="discount.new.discountPercent" type="number" step="0.01" placeholder="Discount %" className="input" />
                  <input name="discount.new.label" placeholder="YouCan variant label, e.g. خمس قطع" className="input sm:col-span-2" />
                  <input name="discount.new.sortOrder" type="number" placeholder="Sort order" className="input sm:col-span-2" />
                </div>
              </div>
            </div>
            <button className="mt-4 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold">Save discount rules</button>
          </form>
        </aside>
      </div>
    </>
  );
}

function SerpApiKeysPanel({ keys }: { keys: Array<{
  id: string;
  label: string;
  apiKey: string;
  monthlyLimit: number;
  monthlyUsage: number;
  totalUsage: number;
  remoteMonthlyLimit: number | null;
  remoteMonthlyUsage: number | null;
  remoteSearchesLeft: number | null;
  remoteTotalSearchesLeft: number | null;
  remotePlanName: string | null;
  remoteSyncedAt: Date | null;
  isActive: boolean;
  lastUsedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
}> }) {
  const activeKeys = keys.filter((key) => key.isActive);
  const totalRemaining = keys.reduce((sum, key) => sum + Math.max(0, key.monthlyLimit - key.monthlyUsage), 0);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">SerpApi keys</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Image enrichment now uses only <a href="https://serpapi.com/" target="_blank" rel="noreferrer" className="font-bold text-brand-600">SerpApi</a>. Keys rotate automatically when a key reaches its limit or errors.
          </p>
        </div>
        <form action={syncSerpApiKeyUsage}>
          <button className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Sync credits</button>
        </form>
      </div>

      <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
        <SummaryCard label="Active keys" value={`${activeKeys.length}/${keys.length}`} />
        <SummaryCard label="Local credits left" value={String(totalRemaining)} />
        <SummaryCard label="Default monthly limit" value="250/key" />
      </div>

      <div className="mt-4 space-y-3">
        {keys.map((key) => {
          const remaining = Math.max(0, key.monthlyLimit - key.monthlyUsage);
          const nearLimit = remaining <= Math.max(5, Math.ceil(key.monthlyLimit * 0.1));
          const exhausted = remaining <= 0;
          return (
            <div key={key.id} className={`rounded-2xl border p-3 text-sm ${exhausted ? 'border-rose-200 bg-rose-50' : nearLimit || key.lastError ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}>
              <form action={updateSerpApiKey} className="grid gap-2">
                <input type="hidden" name="id" value={key.id} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-ink">{key.label}</p>
                    <p className="font-mono text-xs text-slate-500">{maskSerpApiKey(key.apiKey)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${key.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{key.isActive ? 'Active' : 'Inactive'}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input name="label" defaultValue={key.label} className="input" />
                  <input name="monthlyLimit" type="number" min="1" defaultValue={key.monthlyLimit} className="input" />
                  <select name="isActive" defaultValue={String(key.isActive)} className="input">
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                  <button className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold hover:bg-white">Save key</button>
                </div>
              </form>

              <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                <p><strong>Local usage:</strong> {key.monthlyUsage}/{key.monthlyLimit} this month · {remaining} left</p>
                <p><strong>Total attempted:</strong> {key.totalUsage}</p>
                <p><strong>SerpApi plan:</strong> {key.remotePlanName ?? 'Not synced'}</p>
                <p><strong>SerpApi credits:</strong> {key.remoteMonthlyUsage ?? '—'}/{key.remoteMonthlyLimit ?? '—'} · left {key.remoteTotalSearchesLeft ?? key.remoteSearchesLeft ?? '—'}</p>
                <p><strong>Last used:</strong> {formatDate(key.lastUsedAt)}</p>
                <p><strong>Synced:</strong> {formatDate(key.remoteSyncedAt)}</p>
              </div>

              {nearLimit ? <p className="mt-2 rounded-xl bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800">This key is near its local monthly limit. The system will switch to the next active key.</p> : null}
              {key.lastError ? <p className="mt-2 rounded-xl bg-rose-100 px-3 py-2 text-xs font-bold leading-5 text-rose-700">Last error: {key.lastError}</p> : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <form action={syncSerpApiKeyUsage}>
                  <input type="hidden" name="id" value={key.id} />
                  <button className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold hover:bg-white">Sync this key</button>
                </form>
                <form action={deleteSerpApiKey}>
                  <input type="hidden" name="id" value={key.id} />
                  <button className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-white">Delete</button>
                </form>
              </div>
            </div>
          );
        })}
        {keys.length === 0 ? <p className="rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-700">No SerpApi keys configured yet. Add at least one key to enable image search.</p> : null}
      </div>

      <form action={addSerpApiKey} className="mt-4 rounded-2xl border border-dashed border-slate-200 p-3">
        <p className="mb-3 font-bold text-ink">Add SerpApi key</p>
        <div className="grid gap-2">
          <input name="label" placeholder="Label, e.g. SerpApi key 6" className="input" />
          <input name="apiKey" type="password" placeholder="SerpApi API key" className="input font-mono text-xs" />
          <input name="monthlyLimit" type="number" min="1" defaultValue="250" className="input" />
          <button className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">Add key</button>
        </div>
      </form>
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-ink">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-4"><h2 className="text-lg font-bold text-ink">{title}</h2>{children}</section>;
}
