import { LogLevel, LogSource } from '@prisma/client';
import { toJsonValue } from '@/lib/http/client';
import { logEvent } from '@/lib/logger';
import { requestSerpApiWithKeyPool } from '@/lib/products/serpapi-key-pool';

export type ImageCandidate = {
  url: string;
  source: 'cod' | 'serpapi_lens' | 'serpapi_images' | 'web_search';
  title?: string;
  pageUrl?: string;
  domain?: string;
  width?: number;
  height?: number;
};

type SerpApiLensResponse = {
  error?: string;
  search_metadata?: { status?: string; id?: string };
  visual_matches?: Array<{
    title?: string;
    link?: string;
    source?: string;
    thumbnail?: string;
    image?: string;
    image_width?: number;
    image_height?: number;
    thumbnail_width?: number;
    thumbnail_height?: number;
  }>;
};

type SerpApiImagesResponse = {
  error?: string;
  images_results?: Array<{
    title?: string;
    link?: string;
    source?: string;
    original?: string;
    thumbnail?: string;
    original_width?: number;
    original_height?: number;
    thumbnail_width?: number;
    thumbnail_height?: number;
  }>;
};

export async function reverseSearchImagesWithSerpApi(input: {
  imageUrl: string;
  query?: string;
  max?: number;
}) {
  try {
    const response = await requestSerpApiWithKeyPool<SerpApiLensResponse>({
      provider: 'serpapi_google_lens',
      context: { imageUrl: input.imageUrl, query: input.query },
      extractError: (payload) => payload.error,
      buildUrl: (apiKey) => {
        const params = new URLSearchParams({
          engine: 'google_lens',
          type: 'visual_matches',
          url: input.imageUrl,
          api_key: apiKey,
          output: 'json',
          safe: 'active',
          auto_crop: 'true',
        });
        if (input.query) params.set('q', input.query);
        return `https://serpapi.com/search?${params}`;
      },
    });

    return uniqueCandidates(
      (response.visual_matches ?? []).flatMap((match) => [
        candidate(match.image, 'serpapi_lens', match),
        candidate(match.thumbnail, 'serpapi_lens', match, true),
      ]),
      input.max ?? 20,
    );
  } catch (error) {
    await logEvent({
      source: LogSource.SEARCH,
      level: LogLevel.WARN,
      message: 'SerpApi Google Lens image search failed after cycling available keys.',
      context: toJsonValue({ error: String(error), imageUrl: input.imageUrl }),
    });
    return [];
  }
}

export async function searchImagesWithSerpApi(input: {
  query: string;
  max?: number;
  country?: string;
}) {
  if (!input.query.trim()) return [];

  try {
    const response = await requestSerpApiWithKeyPool<SerpApiImagesResponse>({
      provider: 'serpapi_google_images',
      context: { query: input.query, country: input.country ?? 'sa' },
      extractError: (payload) => payload.error,
      buildUrl: (apiKey) => {
        const params = new URLSearchParams({
          engine: 'google_images',
          q: input.query,
          api_key: apiKey,
          output: 'json',
          safe: 'active',
          hl: 'en',
          gl: input.country ?? 'sa',
          ijn: '0',
        });
        return `https://serpapi.com/search?${params}`;
      },
    });

    return uniqueCandidates(
      (response.images_results ?? []).flatMap((image) => [
        candidate(image.original, 'serpapi_images', image),
        candidate(image.thumbnail, 'serpapi_images', image, true),
      ]),
      input.max ?? 20,
    );
  } catch (error) {
    await logEvent({
      source: LogSource.SEARCH,
      level: LogLevel.WARN,
      message: 'SerpApi Google Images search failed after cycling available keys.',
      context: toJsonValue({ error: String(error), query: input.query }),
    });
    return [];
  }
}

function candidate(
  url: unknown,
  source: ImageCandidate['source'],
  metadata: Record<string, unknown>,
  thumbnail = false,
): ImageCandidate | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    url: url.trim(),
    source,
    title: stringValue(metadata.title) ?? stringValue(metadata.image_alt),
    pageUrl: stringValue(metadata.link),
    domain: stringValue(metadata.source) ?? stringValue(metadata.domain),
    width: numberValue(thumbnail ? metadata.thumbnail_width ?? metadata.thumbnailWidth : metadata.image_width ?? metadata.original_width ?? metadata.imageWidth ?? metadata.width),
    height: numberValue(thumbnail ? metadata.thumbnail_height ?? metadata.thumbnailHeight : metadata.image_height ?? metadata.original_height ?? metadata.imageHeight ?? metadata.height),
  };
}

function uniqueCandidates(candidates: Array<ImageCandidate | null>, max: number) {
  const seen = new Set<string>();
  const result: ImageCandidate[] = [];
  for (const item of candidates) {
    if (!item?.url || seen.has(item.url) || shouldRejectCandidate(item)) continue;
    seen.add(item.url);
    result.push(item);
    if (result.length >= max) break;
  }
  return result;
}

export function shouldRejectCandidate(candidate: Pick<ImageCandidate, 'url' | 'title' | 'width' | 'height'>) {
  const haystack = `${candidate.url} ${candidate.title ?? ''}`.toLowerCase();
  if (/sprite|logo|favicon|icon|pixel|uedata|batch\/1|analytics|tracking|avatar|profile|svg/.test(haystack)) return true;
  if (/\.gif(?:\?|$)/.test(haystack)) return true;
  if (candidate.width && candidate.width < 180) return true;
  if (candidate.height && candidate.height < 180) return true;
  return false;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
