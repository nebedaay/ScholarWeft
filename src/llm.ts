// Small OpenAI-compatible chat client used by optional author-overview
// generation. Obsidian's requestUrl is used so the API key never leaves the
// app's network layer (and CORS is not an issue).

import { requestUrl } from 'obsidian';

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** One non-streaming chat completion. Returns the assistant text. */
export async function completeOpenAiCompatible(
  config: OpenAiCompatibleConfig,
  prompt: string
): Promise<string> {
  const base = (config.baseUrl ?? '').trim().replace(/\/+$/, '');
  const key = (config.apiKey ?? '').trim();
  const model = (config.model ?? '').trim();
  if (!base) throw new Error('No LLM base URL is configured.');
  if (!key) throw new Error('No LLM API key is configured.');
  if (!model) throw new Error('No LLM model is configured.');

  const url = /\/chat\/completions$/i.test(base)
    ? base
    : `${base}/chat/completions`;
  const response = await requestUrl({
    url,
    method: 'POST',
    throw: false,
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 700,
    }),
  });

  if (response.status < 200 || response.status >= 300) {
    const detail = (response.text ?? '').trim().slice(0, 500);
    throw new Error(
      `LLM request failed (${response.status})${detail ? `: ${detail}` : ''}`
    );
  }

  const content = response.json?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((part: unknown) =>
        typeof part === 'string'
          ? part
          : typeof (part as { text?: unknown })?.text === 'string'
            ? (part as { text: string }).text
            : ''
      )
      .join('')
      .trim();
    if (text) return text;
  }

  // Some Gemini-compatible responses expose the native candidates shape.
  const native = response.json?.candidates?.[0]?.content?.parts;
  if (Array.isArray(native)) {
    const text = native
      .map((part: { text?: unknown }) =>
        typeof part?.text === 'string' ? part.text : ''
      )
      .join('')
      .trim();
    if (text) return text;
  }

  throw new Error('The LLM returned no text.');
}
