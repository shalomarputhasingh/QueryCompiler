# QueryCompiler — Project Report Material

*SQL Query Translator, Compiler Visualizer & Optimizer (Compiler Design project).*
Statements below describe what the repository actually implements; anything not built is listed under future scope.

## Abstract
QueryCompiler is a web-based educational workbench that demonstrates the classic phases of a compiler using SQL as the source language. A restricted SQL subset is scanned by a hand-written lexer, parsed by a recursive-descent / Pratt parser into a typed abstract syntax tree, validated by a semantic analyzer against a real SQLite schema using a symbol table, translated to a relational-algebra intermediate representation, improved by a deterministic rule-based optimizer, and finally turned back into parameterised SQL that is executed read-only on a sample database. The interface visualises tokens, syntax trees, symbol tables, query plans and every optimization step, and explains errors with line and column positions.

## 1. Introduction
Compiler theory is usually taught with toy languages whose output is never used. SQL offers a practical alternative: students already know it, its semantics depend on a schema (a natural use of a symbol table), and relational algebra is a genuine intermediate representation on which well-known optimizations (selection pushdown, constant folding) can be demonstrated and *tested for equivalence* by running both plans.

## 2. Problem definition
Provide an interactive tool in which a user enters a SQL query and can observe, for every compiler phase, the real data structure produced, understand why errors occur, and see which optimizations apply and why — without relying on canned output.

## 3. Objectives
1. A real, tested compiler pipeline for a documented SQL subset.
2. Accurate lexical, syntax and semantic diagnostics with line/column and recovery.
3. Translation to relational algebra and explainable, semantics-preserving optimization.
4. Safe execution of supported SELECT queries on sample data.
5. Visualisations of each phase, a Learning Mode, examples, history, and documentation.

## 4. Existing and proposed approach
| | Existing approach | Proposed approach |
|---|---|---|
| Teaching | Static diagrams and pen-and-paper exercises | Live pipeline on user input |
| Parsing | Regular expressions or opaque libraries | Custom lexer and parser with source ranges and error recovery |
| Semantics | Not shown | Symbol table against a real schema; type, scope and aggregate checks |
| Optimization | Described in text | Rule engine with preconditions, explanations, skipped-rule reasons, and equivalence tests against SQLite |
| Safety | n/a | Compile-time rejection of non-SELECT statements, parameter binding, read-only connection |

## 5. System architecture
See [architecture.md](architecture.md). Browser (Next.js/React, Monaco, React Flow) ⇄ Route Handlers (`/api/analyze`, `/api/execute`, `/api/schema`) ⇄ compiler library ⇄ read-only SQLite.

## 6. Module descriptions
| Module | Description |
|---|---|
| Lexer | Scans text to tokens `{type, lexeme, value, range}`; reports unterminated strings/comments, invalid characters, malformed numbers |
| Parser | Recursive descent for clauses, Pratt for expressions; clause-level error recovery; produces typed AST with node ids |
| Semantic analyzer | Scope handling (aliases, join order), column resolution, ambiguity, type checking, aggregate/GROUP BY rules, symbol table |
| Relational algebra | Nodes scan, selection, projection, join, aggregation, sort, distinct, limit; printer with π σ ⋈ γ τ δ λ notation |
| Optimizer | 10 rules, fixed-point engine, step trace, skip reasons |
| Code generator | RA → parameterised SQL; RA → numbered instruction listing |
| Safe executor | Single read-only SELECT, bound parameters, row cap, sanitised errors |
| UI | Editor with diagnostic markers, 8 result tabs, plan/AST graphs, schema explorer with ER diagram, examples, history, Learning Mode, documentation |

## 7. Algorithms

### 7.1 Pratt expression parsing
```
parseExpr(minBp):
    left = parsePrefix()                      # literal, name, call, "(" expr ")", NOT/-/+ operand
    loop:
        op = peek()
        if op is an infix/postfix operator with bp(op) >= minBp:
            consume; left = combine(left, op, parseExpr(bp(op)+1))   # left-associative
            (IS [NOT] NULL, [NOT] LIKE/BETWEEN/IN handled as postfix forms)
        else break
    return left
```
Binding powers: OR 1, AND 2, NOT 3, comparison 4, `+ -` 5, `* / %` 6, unary 7.

### 7.2 Clause-level error recovery
```
guard(parseClause):
    try parseClause
    catch ParseError e: record e; skip tokens until next clause keyword at paren depth 0; continue
```

