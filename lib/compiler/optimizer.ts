import { type Catalog, findColumn, findTable } from "./catalog";
import {
  type ProjectedColumn,
  type RaNode,
  mapRaChildren,
  raChildren,
  raToText,
  scansOf,
  shouldQualify,
} from "./relational-algebra";
import {
  FALSE_EXPR,
  NULL_EXPR,
  type RExpr,
  TRUE_EXPR,
  aliasesOf,
  childExprs,
  collectColumns,
  conjoin,
  exprEquals,
  isAggregateCall,
  mapChildren,
  printExpr,
  splitConjuncts,
} from "./rexpr";

// ---- public types -------------------------------------------------------------------

export interface RuleInfo {
  id: string;
  name: string;
  /** Condition under which the rule applies. */
  appliesWhen: string;
  /** Why the rewrite preserves the query result. */
  whySafe: string;
}

export interface OptimizationStep {
  index: number;
  ruleId: string;
  ruleName: string;
  /** The concrete condition that held at this location. */
  precondition: string;
  explanation: string;
  /** Algebra of the rewritten subtree, before and after. */
  before: string;
  after: string;
  planAfter: RaNode;
  planAfterText: string;
}

export interface SkippedRule {
  ruleId: string;
  ruleName: string;
  reason: string;
  location: string;
}

export interface OptimizationResult {
  original: RaNode;
  optimized: RaNode;
  steps: OptimizationStep[];
  skipped: SkippedRule[];
  rules: RuleInfo[];
  /** Number of passes over the rule set until no rule applied. */
  passes: number;
}

type Outcome =
  | { kind: "applied"; node: RaNode; precondition: string; explanation: string }
  | { kind: "skipped"; reason: string };

interface RuleContext {
  catalog: Catalog;
  qualify: boolean;
  /** Columns required by the ancestors of each node (only populated for projection pruning). */
  required: Map<RaNode, Required>;
}

interface Rule extends RuleInfo {
  apply(node: RaNode, ctx: RuleContext): Outcome | null;
}

type Required = Set<string> | "ALL";

const txt = (e: RExpr, ctx: RuleContext): string => printExpr(e, { qualify: ctx.qualify });
const lc = (s: string): string => s.toLowerCase();

// ---- literal folding helpers -----------------------------------------------------------

type Literal = Extract<RExpr, { t: "num" | "str" | "null" | "bool" }>;
const isLiteral = (e: RExpr): e is Literal => e.t === "num" || e.t === "str" || e.t === "null" || e.t === "bool";
const isTrue = (e: RExpr): boolean => e.t === "bool" && e.value;
const isFalse = (e: RExpr): boolean => e.t === "bool" && !e.value;

type Tri = true | false | null;
const triToExpr = (v: Tri): RExpr => (v === null ? NULL_EXPR : v ? TRUE_EXPR : FALSE_EXPR);
const exprToTri = (e: RExpr): Tri | undefined => (e.t === "null" ? null : e.t === "bool" ? e.value : undefined);
const triAnd = (a: Tri, b: Tri): Tri => (a === false || b === false ? false : a === null || b === null ? null : true);
const triOr = (a: Tri, b: Tri): Tri => (a === true || b === true ? true : a === null || b === null ? null : false);
const triNot = (a: Tri): Tri => (a === null ? null : !a);

/** Three-valued comparison of two literals, or undefined when the result cannot be decided safely. */
function compareLiterals(op: string, a: Literal, b: Literal): Tri | undefined {
  if (a.t === "null" || b.t === "null") return null;
  let c: number;
  if (a.t === "num" && b.t === "num") c = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  else if (a.t === "str" && b.t === "str") {
    const ascii = /^[\x00-\x7f]*$/;
    if (op !== "=" && op !== "<>" && op !== "!=" && !(ascii.test(a.value) && ascii.test(b.value))) return undefined;
    c = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  } else if (a.t === "bool" && b.t === "bool" && (op === "=" || op === "<>" || op === "!=")) c = a.value === b.value ? 0 : 1;
  else return undefined;
  switch (op) {
    case "=":
      return c === 0;
    case "<>":
    case "!=":
      return c !== 0;
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    case ">=":
      return c >= 0;
  }
  return undefined;
}

