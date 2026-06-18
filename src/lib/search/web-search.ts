import { LogLevel, LogSource } from '@prisma/client';
import { getEnv } from '@/lib/env';
import { requestJson } from '@/lib/http/client';
import { logEvent } from '@/lib/logger';

export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  imageUrls?: string[];
  imageDescriptions?: string[];
};

type TavilySearchResponse = {
  results?: Array<{ title?: string; url?: string; content?: string; raw_content?: string; images?: string[] }>;
  images?: Array<string | { url?: string; description?: string }>;
};

export class WebSearchClient {
  async search(query: string): Promise<WebSearchResult[]> {
    const env = getEnv();
    if (env.WEB_SEARCH_PROVIDER.toLowerCase() !== 'tavily' || !env.WEB_SEARCH_API_KEY) {
      await logEvent({
        source: LogSource.SEARCH,
        level: LogLevel.WARN,
        message: 'Web search provider is not configured; returning no external search results.',
        context: { query },
      });
      return [];
    }

    const response = await requestJson<TavilySearchResponse>('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WEB_SEARCH_API_KEY}` },
      body: JSON.stringify({
        query,
        search_depth: 'advanced',
        max_results: 5,
        include_images: true,
        include_image_descriptions: true,
      }),
      source: LogSource.SEARCH,
    });

    const topLevelImages = (response.images ?? []).map((image) => (typeof image === 'string' ? image : image.url)).filter((url): url is string => Boolean(url));
    const imageDescriptions = (response.images ?? [])
      .map((image) => (typeof image === 'string' ? undefined : image.description))
      .filter((description): description is string => Boolean(description));

    return (response.results ?? [])
      .filter((result) => result.url)
      .map((result) => ({
        title: result.title ?? result.url!,
        url: result.url!,
        snippet: result.content ?? result.raw_content,
        imageUrls: [...(result.images ?? []), ...topLevelImages].slice(0, 5),
        imageDescriptions,
      }));
  }
}
