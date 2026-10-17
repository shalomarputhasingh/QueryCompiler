# QueryCompiler

**SQL Query Translator, Compiler Visualizer & Optimizer** — an educational web workbench for a Compiler Design course.

Type a SQL query and watch it travel through a real compiler pipeline: tokens → syntax tree → semantic analysis with a symbol table → relational algebra → rule-based optimization → generated SQL, then run it read-only against a sample SQLite database. Every view is rendered from genuine compiler output; nothing is hardcoded.

## Contents
[Problem statement](#problem-statement) · [Objectives](#objectives) · [Tech stack](#technology-stack) · [Architecture](#architecture) · [Install & run](#installation) · [Grammar](#supported-sql-grammar) · [Pipeline](#compiler-pipeline) · [Algebra notation](#relational-algebra-notation) · [Optimization rules](#optimization-rules) · [Database](#database-schema) · [API](#api) · [Testing](#testing) · [Limitations](#limitations) · [Future work](#future-enhancements)

## Problem statement
Compiler phases are abstract. Students read about lexers, parsers and optimizers but rarely see one working on a language they already know. SQL is ideal: it has a compact grammar, a natural typed semantic model, a classical intermediate representation (relational algebra) and well-understood optimizations.

## Objectives
- Implement a genuine, testable compiler pipeline for a documented SQL subset.
- Visualise every phase and explain every error with line and column.
- Translate SQL to relational algebra and apply provably equivalent, explainable optimizations.
- Execute supported queries safely (read-only, parameterised) on sample data.
- Provide tests, documentation and report material.

## Technology stack
| Area | Choice |
|---|---|
| App | Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict), Node.js runtime |
| UI | Tailwind CSS 4, shadcn/ui-style components (Radix primitives + CVA, written in `components/ui`), Lucide icons |
| Editor | Monaco Editor (bundled locally — no CDN) |
| Graphs | React Flow (`@xyflow/react`) with a custom tidy-tree layout |
| Compiler | Custom lexer, recursive-descent + Pratt parser, typed AST, semantic analyzer, relational-algebra IR, rule-based optimizer (all in `lib/compiler`) |
| Database | SQLite via `better-sqlite3` |
| Validation | Zod |
| Tests | Vitest (unit/integration), Playwright (end-to-end) |

Versions are pinned exactly in `package.json`. TypeScript is pinned to 5.9.x because the Next.js tooling targets it.

## Architecture
```
app/                    Next.js routes: pages + app/api/{analyze,execute,schema}/route.ts (Node runtime)
components/             layout, editor (Monaco), compiler (result tabs), visualizations (React Flow), ui
lib/compiler/           framework-free compiler: lexer, parser, ast, semantic-analyzer, symbol-table,
                        rexpr, relational-algebra, optimizer, code-generator, explain, pipeline
lib/database/           connection (read-only), schema introspection, deterministic seed, safe-executor
lib/api/                zod contracts + request handlers used by the route files
lib/client/             typed fetch wrappers and bounded localStorage helpers
lib/utils/              example queries, grammar text
tests/  e2e/  docs/  scripts/
```
Compiler logic never imports React; database access is server-only; the browser receives JSON. See [docs/architecture.md](docs/architecture.md).

## Installation
Requirements: Node.js ≥ 22, npm ≥ 10.
```bash
npm install
npm run dev            # http://localhost:3000
```
The SQLite file (`data/querycompiler.db`, override with `SQLITE_PATH`) is created and seeded automatically on first use. See `.env.example`.

### Commands
| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | development server, production build, production server |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest unit + integration suite |
| `npm run test:e2e` | Playwright end-to-end suite (builds and starts the app on port 3100) |
| `npm run check` | typecheck + unit tests |
| `npm run db:seed` / `db:reset` | create / rebuild the sample database (idempotent) |

