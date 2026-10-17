import { type Expr, type SelectStatement } from "./ast";
import { describeRaNode, raChildren, type RaNode, shouldQualify } from "./relational-algebra";
import type { CompileResult, PhaseId } from "./pipeline";
import type { Token } from "./tokens";

export interface LearningSection {
  id: "query" | PhaseId;
  title: string;
  status: "ok" | "error" | "skipped";
  summary: string;
  points: string[];
}

function snippet(source: string, node: { range: { start: { offset: number }; end: { offset: number } } }): string {
  return source.slice(node.range.start.offset, node.range.end.offset).replace(/\s+/g, " ").trim();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function flatten(e: Expr, op: "AND" | "OR"): Expr[] {
  return e.kind === "BinaryExpr" && e.operator === op ? [...flatten(e.left, op), ...flatten(e.right, op)] : [e];
}

function containsOp(e: Expr, op: string): boolean {
  if (e.kind === "BinaryExpr") return e.operator === op || containsOp(e.left, op) || containsOp(e.right, op);
  if (e.kind === "UnaryExpr") return containsOp(e.operand, op);
  return false;
}

/** Plain-English description of what the statement does, derived from the AST. */
export function describeQuery(ast: SelectStatement, source: string): string[] {
  const lines: string[] = [];
  const star = ast.items.find((i) => i.kind === "StarItem");
  const cols = ast.items.map((i) => (i.kind === "StarItem" ? (i.table ? `all columns of ${i.table}` : "all columns") : snippet(source, i)));
  lines.push(`Reads rows from the ${ast.from.name} table${ast.from.alias ? ` (alias ${ast.from.alias})` : ""}.`);
  for (const j of ast.joins) {
    lines.push(`Joins ${j.table.name}${j.table.alias ? ` (alias ${j.table.alias})` : ""} to the rows read so far wherever ${snippet(source, j.on)}.`);
  }
  if (ast.where) lines.push(`Keeps only the rows where ${snippet(source, ast.where)}.`);
  if (ast.groupBy.length > 0) lines.push(`Groups the rows by ${ast.groupBy.map((g) => snippet(source, g)).join(", ")}.`);
  if (ast.having) lines.push(`Keeps only the groups where ${snippet(source, ast.having)}.`);
  lines.push(`Returns ${star && ast.items.length === 1 ? cols[0] : cols.join(", ")}${ast.distinct ? ", removing duplicate rows" : ""}.`);
  if (ast.orderBy.length > 0) lines.push(`Sorts the result by ${ast.orderBy.map((o) => `${snippet(source, o.expr)} ${o.direction === "DESC" ? "descending" : "ascending"}`).join(", ")}.`);
  if (ast.limit !== null) lines.push(`Returns at most ${plural(ast.limit, "row")}${ast.offset ? `, after skipping the first ${ast.offset}` : ""}.`);
  return lines;
}

function describePredicate(label: string, e: Expr, source: string): string[] {
  const out: string[] = [];
  if (e.kind === "BinaryExpr" && (e.operator === "AND" || e.operator === "OR")) {
    const parts = flatten(e, e.operator);
    out.push(`${label}: the root of the tree is ${e.operator}, combining ${plural(parts.length, "condition")}: ${parts.map((p) => `[${snippet(source, p)}]`).join(` ${e.operator} `)}.`);
  } else {
    out.push(`${label}: a single ${e.kind === "BinaryExpr" ? `'${e.operator}' comparison/expression` : e.kind.replace(/Expr$/, "").toLowerCase()} — ${snippet(source, e)}.`);
  }
  if (containsOp(e, "AND") && containsOp(e, "OR")) {
    out.push(
      `${label} mixes AND and OR. AND binds tighter than OR, so the parser groups AND operands first${source.slice(e.range.start.offset, e.range.end.offset).includes("(") ? "; the parentheses override this default where they appear" : ""}.`,
    );
  }
  return out;
}

function algebraPoints(plan: RaNode): string[] {
  const qualify = shouldQualify(plan);
  const lines: string[] = [];
  const visit = (n: RaNode): void => {
    raChildren(n).forEach(visit);
    const info = describeRaNode(n, qualify);
    lines.push(`${info.symbol} ${info.name}: ${info.description}`);
  };
  visit(plan);
  return lines;
}

/** Deterministic, compiler-output-based explanation of every phase. No AI involved. */
export function explainCompilation(result: CompileResult): LearningSection[] {
  const sections: LearningSection[] = [];
  const source = result.source;
  const phase = (id: PhaseId) => result.phases.find((p) => p.id === id)?.status ?? "skipped";
  const toStatus = (s: string): LearningSection["status"] => (s === "success" ? "ok" : s === "error" ? "error" : "skipped");
  const failedText = (id: PhaseId): string[] =>
    result.diagnostics.filter((d) => d.phase === id && d.severity === "error").map((d) => `Line ${d.range.start.line}, column ${d.range.start.column}: ${d.message}`);

  // What the query does
  if (result.ast) {
    sections.push({ id: "query", title: "What the query does", status: "ok", summary: "Read from the parsed syntax tree, not from the raw text.", points: describeQuery(result.ast, source) });
  } else {
    sections.push({
      id: "query",
      title: "What the query does",
      status: "skipped",
      summary: "The query could not be parsed, so there is no syntax tree to describe yet.",
      points: [],
    });
  }

  // Lexer
  const significant = result.tokens.filter((t: Token) => t.type !== "EOF");
  const byType = new Map<string, string[]>();
  for (const t of significant) byType.set(t.type, [...(byType.get(t.type) ?? []), t.lexeme]);
  const lexPoints = [...byType.entries()].map(([type, lexemes]) => {
    const unique = [...new Set(lexemes)];
    return `${plural(lexemes.length, type.toLowerCase().replace("_", " "))}: ${unique.slice(0, 6).join(" ")}${unique.length > 6 ? " …" : ""}`;
  });
  if (result.comments.length > 0) lexPoints.push(`${plural(result.comments.length, "comment")} skipped (comments never reach the parser).`);
  lexPoints.push(...failedText("lexical"));
  sections.push({
    id: "lexical",
    title: "Lexical analysis (lexer)",
    status: toStatus(phase("lexical")),
    summary: `The lexer scanned the text left to right and produced ${plural(significant.length, "token")}; whitespace was discarded but line/column positions were kept.`,
    points: lexPoints,
  });

  // Parser
  const synPoints: string[] = [];
  if (result.ast) {
    const a = result.ast;
    const clauses = ["SELECT", "FROM", ...a.joins.map(() => "INNER JOIN"), ...(a.where ? ["WHERE"] : []), ...(a.groupBy.length ? ["GROUP BY"] : []), ...(a.having ? ["HAVING"] : []), ...(a.orderBy.length ? ["ORDER BY"] : []), ...(a.limit !== null ? ["LIMIT"] : [])];
    synPoints.push(`Clauses recognised, in grammar order: ${clauses.join(" → ")}.`);
    if (a.where) synPoints.push(...describePredicate("WHERE", a.where, source));
    if (a.having) synPoints.push(...describePredicate("HAVING", a.having, source));
    a.joins.forEach((j) => synPoints.push(...describePredicate(`ON (${j.table.name})`, j.on, source)));
    synPoints.push("Every node of the tree carries its source range, which is how errors and the editor highlights find their position.");
  } else {
    synPoints.push(...failedText("syntax"));
  }
  sections.push({
    id: "syntax",
    title: "Syntax analysis (parser)",
    status: toStatus(phase("syntax")),
    summary: "A recursive-descent parser with a precedence-climbing (Pratt) expression parser turned the tokens into an abstract syntax tree.",
    points: synPoints,
  });

  // Semantic
  const semPoints: string[] = [];
  if (result.semantic) {
    const s = result.semantic;
    semPoints.push(`Table check: ${s.scope.map((t) => (t.name === t.tableName ? t.tableName : `${t.tableName} AS ${t.name}`)).join(", ")} exist in the sample database schema.`);
    const refs = result.symbolTable.filter((e) => e.kind === "reference");
    semPoints.push(`Column check: ${plural(refs.length, "column reference")} resolved to real columns${refs.length ? ` (${[...new Set(refs.map((r) => `${r.name}:${r.dataType}`))].slice(0, 6).join(", ")})` : ""}.`);
    semPoints.push("Type check: comparison operands must be both numeric or both text; AND/OR/NOT operands and WHERE/HAVING/ON conditions must be boolean.");
    if (s.isAggregateQuery) semPoints.push("Grouping check: every selected column must be grouped or aggregated, and aggregates are not allowed in WHERE.");
    semPoints.push(`Output columns: ${s.outputColumns.map((c) => `${c.name} (${c.dataType})`).join(", ")}.`);
    for (const d of result.diagnostics.filter((d) => d.phase === "semantic")) {
      semPoints.push(`${d.severity === "error" ? "Error" : "Warning"} at line ${d.range.start.line}, column ${d.range.start.column}: ${d.message}`);
    }
  }
  sections.push({
    id: "semantic",
    title: "Semantic analysis",
    status: toStatus(phase("semantic")),
    summary: "The analyzer checked the tree against the real database schema using a symbol table.",
    points: semPoints,
  });

  // Relational algebra
  sections.push({
    id: "translation",
    title: "Relational algebra",
    status: toStatus(phase("translation")),
    summary: result.algebra ? `The validated tree became the operator tree ${result.algebra.text}. Data flows from the leaves (scans) up to the root.` : "Relational algebra is produced only for queries that pass semantic analysis.",
    points: result.algebra ? algebraPoints(result.algebra.plan) : [],
  });

  // Optimization
  const optPoints: string[] = [];
  if (result.optimization) {
    const o = result.optimization;
    if (o.steps.length === 0) optPoints.push("No rewrite rule applied: the plan was already in its simplest form for the supported rules.");
    for (const s of o.steps) optPoints.push(`Step ${s.index} — ${s.ruleName}: ${s.explanation.replace(/`/g, "")}`);
    for (const s of o.skipped) optPoints.push(`Not applied — ${s.ruleName}: ${s.reason.replace(/`/g, "")}`);
    if (o.steps.length > 0) optPoints.push(`Result: ${o.optimized.text}`);
  }
  sections.push({
    id: "optimization",
    title: "Optimization",
    status: toStatus(phase("optimization")),
    summary: "A deterministic rule engine rewrites the algebra, applying only transformations that are provably equivalent. Fewer or smaller operators are not a performance measurement.",
    points: optPoints,
  });

  return sections;
}
