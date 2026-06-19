import { LogLevel, LogSource } from '@prisma/client';
import { requestJson, toJsonValue } from '@/lib/http/client';
import { logEvent } from '@/lib/logger';
import { getOptionalConfig } from '@/lib/settings/config';

export type ImageCandidate = {
  url: string;
  source: 'cod' | 'serper_images' | 'serpapi_lens' | 'serpapi_images' | 'brightdata_images' | 'web_search';
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

type SerperImagesResponse = {
  images?: Array<{
    title?: string;
    imageUrl?: string;
    imageWidth?: number;
    imageHeight?: number;
    thumbnailUrl?: string;
    thumbnailWidth?: number;
    thumbnailHeight?: number;
    source?: string;
    domain?: string;
    link?: string;
  }>;
};

type BrightDataImagesResponse = {
  images?: Array<{
    title?: string;
    link?: string;
    source?: string;
    original_image?: string;
    image?: string;
    image_url?: string;
    thumbnail?: string;
    image_alt?: string;
    width?: number;
    height?: number;
  }>;
  organic?: Array<{ title?: string; link?: string; image?: string; thumbnail?: string }>;
  error?: string;
};

export async function reverseSearchImagesWithSerpApi(input: {
  imageUrl: string;
  query?: string;
  max?: number;
}) {
  const env = await getOptionalConfig();
  const apiKey = env.SERPAPI_API_KEY;
  if (!apiKey) return [];

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

  try {
    const response = await requestJson<SerpApiLensResponse>(`https://serpapi.com/search?${params}`, {
      source: LogSource.SEARCH,
      retries: 2,
      logContext: { provider: 'serpapi_google_lens' },
    });
    if (response.error) throw new Error(response.error);

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
      message: 'SerpApi Google Lens image search failed.',
      context: toJsonValue({ error: String(error), imageUrl: input.imageUrl }),
    });
    return [];
  }
}

export async function searchImagesWithSerper(input: {
  query: string;
  max?: number;
  country?: string;
}) {
  const env = await getOptionalConfig();
  const apiKey = env.SERPER_API_KEY;
  if (!apiKey || !input.query.trim()) return [];

  try {
    const response = await requestJson<SerperImagesResponse>('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey },
      body: JSON.stringify({ q: input.query, gl: input.country ?? 'sa', hl: 'en', autocorrect: true, num: input.max ?? 20 }),
      source: LogSource.SEARCH,
      retries: 2,
      logContext: { provider: 'serper_google_images', query: input.query },
    });

    return uniqueCandidates(
      (response.images ?? []).flatMap((image) => [
        candidate(image.imageUrl, 'serper_images', image),
        candidate(image.thumbnailUrl, 'serper_images', image, true),
      ]),
      input.max ?? 20,
    );
  } catch (error) {
    await logEvent({
      source: LogSource.SEARCH,
      level: LogLevel.WARN,
      message: 'Serper Google Images search failed.',
      context: toJsonValue({ error: String(error), query: input.query }),
    });
    return [];
  }
}

export async function searchImagesWithSerpApi(input: {
  query: string;
  max?: number;
  country?: string;
}) {
  const env = await getOptionalConfig();
  const apiKey = env.SERPAPI_API_KEY;
  if (!apiKey || !input.query.trim()) return [];

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

  try {
    const response = await requestJson<SerpApiImagesResponse>(`https://serpapi.com/search?${params}`, {
      source: LogSource.SEARCH,
      retries: 2,
      logContext: { provider: 'serpapi_google_images', query: input.query },
    });
    if (response.error) throw new Error(response.error);

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
      message: 'SerpApi Google Images search failed.',
      context: toJsonValue({ error: String(error), query: input.query }),
    });
    return [];
  }
}

export async function searchImagesWithBrightData(input: {
  query: string;
  max?: number;
  country?: string;
}) {
  const env = await getOptionalConfig();
  const apiKey = env.BRIGHTDATA_API_KEY;
  if (!apiKey) return [];

  const zone = env.BRIGHTDATA_SERP_ZONE || 'serp_api1';
  const searchUrl = `https://www.google.com/search?${new URLSearchParams({ q: input.query, udm: '2' })}`;

  try {
    const response = await requestJson<BrightDataImagesResponse>('https://api.brightdata.com/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        zone,
        url: searchUrl,
        format: 'json',
        country: input.country ?? 'sa',
      }),
      source: LogSource.SEARCH,
      retries: 2,
      logContext: { provider: 'brightdata_google_images' },
    });
    if (response.error) throw new Error(response.error);

    const imageCandidates = (response.images ?? []).flatMap((image) => [
      candidate(image.original_image, 'brightdata_images', image),
      candidate(image.image_url, 'brightdata_images', image),
      candidate(image.image, 'brightdata_images', image),
      candidate(image.thumbnail, 'brightdata_images', image, true),
    ]);
    const organicCandidates = (response.organic ?? []).flatMap((item) => [
      candidate(item.image, 'brightdata_images', item),
      candidate(item.thumbnail, 'brightdata_images', item, true),
    ]);

    return uniqueCandidates([...imageCandidates, ...organicCandidates], input.max ?? 20);
  } catch (error) {
    await logEvent({
      source: LogSource.SEARCH,
      level: LogLevel.WARN,
      message: 'Bright Data Google Images search failed.',
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
