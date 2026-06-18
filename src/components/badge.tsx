import { cn } from '@/lib/utils';

export function Badge({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode;
  tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'purple';
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    red: 'bg-rose-50 text-rose-700 ring-rose-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    blue: 'bg-blue-50 text-blue-700 ring-blue-200',
    purple: 'bg-purple-50 text-purple-700 ring-purple-200',
  };

  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1', tones[tone])}>
      {children}
    </span>
  );
}
