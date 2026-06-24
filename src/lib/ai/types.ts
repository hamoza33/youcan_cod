export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
};

export type AiProviderKey = 'openai' | 'anthropic';

export type AiChatClient = {
  readonly providerName: string;
  readonly model: string;
  chat(messages: ChatMessage[]): Promise<string>;
  chatJson<T>(messages: ChatMessage[], schemaDescription: string): Promise<T>;
};

export function extractJson(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) return trimmed.slice(firstObject, lastObject + 1);
  return trimmed;
}