If Playwright's expected browser is not installed, point it at an existing Chromium: `CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Supported SQL grammar
Keywords and identifiers are case-insensitive. Comments `-- …` and `/* … */` are allowed. One statement per request.
```ebnf
statement     = select_stmt [ ";" ] EOF ;

select_stmt   = "SELECT" [ "DISTINCT" ] select_list
                "FROM" table_ref { join }
                [ "WHERE" expr ]
                [ "GROUP" "BY" expr { "," expr } ]
                [ "HAVING" expr ]
                [ "ORDER" "BY" order_item { "," order_item } ]
                [ "LIMIT" integer [ "OFFSET" integer ] ] ;

select_list   = "*" | select_item { "," select_item } ;
select_item   = identifier "." "*"
              | expr [ [ "AS" ] identifier ] ;
table_ref     = identifier [ [ "AS" ] identifier ] ;
join          = [ "INNER" ] "JOIN" table_ref "ON" expr ;
order_item    = expr [ "ASC" | "DESC" ] ;

expr          = or_expr ;
or_expr       = and_expr { "OR" and_expr } ;
and_expr      = not_expr { "AND" not_expr } ;
not_expr      = "NOT" not_expr | predicate ;
predicate     = additive [ comp_op additive
                         | "IS" [ "NOT" ] "NULL"
                         | [ "NOT" ] "LIKE" additive
                         | [ "NOT" ] "BETWEEN" additive "AND" additive
                         | [ "NOT" ] "IN" "(" expr { "," expr } ")" ] ;
comp_op       = "=" | "<>" | "!=" | "<" | "<=" | ">" | ">=" ;
additive      = term { ( "+" | "-" ) term } ;
term          = unary { ( "*" | "/" | "%" ) unary } ;
unary         = ( "-" | "+" ) unary | primary ;
primary       = number | string | "NULL" | "TRUE" | "FALSE"
              | [ identifier "." ] identifier
              | function_call
              | "(" expr ")" ;
function_call = ( "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" )
                "(" ( "*" | [ "DISTINCT" ] expr ) ")" ;
```
Precedence (loosest → tightest): `OR`, `AND`, `NOT`, comparison/`IS`/`LIKE`/`BETWEEN`/`IN`, `+ -`, `* / %`, unary `- +`. Integer division truncates (as in SQLite) and the analyzer warns about it.

**Not supported** (reported with a diagnostic, never silently misread):
- LEFT / RIGHT / FULL / CROSS / NATURAL joins, JOIN ... USING and comma-separated tables
- Subqueries, WITH (CTEs), EXISTS, ANY / ALL
- UNION, INTERSECT, EXCEPT
- CASE expressions, CAST, window functions, scalar functions other than the five aggregates
- Positional references (ORDER BY 1) and expressions in LIMIT / OFFSET
- Parameters (?, :name) in the SQL text
- INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, PRAGMA and every other non-SELECT statement
- More than one statement per request
- Integer literals beyond ±9,007,199,254,740,991 (exact JavaScript integers)

## Compiler pipeline
1. **Lexical analysis** (`lexer.ts`) — hand-written scanner producing `KEYWORD`, `IDENTIFIER`, `QUOTED_IDENTIFIER`, `NUMBER`, `STRING`, `OPERATOR`, `PUNCTUATION` tokens with start/end line, column and offset. Reports unterminated strings/comments, invalid characters and malformed numbers; whitespace and comments are skipped. Lexical errors stop the pipeline.
2. **Syntax analysis** (`parser.ts`) — recursive descent for clauses, Pratt parsing for expressions, producing a typed AST whose nodes carry ids and source ranges. Errors are recovered at clause boundaries so several can be reported; no AST is produced if any error exists.
3. **Semantic analysis** (`semantic-analyzer.ts`, `symbol-table.ts`) — resolves tables, aliases and columns against the live schema, detects ambiguity, type-checks, enforces boolean conditions and aggregate / GROUP BY rules, and builds the symbol table. Semantic errors stop the pipeline before translation or execution.
4. **Relational algebra** (`relational-algebra.ts`) — translates the AST (never the SQL text) to scan, selection, projection, join, aggregation, sort, distinct and limit operators.
5. **Optimization** (`optimizer.ts`) — fixed-point rule engine; every step records the rule, its precondition, an explanation and the plan afterwards. Rules that were considered but not applicable are listed with the reason.
6. **Code generation** (`code-generator.ts`) — emits parameterised SQL from either plan, plus a numbered instruction listing (an educational format, **not** machine code).

Details: [docs/compiler-phases.md](docs/compiler-phases.md).

## Relational algebra notation
| Symbol | Operator | Written as |
|---|---|---|
| π | Projection | `π_{a, b}(R)` |
| σ | Selection | `σ_{p}(R)` |
| ⋈ | Inner join | `(R ⋈_{c} S)` |
| γ | Aggregation | `γ_{g; f}(R)` (grouping columns `g`, aggregates `f`) |
| τ | Sort | `τ_{k DESC}(R)` |
| δ | Duplicate elimination | `δ(R)` |
| λ | Limit | `λ_{n}(R)` or `λ_{n, offset m}(R)` |

Example: `SELECT name FROM students WHERE marks > 80` → `π_{name}(σ_{marks > 80}(students))`. Columns are qualified (`s.name`) only when the query has more than one table.

