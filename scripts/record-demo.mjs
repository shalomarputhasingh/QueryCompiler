/**
 * Records a narrated-by-cursor tour of the whole app as a video.
 *   1. npm run build && SQLITE_PATH=./data/demo.db npx next start -p 3100
 *   2. npm run demo            (optionally CHROMIUM_PATH=/path/to/chrome)
 * Output: docs/demo/querycompiler-demo.mp4 (needs ffmpeg on PATH)
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT_DIR = path.resolve("docs/demo");
const TMP = path.resolve("data/.video-tmp");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  window.localStorage.clear();
  const install = () => {
    if (document.getElementById("demo-cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      #demo-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;
        transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));transition:transform .02s linear}
      #demo-ripple{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;
        border:3px solid #7c84ff;animation:rip .55s ease-out forwards}
      @keyframes rip{from{transform:scale(.4);opacity:1}to{transform:scale(3.4);opacity:0}}`;
    document.head.appendChild(style);
    const c = document.createElement("div");
    c.id = "demo-cursor";
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    window.addEventListener("mousemove", (e) => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    window.addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.id = "demo-ripple";
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.body) install();
  else document.addEventListener("DOMContentLoaded", install);
});

const page = await context.newPage();

// Screen capture via the DevTools screencast (frames carry timestamps, so playback timing is exact).
const cdp = await context.newCDPSession(page);
const stamps = [];
cdp.on("Page.screencastFrame", (ev) => {
  fs.writeFileSync(path.join(TMP, `f${String(stamps.length).padStart(6, "0")}.jpg`), Buffer.from(ev.data, "base64"));
  stamps.push(ev.metadata.timestamp);
  cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
const sleep = (ms) => page.waitForTimeout(ms);
let cx = 720, cy = 450;

async function moveTo(x, y) {
  await page.mouse.move(x, y, { steps: 28 });
  cx = x; cy = y;
}
async function click(locator, { after = 700 } = {}) {
  const target = locator.first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("no box for locator");
  await moveTo(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(250);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(after);
}
async function hover(locator, ms = 700) {
  const box = await locator.first().boundingBox();
  if (box) await moveTo(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(ms);
}
async function scroll(dy, steps = 8, ms = 120) {
  await page.mouse.move(cx, cy);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await sleep(ms); }
  await sleep(400);
}
const tab = (name) => page.getByRole("tab", { name });
const nav = (name) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name });
async function waitEditor() { await page.locator(".monaco-editor").first().waitFor({ timeout: 30000 }); await sleep(600); }
async function typeQuery(sql) {
  await click(page.locator(".monaco-editor").first());
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  const lines = sql.split("\n");
  for (let i = 0; i < lines.length; i++) {
    await page.keyboard.type(lines[i], { delay: 38 });
    await page.keyboard.press("Escape"); // close the suggestion widget so Enter does not accept a suggestion
    if (i < lines.length - 1) await page.keyboard.press("Enter");
  }
  await sleep(500);
}
async function pickSample(id) {
  await click(page.getByTestId("sample-select"), { after: 300 });
  await page.getByTestId("sample-select").selectOption(id);
  await sleep(1200);
}

// 1. Home ---------------------------------------------------------------
await page.goto(BASE + "/");
await sleep(1500);
await moveTo(700, 300);
await hover(page.getByRole("heading", { name: "The pipeline" }), 1200);
await click(page.getByRole("link", { name: /Open the SQL Playground/ }), { after: 1500 });
await waitEditor();

// 2. Playground: type + analyze --------------------------------------------
await typeQuery("SELECT name, marks\nFROM students\nWHERE marks > 10 * 8 AND 1 = 1\nORDER BY marks DESC\nLIMIT 5;");
await click(page.getByTestId("analyze"), { after: 1800 });
await hover(page.getByTestId("analysis-outcome"), 1000);
await scroll(380, 6);                       // phase panels of the overview
await hover(page.getByRole("heading", { name: "5. Query Optimization" }), 1500);
await scroll(-380, 6);

// 3. Tokens
await click(tab("Tokens"));
await click(page.getByRole("button", { name: /^KEYWORD/ }), { after: 1100 });
await click(page.getByRole("button", { name: /^KEYWORD/ }), { after: 600 });
await click(page.getByRole("button", { name: /Locate token WHERE/ }), { after: 1500 });

// 4. Syntax tree
await click(tab("Syntax Tree"), { after: 1200 });
await click(page.locator(".react-flow__node").filter({ hasText: "marks" }).first(), { after: 1400 });
await click(page.getByRole("button", { name: "Text" }), { after: 1800 });
await click(page.getByRole("button", { name: "Graph" }), { after: 600 });

// 5. Semantic + symbols
await click(tab("Semantic Analysis"), { after: 1600 });
await click(tab("Symbol Table"));
await click(page.getByLabel("Search symbols"), { after: 300 });
await page.keyboard.type("marks", { delay: 120 });
await sleep(1200);
await click(page.getByRole("button", { name: /^reference/ }), { after: 1000 });

// 6. IR + optimization
await click(tab("Intermediate Representation"), { after: 1500 });
await scroll(360, 6);
await click(page.locator(".react-flow__node").filter({ hasText: "scan" }).first(), { after: 1500 });
await scroll(-360, 6);
await click(tab("Query Optimization"), { after: 1500 });
await scroll(520, 8);
await click(page.getByRole("button", { name: /Show plan after this step/ }), { after: 1600 });
await scroll(500, 8);
await scroll(-1000, 8);

// 7. Execute
await click(page.getByTestId("execute"), { after: 1800 });
await hover(page.getByTestId("execution-result"), 1200);
await page.getByLabel("Plan to execute").selectOption("original");
await click(page.getByTestId("execute-in-tab"), { after: 1500 });

// 8. Samples: a join with pushdown, then errors
await pickSample("three-way-join");
await click(tab("Query Optimization"), { after: 1200 });
await scroll(450, 8);
await click(page.getByRole("button", { name: /Show plan after this step/ }).nth(1), { after: 1500 });
await scroll(-450, 6);
await click(page.getByTestId("execute"), { after: 1800 });
await pickSample("missing-operand");
await click(tab("Overview"), { after: 2000 });
await pickSample("unterminated-string");
await sleep(1500);
await pickSample("bad-table");
await sleep(1800);
await pickSample("ambiguous-column");
await sleep(1500);
await click(page.getByTestId("execute"), { after: 1800 });

// 9. Examples
await click(nav("Example Queries"), { after: 1200 });
await scroll(600, 8);
await scroll(900, 10);
await scroll(-1500, 10);
await click(page.getByTestId("example-group-by").getByRole("button", { name: /Load & analyze/ }), { after: 2200 });
await click(page.getByTestId("run-all"), { after: 2200 });

// 10. History
await click(nav("Query History"), { after: 1400 });
await click(page.getByRole("button", { name: "Restore & analyze" }), { after: 1800 });

// 11. Pipeline / Learning mode
await click(nav("Compiler Pipeline"), { after: 1500 });
await scroll(500, 8);
await scroll(700, 10);
await scroll(-1200, 8);

// 12. Schema explorer
await click(nav("Schema Explorer"), { after: 1800 });
await scroll(600, 8);
await click(page.getByRole("link", { name: /enrollments/ }).first(), { after: 1500 });
await scroll(-1500, 8);

// 13. Documentation
await click(nav("Documentation"), { after: 1400 });
await click(page.getByRole("link", { name: "Optimization rules" }), { after: 1600 });
await scroll(500, 8);
await click(page.getByRole("link", { name: "Execution safety" }), { after: 1600 });

// 14. Playground: theme, reset, clear
await click(nav("SQL Playground"), { after: 1500 });
await click(page.getByRole("button", { name: "Switch to light theme" }), { after: 1800 });
await click(page.getByRole("button", { name: "Switch to dark theme" }), { after: 1200 });
await click(page.getByRole("button", { name: "Clear", exact: true }).first(), { after: 1200 });
await click(page.getByRole("button", { name: "Reset", exact: true }).first(), { after: 1500 });
await click(page.getByTestId("run-all"), { after: 2500 });

await sleep(800);
await cdp.send("Page.stopScreencast");
await context.close();
await browser.close();

// Assemble frames into a video with their real timing.
const list = [];
stamps.forEach((t, i) => {
  const next = stamps[i + 1] ?? t + 1;
  list.push(`file 'f${String(i).padStart(6, "0")}.jpg'`, `duration ${Math.max(0.001, next - t).toFixed(4)}`);
});
list.push(`file 'f${String(stamps.length - 1).padStart(6, "0")}.jpg'`);
fs.writeFileSync(path.join(TMP, "frames.txt"), list.join("\n"));
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const dest = path.join(OUT_DIR, "querycompiler-demo.mp4");
const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(TMP, "frames.txt"), "-vf", "fps=25,scale=1440:900,format=yuv420p", "-c:v", "libx264", "-crf", "26", "-preset", "medium", "-movflags", "+faststart", dest], { stdio: "inherit" });
if (r.status !== 0) throw new Error("ffmpeg failed (install ffmpeg or set FFMPEG_PATH)");
fs.rmSync(TMP, { recursive: true, force: true });
console.log("Saved", dest, (fs.statSync(dest).size / 1e6).toFixed(1) + " MB,", stamps.length, "frames");
