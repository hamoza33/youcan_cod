import { LogSource } from '@prisma/client';
import { requestJson } from '@/lib/http/client';
import { getConfig } from '@/lib/settings/config';
import { type AiChatClient, type ChatMessage, extractJson } from '@/lib/ai/types';

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>;
};

type AnthropicResponse = {
  content?: Array<{ type: 'text'; text?: string }>;
};

export class AnthropicCompatibleClient implements AiChatClient {
  readonly providerName: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(config?: { providerName?: string; baseUrl?: string; apiKey?: string; model?: string }) {
    this.providerName = config?.providerName ?? process.env.ANTHROPIC_PROVIDER_NAME ?? 'Anthropic';
    this.baseUrl = (config?.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');
    this.apiKey = config?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = config?.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-latest';
  }

  static async create() {
    const env = await getConfig();
    return new AnthropicCompatibleClient({
      providerName: env.ANTHROPIC_PROVIDER_NAME,
      baseUrl: env.ANTHROPIC_BASE_URL,
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
    });
  }

  async chatJson<T>(messages: ChatMessage[], schemaDescription: string): Promise<T> {
    const content = await this.chat([
      ...messages,
      { role: 'system', content: `Return only valid JSON. The JSON must match this description: ${schemaDescription}` },
    ]);

    try {
      return JSON.parse(extractJson(content)) as T;
    } catch (error) {
      throw new Error(`Anthropic-compatible provider returned invalid JSON: ${(error as Error).message}. Raw: ${content}`);
    }
  }

  async chat(messages: ChatMessage[]) {
    if (!this.apiKey) throw new Error('Anthropic API key is missing. Configure ANTHROPIC_API_KEY or the dashboard Anthropic key before using this provider.');
    const { system, anthropicMessages } = await normalizeMessages(messages);
    const response = await requestJson<AnthropicResponse>(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        temperature: 0.3,
        system: system || undefined,
        messages: anthropicMessages,
      }),
      source: LogSource.AI,
    });

    const content = response.content?.find((part) => part.type === 'text')?.text;
    if (!content) throw new Error('Anthropic-compatible provider returned an empty response.');
    return content;
  }
}

async function normalizeMessages(messages: ChatMessage[]) {
  const systemParts: string[] = [];
  const anthropicMessages: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(contentToText(message.content));
      continue;
    }
    anthropicMessages.push({ role: message.role, content: await normalizeContent(message.content) });
  }

  if (!anthropicMessages.length) {
    anthropicMessages.push({ role: 'user', content: [{ type: 'text', text: 'Return OK.' }] });
  }

  return { system: systemParts.join('\n\n'), anthropicMessages };
}

async function normalizeContent(content: ChatMessage['content']): Promise<AnthropicMessage['content']> {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  const parts: AnthropicMessage['content'] = [];
  for (const item of content) {
    if (item.type === 'text') {
      parts.push({ type: 'text', text: item.text });
    } else {
      const image = await imageUrlToBase64(item.image_url.url).catch(() => null);
      if (image) parts.push({ type: 'image', source: image });
      else parts.push({ type: 'text', text: `[Image URL unavailable to Anthropic provider: ${item.image_url.url}]` });
    }
  }
  return parts;
}

function contentToText(content: ChatMessage['content']) {
  if (typeof content === 'string') return content;
  return content.map((item) => item.type === 'text' ? item.text : `[Image: ${item.image_url.url}]`).join('\n');
}

async function imageUrlToBase64(url: string): Promise<{ type: 'base64'; media_type: string; data: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image fetch failed with ${response.status}`);
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { type: 'base64', media_type: contentType.split(';')[0], data: buffer.toString('base64') };
}