function foldArithmetic(op: string, a: Extract<RExpr, { t: "num" }>, b: Extract<RExpr, { t: "num" }>): RExpr | undefined {
  if (a.isInt && b.isInt) {
    const x = BigInt(a.value);
    const y = BigInt(b.value);
    let r: bigint;
    switch (op) {
      case "+":
        r = x + y;
        break;
      case "-":
        r = x - y;
        break;
      case "*":
        r = x * y;
        break;
      case "/":
        if (y === 0n) return NULL_EXPR;
        r = x / y;
        break;
      case "%":
        if (y === 0n) return NULL_EXPR;
        r = x % y;
        break;
      default:
        return undefined;
    }
    const n = Number(r);
    return Number.isSafeInteger(n) ? { t: "num", value: n, isInt: true } : undefined;
  }
  let r: number;
  switch (op) {
    case "+":
      r = a.value + b.value;
      break;
    case "-":
      r = a.value - b.value;
      break;
    case "*":
      r = a.value * b.value;
      break;
    case "/":
      if (b.value === 0) return NULL_EXPR;
      r = a.value / b.value;
      break;
    default:
      return undefined; // '%' on REAL operands is rejected by semantic analysis
  }
  return Number.isFinite(r) ? { t: "num", value: r, isInt: false } : undefined;
}

interface FoldEvent {
  from: string;
  to: string;
}

/** Bottom-up constant folding. Records one event per fold performed. */
function foldExpr(e: RExpr, events: FoldEvent[]): RExpr {
  const node = mapChildren(e, (c) => foldExpr(c, events));
  const done = (result: RExpr): RExpr => {
    events.push({ from: printExpr(node, { qualify: false }), to: printExpr(result, { qualify: false }) });
    return result;
  };

  switch (node.t) {
    case "un": {
      const o = node.operand;
      if (node.op === "+") return done(o);
      if (node.op === "-") {
        if (o.t === "num") return done({ t: "num", value: -o.value, isInt: o.isInt });
        if (o.t === "null") return done(NULL_EXPR);
      }
      if (node.op === "NOT") {
        const v = exprToTri(o);
        if (v !== undefined) return done(triToExpr(triNot(v)));
      }
      return node;
    }
    case "bin": {
      const { op, left: l, right: r } = node;
      if (op === "AND" || op === "OR") {
        const a = exprToTri(l);
        const b = exprToTri(r);
        if (a !== undefined && b !== undefined) return done(triToExpr(op === "AND" ? triAnd(a, b) : triOr(a, b)));
        return node;
      }
      if (["+", "-", "*", "/", "%"].includes(op)) {
        if (l.t === "null" || r.t === "null") return done(NULL_EXPR);
        if (l.t === "num" && r.t === "num") {
          const v = foldArithmetic(op, l, r);
          if (v) return done(v);
        }
        return node;
      }
      // comparison
      if (l.t === "null" || r.t === "null") return done(NULL_EXPR);
      if (isLiteral(l) && isLiteral(r)) {
        const v = compareLiterals(op, l, r);
        if (v !== undefined) return done(triToExpr(v));
      }
      return node;
    }
    case "isnull":
      if (isLiteral(node.operand)) return done(triToExpr((node.operand.t === "null") !== node.negated));
      return node;
    case "between": {
      const { operand: x, low, high } = node;
      if (isLiteral(x) && isLiteral(low) && isLiteral(high)) {
        const ge = compareLiterals(">=", x, low);
        const le = compareLiterals("<=", x, high);
        if (ge !== undefined && le !== undefined) {
          const v = triAnd(ge, le);
          return done(triToExpr(node.negated ? triNot(v) : v));
        }
      }
      return node;
    }
    case "in": {
      if (isLiteral(node.operand) && node.items.every(isLiteral)) {
        const x = node.operand;
        let result: Tri = false;
        let decided = true;
        for (const item of node.items as Literal[]) {
          const c = compareLiterals("=", x, item);
          if (c === undefined) {
            decided = false;
            break;
          }
          result = triOr(result, c);
        }
        if (decided) return done(triToExpr(node.negated ? triNot(result) : result));
      }
      return node;
    }
    default:
      return node;
  }
}

