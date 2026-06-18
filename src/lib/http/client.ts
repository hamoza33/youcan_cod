import { LogLevel, LogSource, Prisma } from '@prisma/client';
import { logEvent } from '@/lib/logger';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type RequestOptions = RequestInit & {
  retries?: number;
  retryDelayMs?: number;
  source?: LogSource;
  logContext?: Prisma.InputJsonValue;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { retries = 3, retryDelayMs = 600, source, logContext, ...fetchOptions } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(fetchOptions.headers ?? {}),
        },
      });

      const text = await response.text();
      const payload = text ? safeJson(text) : null;

      if (!response.ok) {
        throw new ApiError(`API request failed with ${response.status} ${response.statusText}`, response.status, payload);
      }

      return payload as T;
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < retries && isRetryable(error);
      if (source) {
        await logEvent({
          source,
          level: shouldRetry ? LogLevel.WARN : LogLevel.ERROR,
          message: shouldRetry ? `API request failed; retrying attempt ${attempt}` : 'API request failed permanently',
          context: toJsonValue({ url, attempt, error: errorToJson(error), ...(typeof logContext === 'object' && logContext ? logContext : {}) }),
        });
      }
      if (!shouldRetry) break;
      await sleep(retryDelayMs * attempt);
    }
  }

  throw lastError;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRetryable(error: unknown) {
  if (error instanceof ApiError) {
    return !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}

export function errorToJson(error: unknown) {
  if (error instanceof ApiError) {
    return { name: error.name, message: error.message, status: error.status, payload: toJsonValue(error.payload) };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
