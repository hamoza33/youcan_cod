'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth/session';

export async function loginAction(_previousState: { error?: string } | undefined, formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? '/dashboard/products'));
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return { error: 'Admin password is not configured on the server.' };
  }

  if (password !== adminPassword) {
    return { error: 'Invalid password. Please try again.' };
  }

  const token = await createSessionToken(adminPassword);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  redirect(next);
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect('/login');
}

function safeNextPath(value: string) {
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard/products';
  if (value.startsWith('/login')) return '/dashboard/products';
  return value;
}