/** Boolean identities that hold under SQL three-valued logic. */
function simplifyBoolean(e: RExpr, events: FoldEvent[]): RExpr {
  const node = mapChildren(e, (c) => simplifyBoolean(c, events));
  const done = (result: RExpr): RExpr => {
    events.push({ from: printExpr(node, { qualify: false }), to: printExpr(result, { qualify: false }) });
    return result;
  };
  if (node.t === "un" && node.op === "NOT" && node.operand.t === "un" && node.operand.op === "NOT") return done(node.operand.operand);
  if (node.t === "bin" && (node.op === "AND" || node.op === "OR")) {
    const { op, left: l, right: r } = node;
    if (op === "AND") {
      if (isFalse(l) || isFalse(r)) return done(FALSE_EXPR);
      if (isTrue(l)) return done(r);
      if (isTrue(r)) return done(l);
    } else {
      if (isTrue(l) || isTrue(r)) return done(TRUE_EXPR);
      if (isFalse(l)) return done(r);
      if (isFalse(r)) return done(l);
    }
    // Idempotence over the flattened chain: p AND q AND p  ->  p AND q
    const flat = flatten(node, op);
    const unique: RExpr[] = [];
    for (const part of flat) if (!unique.some((u) => exprEquals(u, part))) unique.push(part);
    if (unique.length < flat.length) {
      const rebuilt = unique.reduce((acc, p) => ({ t: "bin", op, left: acc, right: p }) as RExpr);
      return done(rebuilt);
    }
  }
  return node;
}

function flatten(e: RExpr, op: "AND" | "OR"): RExpr[] {
  return e.t === "bin" && e.op === op ? [...flatten(e.left, op), ...flatten(e.right, op)] : [e];
}

// ---- node expression helpers -------------------------------------------------------------

/** Applies `f` to every expression held directly by the node. */
function mapNodeExprs(node: RaNode, f: (e: RExpr) => RExpr): RaNode {
  switch (node.op) {
    case "select":
      return { ...node, predicate: f(node.predicate) };
    case "join":
      return { ...node, condition: f(node.condition) };
    case "project":
      return { ...node, columns: node.columns.map((c) => ({ ...c, expr: f(c.expr) })) };
    case "sort":
      return { ...node, keys: node.keys.map((k) => ({ ...k, expr: f(k.expr) })) };
    case "aggregate":
      return { ...node, groupBy: node.groupBy.map(f), aggregates: node.aggregates.map(f) };
    default:
      return node;
  }
}

function nodeExprs(node: RaNode): RExpr[] {
  switch (node.op) {
    case "select":
      return [node.predicate];
    case "join":
      return [node.condition];
    case "project":
      return node.columns.map((c) => c.expr);
    case "sort":
      return node.keys.map((k) => k.expr);
    case "aggregate":
      return [...node.groupBy, ...node.aggregates];
    default:
      return [];
  }
}

function scanAliases(node: RaNode): Set<string> {
  return new Set(scansOf(node).map((s) => lc(s.alias)));
}

function describeEvents(events: FoldEvent[]): string {
  const shown = events.slice(0, 4).map((e) => `\`${e.from}\` → \`${e.to}\``);
  return shown.join("; ") + (events.length > 4 ? `; … (${events.length} rewrites in total)` : "");
}

// ---- rules ---------------------------------------------------------------------------------

const constantFolding: Rule = {
  id: "constant-folding",
  name: "Constant folding",
  appliesWhen: "An expression contains an operation whose operands are all literals (or a NULL literal for arithmetic and comparison).",
  whySafe: "The folded value is computed with SQLite semantics: integer division truncates, division by zero is NULL, and NULL propagates through arithmetic and comparison. Results outside the exact integer range are not folded.",
  apply(node) {
    const events: FoldEvent[] = [];
    const next = mapNodeExprs(node, (e) => foldExpr(e, events));
    if (events.length === 0) return null;
    return {
      kind: "applied",
      node: next,
      precondition: "Operands of the folded operations are constants.",
      explanation: `Evaluated constant sub-expressions at compile time: ${describeEvents(events)}.`,
    };
  },
};

