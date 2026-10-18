"use client";

import { AlertCircle, CheckCircle2, CircleDashed } from "lucide-react";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QueraAvatar } from "@/components/quera/quera-avatar";
import { useQuera } from "@/components/quera/quera-provider";
import { Spinner } from "@/components/ui/spinner";
import { Metric } from "./shared";

const PHASE_TEXT: Record<string, string> = {
  lexical: "lexical analysis",
  syntax: "syntax analysis",
  semantic: "semantic analysis",
  translation: "translation",
  optimization: "optimization",
  codegen: "code generation",
};

export function SummaryCard() {
  const { analysis, analysisStatus, analysisError, stale, execution } = useWorkspace();
  const { ask } = useQuera();

  let head: React.ReactNode;
  if (analysisStatus === "loading") {
    head = (
      <div className="flex items-center gap-3">
        <Spinner className="size-6 text-primary" />
        <div>
          <p className="font-semibold">Analyzing…</p>
          <p className="text-xs text-muted-foreground">Running the compiler pipeline</p>
        </div>
      </div>
    );
  } else if (analysisStatus === "error") {
    head = (
      <div className="flex items-center gap-3">
        <AlertCircle className="size-7 text-destructive" aria-hidden />
        <div>
          <p className="font-semibold">Analysis unavailable</p>
          <p className="text-xs text-muted-foreground">{analysisError}</p>
        </div>
      </div>
    );
  } else if (!analysis) {
    head = (
      <div className="flex items-center gap-3">
        <CircleDashed className="size-7 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-semibold">Not analyzed yet</p>
          <p className="text-xs text-muted-foreground">Press Analyze (Ctrl+Enter)</p>
        </div>
      </div>
    );
  } else if (analysis.success) {
    head = (
      <div className="flex items-center gap-3">
        <CheckCircle2 className="size-7 text-success" aria-hidden />
        <div>
          <p className="font-semibold" data-testid="analysis-outcome">
            Analysis Successful
          </p>
          <p className="text-xs text-muted-foreground">{analysis.stats.errorCount === 0 ? "No errors found" : ""}{analysis.stats.warningCount > 0 ? ` · ${analysis.stats.warningCount} warning${analysis.stats.warningCount === 1 ? "" : "s"}` : ""}</p>
        </div>
      </div>
    );
  } else {
    head = (
      <div className="flex items-center gap-3">
        <AlertCircle className="size-7 text-destructive" aria-hidden />
        <div>
          <p className="font-semibold" data-testid="analysis-outcome">
            Analysis Failed
          </p>
          <p className="text-xs text-muted-foreground">
            {analysis.stats.errorCount} error{analysis.stats.errorCount === 1 ? "" : "s"} during {analysis.failedPhase ? PHASE_TEXT[analysis.failedPhase] : "compilation"}
          </p>
        </div>
      </div>
    );
  }

  const s = analysis?.stats;
  return (
    <Card className="flex flex-col justify-between gap-4 p-4" aria-label="Analysis summary">
      {head}
      {stale ? <p className="text-xs text-warning">Editor changed since this analysis — analyze again to refresh.</p> : null}
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Tokens" value={s ? s.tokenCount : "–"} />
        <Metric label="Diagnostics" value={s ? s.diagnosticCount : "–"} tone={s && s.errorCount > 0 ? "bad" : undefined} />
        <Metric label="Optimization rules" value={s ? s.rulesApplied : "–"} />
      </div>
      {analysis && !stale ? (
        <Button variant="outline" size="sm" className="justify-start" onClick={() => ask(analysis.success ? "Explain this query step by step." : "Why did my query fail, and how do I fix it?")} data-testid="ask-quera-summary">
          <QueraAvatar size={18} /> {analysis.success ? "Ask Quera to explain this query" : "Ask Quera what went wrong"}
        </Button>
      ) : null}
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
        <p>
          Semantic validation:{" "}
          <b className={s ? (s.semanticPassed ? "text-success" : "text-destructive") : ""}>{s ? (s.semanticPassed ? "passed" : analysis?.semantic ? "failed" : "not reached") : "–"}</b>
        </p>
        <p>
          Execution:{" "}
          <b className={execution.status === "ok" ? "text-success" : execution.status === "error" ? "text-destructive" : ""}>
            {execution.status === "ok" ? `${execution.data.rowCount} row${execution.data.rowCount === 1 ? "" : "s"}` : execution.status === "error" ? "failed" : execution.status === "loading" ? "running…" : "not run"}
          </b>
        </p>
      </div>
    </Card>
  );
}
