"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { Eraser, FileText, Play, RotateCcw, SquareTerminal, Wand2 } from "lucide-react";
import { ResultsTabs } from "@/components/compiler/results-tabs";
import { SummaryCard } from "@/components/compiler/summary-card";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { EXAMPLES } from "@/lib/utils/examples";
import { cn } from "@/lib/utils/cn";

const SqlEditor = dynamic(() => import("./sql-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner /> Loading editor…
    </div>
  ),
});

type Pane = "editor" | "examples";

export function Playground() {
  const { sql, setSql, analysis, stale, analyze, execute, analysisStatus, execution, resetWorkspace, clearWorkspace, schema, registerReveal, setActiveTab } = useWorkspace();
  const [pane, setPane] = useState<Pane>("editor");
  const busy = analysisStatus === "loading";
  const empty = sql.trim() === "";

  const load = useCallback(
    (id: string) => {
      const ex = EXAMPLES.find((e) => e.id === id);
      if (!ex) return;
      setSql(ex.sql);
      setPane("editor");
      setActiveTab("overview");
      void analyze(ex.sql);
    },
    [setSql, analyze, setActiveTab],
  );

  const runAnalyze = useCallback(() => {
    setActiveTab("overview");
    void analyze();
  }, [analyze, setActiveTab]);

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="flex min-w-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 pt-2">
            <div role="tablist" aria-label="Editor panes" className="flex">
              {(
                [
                  ["editor", "Editor", SquareTerminal],
                  ["examples", "Examples", FileText],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={pane === id}
                  onClick={() => setPane(id)}
                  className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium", pane === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2 pb-2">
              <label className="sr-only" htmlFor="sample-select">
                Load a sample query
              </label>
              <select
                id="sample-select"
                data-testid="sample-select"
                className="h-9 max-w-64 rounded-md border border-input bg-card px-2 text-[13px]"
                value=""
                onChange={(e) => e.target.value && load(e.target.value)}
              >
                <option value="">Sample query…</option>
                {(["valid", "optimizer", "invalid"] as const).map((cat) => (
                  <optgroup key={cat} label={cat === "valid" ? "Valid queries" : cat === "optimizer" ? "Optimizer demos" : "Invalid (learn from errors)"}>
                    {EXAMPLES.filter((e) => e.category === cat).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <Button variant="secondary" onClick={runAnalyze} disabled={busy || empty} title="Analyze (Ctrl/Cmd+Enter)" data-testid="analyze">
                {busy ? <Spinner /> : <Wand2 />}
                Analyze
              </Button>
              <Button onClick={() => void execute()} disabled={execution.status === "loading" || empty} title="Execute (Ctrl/Cmd+Shift+Enter)" data-testid="execute">
                {execution.status === "loading" ? <Spinner /> : <Play />}
                Execute
              </Button>
            </div>
          </div>

          {pane === "editor" ? (
            <div className="h-[260px]" data-testid="editor-pane">
              <SqlEditor
                value={sql}
                onChange={setSql}
                diagnostics={analysis && !stale ? analysis.diagnostics : []}
                schema={schema}
                onAnalyze={runAnalyze}
                onExecute={() => void execute()}
                onRevealReady={registerReveal}
              />
            </div>
          ) : (
            <ul className="scroll-thin h-[260px] divide-y divide-border overflow-auto">
              {EXAMPLES.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => load(e.id)} className="flex w-full items-baseline gap-3 px-4 py-2 text-left hover:bg-muted">
                    <span className="text-[13px] font-medium">{e.title}</span>
                    <span className="truncate text-xs text-muted-foreground">{e.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
            <Button variant="ghost" size="xs" onClick={clearWorkspace}>
              <Eraser /> Clear
            </Button>
            <Button variant="ghost" size="xs" onClick={resetWorkspace}>
              <RotateCcw /> Reset
            </Button>
            <p className="ml-auto text-xs text-muted-foreground">
              <kbd className="rounded border border-border px-1">Ctrl</kbd>+<kbd className="rounded border border-border px-1">Enter</kbd> analyze ·{" "}
              <kbd className="rounded border border-border px-1">Ctrl</kbd>+<kbd className="rounded border border-border px-1">Shift</kbd>+<kbd className="rounded border border-border px-1">Enter</kbd> execute
            </p>
          </div>
        </Card>
        <SummaryCard />
      </div>

      <Card className="p-3 sm:p-4">
        <ResultsTabs />
      </Card>
    </div>
  );
}
