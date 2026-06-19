import { PageHeader } from '@/components/page-header';
import { SettingField } from '@/components/setting-field';
import { prisma } from '@/lib/db';
import { saveCategories, saveDiscountRules, saveSettings } from '@/app/dashboard/settings/actions';
import { groupedSettings, SETTINGS } from '@/lib/settings/registry';
import { ensureSettingDefaults, getRuntimeSettings } from '@/lib/settings/runtime';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await ensureSettingDefaults();
  const values = await getRuntimeSettings();
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  const discounts = await prisma.discountRule.findMany({ orderBy: { sortOrder: 'asc' } });
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-4"><h2 className="text-lg font-bold text-ink">{title}</h2>{children}</section>;
}
