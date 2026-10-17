# Compiler phases

## 1. Lexical analysis
A single left-to-right pass tracking line, column and offset (`\r\n` counts as one break). Output: significant tokens plus one `EOF`, the skipped comments, and diagnostics. Invalid input becomes an `INVALID` token so scanning continues and several errors can be reported. Any lexical error ends compilation after this phase (the tokens are still shown).

| Error | Code |
|---|---|
| Unterminated string / quoted identifier / block comment | QC1001 / QC1002 / QC1003 |
| Malformed number such as `12abc` | QC1004 |
| Invalid character, lone `!` | QC1006 |
| Query longer than 10,000 characters | QC1010 |

## 2. Syntax analysis
Clauses are parsed by recursive descent in grammar order. Expressions use precedence climbing with binding powers `OR 1 < AND 2 < NOT 3 < comparison 4 < additive 5 < multiplicative 6 < unary 7`; `BETWEEN` parses its bounds above `AND` so `a BETWEEN 1 AND 2 AND b` is correct.

**Recovery.** Each clause is guarded: after an error the parser skips to the next clause keyword at parenthesis depth 0 and continues, so `SELECT a, FROM t WHERE x > ORDER BY y LIMIT z` yields three diagnostics. A `ParseError` never escapes the parser.

**Messages.** Missing operand (`QC2014`), missing/unmatched parenthesis with the position of the opening one (`QC2003/2004`), missing FROM (`QC2006`), clause order (`QC2005`), unsupported construct (`QC2010`), blocked statement kinds (`QC2011`), multiple statements (`QC2012`).

## 3. Semantic analysis
1. Declare tables and aliases in FROM/JOIN order (unknown table → `QC3001` with a closest-name hint; duplicates `QC3002`).
2. Resolve column references against the scope visible at that point (`QC3003–3005`).
3. Type-check expressions bottom-up with `INTEGER`, `REAL`, `TEXT`, `BOOLEAN`, `NULL`, `UNKNOWN` (`UNKNOWN` suppresses cascading errors).
4. Check aggregate and grouping rules.
5. Build output columns and the symbol table (tables, aliases, in-scope schema columns, select aliases, resolved references with locations).

Resolutions and types are stored by AST node id, which is how the UI shows "static type" and "resolves to" for a selected node.

## 4. Relational algebra
`translateToAlgebra` builds, bottom-up: scans and left-deep inner joins → σ(WHERE) → γ (if grouped/aggregated) → σ(HAVING) → τ → π → δ → λ. Select-list aliases used in ORDER BY are replaced by their expressions; `*` is expanded.

## 5. Optimization
See [optimization-rules.md](optimization-rules.md).

## 6. Code generation
`generateSql` rebuilds a SELECT block from the plan (handling filtered/pruned join inputs as derived tables and folding filters over joins into `ON`). Numeric and string literals become `?` placeholders; the result also carries an inline `displaySql`. `generateInstructions` linearises the plan into `T1 := SCAN …`, `T2 := FILTER T1 WHERE …`, … — a teaching format, not machine code.
