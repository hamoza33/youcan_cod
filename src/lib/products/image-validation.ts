import { createHash } from 'node:crypto';
import { getOptionalConfig } from '@/lib/settings/config';

export type ImageValidationResult = {
  url: string;
  ok: boolean;
  error?: string;
  contentType?: string | null;
  bytesRead?: number;
};

async function imageTimeoutMs() {
  try {
    return (await getOptionalConfig()).IMAGE_VALIDATION_TIMEOUT_MS ?? Number(process.env.IMAGE_VALIDATION_TIMEOUT_MS ?? 5000);
  } catch {
    return Number(process.env.IMAGE_VALIDATION_TIMEOUT_MS ?? 5000);
  }
}

export async function validateImageUrl(url: string): Promise<ImageValidationResult> {
  const trimmed = url.trim();
  if (!trimmed) return { url, ok: false, error: 'Empty image URL' };
  if (!/^https?:\/\//i.test(trimmed)) return { url: trimmed, ok: false, error: 'Image URL must start with http or https' };

  try {
    const response = await fetch(trimmed, {
      headers: { Accept: 'image/*,*/*', Range: 'bytes=0-1023' },
      signal: AbortSignal.timeout(await imageTimeoutMs()),
    });
    if (!response.ok || !response.body) {
      return { url: trimmed, ok: false, error: `Image request failed with ${response.status}` };
    }
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.toLowerCase().startsWith('image/')) {
      return { url: trimmed, ok: false, error: `URL is not an image (${contentType})`, contentType };
    }
    const reader = response.body.getReader();
    const firstChunk = await reader.read();
    await reader.cancel().catch(() => undefined);
    const bytesRead = firstChunk.value?.byteLength ?? 0;
    if (!bytesRead) return { url: trimmed, ok: false, error: 'Image response is empty', contentType };
    return { url: trimmed, ok: true, contentType, bytesRead };
  } catch (error) {
    return { url: trimmed, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function validateImageUrls(urls: string[], options: { max?: number; candidates?: number } = {}) {
  const uniqueUrls = [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, options.candidates ?? 10);
  const settled = await Promise.all(uniqueUrls.map((url) => validateImageUrl(url)));
  const results: ImageValidationResult[] = [];
  const valid: string[] = [];
  for (const result of settled) {
    results.push(result);
    if (result.ok && (!options.max || valid.length < options.max)) valid.push(result.url);
  }
  return { valid, results };
}

export async function dedupeImageUrlsByContent(urls: string[], options: { max?: number; bytes?: number; keepOnHashError?: boolean } = {}) {
  const max = options.max ?? urls.length;
  const hashes = new Set<string>();
  const unique: string[] = [];
  const duplicates: Array<{ url: string; duplicateOf?: string; error?: string; keptDespiteHashError?: boolean }> = [];
  const hashToUrl = new Map<string, string>();

  for (const url of [...new Set(urls.map((item) => item.trim()).filter(Boolean))]) {
    if (unique.length >= max) break;
    try {
      const hash = await imageContentHash(url, options.bytes ?? 524288);
      if (hashes.has(hash)) {
        duplicates.push({ url, duplicateOf: hashToUrl.get(hash) });
        continue;
      }
      hashes.add(hash);
      hashToUrl.set(hash, url);
      unique.push(url);
    } catch (error) {
      if (options.keepOnHashError ?? true) {
        unique.push(url);
        duplicates.push({ url, error: error instanceof Error ? error.message : String(error), keptDespiteHashError: true });
      } else {
        duplicates.push({ url, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return { unique, duplicates };
}

async function imageContentHash(url: string, maxBytes: number) {
  const response = await fetch(url, {
    headers: { Accept: 'image/*,*/*' },
    signal: AbortSignal.timeout(await imageTimeoutMs()),
  });
  if (!response.ok || !response.body) throw new Error(`Image request failed with ${response.status}`);
  const contentType = response.headers.get('content-type');
  if (contentType && !contentType.toLowerCase().startsWith('image/')) throw new Error(`URL is not an image (${contentType})`);

  const reader = response.body.getReader();
  const hash = createHash('sha256');
  let bytesRead = 0;
  try {
    while (bytesRead < maxBytes) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      const remaining = maxBytes - bytesRead;
      const slice = chunk.byteLength > remaining ? chunk.slice(0, remaining) : chunk;
      hash.update(slice);
      bytesRead += slice.byteLength;
      if (chunk.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (!bytesRead) throw new Error('Image response is empty');
  return hash.digest('hex');
}
