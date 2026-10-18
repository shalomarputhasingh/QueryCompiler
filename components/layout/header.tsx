"use client";

import { AlertCircle, CheckCircle2, Database, Eraser, Menu, Play, RotateCcw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils/cn";
import { subtitleFor, titleFor } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import { useWorkspace } from "./workspace-provider";

function StatusChip() {
  const { analysis, analysisStatus, analysisError, stale } = useWorkspace();
  let tone = "border-border text-muted-foreground";
  let icon = <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden />;
  let text = "Ready";

  if (analysisStatus === "loading") {
    icon = <Spinner className="size-3" />;
    text = "Analyzing…";
  } else if (analysisStatus === "error") {
    tone = "border-destructive/40 text-destructive";
    icon = <AlertCircle className="size-3.5" aria-hidden />;
    text = analysisError ? "Server error" : "Error";
  } else if (analysis) {
    if (analysis.success) {
      tone = "border-success/40 text-success";
      icon = <CheckCircle2 className="size-3.5" aria-hidden />;
      text = analysis.stats.warningCount > 0 ? `Compiled · ${analysis.stats.warningCount} warning${analysis.stats.warningCount === 1 ? "" : "s"}` : "Compiled";
    } else {
      tone = "border-destructive/40 text-destructive";
      icon = <AlertCircle className="size-3.5" aria-hidden />;
      text = `${analysis.stats.errorCount} error${analysis.stats.errorCount === 1 ? "" : "s"} · ${analysis.failedPhase ?? "failed"}`;
    }
    if (stale) text += " (edited)";
  }

  return (
    <span role="status" aria-live="polite" data-testid="compiler-status" className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium", tone)}>
      {icon}
      {text}
    </span>
  );
}

export function Header({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const { analysis, schema, resetWorkspace, clearWorkspace, analyze, execute, analysisStatus } = useWorkspace();
  const router = useRouter();
  const dbName = analysis?.database.name ?? schema?.database.name;
  const storage = analysis?.database.storage ?? schema?.database.storage;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur sm:px-4">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={onMenu}>
        <Menu />
      </Button>
      <div className="min-w-0 leading-tight">
        <h1 className="truncate text-[15px] font-semibold tracking-tight">{titleFor(pathname)}</h1>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">{subtitleFor(pathname)}</p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden md:inline-flex"><StatusChip /></span>
        <span
          className="hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground 2xl:inline-flex"
          title={storage === "memory" ? "Seeded in-memory SQLite (file system not writable)" : "SQLite file database"}
        >
          <Database className="size-3.5" aria-hidden />
          {dbName ? `${dbName} · SQLite${storage === "memory" ? " (memory)" : ""}` : "SQLite sample database"}
        </span>
        <ThemeToggle />
        <Button variant="outline" size="sm" onClick={resetWorkspace} title="Restore the default query and clear all results">
          <RotateCcw />
          <span className="hidden sm:inline">Reset</span>
        </Button>
        <Button variant="outline" size="sm" onClick={clearWorkspace} title="Empty the editor and clear all results">
          <Eraser />
          <span className="hidden sm:inline">Clear</span>
        </Button>
        <Button
          size="sm"
          disabled={analysisStatus === "loading"}
          title="Analyze, then execute if the query compiles"
          onClick={async () => {
            if (pathname !== "/playground") router.push("/playground");
            const result = await analyze();
            if (result?.success) await execute();
          }}
          data-testid="run-all"
        >
          <Play />
          Run All
        </Button>
      </div>
    </header>
  );
}
