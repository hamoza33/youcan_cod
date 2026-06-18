import { LogLevel, LogSource } from '@prisma/client';
import { logEvent } from '@/lib/logger';
import { OpenAICompatibleClient } from '@/lib/ai/openai-compatible';
import { WebSearchResult } from '@/lib/search/web-search';
import { validateImageUrls, dedupeImageUrlsByContent } from '@/lib/products/image-validation';
import { ImageCandidate, reverseSearchImagesWithSerpApi, searchImagesWithBrightData, shouldRejectCandidate } from '@/lib/products/image-search-providers';
import { toJsonValue } from '@/lib/http/client';
import { getOptionalConfig } from '@/lib/settings/config';

export type SelectedImageResult = {
  selectedImageUrls: string[];
  rejectedImageUrls?: string[];
  notes: string;
};

export async function selectAccurateProductImages(input: {
  title: string;
  rawName?: string | null;
  existingImageUrls: string[];
  searchResults: WebSearchResult[];
  ai?: OpenAICompatibleClient;
}) {
  const env = await getOptionalConfig();
  const targetCount = numberSetting(env.IMAGE_ENRICHMENT_TARGET_COUNT, 5, 4, 5);
  const minimumCount = Math.min(4, targetCount);
  const maxCandidates = numberSetting(env.IMAGE_ENRICHMENT_MAX_CANDIDATES, 35, 12, 60);

  const codReferenceUrl = uniqueUrls(input.existingImageUrls)[0];
  const originalCandidates = codReferenceUrl ? [{ url: codReferenceUrl, source: 'cod' as const }] : [];
  const excludedCodUrls = new Set(uniqueUrls(input.existingImageUrls).slice(1));
  const webSearchCandidates = uniqueUrls(input.searchResults.flatMap((result) => result.imageUrls ?? []))
    .filter((url) => !excludedCodUrls.has(url) && url !== codReferenceUrl)
    .map((url) => ({ url, source: 'web_search' as const }));

  let candidates: ImageCandidate[] = dedupeCandidates([...originalCandidates, ...webSearchCandidates]).slice(0, maxCandidates);
  let validation = await validatePrioritizedCandidates(candidates, targetCount, maxCandidates);

  if (validation.valid.length < minimumCount && originalCandidates[0]?.url) {
    const lensCandidates = await reverseSearchImagesWithSerpApi({
      imageUrl: originalCandidates[0].url,
      max: maxCandidates,
    });
    candidates = dedupeCandidates([...candidates, ...lensCandidates]).slice(0, maxCandidates);
    validation = await validatePrioritizedCandidates(candidates, targetCount, maxCandidates);
  }

  if (validation.valid.length < minimumCount && originalCandidates[0]?.url) {
    const refinedLensCandidates = await reverseSearchImagesWithSerpApi({
      imageUrl: originalCandidates[0].url,
      query: buildImageSearchQuery(input),
      max: maxCandidates,
    });
    candidates = dedupeCandidates([...candidates, ...refinedLensCandidates]).slice(0, maxCandidates);
    validation = await validatePrioritizedCandidates(candidates, targetCount, maxCandidates);
  }

  if (validation.valid.length < minimumCount) {
    const brightDataCandidates = await searchImagesWithBrightData({
      query: buildImageSearchQuery(input),
      max: maxCandidates,
      country: 'sa',
    });
    candidates = dedupeCandidates([...candidates, ...brightDataCandidates]).slice(0, maxCandidates);
    validation = await validatePrioritizedCandidates(candidates, targetCount, maxCandidates);
  }

  const validCandidates = validation.valid;
  const selected = await selectWithAi({ ...input, candidates, validCandidates, targetCount, codReferenceUrl });
  const finalValidation = await validateImageUrls(selected, { max: targetCount + 3, candidates: targetCount + 3 });
  const deduped = await dedupeImageUrlsByContent(finalValidation.valid, { max: targetCount });
  const finalImages = prioritizeOriginalImages(deduped.unique, codReferenceUrl ? [codReferenceUrl] : []).slice(0, targetCount);

  if (finalImages.length < minimumCount) {
    await logEvent({
      source: LogSource.SEARCH,
      level: LogLevel.WARN,
      message: `Only ${finalImages.length} exact valid product image(s) found; target is ${minimumCount}-${targetCount}.`,
      context: toJsonValue({
        title: input.title,
        rawName: input.rawName,
        candidateCount: candidates.length,
        validCandidateCount: validCandidates.length,
        providers: providerCounts(candidates),
        duplicateImagesRemoved: deduped.duplicates.slice(0, 10),
        excludedAdditionalCodImageCount: excludedCodUrls.size,
        validationErrors: validation.results.filter((result) => !result.ok).slice(0, 10),
      }),
    });
  }

  return finalImages.length ? finalImages : (codReferenceUrl ? [codReferenceUrl] : uniqueUrls(input.existingImageUrls).slice(0, 1));
}

