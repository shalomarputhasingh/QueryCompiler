/** Groq settings, read lazily so tests and the dev server pick up env changes. */
export interface QueraConfig {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  fallbackModel: string;
  /** Longest total time one answer may wait for the provider's quota to recover. */
  maxWaitMs: number;
}

export function readQueraConfig(env: Record<string, string | undefined> = process.env): QueraConfig {
  const key = env.GROQ_API_KEY?.trim();
  const wait = Number(env.QUERA_MAX_WAIT_MS);
  return {
    apiKey: key ? key : null,
    baseUrl: (env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/+$/, ""),
    model: env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
    fallbackModel: env.GROQ_FALLBACK_MODEL?.trim() || "openai/gpt-oss-20b",
    maxWaitMs: Number.isFinite(wait) && wait > 0 ? wait : 4 * 60_000,
  };
}