### 7.3 Optimization driver
```
repeat until no rule fires (max 200 steps):
    for rule in stage1 rules:
        while rule applies at some node (post-order search): rewrite; record step
apply projection pruning; if it changed the plan, repeat stage 1
```

### 7.4 Selection pushdown (σ over ⋈)
```
for each conjunct c of the predicate:
    A = table aliases referenced by c
    if A ⊆ aliases(left): push to left; elif A ⊆ aliases(right): push to right; else keep above
rebuild: join(σ_left(L), σ_right(R)) with remaining conjuncts as σ above
```

## 8. Flowchart (text)
```
SQL text ─▶ Lexer ──error──▶ report + stop
              │ok
              ▼
           Parser ──error──▶ report (several, with recovery) + stop
              │ok
              ▼
        Semantic analyzer ──error──▶ report + stop
              │ok
              ▼
   Relational algebra ─▶ Optimizer ─▶ Code generator ─▶ (optional) read-only execution
```

## 9. Test-case table
| ID | Input | Expected |
|---|---|---|
| T1 | `SELECT name FROM students WHERE marks > 80;` | success; `π_{name}(σ_{marks > 80}(students))`; no rule applied |
| T2 | `... WHERE marks > 10 * 8 AND 1 = 1` | constant folding + boolean simplification → `marks > 80` |
| T3 | join with `s.marks > 80 AND d.budget > 600000` | both conditions pushed below the join |
| T4 | `SELECT DISTINCT id, name FROM students ...` | redundant DISTINCT removed |
| T5 | `SELECT name FROM student;` | semantic error "Unknown table 'student'", hint `students` |
| T6 | `SELECT nam FROM students` | semantic error "Unknown column", hint `name` |
| T7 | `SELECT name FROM students WHERE marks > ;` | syntax error "Missing operand after '>'" |
| T8 | `... WHERE city = 'Chennai;` | lexical error "Unterminated string literal" |
| T9 | `SELECT name WHERE marks > 80;` | syntax error "Expected FROM clause" |
| T10 | `SELECT id FROM students s INNER JOIN departments d ON ...` | semantic error "Ambiguous column 'id'" |
| T11 | `SELECT name FROM students WHERE name > 5` | semantic error "Cannot compare TEXT with INTEGER" |
| T12 | `DROP TABLE students;` / `SELECT 1 FROM t; DROP ...` | rejected before execution (HTTP 422) |
| T13 | 42 queries (incl. NULL edge cases) | identical rows for user SQL, original plan, optimized plan |
Full list: [test-cases.md](test-cases.md).

## 10. Results and screenshots checklist
Results actually obtained in development: `npm run typecheck` clean; `npm test` — 255 tests passing; `npm run test:e2e` — 13 scenarios passing; `npm run build` succeeds. No performance experiments were run, so no speed-up figures are claimed.

Screenshots to capture for the report (not included in the repository):
- [ ] Playground with the default query, Overview tab (all six phase panels)
- [ ] Tokens tab filtered to KEYWORD
- [ ] Syntax Tree graph with a node selected, and the text form
- [ ] Symbol Table searched for a column
- [ ] Intermediate Representation: expression, plan graph, operator list
- [ ] Query Optimization on the three-way join: steps, before/after plans, skipped rules
- [ ] Execution Results with measured time
- [ ] An error in each of the lexical, syntax and semantic phases with the editor marker
- [ ] Schema Explorer ER diagram; Compiler Pipeline (Learning Mode); light theme; phone layout

## 11. Limitations
- Restricted SQL subset (see grammar); no outer joins, subqueries, set operations or scalar functions.
- Rule-based optimizer without statistics or a cost model; structural changes are not claimed to be faster.
- Equivalence is validated by tests on the sample database, not formally proven for all data.
- `better-sqlite3` is synchronous: statements cannot be interrupted, so safety relies on the small dataset, the supported grammar, a 500-row cap and duration checks.
- SQLite file storage needs a writable server file system (an in-memory fallback is used otherwise).

## 12. Conclusion and future scope
The project demonstrates every classical front-end and middle-end compiler phase on a language students know, with testable correctness and clear visualisations. Future scope: outer joins with outer-join-aware pushdown, subqueries, a statistics-based cost model, interruptible execution through worker threads, parser step-through animation and shareable links.
