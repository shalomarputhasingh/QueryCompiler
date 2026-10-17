import type { BinaryOperator, Expr } from "./ast";
import { AGGREGATE_FUNCTIONS } from "./ast";

/**
 * Resolved scalar expression used by the relational algebra. Unlike the AST it carries no source
 * positions and every column is bound to a table alias, so the optimizer can reason about it.
 */
export type RExpr =
  | { t: "num"; value: number; isInt: boolean }
  | { t: "str"; value: string }
  | { t: "null" }
  | { t: "bool"; value: boolean }
  | { t: "col"; table: string; name: string }
  | { t: "bin"; op: BinaryOperator; left: RExpr; right: RExpr }
  | { t: "un"; op: "NOT" | "-" | "+"; operand: RExpr }
  | { t: "fn"; name: string; distinct: boolean; star: boolean; args: RExpr[] }
  | { t: "isnull"; operand: RExpr; negated: boolean }
  | { t: "like"; operand: RExpr; pattern: RExpr; negated: boolean }
  | { t: "between"; operand: RExpr; low: RExpr; high: RExpr; negated: boolean }
  | { t: "in"; operand: RExpr; items: RExpr[]; negated: boolean };

export interface ResolvedColumn {
  /** Alias (or table name) used in the query scope. */
  table: string;
  /** Real table name in the catalog. */
  tableName: string;
  column: string;
}

export const TRUE_EXPR: RExpr = { t: "bool", value: true };
export const FALSE_EXPR: RExpr = { t: "bool", value: false };
export const NULL_EXPR: RExpr = { t: "null" };

/** Converts an AST expression using the column resolutions produced by semantic analysis. */
export function toRExpr(expr: Expr, resolve: (id: number) => ResolvedColumn | undefined): RExpr {
  const go = (e: Expr): RExpr => {
    switch (e.kind) {
      case "NumberLiteral":
        return { t: "num", value: e.value, isInt: e.isInteger };
      case "StringLiteral":
        return { t: "str", value: e.value };
      case "NullLiteral":
        return { t: "null" };
      case "BooleanLiteral":
        return { t: "bool", value: e.value };
      case "ColumnRef": {
        const r = resolve(e.id);
        if (!r) throw new Error(`Unresolved column reference '${e.name}' (node ${e.id})`);
        return { t: "col", table: r.table, name: r.column };
      }
      case "BinaryExpr":
        return { t: "bin", op: e.operator, left: go(e.left), right: go(e.right) };
      case "UnaryExpr":
        return { t: "un", op: e.operator, operand: go(e.operand) };
      case "FunctionCall":
        return { t: "fn", name: e.name, distinct: e.distinct, star: e.star, args: e.args.map(go) };
      case "IsNullExpr":
        return { t: "isnull", operand: go(e.operand), negated: e.negated };
      case "LikeExpr":
        return { t: "like", operand: go(e.operand), pattern: go(e.pattern), negated: e.negated };
      case "BetweenExpr":
        return { t: "between", operand: go(e.operand), low: go(e.low), high: go(e.high), negated: e.negated };
      case "InExpr":
        return { t: "in", operand: go(e.operand), items: e.items.map(go), negated: e.negated };
    }
  };
  return go(expr);
}

export function isAggregateCall(e: RExpr): boolean {
  return e.t === "fn" && AGGREGATE_FUNCTIONS.has(e.name);
}

export function childExprs(e: RExpr): RExpr[] {
  switch (e.t) {
    case "bin":
      return [e.left, e.right];
    case "un":
    case "isnull":
      return [e.operand];
    case "fn":
      return e.args;
    case "like":
      return [e.operand, e.pattern];
    case "between":
      return [e.operand, e.low, e.high];
    case "in":
      return [e.operand, ...e.items];
    default:
      return [];
  }
}

/** Rebuilds `e` with `f` applied to each direct child. */
export function mapChildren(e: RExpr, f: (c: RExpr) => RExpr): RExpr {
  switch (e.t) {
    case "bin":
      return { ...e, left: f(e.left), right: f(e.right) };
    case "un":
    case "isnull":
      return { ...e, operand: f(e.operand) };
    case "fn":
      return { ...e, args: e.args.map(f) };
    case "like":
      return { ...e, operand: f(e.operand), pattern: f(e.pattern) };
    case "between":
      return { ...e, operand: f(e.operand), low: f(e.low), high: f(e.high) };
    case "in":
      return { ...e, operand: f(e.operand), items: e.items.map(f) };
    default:
      return e;
  }
}

export function containsAggregate(e: RExpr): boolean {
  return isAggregateCall(e) || childExprs(e).some(containsAggregate);
}

export function collectColumns(e: RExpr, out: { table: string; name: string }[] = []): { table: string; name: string }[] {
  if (e.t === "col") out.push({ table: e.table, name: e.name });
  for (const c of childExprs(e)) collectColumns(c, out);
  return out;
}

