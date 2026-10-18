import { describe, expect, it } from "vitest";
import { readQueraConfig } from "@/lib/chat/config";
import { type ChatEvent, computeWaitMs, modelParams, parseRetryHint, streamChat } from "@/lib/chat/groq";

const cfg = (over: Partial<ReturnType<typeof readQueraConfig>> = {}) => ({ ...readQueraConfig({ GROQ_API_KEY: "k" }), ...over });

function sse(parts: string[]): Response {
  const body = parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const limited = (retryAfter?: string, message = "Rate limit reached. Please try again in 7.6s."): Response =>
  new Response(JSON.stringify({ error: { message } }), { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
const text = (events: ChatEvent[]) => events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");

function harness(responses: (Response | Error)[]) {
  let clock = 0;
  const sleeps: number[] = [];
  const calls: { model: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ model: body.model, body });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { sleeps, calls, opts: { fetchImpl, now: () => clock, sleep: async (ms: number) => { sleeps.push(ms); clock += ms; } } };
}

describe("retry hints", () => {
  it("parses Groq's human readable durations", () => {
    expect(parseRetryHint("Please try again in 7.6s.")).toBe(7600);
    expect(parseRetryHint("Please try again in 1m3.2s")).toBe(63200);
    expect(parseRetryHint("try again in 850ms")).toBe(850);
    expect(parseRetryHint("try again in 2m")).toBe(120000);
    expect(parseRetryHint("something else")).toBeNull();
  });

  it("prefers the retry-after header, then the message, then exponential backoff", () => {
    expect(computeWaitMs(new Headers({ "retry-after": "20" }), "try again in 1s", 0)).toBe(20_400);
    expect(computeWaitMs(new Headers(), "try again in 7.6s", 0)).toBe(8_000);
    expect(computeWaitMs(new Headers(), "", 3)).toBe(8_400);
    expect(computeWaitMs(new Headers(), "", 20)).toBe(30_400);
  });
});

describe("model parameters", () => {
  it("uses openai/gpt-oss-120b by default with room for reasoning, and hides the reasoning text", () => {
    const c = readQueraConfig({ GROQ_API_KEY: "k" });
    expect(c.model).toBe("openai/gpt-oss-120b");
    expect(c.fallbackModel).toBe("openai/gpt-oss-20b");
    expect(modelParams(c.model)).toEqual({ reasoning_effort: "low", include_reasoning: false, max_completion_tokens: 2048 });
  });
  it("only sends reasoning options to gpt-oss models", () => {
    expect(modelParams("llama-3.3-70b-versatile")).toEqual({ max_tokens: 900 });
    expect(modelParams("openai/gpt-oss-20b")).toHaveProperty("reasoning_effort");
  });
  it("puts those parameters on the wire, and a model override is honoured", async () => {
    const h = harness([sse(["a"]), sse(["b"])]);
    await collect(streamChat([{ role: "user", content: "hi" }], { config: cfg(), ...h.opts }));
    expect(h.calls[0]?.body).toMatchObject({ model: "openai/gpt-oss-120b", stream: true, reasoning_effort: "low", include_reasoning: false, max_completion_tokens: 2048 });
    expect(h.calls[0]?.body).not.toHaveProperty("max_tokens");
    const o = readQueraConfig({ GROQ_API_KEY: "k", GROQ_MODEL: "llama-3.3-70b-versatile" });
    await collect(streamChat([{ role: "user", content: "hi" }], { config: o, ...h.opts }));
    expect(h.calls[1]?.body).toMatchObject({ model: "llama-3.3-70b-versatile", max_tokens: 900 });
    expect(h.calls[1]?.body).not.toHaveProperty("reasoning_effort");
  });
});

describe("streamChat", () => {
  const msgs = [{ role: "user" as const, content: "hi" }];

  it("streams deltas and finishes", async () => {
    const h = harness([sse(["Hel", "lo ", "there"])]);
    const events = await collect(streamChat(msgs, { config: cfg(), ...h.opts }));
    expect(text(events)).toBe("Hello there");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(h.calls[0]?.model).toBe("openai/gpt-oss-120b");
  });

  it("silently waits out a rate limit and then answers — no error event ever", async () => {
    const h = harness([limited("12"), limited(undefined, "Please try again in 3.5s"), sse(["ok"])]);
    const events = await collect(streamChat(msgs, { config: cfg(), ...h.opts }));
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(text(events)).toBe("ok");
    expect(events.filter((e) => e.type === "ping").length).toBeGreaterThan(2);
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBe(12_400 + 3_900);
    expect(h.calls).toHaveLength(3);
  });

  it("pings at most every 5 seconds while waiting a long time (1 minute)", async () => {
    const h = harness([limited("60"), sse(["done"])]);
    const events = await collect(streamChat(msgs, { config: cfg(), ...h.opts }));
    expect(Math.max(...h.sleeps)).toBeLessThanOrEqual(5_000);
    expect(events.filter((e) => e.type === "ping")).toHaveLength(13);
    expect(text(events)).toBe("done");
  });

  it("retries 5xx responses and network errors", async () => {
    const h = harness([new Response("oops", { status: 503 }), new Error("socket hang up"), sse(["fine"])]);
    const events = await collect(streamChat(msgs, { config: cfg(), ...h.opts }));
    expect(text(events)).toBe("fine");
  });

  it("falls back to the lighter model when the wait would exceed the budget", async () => {
    const h = harness([limited("3600"), sse(["from fallback"])]);
    const events = await collect(streamChat(msgs, { config: cfg({ maxWaitMs: 60_000 }), ...h.opts }));
    expect(text(events)).toBe("from fallback");
    expect(h.calls.map((c) => c.model)).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  });

  it("gives up with a generic 'unavailable' code only when nothing can recover", async () => {
    const h = harness([limited("3600"), limited("3600")]);
    const events = await collect(streamChat(msgs, { config: cfg({ maxWaitMs: 60_000 }), ...h.opts }));
    expect(events.at(-1)).toEqual({ type: "error", code: "unavailable" });
  });

  it("reports a missing key and a rejected key without calling the network", async () => {
    const none = harness([]);
    expect(await collect(streamChat(msgs, { config: cfg({ apiKey: null }), ...none.opts }))).toEqual([{ type: "error", code: "not_configured" }]);
    const bad = harness([new Response("{}", { status: 401 })]);
    expect((await collect(streamChat(msgs, { config: cfg(), ...bad.opts }))).at(-1)).toEqual({ type: "error", code: "unauthorized" });
  });

  it("tries the fallback model on a 400 (e.g. retired model) before failing", async () => {
    const h = harness([new Response("{}", { status: 400 }), sse(["x"])]);
    expect(text(await collect(streamChat(msgs, { config: cfg(), ...h.opts })))).toBe("x");
    const h2 = harness([new Response("{}", { status: 400 }), new Response("{}", { status: 400 })]);
    expect((await collect(streamChat(msgs, { config: cfg(), ...h2.opts }))).at(-1)).toEqual({ type: "error", code: "bad_request" });
  });

  it("stops promptly when aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const h = harness([]);
    expect(await collect(streamChat(msgs, { config: cfg(), signal: ctl.signal, ...h.opts }))).toEqual([{ type: "error", code: "aborted" }]);
  });
});
