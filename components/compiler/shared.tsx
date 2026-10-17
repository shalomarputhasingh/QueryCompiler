"use client";

import { AlertCircle, AlertTriangle, Check, Copy, Info, Sparkles } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { Diagnostic } from "@/lib/compiler/diagnostics";
import type { PhaseId } from "@/lib/compiler/pipeline";
import { cn } from "@/lib/utils/cn";


export const PHASE_NAME: Record<PhaseId, string> = {
  lexical: "lexical analysis",
  syntax: "syntax analysis",
  semantic: "semantic analysis",
  translation: "relational algebra translation",
  optimization: "optimization",
  codegen: "code generation",
};

/** Empty state that explains *why* a view has nothing to show, based on the real analysis result. */
export function Unavailable({ what, requires }: { what: string; requires: PhaseId }) {
  const { analysis, analysisStatus } = useWorkspace();
  if (analysisStatus === "loading" && !analysis) return <EmptyState icon={Sparkles} title="Analyzing…" description="The compiler is running." />;
  if (!analysis) {
    return (
      <EmptyState
        icon={Sparkles}
        title={`No ${what} yet`}
        description={`Write a query and press “Analyze” (Ctrl+Enter). The ${what} appears here once the compiler has produced it.`}
      />
    );
  }
  return (
    <EmptyState
      icon={AlertCircle}
      title={`No ${what} available`}
      description={
        analysis.failedPhase
          ? `Compilation stopped during ${PHASE_NAME[analysis.failedPhase]}, so ${requires === analysis.failedPhase ? "this" : "a later"} phase never ran. Fix the reported errors and analyze again.`
          : `The ${what} requires ${PHASE_NAME[requires]}, which did not run.`
      }
    />
  );
}

export function CodeBlock({ text, label, className, wrap }: { text: string; label?: string; className?: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("relative rounded-lg border border-border bg-muted/40", className)}>
      <Button
        variant="ghost"
        size="xs"
        className="absolute right-1.5 top-1.5"
        aria-label={label ? `Copy ${label}` : "Copy"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard can be blocked; ignore.
          }
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      <pre className={cn("scroll-thin overflow-auto p-3 pr-10 font-mono text-[13px] leading-relaxed", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>{text}</pre>
    </div>
  );
}

export function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="min-w-24 flex-1 border-l-2 border-primary/60 pl-3">
      <div className={cn("text-xl font-semibold leading-tight tabular-nums", tone === "good" && "text-success", tone === "bad" && "text-destructive", tone === "warn" && "text-warning")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{children}</h3>
      {right}
    </div>
  );
}

export function DiagnosticList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const { reveal, stale } = useWorkspace();
  if (diagnostics.length === 0) return null;
  return (
    <ul className="space-y-1.5" aria-label="Diagnostics">
      {diagnostics.map((d, i) => {
        const Icon = d.severity === "error" ? AlertCircle : d.severity === "warning" ? AlertTriangle : Info;
        return (
          <li
            key={`${d.code}-${d.range.start.offset}-${i}`}
            className={cn(
              "flex gap-2.5 rounded-md border px-3 py-2 text-[13px]",
              d.severity === "error" ? "border-destructive/30 bg-destructive/10" : d.severity === "warning" ? "border-warning/30 bg-warning/10" : "border-info/30 bg-info/10",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", d.severity === "error" ? "text-destructive" : d.severity === "warning" ? "text-warning" : "text-info")} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="break-words">
                {d.message}
              </p>
              {d.hint ? <p className="mt-0.5 text-xs text-muted-foreground">{d.hint}</p> : null}
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Badge>{d.code}</Badge>
                <span>{d.phase}</span>
                <button
                  type="button"
                  disabled={stale}
                  title={stale ? "The query changed since this analysis" : "Show in editor"}
                  className="rounded px-1 font-mono text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                  onClick={() => reveal(d.range)}
                >
                  line {d.range.start.line}, column {d.range.start.column}
                </button>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function StatusBadge({ ok, okText = "Passed", failText = "Failed" }: { ok: boolean; okText?: string; failText?: string }) {
  return <Badge tone={ok ? "success" : "danger"}>{ok ? okText : failText}</Badge>;
}
