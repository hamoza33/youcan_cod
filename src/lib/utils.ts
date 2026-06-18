import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | null | undefined, currency = 'SAR') {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-SA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function truncate(value: string | null | undefined, length = 80) {
  if (!value) return '—';
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
