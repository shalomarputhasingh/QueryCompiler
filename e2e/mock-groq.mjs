// Minimal stand-in for Groq's OpenAI-compatible streaming endpoint, used by the e2e suite.
// A user message containing "[throttle]" is answered with HTTP 429 (retry-after: 2) the first time.
import http from "node:http";

const port = Number(process.env.MOCK_GROQ_PORT ?? 4010);
const throttled = new Set();
// MOCK_GROQ_STYLE=explain: write a grounded explanation from the compiler output found in the prompt
// (used for the demo video; NOT a real model). Also waits ~1.6 s before answering and throttles
// the first attempt of every new question once, to show the "thinking" state.
const explain = process.env.MOCK_GROQ_STYLE === "explain";

function section(system, name) {
  const m = new RegExp(`(?:^|\\n)${name}:\\n([\\s\\S]*?)(?:\\n\\n[A-Z][A-Z ()]+:|$)`).exec(system);
  return m?.[1]?.trim() ?? "";
}

function explainAnswer(system) {
  const query = section(system, "QUERY");
  const status = /STATUS: ([^\n]+)/.exec(system)?.[1] ?? "";
  const diagLines = section(system, "DIAGNOSTICS").split("\n").filter(Boolean);
  const out = [];
  if (status.startsWith("FAILED")) {
    const phase = /FAILED during (\w+)/.exec(status)?.[1] ?? "compilation";
    const d = /\[(\w+) (QC\d+) (\w+)\] line (\d+), col (\d+): (.*?)(?: \(hint: (.*)\))?$/.exec(diagLines[0] ?? "");
    out.push("## What went wrong\n\n");
    if (d) {
      out.push(`The compiler stopped in the **${phase}** phase, so nothing after it ran. At **line ${d[4]}, column ${d[5]}** it reported \`${d[2]}\`:\n\n> ${d[6]}\n\n`);
      const didYouMean = /Did you mean '([^']+)'/.exec(d[7] ?? "")?.[1];
      const bad = /'([^']+)'/.exec(d[6])?.[1];
      if (d[7]) out.push(`The compiler also left a hint: ${d[7]}\n\n`);
      if (didYouMean && bad && query.includes(bad)) {
        out.push("## A fixed version\n\n```sql\n" + query.replace(new RegExp(`\\b${bad}\\b`), didYouMean) + "\n```\n");
      } else {
        out.push("Fix the highlighted spot, then analyze again — every earlier phase's output (tokens, tree) is still available in the tabs.\n");
      }
    }
  } else {
    const orig = /RELATIONAL ALGEBRA \(original\): ([^\n]+)/.exec(system)?.[1] ?? /RELATIONAL ALGEBRA: ([^\n]+)/.exec(system)?.[1] ?? "";
    const opt = /RELATIONAL ALGEBRA \(optimized\): ([^\n]+)/.exec(system)?.[1] ?? "";
    out.push("## What this query does\n\n");
    out.push(`It compiled successfully ${status.replace("compiled successfully ", "")}. As relational algebra it reads, from the inside out:\n\n\`${orig}\`\n\n`);
    const steps = section(system, "OPTIMIZER STEPS").split("\n").filter(Boolean);
    if (steps.length > 0) {
      out.push("## Which optimizations applied\n\n" + steps.slice(0, 4).map((x) => `- ${x.replace(/^\d+\.\s*/, "")}`).join("\n") + "\n\n");
      out.push(`Each step is an equivalence-preserving rewrite, so the optimized plan \`${opt}\` returns exactly the same rows — it just does less work per step. The Execution tab is where real timings are measured.\n`);
    } else {
      out.push("No optimizer rule applied: the plan was already minimal, so there was nothing to rewrite.\n");
    }
  }
  return out.join("");
}

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
      if ((last.includes("[throttle]") || explain) && !throttled.has(last + system.length)) {
        throttled.add(last + system.length);
        res.writeHead(429, { "retry-after": "2", "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Rate limit reached for model. Please try again in 2s." } }));
        return;
      }
      const status = /STATUS: ([^\n]+)/.exec(system)?.[1] ?? "no status";
      const query = /QUERY:\n([^\n]+)/.exec(system)?.[1] ?? "";
      const diag = /\[error (QC\d+)[^\]]*\][^\n]*/.exec(system)?.[0];
      const text = explain ? explainAnswer(system) : [
        "## Here is what I see\n\n",
        `Your query starts with \`${query.slice(0, 40)}\`.\n\n`,
        `The compiler says: **${status}**.\n\n`,
        diag ? `The first diagnostic is \`${diag.slice(0, 60)}\`.\n\n` : "- It compiled, so every phase ran.\n- Ask me about any phase.\n\n",
        "Try this version:\n\n```sql\nSELECT name FROM students WHERE marks > 80;\n```\n",
      ].join("");
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunks = text.match(/.{1,6}/gs) ?? [];
      let i = 0;
      const t = setInterval(() => {
        if (i < chunks.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`);
        else {
          clearInterval(t);
          res.end("data: [DONE]\n\n");
        }
      }, explain ? 18 : 40);
      res.on("close", () => clearInterval(t));
    });
  })
  .listen(port, () => console.log(`mock groq on ${port}`));
