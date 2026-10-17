import type { SelectStatement } from "./ast";
import { printAst } from "./ast";
import type { Catalog } from "./catalog";
import { type GeneratedSql, type PlanInstruction, generateInstructions, generateSql } from "./code-generator";
import { type CompilerPhase, type Diagnostic, type Range, errorCount, makeDiagnostic } from "./diagnostics";
import { lex } from "./lexer";
import { type OptimizationStep, type SkippedRule, optimize, OPTIMIZATION_RULES, type RuleInfo } from "./optimizer";
import { parse } from "./parser";
import { type RaNode, raToText, raToTree, shouldQualify, translateToAlgebra } from "./relational-algebra";
import { type OutputColumn, type ScopeEntry, analyzeSemantics } from "./semantic-analyzer";
import type { SymbolEntry, DataType } from "./symbol-table";
import type { Comment, Token } from "./tokens";
import type { ResolvedColumn } from "./rexpr";

export const MAX_SOURCE_LENGTH = 10_000;

export type PhaseId = "lexical" | "syntax" | "semantic" | "translation" | "optimization" | "codegen";
export type PhaseState = "success" | "error" | "skipped";

export interface PhaseStatus {
  id: PhaseId;
  label: string;
  status: PhaseState;
  diagnosticCount: number;
  durationMs: number;
}

export interface PlanView {
  plan: RaNode;
  text: string;
  tree: string;
}

export interface CompileResult {
  source: string;
  /** True when every phase finished without errors. */
  success: boolean;
  /** First phase that failed, or null. */
  failedPhase: PhaseId | null;
  tokens: Token[];
  comments: Comment[];
  ast: SelectStatement | null;
  astText: string | null;
  diagnostics: Diagnostic[];
  semantic: {
    ok: boolean;
    scope: ScopeEntry[];
    resolutions: Record<number, ResolvedColumn>;
    types: Record<number, DataType>;
    outputColumns: OutputColumn[];
    isAggregateQuery: boolean;
  } | null;
  symbolTable: SymbolEntry[];
  algebra: PlanView | null;
  optimization: {
    original: PlanView;
    optimized: PlanView;
    steps: OptimizationStep[];
    skipped: SkippedRule[];
    rules: RuleInfo[];
    passes: number;
  } | null;
  codegen: {
    original: GeneratedSql;
    optimized: GeneratedSql;
    originalInstructions: { instructions: PlanInstruction[]; result: string };
    optimizedInstructions: { instructions: PlanInstruction[]; result: string };
  } | null;
  phases: PhaseStatus[];
  stats: {
    tokenCount: number;
    diagnosticCount: number;
    errorCount: number;
    warningCount: number;
    semanticPassed: boolean;
    rulesApplied: number;
    totalMs: number;
  };
}

const PHASE_LABELS: Record<PhaseId, string> = {
  lexical: "Lexical analysis",
  syntax: "Syntax analysis",
  semantic: "Semantic analysis",
  translation: "Relational algebra",
  optimization: "Optimization",
  codegen: "Code generation",
};
const PHASE_ORDER: PhaseId[] = ["lexical", "syntax", "semantic", "translation", "optimization", "codegen"];

const ZERO_RANGE: Range = { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } };

function planView(plan: RaNode): PlanView {
  const qualify = shouldQualify(plan);
  return { plan, text: raToText(plan, qualify), tree: raToTree(plan, qualify) };
}

