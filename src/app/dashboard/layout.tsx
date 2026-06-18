import Link from 'next/link';
import { BarChart3, Boxes, FileText, LogOut, Settings } from 'lucide-react';
import { logoutAction } from '@/app/login/actions';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard/products', label: 'Products', icon: Boxes },
  { href: '/dashboard/logs', label: 'Logs', icon: FileText },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-soft">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-200 bg-white px-5 py-6 lg:block">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-soft">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">COD Automation</p>
            <h1 className="text-lg font-bold text-ink">KSA Import Control</h1>
          </div>
        </div>

        <nav className="mt-10 space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-brand-50 hover:text-brand-700',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="absolute bottom-6 left-5 right-5 rounded-3xl bg-slate-900 p-5 text-white">
          <p className="text-sm font-semibold">KSA only</p>
          <p className="mt-2 text-xs leading-5 text-slate-300">
            Product discovery, SKU mapping, YouCan import, and GMC submissions are scoped to Saudi Arabia.
          </p>
          <form action={logoutAction} className="mt-4">
            <button className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/20">
              <LogOut className="h-3.5 w-3.5" /> Logout
            </button>
          </form>
        </div>
      </aside>

      <main className="lg:pl-72">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
