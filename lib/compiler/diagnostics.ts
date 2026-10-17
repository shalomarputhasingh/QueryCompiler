/** Source positions are 1-based; `end` is exclusive (the position just after the last character). */
export interface Position {
  line: number;
  column: number;
  offset: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export type Severity = "error" | "warning" | "info";
export type CompilerPhase = "lexical" | "syntax" | "semantic" | "translation" | "optimization" | "codegen";

export interface Diagnostic {
  severity: Severity;
  phase: CompilerPhase;
  /** Stable machine-readable code, e.g. QC2001. */
  code: string;
  message: string;
  range: Range;
  hint?: string;
}

export function makeDiagnostic(
  severity: Severity,
  phase: CompilerPhase,
  code: string,
  message: string,
  range: Range,
  hint?: string,
): Diagnostic {
  return hint === undefined ? { severity, phase, code, message, range } : { severity, phase, code, message, range, hint };
}

export function formatLocation(range: Range): string {
  return `${range.start.line}:${range.start.column}`;
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.severity} ${d.code} at ${formatLocation(d.range)}: ${d.message}`;
}

export function mergeRanges(a: Range, b: Range): Range {
  return { start: a.start, end: b.end };
}

export function errorCount(diags: readonly Diagnostic[]): number {
  return diags.filter((d) => d.severity === "error").length;
}

/** Levenshtein distance, used for "did you mean ...?" hints. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[n] ?? 0;
}

export function suggestName(name: string, candidates: readonly string[]): string | undefined {
  const lower = name.toLowerCase();
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const d = editDistance(lower, c.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  const threshold = Math.max(1, Math.floor(lower.length / 3));
  return best !== undefined && bestDistance <= threshold ? best : undefined;
}
