// Minimal stand-in for Groq's OpenAI-compatible streaming endpoint, used by the e2e suite.
// A user message containing "[throttle]" is answered with HTTP 429 (retry-after: 2) the first time.
import http from "node:http";

const port = Number(process.env.MOCK_GROQ_PORT ?? 4010);
const throttled = new Set();

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      const payload = JSON.parse(body);
      const system = payload.messages.find((m) => m.role === "system")?.content ?? "";
      const last = payload.messages.at(-1)?.content ?? "";
      if (last.includes("[throttle]") && !throttled.has(last)) {
        throttled.add(last);
        res.writeHead(429, { "retry-after": "2", "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Rate limit reached for model. Please try again in 2s." } }));
        return;
      }
      const status = /STATUS: ([^\n]+)/.exec(system)?.[1] ?? "no status";
      const query = /QUERY:\n([^\n]+)/.exec(system)?.[1] ?? "";
      const diag = /\[error (QC\d+)[^\]]*\][^\n]*/.exec(system)?.[0];
      const text = [
        "## Here is what I see\n\n",
        `Your query starts with \`${query.slice(0, 40)}\`.\n\n`,
        `The compiler says: **${status}**.\n\n`,
        diag ? `The first diagnostic is \`${diag.slice(0, 60)}\`.\n\n` : "- It compiled, so every phase ran.\n- Ask me about any phase.\n\n",
        "Try this version:\n\n```sql\nSELECT name FROM students WHERE marks > 80;\n```\n",
      ].join("");
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunks = text.match(/.{1,14}/gs) ?? [];
      let i = 0;
      const t = setInterval(() => {
        if (i < chunks.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`);
        else {
          clearInterval(t);
          res.end("data: [DONE]\n\n");
        }
      }, 40);
      res.on("close", () => clearInterval(t));
    });
  })
  .listen(port, () => console.log(`mock groq on ${port}`));
