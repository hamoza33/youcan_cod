import { LogLevel, LogSource } from '@prisma/client';
import { OpenAICompatibleClient } from '@/lib/ai/openai-compatible';
import { AnthropicCompatibleClient } from '@/lib/ai/anthropic-compatible';
import { type AiChatClient, type ChatMessage } from '@/lib/ai/types';
import { parseAiProviderOrder } from '@/lib/ai/provider-order';
import { getConfig } from '@/lib/settings/config';
import { logEvent } from '@/lib/logger';
import { toJsonValue } from '@/lib/http/client';

export class AiProviderChain implements AiChatClient {
  private lastSuccessfulProvider?: AiChatClient;

  get providerName() {
    return this.lastSuccessfulProvider?.providerName ?? 'AI fallback chain';
  }

  get model() {
    return this.lastSuccessfulProvider?.model ?? 'fallback-chain';
  }

  constructor(private readonly providers: AiChatClient[]) {}

  static async create() {
    const env = await getConfig();
    const providers = parseAiProviderOrder(env.AI_PROVIDER_ORDER).map((provider) => {
      if (provider === 'anthropic') {
        return new AnthropicCompatibleClient({
          providerName: env.ANTHROPIC_PROVIDER_NAME,
          baseUrl: env.ANTHROPIC_BASE_URL,
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.ANTHROPIC_MODEL,
        });
      }
      return new OpenAICompatibleClient({ providerName: env.AI_PROVIDER_NAME, baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL });
    });
    return new AiProviderChain(providers);
  }

  async chatJson<T>(messages: ChatMessage[], schemaDescription: string): Promise<T> {
    return this.run((provider) => provider.chatJson<T>(messages, schemaDescription));
  }

  async chat(messages: ChatMessage[]) {
    return this.run((provider) => provider.chat(messages));
  }

  private async run<T>(call: (provider: AiChatClient) => Promise<T>) {
    const failures: Array<{ provider: string; model: string; error: string }> = [];
    for (const [index, provider] of this.providers.entries()) {
      try {
        if (index > 0) {
          await logEvent({
            source: LogSource.AI,
            level: LogLevel.WARN,
            message: `Switching AI provider to ${provider.providerName} after previous provider failure.`,
            context: toJsonValue({ provider: provider.providerName, model: provider.model, failures }),
          });
        }
        const result = await call(provider);
        this.lastSuccessfulProvider = provider;
        return result;
      } catch (error) {
        failures.push({ provider: provider.providerName, model: provider.model, error: errorMessage(error) });
        await logEvent({
          source: LogSource.AI,
          level: LogLevel.WARN,
          message: `AI provider ${provider.providerName} failed; trying fallback if available.`,
          context: toJsonValue({ provider: provider.providerName, model: provider.model, error: errorMessage(error) }),
        });
      }
    }
    throw new Error(`All AI providers failed: ${failures.map((failure) => `${failure.provider}/${failure.model}: ${failure.error}`).join(' | ')}`);
  }
}

export async function testAiProvider(provider: 'openai' | 'anthropic' | 'chain') {
  const client = provider === 'openai'
    ? await OpenAICompatibleClient.create()
    : provider === 'anthropic'
      ? await AnthropicCompatibleClient.create()
      : await AiProviderChain.create();
  const startedAt = Date.now();
  const result = await client.chatJson<{ ok: boolean; provider?: string }>([
    { role: 'system', content: 'You are a health check endpoint. Return a tiny JSON object only.' },
    { role: 'user', content: 'Return {"ok":true}.' },
  ], '{ ok: boolean }');
  return { ok: Boolean(result.ok), provider: client.providerName, model: client.model, latencyMs: Date.now() - startedAt };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
