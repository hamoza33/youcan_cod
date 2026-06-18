'use client';

import { useActionState } from 'react';
import { LockKeyhole, LogIn } from 'lucide-react';
import { loginAction } from '@/app/login/actions';

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <input type="hidden" name="next" value={next} />
      <label className="block space-y-2 text-sm font-semibold text-slate-700">
        Admin password
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            className="input pl-10"
            placeholder="Enter dashboard password"
            required
            autoFocus
          />
        </div>
      </label>
      {state?.error ? <div className="rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{state.error}</div> : null}
      <button
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-soft transition hover:bg-brand-700 disabled:opacity-60"
      >
        <LogIn className="h-4 w-4" /> {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
