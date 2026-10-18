import type { QueraConfig } from "./config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Events sent to the browser. `ping` keeps the connection alive while the provider quota recovers. */
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "ping" }
  | { type: "done" }
  | { type: "error"; code: "not_configured" | "unauthorized" | "unavailable" | "bad_request" | "aborted" };

export interface StreamOptions {
  config: QueraConfig;
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to a real timer that resolves early on abort. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}

const PING_EVERY_MS = 5_000;
const MIN_WAIT_MS = 500;
const MAX_SINGLE_WAIT_MS = 5 * 60_000;

/** Parses Groq's "Please try again in 1m3.2s / 7.6s / 850ms" hint. */
export function parseRetryHint(text: string): number | null {
  const m = /try again in\s+(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)(ms|s))?/i.exec(text);
  if (!m) return null;
  const [, h, min, num, unit] = m;
  if (!h && !min && !num) return null;
  let ms = 0;
  if (h) ms += Number(h) * 3_600_000;
  if (min) ms += Number(min) * 60_000;
  if (num) ms += unit === "ms" ? Number(num) : Number(num) * 1000;
  return ms;
}

/** How long to wait before retrying a throttled / failed request. */
export function computeWaitMs(headers: Headers, bodyText: string, attempt: number): number {
  const header = headers.get("retry-after");
  let ms: number | null = null;
  if (header && Number.isFinite(Number(header))) ms = Number(header) * 1000;
  if (ms === null) ms = parseRetryHint(bodyText);
  if (ms === null) ms = Math.min(30_000, 1_000 * 2 ** attempt);
  return Math.min(MAX_SINGLE_WAIT_MS, Math.max(MIN_WAIT_MS, ms + 400)); // small pad so the window has really reset
}

/**
 * Request parameters that depend on the model. gpt-oss models are reasoning models: they spend part of
 * the completion budget on hidden reasoning, so they get a roomier token limit, a low reasoning effort
 * (fast, and kind to free-tier quotas) and the reasoning text is not returned. Other models reject
 * those parameters, so they are only sent to gpt-oss.
 */
export function modelParams(model: string): Record<string, unknown> {
  if (/gpt-oss/i.test(model)) return { reasoning_effort: "low", include_reasoning: false, max_completion_tokens: 2048 };
  return { max_tokens: 900 };
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Streams a chat completion from Groq (OpenAI-compatible). Rate limits (429) and transient errors
 * are absorbed here: the generator waits as long as the provider asks (up to `maxWaitMs`) while
 * yielding `ping` events, so the caller never has to surface "rate limited" to the user.
 */
export async function* streamChat(messages: ChatMessage[], opts: StreamOptions): AsyncGenerator<ChatEvent> {
  const { config } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const deadline = now() + config.maxWaitMs;

  if (!config.apiKey) {
    yield { type: "error", code: "not_configured" };
    return;
  }

  let model = config.model;
  let attempt = 0;
  let triedFallback = model === config.fallbackModel;

  const switchToFallback = (): boolean => {
    if (triedFallback) return false;
    triedFallback = true;
    model = config.fallbackModel;
    attempt = 0;
    return true;
  };

  async function* waitFor(ms: number): AsyncGenerator<ChatEvent> {
    let left = ms;
    while (left > 0) {
      if (opts.signal?.aborted) return;
      const step = Math.min(PING_EVERY_MS, left);
      await sleep(step);
      left -= step;
      yield { type: "ping" };
    }
  }

  for (;;) {
    if (opts.signal?.aborted) {
      yield { type: "error", code: "aborted" };
      return;
    }

    let res: Response;
    try {
      res = await doFetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model, messages, stream: true, temperature: 0.3, ...modelParams(model) }),
        signal: opts.signal,
      });
    } catch {
      if (opts.signal?.aborted) {
        yield { type: "error", code: "aborted" };
        return;
      }
      // Network hiccup: back off and retry within the time budget.
      const wait = computeWaitMs(new Headers(), "", attempt++);
      if (wait > deadline - now()) {
        yield { type: "error", code: "unavailable" };
        return;
      }
      yield* waitFor(wait);
      continue;
    }

    if (res.ok && res.body) {
      try {
        for await (const text of readDeltas(res.body)) {
          yield { type: "delta", text };
        }
        yield { type: "done" };
      } catch {
        yield { type: "error", code: opts.signal?.aborted ? "aborted" : "unavailable" };
      }
      return;
    }

    const bodyText = await res.text().catch(() => "");
    const status = res.status;

    if (status === 401 || status === 403) {
      yield { type: "error", code: "unauthorized" };
      return;
    }

    if (status === 429 || status >= 500 || status === 408) {
      const wait = computeWaitMs(res.headers, bodyText, attempt++);
      const remaining = deadline - now();
      if (wait > remaining) {
        // Waiting is not possible any more (e.g. a daily quota). Try the lighter model, which has its own quota.
        if (switchToFallback()) continue;
        yield { type: "error", code: "unavailable" };
        return;
      }
      yield* waitFor(wait);
      continue;
    }

    // 400 / 404 / 413 …: usually a retired model or an oversized prompt.
    if (switchToFallback()) continue;
    yield { type: "error", code: "bad_request" };
    return;
  }
}

/** Reads OpenAI-style SSE and yields the content deltas. */
async function* readDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] };
          const text = json.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          // ignore malformed keep-alive lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
