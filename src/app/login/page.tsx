import { BarChart3, ShieldCheck } from 'lucide-react';
import { LoginForm } from '@/app/login/login-form';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : '/dashboard/products';

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4 py-12">
      <div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-8 shadow-soft">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-soft">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-600">COD Automation</p>
            <h1 className="text-xl font-black text-ink">Admin login</h1>
          </div>
        </div>

        <div className="mt-6 rounded-3xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          <div className="mb-2 flex items-center gap-2 font-bold text-slate-800">
            <ShieldCheck className="h-4 w-4 text-brand-600" /> Secure dashboard access
          </div>
          Sign in to manage COD Network imports, YouCan products, SEO generation, stock sync, and Google Merchant Center status.
        </div>

        <LoginForm next={next} />
      </div>
    </main>
  );
}