/** Runs the whole compiler pipeline. Deterministic apart from the measured durations. */
export function compile(source: string, catalog: Catalog): CompileResult {
  const started = performance.now();
  const timings: Partial<Record<PhaseId, number>> = {};
  const counts: Partial<Record<PhaseId, number>> = {};
  const diagnostics: Diagnostic[] = [];
  let failedPhase: PhaseId | null = null;

  const timed = <T>(phase: PhaseId, fn: () => T): T => {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      timings[phase] = performance.now() - t0;
    }
  };
  const collect = (phase: PhaseId, list: Diagnostic[]): boolean => {
    diagnostics.push(...list);
    counts[phase] = list.length;
    const failed = errorCount(list) > 0;
    if (failed && failedPhase === null) failedPhase = phase;
    return failed;
  };
  const internalError = (phase: CompilerPhase, e: unknown): Diagnostic =>
    makeDiagnostic("error", phase, "QC9000", `Internal compiler error: ${e instanceof Error ? e.message : "unknown failure"}`, ZERO_RANGE);

  const result: CompileResult = {
    source,
    success: false,
    failedPhase: null,
    tokens: [],
    comments: [],
    ast: null,
    astText: null,
    diagnostics,
    semantic: null,
    symbolTable: [],
    algebra: null,
    optimization: null,
    codegen: null,
    phases: [],
    stats: { tokenCount: 0, diagnosticCount: 0, errorCount: 0, warningCount: 0, semanticPassed: false, rulesApplied: 0, totalMs: 0 },
  };

  const finish = (): CompileResult => {
    result.failedPhase = failedPhase;
    result.success = failedPhase === null;
    result.phases = PHASE_ORDER.map((id) => {
      const ran = timings[id] !== undefined;
      return {
        id,
        label: PHASE_LABELS[id],
        status: !ran ? "skipped" : (counts[id] ?? 0) > 0 && diagnostics.some((d) => d.phase === id && d.severity === "error") ? "error" : "success",
        diagnosticCount: diagnostics.filter((d) => d.phase === id).length,
        durationMs: timings[id] ?? 0,
      } satisfies PhaseStatus;
    });
    result.stats = {
      tokenCount: result.tokens.filter((t) => t.type !== "EOF").length,
      diagnosticCount: diagnostics.length,
      errorCount: errorCount(diagnostics),
      warningCount: diagnostics.filter((d) => d.severity === "warning").length,
      semanticPassed: result.semantic?.ok ?? false,
      rulesApplied: result.optimization?.steps.length ?? 0,
      totalMs: performance.now() - started,
    };
    return result;
  };

  if (source.length > MAX_SOURCE_LENGTH) {
    timings.lexical = 0;
    collect("lexical", [
      makeDiagnostic("error", "lexical", "QC1010", `The query is too long (${source.length} characters; the limit is ${MAX_SOURCE_LENGTH})`, ZERO_RANGE),
    ]);
    return finish();
  }

  // 1. Lexical analysis
  const lexed = timed("lexical", () => lex(source));
  result.tokens = lexed.tokens;
  result.comments = lexed.comments;
  if (collect("lexical", lexed.diagnostics)) return finish();

  // 2. Syntax analysis
  const parsed = timed("syntax", () => parse(lexed.tokens));
  result.ast = parsed.ast;
  result.astText = parsed.ast ? printAst(parsed.ast) : null;
  if (collect("syntax", parsed.diagnostics) || !parsed.ast) return finish();
  const ast = parsed.ast;

  // 3. Semantic analysis
  const sem = timed("semantic", () => analyzeSemantics(ast, catalog));
  result.semantic = {
    ok: sem.ok,
    scope: sem.scope,
    resolutions: sem.resolutions,
    types: sem.types,
    outputColumns: sem.outputColumns,
    isAggregateQuery: sem.isAggregateQuery,
  };
  result.symbolTable = sem.symbols;
  if (collect("semantic", sem.diagnostics)) return finish();

  // 4. Relational algebra
  let plan: RaNode;
  try {
    plan = timed("translation", () => translateToAlgebra(ast, sem));
  } catch (e) {
    timings.translation ??= 0;
    collect("translation", [internalError("translation", e)]);
    return finish();
  }
  result.algebra = planView(plan);
  counts.translation = 0;

  // 5. Optimization
  try {
    const opt = timed("optimization", () => optimize(plan, catalog));
    result.optimization = {
      original: planView(opt.original),
      optimized: planView(opt.optimized),
      steps: opt.steps,
      skipped: opt.skipped,
      rules: OPTIMIZATION_RULES,
      passes: opt.passes,
    };
    counts.optimization = 0;

    // 6. Code generation (normalised SQL + educational instructions)
    const cg = timed("codegen", () => ({
      original: generateSql(opt.original),
      optimized: generateSql(opt.optimized),
      originalInstructions: generateInstructions(opt.original),
      optimizedInstructions: generateInstructions(opt.optimized),
    }));
    result.codegen = cg;
    counts.codegen = 0;
  } catch (e) {
    const phase: PhaseId = timings.optimization === undefined || result.optimization === null ? "optimization" : "codegen";
    timings[phase] ??= 0;
    collect(phase, [internalError(phase, e)]);
  }
  return finish();
}
