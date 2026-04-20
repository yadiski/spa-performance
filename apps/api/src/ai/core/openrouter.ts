export interface OpenRouterCallInput {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  responseSchema: Record<string, unknown>; // JSON schema for response_format
  temperature?: number;
  maxTokens?: number;
}

export interface OpenRouterCallOutput {
  content: unknown; // parsed JSON (opaque — caller validates with Zod)
  promptTokens: number;
  completionTokens: number;
  model: string; // actual model used (server may redirect)
}

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 5000;
const RETRY_DELAYS = [200, 800];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callOpenRouter(input: OpenRouterCallInput): Promise<OpenRouterCallOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY missing');
  }

  const body = JSON.stringify({
    model: input.model,
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'response',
        schema: input.responseSchema,
        strict: true,
      },
    },
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(OPENROUTER_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const shouldRetry = response.status === 429 || response.status >= 500;
        if (!shouldRetry || attempt === RETRY_DELAYS.length) {
          const text = await response.text().catch(() => '');
          throw new Error(`openrouter: HTTP ${response.status} — ${text.slice(0, 200)}`);
        }
        lastError = new Error(`openrouter: HTTP ${response.status}`);
        await sleep(RETRY_DELAYS[attempt]!);
        continue;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };

      const raw = data.choices?.[0]?.message?.content;
      if (!raw) {
        throw new Error('openrouter: response not JSON');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('openrouter: response not JSON');
      }

      return {
        content: parsed,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        model: data.model ?? input.model,
      };
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error('openrouter: request timed out after 5s');
        if (attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt]!);
          continue;
        }
        throw lastError;
      }

      // Re-throw non-retryable errors immediately
      if (
        err instanceof Error &&
        err.message.startsWith('openrouter:') &&
        !err.message.includes('HTTP 429') &&
        !err.message.includes('HTTP 5')
      ) {
        throw err;
      }

      // If this is our final attempt, throw
      if (attempt === RETRY_DELAYS.length) {
        throw err;
      }

      lastError = err instanceof Error ? err : new Error(String(err));
      await sleep(RETRY_DELAYS[attempt]!);
    }
  }

  throw lastError ?? new Error('openrouter: unknown error');
}