const booleanSimplification: Rule = {
  id: "boolean-simplification",
  name: "Boolean simplification",
  appliesWhen: "A predicate contains TRUE/FALSE with AND/OR, a double NOT, or a repeated operand in an AND/OR chain.",
  whySafe: "Each identity (TRUE AND p = p, FALSE AND p = FALSE, TRUE OR p = TRUE, FALSE OR p = p, NOT NOT p = p, p AND p = p) holds for TRUE, FALSE and NULL under three-valued logic.",
  apply(node) {
    const events: FoldEvent[] = [];
    const next = mapNodeExprs(node, (e) => simplifyBoolean(e, events));
    if (events.length === 0) return null;
    return {
      kind: "applied",
      node: next,
      precondition: "The predicate contains a boolean constant, double negation, or duplicate operand.",
      explanation: `Applied boolean identities: ${describeEvents(events)}.`,
    };
  },
};

const removeTrivialSelection: Rule = {
  id: "remove-trivial-selection",
  name: "Remove always-true selection",
  appliesWhen: "A selection's predicate is the constant TRUE.",
  whySafe: "σ_TRUE(R) keeps every row of R, so it equals R.",
  apply(node, ctx) {
    if (node.op !== "select") return null;
    if (isTrue(node.predicate)) {
      return { kind: "applied", node: node.input, precondition: "The predicate is the constant TRUE.", explanation: "Removed a selection that keeps every row." };
    }
    if (isFalse(node.predicate) || node.predicate.t === "null") {
      return {
        kind: "skipped",
        reason: `The predicate ${txt(node.predicate, ctx)} is never TRUE, so the result is empty; the selection is kept because this IR has no empty-relation operator.`,
      };
    }
    return null;
  },
};

const mergeSelections: Rule = {
  id: "merge-selections",
  name: "Merge adjacent selections",
  appliesWhen: "A selection sits directly on top of another selection.",
  whySafe: "σ_p(σ_q(R)) = σ_{q AND p}(R): a row survives both filters exactly when both predicates are TRUE.",
  apply(node, ctx) {
    if (node.op !== "select" || node.input.op !== "select") return null;
    const merged = conjoin([...splitConjuncts(node.input.predicate), ...splitConjuncts(node.predicate)]);
    return {
      kind: "applied",
      node: { op: "select", predicate: merged, input: node.input.input },
      precondition: "Two selections are stacked on the same input.",
      explanation: `Combined the predicates ${txt(node.input.predicate, ctx)} and ${txt(node.predicate, ctx)} into one selection.`,
    };
  },
};

const selectionPushdown: Rule = {
  id: "selection-pushdown",
  name: "Selection pushdown through join",
  appliesWhen: "A selection above an inner join has a conjunct that only references columns of one join input.",
  whySafe: "For an inner join, σ_p(L ⋈ R) = σ_p(L) ⋈ R when p only uses columns of L (and symmetrically for R), so rows are filtered before the join instead of after it.",
  apply(node, ctx) {
    if (node.op !== "select" || node.input.op !== "join") return null;
    const join = node.input;
    const leftAliases = scanAliases(join.left);
    const rightAliases = scanAliases(join.right);
    const toLeft: RExpr[] = [];
    const toRight: RExpr[] = [];
    const keep: RExpr[] = [];
    for (const c of splitConjuncts(node.predicate)) {
      const aliases = [...aliasesOf(c)].map(lc);
      if (aliases.length > 0 && aliases.every((a) => leftAliases.has(a))) toLeft.push(c);
      else if (aliases.length > 0 && aliases.every((a) => rightAliases.has(a))) toRight.push(c);
      else keep.push(c);
    }
    if (toLeft.length === 0 && toRight.length === 0) {
      return { kind: "skipped", reason: `Every condition in ${txt(node.predicate, ctx)} references both sides of the join (or no column), so none can move below it.` };
    }
    const newJoin: RaNode = {
      ...join,
      left: toLeft.length > 0 ? { op: "select", predicate: conjoin(toLeft), input: join.left } : join.left,
      right: toRight.length > 0 ? { op: "select", predicate: conjoin(toRight), input: join.right } : join.right,
    };
    const result: RaNode = keep.length > 0 ? { op: "select", predicate: conjoin(keep), input: newJoin } : newJoin;
    const moved = [...toLeft, ...toRight].map((c) => `\`${txt(c, ctx)}\``).join(", ");
    return {
      kind: "applied",
      node: result,
      precondition: "The condition references columns of a single join input.",
      explanation: `Pushed ${moved} below the join so rows are filtered before they are joined.${keep.length > 0 ? ` ${keep.map((c) => `\`${txt(c, ctx)}\``).join(", ")} needs both inputs and stays above the join.` : ""}`,
    };
  },
};

