"use client";

import { History, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export function HistoryList() {
  const { history, removeHistoryEntry, clearHistory, setSql, analyze, setActiveTab } = useWorkspace();
  const router = useRouter();

  const restore = (sql: string, run: boolean) => {
    setSql(sql);
    setActiveTab("overview");
    if (run) void analyze(sql);
    router.push("/playground");
  };

  if (history.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState
          icon={History}
          title="No history yet"
          description="Every query you analyze is remembered here (up to 50, stored only in this browser)."
          action={
            <Button asChild size="sm">
              <Link href="/playground">Open the playground</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">{history.length} saved {history.length === 1 ? "query" : "queries"} · stored in this browser only</p>
        <Button variant="destructive" size="sm" onClick={clearHistory}>
          <Trash2 /> Clear history
        </Button>
      </div>
      <ul className="space-y-3">
        {history.map((h) => (
          <li key={h.id}>
            <Card className="space-y-2 p-4" data-testid="history-entry">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge tone={h.status === "success" ? "success" : "danger"}>{h.status === "success" ? "Compiled" : `Failed${h.failedPhase ? ` · ${h.failedPhase}` : ""}`}</Badge>
                <span>{h.diagnosticCount} diagnostic{h.diagnosticCount === 1 ? "" : "s"}</span>
                <time dateTime={new Date(h.timestamp).toISOString()}>{new Date(h.timestamp).toLocaleString()}</time>
              </div>
              <pre className="scroll-thin max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-xs">{h.sql}</pre>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => restore(h.sql, true)}>
                  <RotateCcw /> Restore &amp; analyze
                </Button>
                <Button size="sm" variant="ghost" onClick={() => restore(h.sql, false)}>
                  Restore only
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto" aria-label="Remove this entry" onClick={() => removeHistoryEntry(h.id)}>
                  <Trash2 /> Remove
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
