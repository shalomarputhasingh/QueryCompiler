import type { CompileResult } from "@/lib/compiler/pipeline";

export interface ExecutionSummary {
  columns: string[];
  rows: (string | number | null)[][];
  rowCount: number;
  truncated: boolean;
}

const MAX_CONTEXT_CHARS = 9_000;
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Compact text rendering of the real compiler output, handed to the model so Quera's answers are
 * grounded in what the compiler actually produced for the student's query.
 */
export function buildQueraContext(result: CompileResult, execution?: ExecutionSummary | null): string {
  const out: string[] = [];
  out.push(`QUERY:\n${clip(result.source.trim() || "(empty)", 1500)}`);
  out.push(
    result.success
      ? `STATUS: compiled successfully (${result.stats.tokenCount} tokens, ${result.stats.warningCount} warnings, ${result.stats.rulesApplied} optimizer rules applied)`
      : `STATUS: FAILED during ${result.failedPhase} (${result.stats.errorCount} errors); later phases did not run`,
  );

  if (result.diagnostics.length > 0) {
    out.push(
      "DIAGNOSTICS:\n" +
        result.diagnostics
          .slice(0, 8)
          .map((d) => `- [${d.severity} ${d.code} ${d.phase}] line ${d.range.start.line}, col ${d.range.start.column}: ${d.message}${d.hint ? ` (hint: ${d.hint})` : ""}`)
          .join("\n"),
    );
  }

  const tokens = result.tokens.filter((t) => t.type !== "EOF");
  if (tokens.length > 0) out.push(`TOKENS (${tokens.length}): ${tokens.slice(0, 45).map((t) => `${t.lexeme}:${t.type}`).join(" ")}${tokens.length > 45 ? " …" : ""}`);

  if (result.astText) out.push(`SYNTAX TREE:\n${clip(result.astText.split("\n").slice(0, 45).join("\n"), 2200)}`);

  if (result.semantic) {
    const s = result.semantic;
    out.push(
      `SEMANTIC: tables in scope = ${s.scope.map((t) => (t.name === t.tableName ? t.name : `${t.tableName} AS ${t.name}`)).join(", ")}; output columns = ${s.outputColumns.map((c) => `${c.name}:${c.dataType}`).join(", ")}; aggregate query = ${s.isAggregateQuery}`,
    );
  }

  if (result.optimization) {
    const o = result.optimization;
    out.push(`RELATIONAL ALGEBRA (original): ${clip(o.original.text, 700)}`);
    out.push(`RELATIONAL ALGEBRA (optimized): ${clip(o.optimized.text, 700)}`);
    out.push(
      o.steps.length === 0
        ? "OPTIMIZER: no rule applied (plan already minimal)."
        : "OPTIMIZER STEPS:\n" + o.steps.slice(0, 8).map((s) => `${s.index}. ${s.ruleName}: ${s.explanation.replace(/`/g, "")}`).join("\n"),
    );
    if (o.skipped.length > 0) out.push("RULES CONSIDERED BUT NOT APPLIED:\n" + o.skipped.slice(0, 5).map((s) => `- ${s.ruleName}: ${s.reason.replace(/`/g, "")}`).join("\n"));
  } else if (result.algebra) {
    out.push(`RELATIONAL ALGEBRA: ${clip(result.algebra.text, 700)}`);
  }

  if (result.codegen) out.push(`GENERATED SQL (optimized plan):\n${clip(result.codegen.optimized.displaySql, 900)}`);

  if (execution) {
    const rows = execution.rows.slice(0, 8).map((r) => r.map((v) => (v === null ? "NULL" : String(v))).join(" | "));
    out.push(`EXECUTION RESULT: ${execution.rowCount} rows${execution.truncated ? " (truncated)" : ""}\ncolumns: ${execution.columns.join(" | ")}\n${rows.join("\n")}${execution.rowCount > 8 ? "\n…" : ""}`);
  }

  return clip(out.join("\n\n"), MAX_CONTEXT_CHARS);
}
