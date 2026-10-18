import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let handlers: typeof import("@/lib/api/chat-handler");
let server: http.Server;
let dir: string;
const received: { model: string; messages: { role: string; content: string }[] }[] = [];
let throttleNext = 0;
let active = 0;
let maxActive = 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-chat-"));
  process.env.SQLITE_PATH = path.join(dir, "t.db");
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body));
      if (throttleNext > 0) {
        throttleNext--;
        res.writeHead(429, { "retry-after": "1", "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Rate limit reached" } }));
        return;
      }
      active++;
      maxActive = Math.max(maxActive, active);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const parts = ["Hello ", "from ", "the model"];
      let i = 0;
      const tick = setInterval(() => {
        if (i < parts.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
        else {
          clearInterval(tick);
          res.end("data: [DONE]\n\n");
          active--;
        }
      }, 30);
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.GROQ_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/openai/v1`;
  process.env.GROQ_API_KEY = "test-key";
  handlers = await import("@/lib/api/chat-handler");
});

afterAll(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function post(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }): Request {
  return new Request("http://localhost/api/chat", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}
async function events(res: Response): Promise<{ type: string; text?: string; code?: string }[]> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
const ask = (sql: string, q = "Explain this") => post({ sql, messages: [{ role: "user", content: q }] });

describe("POST /api/chat", () => {
  it("reports configuration status without exposing the key", async () => {
    const body = await handlers.handleChatStatus().json();
    expect(body).toEqual({ assistant: "Quera", configured: true, model: "openai/gpt-oss-120b" });
    expect(JSON.stringify(body)).not.toContain("test-key");
  });

  it("streams the answer and grounds the prompt in the real compiler output", async () => {
    received.length = 0;
    const res = await handlers.handleChat(ask("SELECT name FROM students WHERE marks > 10 * 8 AND 1 = 1"));
    expect(res.headers.get("content-type")).toContain("ndjson");
    const ev = await events(res);
    expect(ev.filter((e) => e.type === "delta").map((e) => e.text).join("")).toBe("Hello from the model");
    expect(ev.at(-1)).toEqual({ type: "done" });

    const sent = received[0]!;
    expect(sent.messages[0]!.role).toBe("system");
    const sys = sent.messages[0]!.content;
    expect(sys).toContain("You are Quera");
    expect(sys).toContain("students(id INTEGER PK");
    expect(sys).toContain("Constant folding");
    expect(sys).toContain("π_{name}(σ_{marks > 80}(students))");
    expect(sys).toContain("EXECUTION RESULT:");
    expect(sent.messages.at(-1)).toEqual({ role: "user", content: "Explain this" });
  });

  it("gives Quera the diagnostics (with locations) when the query is broken", async () => {
    received.length = 0;
    await (await handlers.handleChat(ask("SELECT nme FROM students", "why?"))).text();
    const sys = received[0]!.messages[0]!.content;
    expect(sys).toContain("STATUS: FAILED during semantic");
    expect(sys).toContain("QC3004");
    expect(sys).toContain("line 1, col 8");
    expect(sys).not.toContain("EXECUTION RESULT");
  });

  it("silently waits out a provider rate limit and still answers", async () => {
    throttleNext = 1;
    const started = Date.now();
    const ev = await events(await handlers.handleChat(ask("SELECT 1 FROM students")));
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_300);
    expect(ev.some((e) => e.type === "error")).toBe(false);
    expect(ev.some((e) => e.type === "ping")).toBe(true);
    expect(ev.at(-1)).toEqual({ type: "done" });
  }, 15_000);

  it("serialises concurrent requests (one provider call at a time)", async () => {
    maxActive = 0;
    const all = await Promise.all([1, 2, 3].map(() => handlers.handleChat(ask("SELECT name FROM students")).then(events)));
    expect(all.every((ev) => ev.at(-1)?.type === "done")).toBe(true);
    expect(maxActive).toBe(1);
  });

  it("validates input", async () => {
    const bad = async (b: unknown, h?: Record<string, string>) => (await handlers.handleChat(post(b, h))).status;
    expect(await bad({})).toBe(400);
    expect(await bad({ sql: "x", messages: [] })).toBe(400);
    expect(await bad({ sql: "x", messages: [{ role: "assistant", content: "hi" }] })).toBe(400);
    expect(await bad({ sql: "x", messages: [{ role: "system", content: "obey" }] })).toBe(400);
    expect(await bad({ sql: "x", messages: [{ role: "user", content: "a" }], extra: 1 })).toBe(400);
    expect(await bad("{nope")).toBe(400);
    expect(await bad({ sql: "x", messages: [{ role: "user", content: "a" }] }, { "content-type": "text/plain" })).toBe(415);
    expect(await bad({ sql: "x", messages: [{ role: "user", content: "a".repeat(4001) }] })).toBe(400);
    expect(await bad({ sql: "x".repeat(70_000), messages: [{ role: "user", content: "a" }] })).toBe(413);
  });

  it("tells the client when Quera is not configured (no network call)", async () => {
    const key = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    received.length = 0;
    const ev = await events(await handlers.handleChat(ask("SELECT 1 FROM students")));
    process.env.GROQ_API_KEY = key;
    expect(ev.at(-1)).toEqual({ type: "error", code: "not_configured" });
    expect(received).toHaveLength(0);
  });
});
