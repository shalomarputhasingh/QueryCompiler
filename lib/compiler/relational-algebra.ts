import type { SelectStatement } from "./ast";
import type { SemanticResult } from "./semantic-analyzer";
import {
  type RExpr,
  type ResolvedColumn,
  childExprs,
  exprEquals,
  isAggregateCall,
  printExpr,
  toRExpr,
} from "./rexpr";

export interface ProjectedColumn {
  expr: RExpr;
  name: string;
}
export interface SortKey {
  expr: RExpr;
  direction: "ASC" | "DESC";
}

export type RaNode =
  | { op: "scan"; table: string; alias: string }
  | { op: "select"; predicate: RExpr; input: RaNode }
  | { op: "project"; columns: ProjectedColumn[]; input: RaNode }
  | { op: "join"; joinType: "inner"; condition: RExpr; left: RaNode; right: RaNode }
  | { op: "aggregate"; groupBy: RExpr[]; aggregates: RExpr[]; input: RaNode }
  | { op: "sort"; keys: SortKey[]; input: RaNode }
  | { op: "distinct"; input: RaNode }
  | { op: "limit"; count: number; offset: number | null; input: RaNode };

export function raChildren(node: RaNode): RaNode[] {
  switch (node.op) {
    case "scan":
      return [];
    case "join":
      return [node.left, node.right];
    default:
      return [node.input];
  }
}

export function mapRaChildren(node: RaNode, f: (c: RaNode) => RaNode): RaNode {
  switch (node.op) {
    case "scan":
      return node;
    case "join":
      return { ...node, left: f(node.left), right: f(node.right) };
    default:
      return { ...node, input: f(node.input) } as RaNode;
  }
}

/** Scan nodes in left-to-right order. */
export function scansOf(node: RaNode): Extract<RaNode, { op: "scan" }>[] {
  if (node.op === "scan") return [node];
  return raChildren(node).flatMap(scansOf);
}

export function raEquals(a: RaNode, b: RaNode): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- translation --------------------------------------------------------------------

/** Translates a semantically valid AST into relational algebra. Never inspects the SQL text. */
export function translateToAlgebra(stmt: SelectStatement, sem: SemanticResult): RaNode {
  const resolve = (id: number): ResolvedColumn | undefined => sem.resolutions[id];
  const conv = (e: Parameters<typeof toRExpr>[0]): RExpr => toRExpr(e, resolve);

  let plan: RaNode = { op: "scan", table: sem.scope[0]!.tableName, alias: sem.scope[0]!.name };
  stmt.joins.forEach((j, i) => {
    const entry = sem.scope[i + 1]!;
    plan = {
      op: "join",
      joinType: "inner",
      condition: conv(j.on),
      left: plan,
      right: { op: "scan", table: entry.tableName, alias: entry.name },
    };
  });

  if (stmt.where) plan = { op: "select", predicate: conv(stmt.where), input: plan };

  const outputs = sem.outputColumns;
  const sortKeys: SortKey[] = stmt.orderBy.map((o) => ({
    expr: o.expr.kind === "ColumnRef" && o.expr.id in sem.aliasReferences ? outputs[sem.aliasReferences[o.expr.id]!]!.expr : conv(o.expr),
    direction: o.direction,
  }));
  const having = stmt.having ? conv(stmt.having) : null;

  if (sem.isAggregateQuery) {
    const aggregates: RExpr[] = [];
    const collect = (e: RExpr): void => {
      if (isAggregateCall(e)) {
        if (!aggregates.some((a) => exprEquals(a, e))) aggregates.push(e);
        return;
      }
      childExprs(e).forEach(collect);
    };
    outputs.forEach((o) => collect(o.expr));
    if (having) collect(having);
    sortKeys.forEach((k) => collect(k.expr));
    plan = { op: "aggregate", groupBy: stmt.groupBy.map(conv), aggregates, input: plan };
    if (having) plan = { op: "select", predicate: having, input: plan };
  }

  if (sortKeys.length > 0) plan = { op: "sort", keys: sortKeys, input: plan };
  plan = { op: "project", columns: outputs.map((o) => ({ expr: o.expr, name: o.name })), input: plan };
  if (stmt.distinct) plan = { op: "distinct", input: plan };
  if (stmt.limit !== null) plan = { op: "limit", count: stmt.limit, offset: stmt.offset, input: plan };
  return plan;
}

// ---- printing -----------------------------------------------------------------------

export function shouldQualify(plan: RaNode): boolean {
  return scansOf(plan).length > 1;
}

function exprText(e: RExpr, qualify: boolean): string {
  return printExpr(e, { qualify });
}

function projectionText(col: ProjectedColumn, qualify: boolean): string {
  const text = exprText(col.expr, qualify);
  const plain = col.expr.t === "col" ? col.expr.name : text;
  return col.name === plain || col.name === text ? text : `${text} AS ${col.name}`;
}

