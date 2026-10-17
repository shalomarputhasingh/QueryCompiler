import { KEYWORDS } from "./tokens";
import {
  type ProjectedColumn,
  type RaNode,
  raChildren,
} from "./relational-algebra";
import { type RExpr, conjoin, printExpr } from "./rexpr";

/** A value bound to a `?` placeholder, in a JSON-safe form (BigInt cannot be serialised). */
export type SqlParam = { type: "integer"; value: string } | { type: "real"; value: number } | { type: "text"; value: string };

/** Converts to what the SQLite driver expects. Integers are BigInt so SQLite keeps INTEGER semantics (7/2 = 3). */
export function toBindValue(p: SqlParam): bigint | number | string {
  return p.type === "integer" ? BigInt(p.value) : p.value;
}

export interface GeneratedSql {
  /** Parameterised statement: every numeric/string literal is a `?` placeholder. */
  sql: string;
  params: SqlParam[];
  /** The same statement with literals inlined, for display. */
  displaySql: string;
}

const SQLITE_EXTRA_RESERVED = new Set(["INDEX", "KEY", "PRIMARY", "REFERENCES", "DEFAULT", "CHECK", "UNIQUE", "FOREIGN", "CONSTRAINT", "TO", "FOR", "IF", "NO", "ROW", "ROWS", "OF", "RANGE", "TEMP", "VIEW", "TRIGGER", "EACH", "AFTER", "BEFORE", "ACTION"]);

export function quoteIdent(name: string): string {
  const plain = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !KEYWORDS.has(name.toUpperCase()) && !SQLITE_EXTRA_RESERVED.has(name.toUpperCase());
  return plain ? name : `"${name.replace(/"/g, '""')}"`;
}

interface Emitter {
  params: SqlParam[] | null;
  expr(e: RExpr): string;
  literalCount(n: number): string;
}

function makeEmitter(parameterize: boolean): Emitter {
  const params: SqlParam[] | null = parameterize ? [] : null;
  const expr = (e: RExpr): string =>
    printExpr(e, {
      qualify: true,
      ident: quoteIdent,
      literal: (lit) => {
        if (!params) return undefined;
        if (lit.t === "num") {
          params.push(lit.isInt ? { type: "integer", value: String(lit.value) } : { type: "real", value: lit.value });
          return "?";
        }
        if (lit.t === "str") {
          params.push({ type: "text", value: lit.value });
          return "?";
        }
        return undefined; // NULL stays a keyword
      },
    });
  return {
    params,
    expr,
    literalCount(n: number) {
      if (!params) return String(n);
      params.push({ type: "integer", value: String(n) });
      return "?";
    },
  };
}

function scanSql(n: Extract<RaNode, { op: "scan" }>): string {
  return n.alias.toLowerCase() === n.table.toLowerCase() && n.alias === n.table ? quoteIdent(n.table) : `${quoteIdent(n.table)} AS ${quoteIdent(n.alias)}`;
}

function projectionSql(c: ProjectedColumn, em: Emitter): string {
  const text = em.expr(c.expr);
  return c.expr.t === "col" && c.expr.name === c.name ? text : `${text} AS ${quoteIdent(c.name)}`;
}

function peelSelects(node: RaNode): { preds: RExpr[]; base: RaNode } {
  const preds: RExpr[] = [];
  let n = node;
  while (n.op === "select") {
    preds.unshift(n.predicate);
    n = n.input;
  }
  return { preds, base: n };
}

/** FROM-clause item for an SPJ subtree (scans, selections and inner joins, plus pruning projections). */
function fromItem(node: RaNode, em: Emitter, nested: boolean): string {
  if (node.op === "scan") return scanSql(node);

  if (node.op === "project" || node.op === "select") {
    const project = node.op === "project" ? node : null;
    const { preds, base } = peelSelects(project ? project.input : node);
    if (base.op === "scan") {
      const cols = project ? project.columns.map((c) => projectionSql(c, em)).join(", ") : "*";
      const where = preds.length > 0 ? ` WHERE ${em.expr(conjoin(preds))}` : "";
      return `(SELECT ${cols} FROM ${scanSql(base)}${where}) AS ${quoteIdent(base.alias)}`;
    }
    if (base.op === "join" && !project) {
      // A filter over an inner join is equivalent to extra ON conjuncts.
      return joinSql({ ...base, condition: conjoin([base.condition, ...preds]) }, em, nested);
    }
    throw new Error(`Cannot generate SQL for ${node.op} over ${base.op}`);
  }

  if (node.op === "join") return joinSql(node, em, nested);
  throw new Error(`Unexpected ${node.op} inside a join tree`);
}

function joinSql(node: Extract<RaNode, { op: "join" }>, em: Emitter, nested: boolean): string {
  const left = fromItem(node.left, em, false);
  const right = fromItem(node.right, em, true);
  const sql = `${left} INNER JOIN ${right} ON ${em.expr(node.condition)}`;
  return nested ? `(${sql})` : sql;
}

