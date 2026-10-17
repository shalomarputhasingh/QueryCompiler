# Optimization rules

The optimizer is deterministic and rule-based. It repeats the stage-1 rules until none applies, then applies projection pruning once, then re-converges stage 1. At most 200 steps are performed. Every step stores the rule id, the precondition that held, an explanation, the affected subtree before/after and a snapshot of the whole plan.

A rule that matches a location but must not fire records a **skip reason** (computed on the final plan). Nothing here claims faster execution; the Execution tab reports measured SQLite time only.

All rules are written for SQL three-valued logic (TRUE / FALSE / NULL).

| # | Rule id | Applies when | Equivalence argument |
|---|---|---|---|
| 1 | `constant-folding` | an operator's operands are literals (arithmetic, comparison, NOT/AND/OR, IS NULL, BETWEEN, IN) or a NULL literal is an operand of arithmetic/comparison | Evaluated with SQLite semantics: integer ÷ truncates, `x/0` and `x%0` are NULL, any NULL operand gives NULL. Not folded: results outside ±2⁵³, REAL `%`, LIKE, non-ASCII string ordering |
| 2 | `boolean-simplification` | `TRUE AND p`, `FALSE AND p`, `TRUE OR p`, `FALSE OR p`, `NOT NOT p`, duplicate operands in an AND/OR chain | Each identity holds for TRUE/FALSE/NULL (e.g. `FALSE AND NULL = FALSE`, `TRUE OR NULL = TRUE`) |
| 3 | `remove-trivial-selection` | σ_TRUE | σ_TRUE(R)=R. σ_FALSE / σ_NULL are *kept* (no empty-relation operator) and listed as skipped |
| 4 | `merge-selections` | σ_p(σ_q(R)) | a row must satisfy both: σ_{q∧p}(R) |
| 5 | `selection-pushdown` | σ above an inner join with a conjunct referencing only one input | σ_p(L⋈R)=σ_p(L)⋈R if p uses only L attributes |
| 6 | `join-condition-pushdown` | ON conjunct referencing one input, and ≥1 other conjunct remains | L ⋈_{p∧q} R = σ_p(L) ⋈_q R for inner joins |
| 7 | `having-pushdown` | HAVING conjunct has no aggregate, uses only GROUP BY columns, GROUP BY non-empty | A filter on grouping columns keeps/drops whole groups. Not for global aggregates (they return one row even on empty input) |
| 8 | `eliminate-redundant-distinct` | δ(δ(R)); projection contains the full non-null PK of every table of an SPJ input; or all GROUP BY expressions over an aggregation | Rows are unique, so δ removes nothing |
| 9 | `remove-identity-projection` | π lists exactly the input's columns, in order, unrenamed | π_all(R)=R |
| 10 | `projection-pruning` | a join input (table, maybe filtered) has columns unused by the join condition and every ancestor | Unused columns cannot influence the result; join keys and filter columns below the projection are preserved. If nothing is needed, one column is kept |

## Why some things are *not* done
- Conjuncts that reference both join inputs stay above the join (skip reason shown).
- A join is never left without a condition (it would silently become a cross product).
- `col = col` is not simplified to TRUE (it is NULL when the column is NULL).
- LIKE is never folded (collation/case rules).

## Verification
`tests/optimizer.test.ts` has positive, negative and NULL edge-case tests for each rule, an idempotence test (optimising an optimised plan changes nothing), a determinism test, and **42 queries whose rows are compared as multisets between the user's SQL executed directly, the SQL generated from the original plan, and the SQL generated from the optimized plan** (order is compared exactly for ORDER BY queries).
