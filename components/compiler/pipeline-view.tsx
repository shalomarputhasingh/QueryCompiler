"use client";

import { ArrowRight, CheckCircle2, CircleDashed, Play, XCircle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { explainCompilation } from "@/lib/compiler/explain";
import type { PhaseId } from "@/lib/compiler/pipeline";
import { cn } from "@/lib/utils/cn";
import { CodeBlock } from "./shared";

const PHASES: { id: PhaseId; label: string; blurb: string }[] = [
  { id: "lexical", label: "Lexer", blurb: "Characters → tokens" },
  { id: "syntax", label: "Parser", blurb: "Tokens → syntax tree" },
  { id: "semantic", label: "Semantic analyzer", blurb: "Names & types vs. schema" },
  { id: "translation", label: "Relational algebra", blurb: "Tree → operators" },
  { id: "optimization", label: "Optimizer", blurb: "Equivalent, simpler plan" },
  { id: "codegen", label: "Code generator", blurb: "Plan → SQL & instructions" },
];

export function PipelineView() {
  const { analysis, analysisStatus, analyze, sql } = useWorkspace();
  const sections = useMemo(() => (analysis ? explainCompilation(analysis) : []), [analysis]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Query under study</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void analyze()} disabled={analysisStatus === "loading" || sql.trim() === ""}>
              {analysisStatus === "loading" ? <Spinner /> : <Play />}
              {analysis ? "Re-analyze" : "Analyze current query"}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/playground">Edit in playground</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sql.trim() === "" ? <p className="text-[13px] text-muted-foreground">The editor is empty. Open the playground or load an example first.</p> : <CodeBlock text={analysis?.source ?? sql} label="query" />}
        </CardContent>
      </Card>

      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6" aria-label="Compiler pipeline">
        {PHASES.map((p, i) => {
          const status = analysis?.phases.find((x) => x.id === p.id)?.status;
          return (
            <li key={p.id} className="relative">
              <div
                className={cn(
                  "h-full rounded-lg border p-3",
                  status === "success" && "border-success/40 bg-success/10",
                  status === "error" && "border-destructive/40 bg-destructive/10",
                  (!status || status === "skipped") && "border-border",
                )}
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {status === "success" ? <CheckCircle2 className="size-3.5 text-success" aria-label="Succeeded" /> : status === "error" ? <XCircle className="size-3.5 text-destructive" aria-label="Failed" /> : <CircleDashed className="size-3.5" aria-label="Not run" />}
                  Phase {i + 1}
                </div>
                <p className="text-[13px] font-semibold">{p.label}</p>
                <p className="text-xs text-muted-foreground">{p.blurb}</p>
              </div>
              {i < PHASES.length - 1 ? <ArrowRight className="absolute -right-2.5 top-1/2 hidden size-4 -translate-y-1/2 text-muted-foreground lg:block" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>

      <div>
        <h2 className="mb-1 text-base font-semibold">Learning Mode</h2>
        <p className="mb-3 text-[13px] text-muted-foreground">Every sentence below is generated from the real compiler output for your query — nothing is canned.</p>
        {!analysis ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">Analyze a query to see how each phase handled it.</p>
        ) : (
          <ol className="space-y-3">
            {sections.map((s, i) => (
              <li key={s.id}>
                <Card data-testid={`learn-${s.id}`}>
                  <CardHeader>
                    <CardTitle>
                      {i + 1}. {s.title}
                    </CardTitle>
                    <span className={cn("text-xs font-medium", s.status === "ok" ? "text-success" : s.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                      {s.status === "ok" ? "completed" : s.status === "error" ? "failed" : "not reached"}
                    </span>
                  </CardHeader>
                  <CardContent className="space-y-2 text-[13px]">
                    <p className="text-muted-foreground">{s.summary}</p>
                    {s.points.length > 0 ? (
                      <ul className="list-disc space-y-1 pl-5">
                        {s.points.map((pt, j) => (
                          <li key={j} className="break-words">
                            {pt}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