function buildSelect(plan: RaNode, em: Emitter): string {
  let n = plan;
  let limit: Extract<RaNode, { op: "limit" }> | null = null;
  let distinct = false;
  let project: Extract<RaNode, { op: "project" }> | null = null;
  let sort: Extract<RaNode, { op: "sort" }> | null = null;
  let agg: Extract<RaNode, { op: "aggregate" }> | null = null;
  let having: RExpr[] = [];

  if (n.op === "limit") {
    limit = n;
    n = n.input;
  }
  if (n.op === "distinct") {
    distinct = true;
    n = n.input;
  }
  if (n.op === "project") {
    project = n;
    n = n.input;
  }
  if (n.op === "sort") {
    sort = n;
    n = n.input;
  }
  const { preds, base } = peelSelects(n);
  let where: RExpr[];
  let source: RaNode;
  if (base.op === "aggregate") {
    agg = base;
    having = preds;
    const inner = peelSelects(base.input);
    where = inner.preds;
    source = inner.base;
  } else {
    where = preds;
    source = base;
  }

  // Emit in textual order so bound parameters line up with the placeholders.
  const selectList = project ? project.columns.map((c) => projectionSql(c, em)).join(", ") : "*";
  const from = fromItem(source, em, false);
  const lines = [`SELECT ${distinct ? "DISTINCT " : ""}${selectList}`, `FROM ${from}`];
  if (where.length > 0) lines.push(`WHERE ${em.expr(conjoin(where))}`);
  if (agg && agg.groupBy.length > 0) lines.push(`GROUP BY ${agg.groupBy.map((g) => em.expr(g)).join(", ")}`);
  if (having.length > 0) lines.push(`HAVING ${em.expr(conjoin(having))}`);
  if (sort) lines.push(`ORDER BY ${sort.keys.map((k) => `${em.expr(k.expr)} ${k.direction}`).join(", ")}`);
  if (limit) {
    lines.push(`LIMIT ${em.literalCount(limit.count)}`);
    if (limit.offset !== null) lines.push(`OFFSET ${em.literalCount(limit.offset)}`);
  }
  return lines.join("\n");
}

/** Generates a (parameterised) SQLite SELECT from a relational algebra plan. */
export function generateSql(plan: RaNode): GeneratedSql {
  const bound = makeEmitter(true);
  const sql = buildSelect(plan, bound);
  const inline = makeEmitter(false);
  const displaySql = buildSelect(plan, inline);
  return { sql, params: bound.params ?? [], displaySql };
}

// ---- educational instruction format ---------------------------------------------------------

export interface PlanInstruction {
  target: string;
  opcode: "SCAN" | "FILTER" | "PROJECT" | "JOIN" | "GROUP" | "SORT" | "DISTINCT" | "LIMIT";
  text: string;
}

/**
 * Linearises a plan into numbered instructions (post-order, one temporary per operator). This is a
 * documented teaching format, not executable machine code.
 */
export function generateInstructions(plan: RaNode): { instructions: PlanInstruction[]; result: string } {
  const instructions: PlanInstruction[] = [];
  const ex = (e: RExpr): string => printExpr(e, { qualify: true });
  let counter = 0;
  const emit = (opcode: PlanInstruction["opcode"], body: (t: string) => string): string => {
    const target = `T${++counter}`;
    instructions.push({ target, opcode, text: `${target} := ${body(target)}` });
    return target;
  };
  const go = (n: RaNode): string => {
    const inputs = raChildren(n).map(go);
    switch (n.op) {
      case "scan":
        return emit("SCAN", () => `SCAN ${n.table}${n.alias !== n.table ? ` AS ${n.alias}` : ""}`);
      case "select":
        return emit("FILTER", () => `FILTER ${inputs[0]} WHERE ${ex(n.predicate)}`);
      case "project":
        return emit("PROJECT", () => `PROJECT ${inputs[0]} [${n.columns.map((c) => ex(c.expr) + (c.expr.t === "col" && c.expr.name === c.name ? "" : ` AS ${c.name}`)).join(", ")}]`);
      case "join":
        return emit("JOIN", () => `JOIN ${inputs[0]}, ${inputs[1]} ON ${ex(n.condition)}`);
      case "aggregate":
        return emit("GROUP", () => `GROUP ${inputs[0]} BY [${n.groupBy.map(ex).join(", ")}] COMPUTE [${n.aggregates.map(ex).join(", ")}]`);
      case "sort":
        return emit("SORT", () => `SORT ${inputs[0]} BY [${n.keys.map((k) => `${ex(k.expr)} ${k.direction}`).join(", ")}]`);
      case "distinct":
        return emit("DISTINCT", () => `DISTINCT ${inputs[0]}`);
      case "limit":
        return emit("LIMIT", () => `LIMIT ${inputs[0]} COUNT ${n.count}${n.offset !== null ? ` OFFSET ${n.offset}` : ""}`);
    }
  };
  const result = go(plan);
  return { instructions, result };
}