const joinConditionPushdown: Rule = {
  id: "join-condition-pushdown",
  name: "Join-condition pushdown",
  appliesWhen: "An inner join's ON condition has a conjunct that only references one input, and at least one conjunct remains for the join itself.",
  whySafe: "For an inner join, L ⋈_{p AND q} R = σ_p(L) ⋈_q R when p only uses columns of L: rows failing p can never produce a join result.",
  apply(node, ctx) {
    if (node.op !== "join") return null;
    const leftAliases = scanAliases(node.left);
    const rightAliases = scanAliases(node.right);
    const toLeft: RExpr[] = [];
    const toRight: RExpr[] = [];
    const keep: RExpr[] = [];
    for (const c of splitConjuncts(node.condition)) {
      const aliases = [...aliasesOf(c)].map(lc);
      if (aliases.length > 0 && aliases.every((a) => leftAliases.has(a))) toLeft.push(c);
      else if (aliases.length > 0 && aliases.every((a) => rightAliases.has(a))) toRight.push(c);
      else keep.push(c);
    }
    if (toLeft.length + toRight.length === 0) return null;
    if (keep.length === 0) {
      return { kind: "skipped", reason: `Every conjunct of ON ${txt(node.condition, ctx)} uses a single input; moving them all would leave the join without a condition.` };
    }
    const moved = [...toLeft, ...toRight].map((c) => `\`${txt(c, ctx)}\``).join(", ");
    return {
      kind: "applied",
      node: {
        ...node,
        condition: conjoin(keep),
        left: toLeft.length > 0 ? { op: "select", predicate: conjoin(toLeft), input: node.left } : node.left,
        right: toRight.length > 0 ? { op: "select", predicate: conjoin(toRight), input: node.right } : node.right,
      },
      precondition: "A conjunct of the ON condition uses only one join input.",
      explanation: `Moved ${moved} out of the join condition onto the input it refers to.`,
    };
  },
};

