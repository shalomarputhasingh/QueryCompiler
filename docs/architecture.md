# Architecture

```
Browser (React)                              Server (Next.js Route Handlers, Node runtime)
┌──────────────────────┐   POST /api/analyze  ┌───────────────────────────────────────────┐
│ Monaco editor        │ ───────────────────▶ │ lib/api/handlers  (zod validation, limits) │
│ Result tabs / graphs │ ◀─────────────────── │   └─ lib/compiler/pipeline.compile()       │
│ Workspace context    │   JSON CompileResult │        lexer → parser → semantic → algebra │
│ localStorage history │                      │        → optimizer → code generator        │
│                      │   POST /api/execute  │ lib/database  (read-only better-sqlite3)   │
│                      │ ───────────────────▶ │   safe-executor: single SELECT, params,    │
│                      │ ◀─────────────────── │   row cap, sanitised errors                │
└──────────────────────┘   GET /api/schema    └───────────────────────────────────────────┘
```

## Principles
- **Compiler is a library.** `lib/compiler` has no React, Next or database imports; it consumes a plain-data `Catalog`. This makes it unit-testable and lets the semantic analyzer use the real schema (read from SQLite at startup) without coupling.
- **Server-side everything that matters.** The browser only renders results. `/api/execute` recompiles the SQL and never trusts client-supplied validation state.
- **One data flow.** `CompileResult` (see `pipeline.ts`) is the only contract between compiler and UI; it is JSON-serialisable (bound integer parameters are strings, not BigInt).
- **Typed IR.** The AST (`ast.ts`) keeps ids and ranges for tooling; the relational algebra (`relational-algebra.ts`) uses resolved scalar expressions (`rexpr.ts`) bound to table aliases, so the optimizer reasons about columns without strings or positions.

## Modules
| Module | Responsibility |
|---|---|
| `tokens.ts`, `lexer.ts` | token model, scanner |
| `ast.ts`, `parser.ts` | typed AST, recursive-descent/Pratt parser, error recovery |
| `catalog.ts`, `symbol-table.ts`, `semantic-analyzer.ts` | schema model, symbols, name/type/aggregate checks |
| `rexpr.ts` | resolved expressions: conversion, printing, equality, conjunct helpers |
| `relational-algebra.ts` | IR nodes, translation, printing, node descriptions |
| `optimizer.ts` | rules + fixed-point engine producing steps and skip reasons |
| `code-generator.ts` | RA → parameterised SQL, RA → instruction listing |
| `explain.ts` | deterministic Learning Mode text from compiler output |
| `pipeline.ts` | orchestration, phase statuses, stop-at-first-failed-phase |
| `lib/database/*` | read-only connection, schema introspection, seed, safe executor |
| `components/*` | UI; `workspace-provider` holds the editor text, analysis, execution and history |

## Database lifecycle
First use creates the file (seeded into a temporary file then renamed, so concurrent workers never see a half-built DB), then reopens it read-only with `query_only`. If the location is not writable (e.g. serverless), a seeded in-memory database is used instead; because the app never writes, nothing is lost.

## Deployment notes
SQLite via `better-sqlite3` needs a Node.js server with a native module build and (for the file mode) a writable directory. It is not suited to the Edge runtime. Next.js is configured with `serverExternalPackages: ["better-sqlite3"]`.