## Optimization rules
| Rule | Applies when | Why it is safe |
|---|---|---|
| Constant folding | An operation has only literal operands (or a NULL literal for arithmetic/comparison) | Uses SQLite semantics: integer division truncates, ÷0 is NULL, NULL propagates; values outside the exact integer range are not folded |
| Boolean simplification | `TRUE/FALSE` with AND/OR, `NOT NOT`, repeated operands | Identities hold under three-valued logic |
| Remove always-true selection | Predicate is `TRUE` | σ_TRUE(R) = R. Always-FALSE/NULL selections are kept and reported |
| Merge selections | σ directly over σ | σ_p(σ_q(R)) = σ_{q∧p}(R) |
| Selection pushdown | σ above an inner join has a conjunct using one input only | σ_p(L ⋈ R) = σ_p(L) ⋈ R when p uses only L |
| Join-condition pushdown | ON has a single-input conjunct and another conjunct remains | Rows failing it can never join |
| HAVING pushdown | HAVING conjunct has no aggregate and uses only grouping columns, with non-empty GROUP BY | Filters whole groups; never for global aggregates |
| Eliminate redundant DISTINCT | δ of δ; or projection holds every table's non-null primary key; or all GROUP BY expressions | Rows are provably unique |
| Remove identity projection | π lists all input columns unchanged | π over everything is the input |
| Projection pushdown (pruning) | A join input has columns nothing above uses | Unused columns cannot affect the result; join keys are always kept |

No rule claims a speed-up; the app only reports **measured** SQLite times. Details and proofs: [docs/optimization-rules.md](docs/optimization-rules.md).

## Database schema
`departments(id PK, name, building, budget)` · `students(id PK, name, email NULL, age, gpa NULL, marks, department_id → departments, enrollment_year, city)` · `courses(id PK, title, credits, department_id → departments, instructor)` · `enrollments(id PK, student_id → students, course_id → courses, semester, grade NULL, score NULL)`.
5 departments, 30 students, 10 courses and 72 enrollments, generated deterministically (fixed-seed generator) so every run is identical. Some `email`, `gpa`, `grade` and `score` values are NULL to demonstrate three-valued logic.

## API
All endpoints run on the Node.js runtime, validate input with Zod (unknown fields are rejected), require `application/json`, limit bodies to 32 kB / queries to 10,000 characters and send `Cache-Control: no-store`.

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/analyze` | `{ "sql": string }` | Full compile result: `tokens`, `ast`, `astText`, `diagnostics`, `semantic`, `symbolTable`, `algebra`, `optimization` (`steps`, `skipped`, `rules`), `codegen`, `phases`, `stats`, `database`. Invalid SQL is a **200** with `success: false` and diagnostics |
| `POST /api/execute` | `{ "sql": string, "plan"?: "optimized" \| "original" }` | `200 {status, plan, columns, rows, rowCount, truncated, durationMs, sql, parameterizedSql, paramCount}`; `422` with `diagnostics` if the query fails compilation or is a blocked statement; `400/413/415` for bad requests |
| `GET /api/schema` | – | `{ database, tables: [{ name, rowCount, primaryKey, columns, foreignKeys }] }` |

**Execution safety.** The server recompiles every query (client flags are ignored); only a single SELECT that passed all phases runs; literals are bound as parameters (integers as BigInt to keep SQLite integer semantics); the connection is opened read-only with `query_only`; results are capped at 500 rows; errors are sanitised; there is no `eval`, raw connection or file access.

## Testing
```bash
npm test            # 228 unit/integration tests
npm run test:e2e    # 7 Playwright scenarios
```
Coverage: lexer (tokens, positions, errors), parser (grammar, precedence, error recovery, unsupported constructs), semantic analysis (tables, columns, aliases, ambiguity, types, aggregates, symbol table), every optimizer rule with positive and negative cases, **equivalence of original, translated and optimized plans against SQLite on 42 queries (including NULL edge cases)**, pipeline phase stopping, API validation, read-only enforcement and blocked statements, all example queries, and the browser flow (load sample → analyze → tokens/AST → algebra/optimization → execute → invalid SQL diagnostics). Test list: [docs/test-cases.md](docs/test-cases.md).

## Limitations
- Educational subset of SQL, not a SQL-standard or full SQLite implementation.
- Optimizer is rule-based and heuristic: it does not use statistics or a cost model, and rewritten plans are not claimed to be faster.
- Execution is checked for equivalence on the sample database in tests; it is not a formal proof of equivalence for arbitrary data.
- better-sqlite3 is synchronous, so a running statement cannot be interrupted. Protection comes from the tiny dataset, the compiler rejecting unsupported constructs, a 500-row cap and a duration check while iterating rows.
- SQLite files need a writable, persistent file system. On read-only or serverless hosts the app falls back to a seeded in-memory database (changes never persist, which is fine because the database is read-only).
- String comparison constant folding is limited to ASCII ordering; LIKE is never folded.

## Future enhancements
- LEFT/RIGHT joins (requires outer-join-aware pushdown rules), subqueries and set operations.
- Statistics-based cost model with measured-vs-estimated comparison.
- Interruptible execution via a worker thread for hard timeouts.
- Step-through animation of the parser and shareable query links.

## Project report material
[docs/project-report.md](docs/project-report.md) contains an abstract, introduction, problem definition, objectives, module descriptions, algorithms, test-case table and a screenshots checklist. Only results that were actually produced are stated there.
