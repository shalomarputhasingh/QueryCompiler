import { z } from "zod";
import { type ExecutionSummary, buildQueraContext } from "@/lib/chat/context";
import { readQueraConfig } from "@/lib/chat/config";
import { type ChatEvent, type ChatMessage, streamChat } from "@/lib/chat/groq";
import { Lock } from "@/lib/chat/lock";
import { buildSystemPrompt } from "@/lib/chat/prompt";
import { compile, MAX_SOURCE_LENGTH } from "@/lib/compiler/pipeline";
import { getDatabase } from "@/lib/database/connection";
import { executeReadOnly } from "@/lib/database/safe-executor";

const MAX_BODY_BYTES = 64_000;
const PING_EVERY_MS = 5_000;

export const chatRequestSchema = z
  .object({
    sql: z.string().max(MAX_SOURCE_LENGTH),
    messages: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4_000) }).strict())
      .min(1)
      .max(20),
  })
  .strict()
  .refine((b) => b.messages.at(-1)?.role === "user", { message: "The last message must come from the user" });

const lock = new Lock();
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: HEADERS });
}

export function handleChatStatus(): Response {
  const cfg = readQueraConfig();
  return Response.json({ assistant: "Quera", configured: cfg.apiKey !== null, model: cfg.model }, { headers: HEADERS });
}

function summarizeExecution(sql: string): ExecutionSummary | null {
  try {
    const { db, catalog } = getDatabase();
    const compiled = compile(sql, catalog);
    if (!compiled.success || !compiled.codegen) return null;
    const out = executeReadOnly(db, compiled.codegen.optimized);
    return { columns: out.columns, rows: out.rows.slice(0, 8), rowCount: out.rowCount, truncated: out.truncated };
  } catch {
    return null;
  }
}

export async function handleChat(req: Request): Promise<Response> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return jsonError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return jsonError(400, "invalid_body", "The request body could not be read.");
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return jsonError(413, "payload_too_large", "The request is too large.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return jsonError(400, "invalid_json", "The request body is not valid JSON.");
  }
  const parsed = chatRequestSchema.safeParse(json);
  if (!parsed.success) return jsonError(400, "invalid_request", "The request did not match the expected shape.");

  const config = readQueraConfig();
  const { catalog } = getDatabase();
  const compiled = compile(parsed.data.sql, catalog);
  const execution = compiled.success ? summarizeExecution(parsed.data.sql) : null;
  const system = buildSystemPrompt(catalog, buildQueraContext(compiled, execution));
  const messages: ChatMessage[] = [{ role: "system", content: system }, ...parsed.data.messages];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: ChatEvent): void => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      };
      const close = (): void => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the client disconnecting
          }
        }
      };
      req.signal.addEventListener("abort", close, { once: true });

      // Keep the connection warm while queued behind another request.
      send({ type: "ping" });
      const keepAlive = setInterval(() => send({ type: "ping" }), PING_EVERY_MS);
      let release: (() => void) | null = null;
      try {
        release = await lock.acquire();
        for await (const event of streamChat(messages, { config, signal: req.signal })) {
          if (closed) break;
          send(event);
        }
      } catch {
        send({ type: "error", code: "unavailable" });
      } finally {
        clearInterval(keepAlive);
        release?.();
        close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...HEADERS, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" },
  });
}