/** Table aliases referenced by the expression. */
export function aliasesOf(e: RExpr): Set<string> {
  return new Set(collectColumns(e).map((c) => c.table));
}

export function exprEquals(a: RExpr, b: RExpr): boolean {
  return exprKey(a) === exprKey(b);
}

/** Canonical structural key (case-insensitive for identifiers). */
export function exprKey(e: RExpr): string {
  return JSON.stringify(e, (k, v) => (k === "table" || k === "name" ? (typeof v === "string" ? v.toLowerCase() : v) : v));
}

/** Splits an expression into its top-level AND conjuncts. */
export function splitConjuncts(e: RExpr): RExpr[] {
  if (e.t === "bin" && e.op === "AND") return [...splitConjuncts(e.left), ...splitConjuncts(e.right)];
  return [e];
}

export function conjoin(parts: RExpr[]): RExpr {
  if (parts.length === 0) return TRUE_EXPR;
  return parts.reduce((acc, p) => ({ t: "bin", op: "AND", left: acc, right: p }));
}

// ---- printing ----------------------------------------------------------------------

const PRECEDENCE: Record<string, number> = {
  OR: 1,
  AND: 2,
  NOT: 3,
  "=": 4,
  "<>": 4,
  "!=": 4,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  IS: 4,
  LIKE: 4,
  BETWEEN: 4,
  IN: 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  UNARY: 7,
};

function precedenceOf(e: RExpr): number {
  switch (e.t) {
    case "bin":
      return PRECEDENCE[e.op] ?? 0;
    case "un":
      return e.op === "NOT" ? PRECEDENCE.NOT! : PRECEDENCE.UNARY!;
    case "isnull":
    case "like":
    case "between":
    case "in":
      return PRECEDENCE.IS!;
    default:
      return 100;
  }
}

export interface PrintOptions {
  /** Prefix column names with their table alias. */
  qualify: boolean;
  /** Replace literals by a callback (used by the code generator to emit bound parameters). */
  literal?: (e: Extract<RExpr, { t: "num" | "str" | "null" }>) => string | undefined;
  /** Renders identifiers (quoting when required). */
  ident?: (name: string) => string;
}

export function formatNumber(value: number, isInt: boolean): string {
  if (isInt) return String(value);
  const s = String(value);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

export function printExpr(e: RExpr, opts: PrintOptions): string {
  const ident = opts.ident ?? ((n: string) => n);
  const wrap = (child: RExpr, minPrec: number): string => {
    const text = printExpr(child, opts);
    return precedenceOf(child) < minPrec ? `(${text})` : text;
  };
  switch (e.t) {
    case "num": {
      const custom = opts.literal?.(e);
      return custom ?? formatNumber(e.value, e.isInt);
    }
    case "str": {
      const custom = opts.literal?.(e);
      return custom ?? `'${e.value.replace(/'/g, "''")}'`;
    }
    case "null": {
      const custom = opts.literal?.(e);
      return custom ?? "NULL";
    }
    case "bool":
      return e.value ? "TRUE" : "FALSE";
    case "col":
      return opts.qualify ? `${ident(e.table)}.${ident(e.name)}` : ident(e.name);
    case "bin": {
      const p = PRECEDENCE[e.op] ?? 0;
      // Left-associative: the right operand needs parentheses at equal precedence.
      const isComparison = p === 4;
      const left = wrap(e.left, isComparison ? p + 1 : p);
      const right = wrap(e.right, p + 1);
      return `${left} ${e.op} ${right}`;
    }
    case "un": {
      if (e.op === "NOT") return `NOT ${wrap(e.operand, PRECEDENCE.NOT!)}`;
      // "--" would start a comment, so a sign directly followed by another sign gets parentheses.
      const inner = wrap(e.operand, PRECEDENCE.UNARY!);
      return /^[-+]/.test(inner) ? `${e.op}(${inner})` : `${e.op}${inner}`;
    }
    case "fn": {
      if (e.star) return `${e.name}(*)`;
      const args = e.args.map((a) => printExpr(a, opts)).join(", ");
      return `${e.name}(${e.distinct ? "DISTINCT " : ""}${args})`;
    }
    case "isnull":
      return `${wrap(e.operand, 5)} IS ${e.negated ? "NOT " : ""}NULL`;
    case "like":
      return `${wrap(e.operand, 5)} ${e.negated ? "NOT " : ""}LIKE ${wrap(e.pattern, 5)}`;
    case "between":
      return `${wrap(e.operand, 5)} ${e.negated ? "NOT " : ""}BETWEEN ${wrap(e.low, 5)} AND ${wrap(e.high, 5)}`;
    case "in":
      return `${wrap(e.operand, 5)} ${e.negated ? "NOT " : ""}IN (${e.items.map((i) => printExpr(i, opts)).join(", ")})`;
  }
}