async function selectWithAi(input: {
  title: string;
  rawName?: string | null;
  existingImageUrls: string[];
  searchResults: WebSearchResult[];
  candidates: ImageCandidate[];
  validCandidates: string[];
  targetCount: number;
  codReferenceUrl?: string;
  ai?: OpenAICompatibleClient;
}) {
  const fallback = prioritizeOriginalImages(input.validCandidates, input.codReferenceUrl ? [input.codReferenceUrl] : []).slice(0, input.targetCount);
  if (input.validCandidates.length <= 1) return fallback;

  try {
    const ai = input.ai ?? await OpenAICompatibleClient.create();
    const metadataByUrl = new Map(input.candidates.map((candidate) => [candidate.url, candidate]));
    const result = await ai.chatJson<SelectedImageResult>(
      [
        {
          role: 'system',
          content:
            'You select ecommerce product images for import. Return only image URLs that show the exact same physical product as the original COD image/product. Reject every different variant: different color, pattern, material, size, model, bundle quantity, packaging-only image, accessory-only image, similar replacement product, or same category but not the same item. Accept only additional angles/perspectives/details of the identical item. Reject logos, sprites, tracking pixels, thumbnails that are not the product, and similar-but-different products. Keep the original COD image first when it is valid. Target 4-5 total images only if they are exact matches; otherwise return fewer and explain why.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                productTitle: input.title,
                rawProductName: input.rawName,
                originalCodImages: input.existingImageUrls,
                targetImageCount: input.targetCount,
                validatedCandidates: input.validCandidates.map((url) => ({
                  url,
                  source: metadataByUrl.get(url)?.source,
                  title: metadataByUrl.get(url)?.title,
                  pageUrl: metadataByUrl.get(url)?.pageUrl,
                  domain: metadataByUrl.get(url)?.domain,
                })),
                searchEvidence: input.searchResults.map((result) => ({ title: result.title, url: result.url, snippet: result.snippet })).slice(0, 10),
                requiredOutput: {
                  selectedImageUrls: 'array of 1-5 URL strings. Use only validatedCandidates. Keep at most one COD image: the reference image. Prefer unique online images from different listings/angles that match the exact same product. Do not include different colors, variants, models, sizes, or bundles.',
                  rejectedImageUrls: 'optional array of URLs rejected as not exact product images',
                  notes: 'short reason for selected/rejected images',
                },
              }),
            },
            ...input.validCandidates.slice(0, 10).map((url) => ({ type: 'image_url' as const, image_url: { url } })),
          ],
        },
      ],
      'SelectedImageResult object with selectedImageUrls string[], optional rejectedImageUrls string[], and notes string.',
    );

    const selected = uniqueUrls(result.selectedImageUrls ?? []).filter((url) => input.validCandidates.includes(url));
    return selected.length ? prioritizeOriginalImages(selected, input.codReferenceUrl ? [input.codReferenceUrl] : []).slice(0, input.targetCount) : fallback;
  } catch (error) {
    await logEvent({
      source: LogSource.AI,
      level: LogLevel.WARN,
      message: 'AI image selection failed; using validated prioritized image candidates.',
      context: toJsonValue({ error: String(error), title: input.title, validCandidateCount: input.validCandidates.length }),
    });
    return fallback;
  }
}

async function validatePrioritizedCandidates(candidates: ImageCandidate[], max: number, maxCandidates: number) {
  const filtered = candidates.filter((candidate) => !shouldRejectCandidate(candidate)).slice(0, maxCandidates);
  const validation = await validateImageUrls(filtered.map((candidate) => candidate.url), { max, candidates: maxCandidates });
  return validation;
}

function buildImageSearchQuery(input: { title: string; rawName?: string | null }) {
  return uniqueWords([input.rawName, input.title, 'exact same product images different angles no color variant'].filter(Boolean).join(' ')).slice(0, 14).join(' ');
}

function uniqueWords(value: string) {
  const seen = new Set<string>();
  return value
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => {
      const key = word.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function dedupeCandidates(candidates: ImageCandidate[]) {
  const seen = new Set<string>();
  const result: ImageCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.url || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    result.push(candidate);
  }
  return result;
}

function prioritizeOriginalImages(urls: string[], originals: string[]) {
  const unique = uniqueUrls(urls);
  const originalSet = new Set(originals.slice(0, 1));
  return [...unique.filter((url) => originalSet.has(url)), ...unique.filter((url) => !originalSet.has(url))];
}

function uniqueUrls(urls: unknown[]) {
  return [...new Set(urls.map((url) => (typeof url === 'string' ? url.trim() : '')).filter(Boolean))];
}

function providerCounts(candidates: ImageCandidate[]) {
  return candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.source] = (counts[candidate.source] ?? 0) + 1;
    return counts;
  }, {});
}

function numberSetting(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
