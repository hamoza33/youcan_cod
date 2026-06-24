import { LogSource } from '@prisma/client';
import { requestJson } from '@/lib/http/client';
import { getConfig } from '@/lib/settings/config';
import { type AiChatClient, type ChatMessage, extractJson } from '@/lib/ai/types';

export type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export class OpenAICompatibleClient implements AiChatClient {
  readonly providerName: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(config?: { providerName?: string; baseUrl?: string; apiKey?: string; model?: string }) {
    this.providerName = config?.providerName ?? process.env.AI_PROVIDER_NAME ?? 'DuckCoding';
    this.baseUrl = (config?.baseUrl ?? process.env.AI_BASE_URL ?? 'https://www.duckcoding.ai/').replace(/\/$/, '');
    this.apiKey = config?.apiKey ?? process.env.AI_API_KEY;
    this.model = config?.model ?? process.env.AI_MODEL ?? 'claude-opus-4-8';
  }

  static async create() {
    const env = await getConfig();
    return new OpenAICompatibleClient({ providerName: env.AI_PROVIDER_NAME, baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL });
  }

  async chatJson<T>(messages: ChatMessage[], schemaDescription: string): Promise<T> {
    const content = await this.chat([
      ...messages,
      {
        role: 'system',
        content: `Return only valid JSON. The JSON must match this description: ${schemaDescription}`,
      },
    ]);

    try {
      return JSON.parse(extractJson(content)) as T;
    } catch (error) {
      throw new Error(`AI provider returned invalid JSON: ${(error as Error).message}. Raw: ${content}`);
    }
  }

  async chat(messages: ChatMessage[]) {
    if (!this.apiKey) {
      throw new Error('OpenAI-compatible API key is missing. Configure AI_API_KEY or the dashboard OpenAI-compatible key before AI enrichment.');
    }

    const response = await requestJson<ChatCompletionResponse>(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.3,
      }),
      source: LogSource.AI,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI-compatible provider returned an empty response.');
    return content;
  }
}

export type { ChatMessage } from '@/lib/ai/types';
