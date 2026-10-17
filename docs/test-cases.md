# Test cases

Run: `npm test` (228 tests, Vitest) and `npm run test:e2e` (7 scenarios, Playwright).

| Suite | File | What it proves |
|---|---|---|
| Lexer | `tests/lexer.test.ts` | keywords (case-insensitive) vs identifiers, quoted identifiers, numbers/strings with escapes, operators/punctuation, comments, line/column/offset tracking incl. CRLF, unterminated strings/comments, invalid characters, digit-led identifiers |
| Parser | `tests/parser.test.ts` | every clause, aliases, stars, joins, AND/OR/NOT/arithmetic precedence and associativity, parentheses, IS NULL/LIKE/BETWEEN/IN, aggregates; missing FROM/operand/select item, unmatched parentheses, clause order, LIMIT/OFFSET validation, multi-error recovery, no AST on error; unsupported joins/subqueries/CASE/set operations; INSERT/UPDATE/DELETE/DROP/PRAGMA/ATTACH/CREATE blocked; multiple statements |
| Semantic | `tests/semantic.test.ts` | existing/missing tables with suggestions, duplicate aliases, self-join, columns, alias resolution and hiding, ambiguity, JOIN scope, star expansion, ORDER BY aliases, type mismatches, boolean conditions, arithmetic typing, integer-division warning, LIKE/BETWEEN/IN types, aggregate + GROUP BY rules, function arity/types, DISTINCT/ORDER BY, symbol table contents |
| Optimizer | `tests/optimizer.test.ts` | each rule (applies / must not apply), NULL three-valued-logic edge cases, nested predicates, pushdown across multiple joins, HAVING pushdown limits, DISTINCT key proofs, pruning keeps join keys, idempotence, determinism, **result equivalence on 42 queries + order preservation** |
| Pipeline | `tests/pipeline.test.ts` | phase statuses, stopping at lexical/syntax/semantic phase while keeping earlier results, empty/oversized/hostile input, JSON-serialisable, deterministic, locations |
| API & DB | `tests/api.test.ts` | file DB created/seeded/reused, FK integrity, read-only connection, analyze/execute/schema contracts, request validation (400/413/415), unknown fields rejected, blocked statements (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, PRAGMA, VACUUM, REPLACE, WITH, multi-statement, sqlite_master, subquery) → 422, quote-injection handled as data, integer-semantics of bound literals, sanitised errors, row cap |
| Examples & Learning Mode | `tests/examples.test.ts` | every documented example behaves as documented (compiles / stops at the stated phase) and returns the same rows as SQLite; Learning Mode text is produced from real output |
| End-to-end | `e2e/workbench.spec.ts` | open app → load sample → analyze → filter tokens → inspect AST (graph + text) → symbol search → algebra → optimization steps → execute → rows shown; syntax error shows message, location and editor marker, execution refused; invalid samples; keyboard shortcut and stale-edit indicator; navigation, examples, history restore/clear, schema, documentation, Learning Mode; theme toggle + Run All; phone viewport without horizontal overflow |

## Manual checklist
- [ ] Analyze each example and read the Learning Mode page.
- [ ] Toggle "Run optimized / original plan" and compare rows and measured time.
- [ ] Try the invalid examples and click a diagnostic's location to jump to it in the editor.
