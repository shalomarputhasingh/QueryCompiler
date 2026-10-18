"use client";

import { useWorkspace } from "@/components/layout/workspace-provider";
import { cn } from "@/lib/utils/cn";
import { QueraAvatar } from "./quera-avatar";
import { useQuera } from "./quera-provider";

/** Floating entry point. Quietly nudges when the current query failed to compile. */
export function QueraLauncher() {
  const { open, setOpen, status } = useQuera();
  const { analysis, stale } = useWorkspace();
  const failed = Boolean(analysis && !analysis.success && !stale);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open Quera, your AI tutor"
      title="Ask Quera (Ctrl+/)"
      data-testid="quera-launcher"
      className={cn(
        "group fixed bottom-4 right-4 z-30 flex items-center gap-2.5 rounded-full border border-border bg-card/95 py-1.5 pl-1.5 pr-4 shadow-lg backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-xl",
        open && "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      <span className="relative">
        <QueraAvatar size={36} thinking={status !== "idle"} />
        {failed ? <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-card bg-destructive" aria-hidden /> : null}
      </span>
      <span className="text-left leading-tight">
        <span className="block text-[13px] font-semibold">{failed ? "Explain this error" : "Ask Quera"}</span>
        <span className="block text-[11px] text-muted-foreground">{status !== "idle" ? "Quera is thinking…" : "AI tutor · Ctrl+/"}</span>
      </span>
    </button>
  );
}