const havingPushdown: Rule = {
  id: "having-pushdown",
  name: "HAVING-to-WHERE pushdown",
  appliesWhen: "A selection above a GROUP BY aggregation has a conjunct with no aggregate calls whose columns are all grouping columns.",
  whySafe: "A filter on grouping columns keeps or drops whole groups, so applying it before grouping yields the same groups. It requires a non-empty GROUP BY: a global aggregate over zero rows still returns one row.",
  apply(node, ctx) {
    if (node.op !== "select" || node.input.op !== "aggregate") return null;
    const agg = node.input;
    if (agg.groupBy.length === 0) {
      return { kind: "skipped", reason: "The aggregation has no GROUP BY: a global aggregate always yields one row, so its filter cannot move below it." };
    }
    const groupCols = new Set(agg.groupBy.filter((g) => g.t === "col").map((g) => (g.t === "col" ? `${lc(g.table)}.${lc(g.name)}` : "")));
    const movable: RExpr[] = [];
    const keep: RExpr[] = [];
    for (const c of splitConjuncts(node.predicate)) {
      const cols = collectColumns(c);
      const hasAgg = containsAgg(c);
      if (!hasAgg && cols.length > 0 && cols.every((x) => groupCols.has(`${lc(x.table)}.${lc(x.name)}`))) movable.push(c);
      else keep.push(c);
    }
    if (movable.length === 0) {
      return { kind: "skipped", reason: `${txt(node.predicate, ctx)} depends on an aggregate result or a non-grouping column, so it must be evaluated after grouping.` };
    }
    const below: RaNode = { op: "aggregate", groupBy: agg.groupBy, aggregates: agg.aggregates, input: { op: "select", predicate: conjoin(movable), input: agg.input } };
    return {
      kind: "applied",
      node: keep.length > 0 ? { op: "select", predicate: conjoin(keep), input: below } : below,
      precondition: "The condition only uses grouping columns and no aggregate functions.",
      explanation: `Moved ${movable.map((c) => `\`${txt(c, ctx)}\``).join(", ")} from HAVING to before the grouping, so fewer rows are aggregated.`,
    };
  },
};

function containsAgg(e: RExpr): boolean {
  return isAggregateCall(e) || childExprs(e).some(containsAgg);
}

/** Primary-key coverage: does `cols` project the whole key of every table under an SPJ subtree? */
function keysProjected(input: RaNode, cols: ProjectedColumn[], ctx: RuleContext): { ok: boolean; missing?: string } {
  const projected = new Set(cols.filter((c) => c.expr.t === "col").map((c) => (c.expr.t === "col" ? `${lc(c.expr.table)}.${lc(c.expr.name)}` : "")));
  for (const scan of scansOf(input)) {
    const table = findTable(ctx.catalog, scan.table);
    if (!table || table.primaryKey.length === 0) return { ok: false, missing: `${scan.table} (no primary key)` };
    for (const pk of table.primaryKey) {
      const col = findColumn(table, pk);
      const nonNull = col ? col.notNull : false;
      if (!nonNull) return { ok: false, missing: `${scan.alias}.${pk} (nullable key)` };
      if (!projected.has(`${lc(scan.alias)}.${lc(pk)}`)) return { ok: false, missing: `${scan.alias}.${pk}` };
    }
  }
  return { ok: true };
}

function peelSpj(node: RaNode): RaNode {
  let n = node;
  while (n.op === "sort" || n.op === "select") n = n.input;
  return n;
}

function isSpj(node: RaNode): boolean {
  if (node.op === "scan") return true;
  if (node.op === "select") return isSpj(node.input);
  if (node.op === "join") return isSpj(node.left) && isSpj(node.right);
  return false;
}

const eliminateDistinct: Rule = {
  id: "eliminate-redundant-distinct",
  name: "Eliminate redundant DISTINCT",
  appliesWhen: "Duplicate elimination is applied to rows that are already unique: DISTINCT of DISTINCT, a projection containing the primary key of every table, or a projection of every GROUP BY expression.",
  whySafe: "Rows that include a table's complete non-null primary key cannot repeat (and every group is produced once), so δ removes nothing.",
  apply(node, ctx) {
    if (node.op !== "distinct") return null;
    const input = node.input;
    if (input.op === "distinct") {
      return { kind: "applied", node: input, precondition: "δ is applied directly to another δ.", explanation: "Removed a duplicate-elimination operator applied to already de-duplicated rows." };
    }
    if (input.op !== "project") return null;
    const base = peelSpj(input.input);
    if (base.op === "aggregate" && base.groupBy.length > 0) {
      const covered = base.groupBy.every((g) => input.columns.some((c) => exprEquals(c.expr, g)));
      if (covered) {
        return {
          kind: "applied",
          node: input,
          precondition: "The projection contains every GROUP BY expression, and GROUP BY emits one row per group.",
          explanation: "Removed DISTINCT: each group is produced exactly once, and every grouping expression is in the output, so rows are already unique.",
        };
      }
      return { kind: "skipped", reason: "DISTINCT kept: the projection omits some GROUP BY expressions, so different groups could produce equal rows." };
    }
    if (isSpj(base)) {
      const check = keysProjected(base, input.columns, ctx);
      if (check.ok) {
        return {
          kind: "applied",
          node: input,
          precondition: "The projection includes the complete non-null primary key of every table in the query.",
          explanation: "Removed DISTINCT: output rows contain each table's primary key, so no two rows can be identical.",
        };
      }
      return { kind: "skipped", reason: `DISTINCT kept: the projection does not include the primary key ${check.missing}, so duplicates may occur.` };
    }
    return null;
  },
};

function outputColumnsOf(node: RaNode, ctx: RuleContext): { table: string; name: string }[] | null {
  switch (node.op) {
    case "scan": {
      const t = findTable(ctx.catalog, node.table);
      return t ? t.columns.map((c) => ({ table: node.alias, name: c.name })) : null;
    }
    case "join": {
      const l = outputColumnsOf(node.left, ctx);
      const r = outputColumnsOf(node.right, ctx);
      return l && r ? [...l, ...r] : null;
    }
    case "select":
    case "sort":
    case "distinct":
    case "limit":
      return outputColumnsOf(node.input, ctx);
    default:
      return null;
  }
}

const removeIdentityProjection: Rule = {
  id: "remove-identity-projection",
  name: "Remove identity projection",
  appliesWhen: "A projection lists exactly all columns of its input, in order, without renaming (e.g. SELECT * on the tables in scope).",
  whySafe: "π over all input columns in their original order returns its input unchanged.",
  apply(node, ctx) {
    if (node.op !== "project") return null;
    const out = outputColumnsOf(node.input, ctx);
    if (!out || out.length !== node.columns.length) return null;
    const identity = node.columns.every((c, i) => {
      const o = out[i]!;
      return c.expr.t === "col" && lc(c.expr.table) === lc(o.table) && lc(c.expr.name) === lc(o.name) && c.name === o.name;
    });
    if (!identity) return null;
    return {
      kind: "applied",
      node: node.input,
      precondition: "The projected columns equal the input's columns in the same order.",
      explanation: "Removed a projection that returns all columns unchanged.",
    };
  },
};

// Projection (column) pruning: only below joins, where narrower inputs reduce the join's working set.
function requiredAbove(node: RaNode, req: Required, map: Map<RaNode, Required>): void {
  map.set(node, req);
  const withExprs = (r: Required): Required => {
    if (r === "ALL") return r;
    const next = new Set(r);
    for (const e of nodeExprs(node)) for (const c of collectColumns(e)) next.add(`${lc(c.table)}.${lc(c.name)}`);
    return next;
  };
  switch (node.op) {
    case "project":
    case "aggregate": {
      const next = new Set<string>();
      for (const e of nodeExprs(node)) for (const c of collectColumns(e)) next.add(`${lc(c.table)}.${lc(c.name)}`);
      requiredAbove(node.input, next, map);
      break;
    }
    case "join": {
      const r = withExprs(req);
      requiredAbove(node.left, r, map);
      requiredAbove(node.right, r, map);
      break;
    }
    case "scan":
      break;
    default:
      requiredAbove(node.input, withExprs(req), map);
  }
}

function peelSelects(node: RaNode): RaNode {
  let n = node;
  while (n.op === "select") n = n.input;
  return n;
}

const projectionPruning: Rule = {
  id: "projection-pruning",
  name: "Projection pushdown (column pruning)",
  appliesWhen: "A join input is a table (possibly filtered) and the query needs only some of its columns.",
  whySafe: "Columns that no ancestor operator reads cannot affect the result, so dropping them early keeps the output identical while narrowing the rows flowing into the join.",
  apply(node, ctx) {
    if (node.op !== "join") return null;
    const above = ctx.required.get(node);
    if (!above) return null;
    // Columns needed by the ancestors plus the join's own condition.
    const req: Required = above === "ALL" ? above : new Set(above);
    if (req !== "ALL") for (const c of collectColumns(node.condition)) req.add(`${lc(c.table)}.${lc(c.name)}`);
    const pruned: string[] = [];
    const prune = (child: RaNode): RaNode => {
      if (child.op === "project") return child;
      const base = peelSelects(child);
      if (base.op !== "scan") return child;
      const table = findTable(ctx.catalog, base.table);
      if (!table) return child;
      let keep = table.columns.filter((c) => req === "ALL" || req.has(`${lc(base.alias)}.${lc(c.name)}`));
      if (keep.length === table.columns.length) return child;
      if (keep.length === 0) keep = [table.columns[0]!];
      pruned.push(`${base.alias}: keep ${keep.map((c) => c.name).join(", ")} (drop ${table.columns.length - keep.length} of ${table.columns.length} columns)`);
      return {
        op: "project",
        columns: keep.map((c) => ({ expr: { t: "col", table: base.alias, name: c.name } as RExpr, name: c.name })),
        input: child,
      };
    };
    const left = prune(node.left);
    const right = prune(node.right);
    if (pruned.length === 0) return null;
    return {
      kind: "applied",
      node: { ...node, left, right },
      precondition: "Some columns of a join input are not used by the join condition or by any operator above the join.",
      explanation: `Inserted projections below the join to discard unused columns — ${pruned.join("; ")}.`,
    };
  },
};

const STAGE_ONE: Rule[] = [
  constantFolding,
  booleanSimplification,
  removeTrivialSelection,
  mergeSelections,
  selectionPushdown,
  joinConditionPushdown,
  havingPushdown,
  eliminateDistinct,
  removeIdentityProjection,
];
const STAGE_TWO: Rule[] = [projectionPruning];

export const OPTIMIZATION_RULES: RuleInfo[] = [...STAGE_ONE, ...STAGE_TWO].map(({ id, name, appliesWhen, whySafe }) => ({ id, name, appliesWhen, whySafe }));

// ---- engine --------------------------------------------------------------------------------

interface Applied {
  node: RaNode;
  before: RaNode;
  after: RaNode;
  precondition: string;
  explanation: string;
}

/** Finds the first (post-order) location where `rule` applies and rewrites it. */
function applyOnce(node: RaNode, rule: Rule, ctx: RuleContext, skips: SkippedRule[]): Applied | null {
  const kids = raChildren(node);
  for (let i = 0; i < kids.length; i++) {
    const hit = applyOnce(kids[i]!, rule, ctx, skips);
    if (hit) {
      let idx = 0;
      const rebuilt = mapRaChildren(node, (c) => (idx++ === i ? hit.node : c));
      return { ...hit, node: rebuilt };
    }
  }
  const outcome = rule.apply(node, ctx);
  if (!outcome) return null;
  if (outcome.kind === "skipped") {
    skips.push({ ruleId: rule.id, ruleName: rule.name, reason: outcome.reason, location: raToText(node, ctx.qualify) });
    return null;
  }
  return { node: outcome.node, before: node, after: outcome.node, precondition: outcome.precondition, explanation: outcome.explanation };
}

export function optimize(original: RaNode, catalog: Catalog): OptimizationResult {
  const qualify = shouldQualify(original);
  const steps: OptimizationStep[] = [];
  const skippedByRule = new Map<string, SkippedRule[]>();
  let plan = original;
  const MAX_STEPS = 200;

  const runRules = (rules: Rule[]): boolean => {
    let changedAny = false;
    for (const rule of rules) {
      for (;;) {
        if (steps.length >= MAX_STEPS) return changedAny;
        const ctx: RuleContext = { catalog, qualify, required: new Map() };
        if (rule === projectionPruning) requiredAbove(plan, "ALL", ctx.required);
        const skips: SkippedRule[] = [];
        const hit = applyOnce(plan, rule, ctx, skips);
        skippedByRule.set(rule.id, skips);
        if (!hit) break;
        plan = hit.node;
        changedAny = true;
        steps.push({
          index: steps.length + 1,
          ruleId: rule.id,
          ruleName: rule.name,
          precondition: hit.precondition,
          explanation: hit.explanation,
          before: raToText(hit.before, qualify),
          after: raToText(hit.after, qualify),
          planAfter: plan,
          planAfterText: raToText(plan, qualify),
        });
      }
    }
    return changedAny;
  };

  let passes = 0;
  const converge = (rules: Rule[]): void => {
    for (;;) {
      passes++;
      if (!runRules(rules) || steps.length >= MAX_STEPS) break;
    }
  };
  converge(STAGE_ONE);
  if (runRules(STAGE_TWO)) converge(STAGE_ONE);

  const seen = new Set<string>();
  const skipped: SkippedRule[] = [];
  for (const list of skippedByRule.values()) {
    for (const s of list) {
      const key = `${s.ruleId}|${s.reason}|${s.location}`;
      if (!seen.has(key)) {
        seen.add(key);
        skipped.push(s);
      }
    }
  }
  return { original, optimized: plan, steps, skipped, rules: OPTIMIZATION_RULES, passes };
}