function scanText(n: Extract<RaNode, { op: "scan" }>): string {
  return n.alias.toLowerCase() === n.table.toLowerCase() ? n.table : `${n.table} AS ${n.alias}`;
}

/** Operator symbol and parameter text of one node (without its inputs). */
export function raNodeParts(node: RaNode, qualify: boolean): { symbol: string; param: string } {
  switch (node.op) {
    case "scan":
      return { symbol: "", param: scanText(node) };
    case "select":
      return { symbol: "σ", param: exprText(node.predicate, qualify) };
    case "project":
      return { symbol: "π", param: node.columns.map((c) => projectionText(c, qualify)).join(", ") };
    case "join":
      return { symbol: "⋈", param: exprText(node.condition, qualify) };
    case "aggregate":
      return {
        symbol: "γ",
        param: `${node.groupBy.map((g) => exprText(g, qualify)).join(", ")}; ${node.aggregates.map((a) => exprText(a, qualify)).join(", ")}`,
      };
    case "sort":
      return { symbol: "τ", param: node.keys.map((k) => `${exprText(k.expr, qualify)} ${k.direction}`).join(", ") };
    case "distinct":
      return { symbol: "δ", param: "" };
    case "limit":
      return { symbol: "λ", param: node.offset !== null ? `${node.count}, offset ${node.offset}` : String(node.count) };
  }
}

/** Single-line relational algebra, e.g. π_{name}(σ_{marks > 80}(students)). */
export function raToText(node: RaNode, qualify: boolean = shouldQualify(node)): string {
  const go = (n: RaNode): string => {
    if (n.op === "scan") return scanText(n);
    if (n.op === "join") return `(${go(n.left)} ⋈_{${exprText(n.condition, qualify)}} ${go(n.right)})`;
    const { symbol, param } = raNodeParts(n, qualify);
    const inner = go((n as Exclude<RaNode, { op: "scan" | "join" }>).input);
    return param === "" ? `${symbol}(${inner})` : `${symbol}_{${param}}(${inner})`;
  };
  return go(node);
}

/** Indented operator tree. */
export function raToTree(node: RaNode, qualify: boolean = shouldQualify(node)): string {
  const lines: string[] = [];
  const walk = (n: RaNode, prefix: string, isLast: boolean, isRoot: boolean): void => {
    const { symbol, param } = raNodeParts(n, qualify);
    const label = n.op === "scan" ? `scan ${param}` : `${symbol} ${param}`.trimEnd();
    lines.push(`${prefix}${isRoot ? "" : isLast ? "└─ " : "├─ "}${label}`);
    const kids = raChildren(n);
    const childPrefix = isRoot ? "" : prefix + (isLast ? "   " : "│  ");
    kids.forEach((k, i) => walk(k, childPrefix, i === kids.length - 1, false));
  };
  walk(node, "", true, true);
  return lines.join("\n");
}

export interface RaNodeInfo {
  symbol: string;
  name: string;
  description: string;
}

/** Plain-language role of an operator, for tooltips and Learning Mode. */
export function describeRaNode(node: RaNode, qualify: boolean = true): RaNodeInfo {
  const { param } = raNodeParts(node, qualify);
  switch (node.op) {
    case "scan":
      return { symbol: "R", name: "Table scan", description: `Reads every row of table ${node.table}${node.alias !== node.table ? ` under the alias ${node.alias}` : ""}.` };
    case "select":
      return { symbol: "σ", name: "Selection", description: `Keeps only the rows for which ${param} is TRUE (rows where it is FALSE or NULL are discarded).` };
    case "project":
      return { symbol: "π", name: "Projection", description: `Produces the output columns ${param}.` };
    case "join":
      return { symbol: "⋈", name: "Inner join", description: `Combines rows of the two inputs that satisfy ${param}.` };
    case "aggregate":
      return {
        symbol: "γ",
        name: "Aggregation",
        description:
          node.groupBy.length > 0
            ? `Groups rows by ${node.groupBy.map((g) => exprText(g, qualify)).join(", ")} and computes ${node.aggregates.map((a) => exprText(a, qualify)).join(", ") || "no aggregates"} per group.`
            : `Collapses all rows into a single row computing ${node.aggregates.map((a) => exprText(a, qualify)).join(", ")}.`,
      };
    case "sort":
      return { symbol: "τ", name: "Sort", description: `Orders rows by ${param}.` };
    case "distinct":
      return { symbol: "δ", name: "Duplicate elimination", description: "Removes duplicate rows from the input." };
    case "limit":
      return { symbol: "λ", name: "Limit", description: node.offset !== null ? `Skips ${node.offset} rows, then returns at most ${node.count}.` : `Returns at most ${node.count} rows.` };
  }
}
