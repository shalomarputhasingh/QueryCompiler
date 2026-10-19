# QueryCompiler explainer animation (Remotion)

A 28-second, 1920×1080, 30 fps animation that follows one query through the compiler:
intro → lexer → parser → semantic analysis → relational algebra → optimizer → run it & ask Quera.
The query, tokens, tree, algebra and optimizer steps match what the app produces for
`SELECT name FROM students WHERE marks > 10 * 8 AND 1 = 1;`, and the result rows are the real sample-database rows.

```bash
cd animation
npm install
npm run dev                      # Remotion Studio: every scene is also a standalone composition
npm run render                   # → ../docs/demo/querycompiler-explainer.mp4
```

If Remotion cannot download its own headless Chrome (offline / restricted network), point it at one you already have:
`npx remotion render src/index.ts QueryCompilerExplainer ../docs/demo/querycompiler-explainer.mp4 --browser-executable=/path/to/chrome-headless-shell`
(a full `chrome` binary is not enough on recent versions; use `chrome-headless-shell`, e.g. Playwright's `headless_shell`).

Files: `src/QueryCompilerExplainer.tsx` (timeline + transitions), `src/scenes/*` (one file per scene), `src/theme.ts` (colours/query), `src/ui.tsx` (shared pieces).
Remotion is free for individuals and teams of up to 3 — see https://www.remotion.pro/license for company use.
