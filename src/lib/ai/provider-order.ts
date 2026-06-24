import { type AiProviderKey } from '@/lib/ai/types';

export function parseAiProviderOrder(value: string | undefined): AiProviderKey[] {
  const parsed = (value ?? 'openai,anthropic')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is AiProviderKey => item === 'openai' || item === 'anthropic');

  return parsed.length ? [...new Set(parsed)] : ['openai', 'anthropic'];
}
