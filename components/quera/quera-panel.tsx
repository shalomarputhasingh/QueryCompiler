"use client";

import { AlertTriangle, ArrowUp, Check, Copy, Eye, KeyRound, Maximize2, Minimize2, MessageSquarePlus, RefreshCw, Square, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { QueraMarkdown } from "./markdown";
import { MAX_MESSAGE_CHARS, type QueraMessage, useQuera } from "./quera-provider";
import { QueraAvatar } from "./quera-avatar";
import { Thinking } from "./thinking";

function useSuggestions(): string[] {
  const { analysis, sql } = useWorkspace();
  if (sql.trim() === "" || !analysis) {
    return ["What can you help me with?", "How is a SQL query compiled?", "Show me a query to try", "WHERE vs HAVING — what's the difference?"];
  }
  if (!analysis.success) return ["Why did my query fail?", "How do I fix it?", "Explain where the error is", "Which compiler phase caught this?"];
  return ["Explain this query step by step", "Walk me through each compiler phase", "Explain the relational algebra", "Which optimizations applied, and why?"];
}

function ContextBar() {
  const { analysis, sql, stale } = useWorkspace();
  const one = sql.replace(/\s+/g, " ").trim();
  let badge: React.ReactNode = <span className="text-muted-foreground">not analyzed</span>;
  if (analysis && !stale) {
    badge = analysis.success ? (
      <span className="font-medium text-success">compiled</span>
    ) : (
      <span className="font-medium text-destructive">
        {analysis.stats.errorCount} error{analysis.stats.errorCount === 1 ? "" : "s"} · {analysis.failedPhase}
      </span>
    );
  } else if (analysis && stale) {
    badge = <span className="text-warning">edited</span>;
  }
  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs" data-testid="quera-context">
      <Eye className="size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="shrink-0 text-muted-foreground">Looking at</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={one}>
        {one || "(empty editor)"}
      </code>
      <span className="shrink-0">{badge}</span>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: QueraMessage; onRetry: () => void }) {
  if (message.errorCode === "not_configured") {
    return (
      <div className="rounded-xl border border-primary/30 bg-accent/40 p-3.5 text-[13px]" data-testid="quera-setup">
        <p className="mb-1.5 flex items-center gap-2 font-semibold">
          <KeyRound className="size-4 text-primary" aria-hidden /> Quera needs her Groq key
        </p>
        <p className="text-muted-foreground">Create a free key at console.groq.com/keys, then add it to a file named <code className="rounded bg-muted px-1 font-mono">.env.local</code> in the project root and restart the app:</p>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-background p-2.5 font-mono text-[12px]">GROQ_API_KEY=your_key_here</pre>
      </div>
    );
  }
  if (message.errorCode === "unauthorized") {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-[13px]">
        <p className="mb-1 flex items-center gap-2 font-semibold text-destructive">
          <KeyRound className="size-4" aria-hidden /> The Groq API key was not accepted
        </p>
        <p className="text-muted-foreground">Check <code className="rounded bg-muted px-1 font-mono">GROQ_API_KEY</code> in <code className="rounded bg-muted px-1 font-mono">.env.local</code>, then restart the app.</p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-3 text-[13px]" role="alert" data-testid="quera-error">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">Quera tripped over that one.</p>
        <p className="text-muted-foreground">Nothing was lost — give it another go.</p>
      </div>
      <Button size="xs" variant="secondary" onClick={onRetry}>
        <RefreshCw /> Retry
      </Button>
    </div>
  );
}

function Bubble({ message, isLast, streaming, onUseSql, onRunSql, onRegenerate }: { message: QueraMessage; isLast: boolean; streaming: boolean; onUseSql: (s: string) => void; onRunSql: (s: string) => void; onRegenerate: () => void }) {
  const [copied, setCopied] = useState(false);
  if (message.role === "user") {
    return (
      <div className="quera-rise flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[14px] leading-relaxed text-primary-foreground" data-testid="quera-user-msg">
          {message.content}
        </div>
      </div>
    );
  }
  if (message.state === "streaming" && message.content === "") return null; // the thinking indicator covers this moment
  if (message.state === "error" && message.content === "") {
    return (
      <div className="quera-rise flex gap-2.5">
        <QueraAvatar size={28} />
        <div className="min-w-0 flex-1">
          <ErrorCard message={message} onRetry={onRegenerate} />
        </div>
      </div>
    );
  }
  return (
    <div className="quera-rise group flex gap-2.5">
      <QueraAvatar size={28} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-xs font-semibold text-muted-foreground">Quera</div>
        <div data-testid="quera-msg">
          <QueraMarkdown text={message.content} streaming={streaming && isLast} onUseSql={onUseSql} onRunSql={onRunSql} />
        </div>
        {message.state === "error" ? <div className="mt-2"><ErrorCard message={message} onRetry={onRegenerate} /></div> : null}
        {message.state === "done" ? (
          <div className="mt-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <Button
              variant="ghost"
              size="xs"
              aria-label="Copy answer"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message.content);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                } catch {
                  // ignore
                }
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
            {isLast ? (
              <Button variant="ghost" size="xs" onClick={onRegenerate}>
                <RefreshCw /> Regenerate
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (s: string) => void }) {
  const suggestions = useSuggestions();
  const { analysis, stale } = useWorkspace();
  const failed = analysis && !analysis.success && !stale;
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-5 py-8 text-center">
      <span data-quera-motion style={{ animation: "quera-float 4s ease-in-out infinite" }}>
        <QueraAvatar size={64} />
      </span>
      <h3 className="mt-4 text-lg font-semibold tracking-tight">Hi, I&apos;m Quera ✨</h3>
      <p className="mt-1 max-w-xs text-[13.5px] text-muted-foreground">
        {failed ? "I can see your query hit an error. Want me to walk you through it?" : "I can see your query and everything the compiler produced for it — ask me anything about it."}
      </p>
      <div className="mt-5 grid w-full gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-left text-[13px] transition-colors hover:border-primary/50 hover:bg-accent/50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({ busy, onSend, onStop, inputRef }: { busy: boolean; onSend: (t: string) => void; onStop: () => void; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const [text, setText] = useState("");
  const resize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [inputRef]);
  useEffect(resize, [text, resize]);

  const submit = (): void => {
    if (!text.trim() || busy) return;
    onSend(text);
    setText("");
  };
  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2 rounded-2xl border border-input bg-background p-1.5 pl-3.5 transition-colors focus-within:border-primary">
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_CHARS}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask Quera about your query…"
          aria-label="Message Quera"
          data-testid="quera-input"
          className="max-h-[150px] min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-snug outline-none placeholder:text-muted-foreground"
        />
        {busy ? (
          <Button size="icon" variant="secondary" className="size-9 shrink-0 rounded-xl" onClick={onStop} aria-label="Stop generating" data-testid="quera-stop">
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button size="icon" className="size-9 shrink-0 rounded-xl" onClick={submit} disabled={!text.trim()} aria-label="Send message" data-testid="quera-send">
            <ArrowUp />
          </Button>
        )}
      </div>
      <p className="mt-2 px-1 text-center text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line · Quera can make mistakes — the compiler tabs are the source of truth.</p>
    </div>
  );
}

export function QueraPanel() {
  const { open, setOpen, wide, setWide, messages, status, send, stop, regenerate, clear } = useQuera();
  const { setSql, analyze, setActiveTab } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const busy = status !== "idle";

  useEffect(() => {
    if (open) window.setTimeout(() => input.current?.focus(), 250);
  }, [open]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const useSql = useCallback(
    (sql: string) => {
      setSql(sql);
      if (pathname !== "/playground") router.push("/playground");
    },
    [setSql, pathname, router],
  );
  const runSql = useCallback(
    (sql: string) => {
      setSql(sql);
      setActiveTab("overview");
      if (pathname !== "/playground") router.push("/playground");
      void analyze(sql);
    },
    [setSql, setActiveTab, analyze, pathname, router],
  );

  const last = messages[messages.length - 1];
  const showThinking = status === "thinking" || (status === "streaming" && last?.role === "assistant" && last.content === "");

  return (
    <>
      {open ? <button type="button" aria-label="Close Quera" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} /> : null}
      <aside
        aria-label="Quera, your SQL and compiler tutor"
        aria-hidden={!open}
        inert={!open}
        data-testid="quera-panel"
        data-open={open}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-2xl transition-[transform,width] duration-300 ease-out",
          wide ? "md:w-[680px]" : "md:w-[440px]",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <QueraAvatar size={38} thinking={busy} />
          <div className="min-w-0 flex-1 leading-tight">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              Quera
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                <span className="size-1.5 rounded-full bg-success" aria-hidden /> online
              </span>
            </h2>
            <p className="truncate text-xs text-muted-foreground">Your SQL &amp; compiler tutor</p>
          </div>
          <Button variant="ghost" size="icon" className="hidden size-8 md:inline-flex" onClick={() => setWide(!wide)} aria-label={wide ? "Make panel narrower" : "Make panel wider"}>
            {wide ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={clear} aria-label="Start a new chat" title="New chat" disabled={messages.length === 0}>
            <MessageSquarePlus />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setOpen(false)} aria-label="Close Quera" data-testid="quera-close">
            <X />
          </Button>
        </header>

        <ContextBar />

        <div
          ref={scroller}
          className="scroll-thin flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {messages.length === 0 ? (
            <Welcome
              onPick={(s) => {
                stick.current = true;
                void send(s);
              }}
            />
          ) : (
            <div className="space-y-5 px-4 py-5" aria-live="off">
              {messages.map((m, i) => (
                <Bubble
                  key={m.id}
                  message={m}
                  isLast={i === messages.length - 1}
                  streaming={status === "streaming"}
                  onUseSql={useSql}
                  onRunSql={runSql}
                  onRegenerate={regenerate}
                />
              ))}
              {showThinking ? <Thinking /> : null}
            </div>
          )}
        </div>

        <Composer
          busy={busy}
          inputRef={input}
          onSend={(t) => {
            stick.current = true;
            void send(t);
          }}
          onStop={stop}
        />
      </aside>
    </>
  );
}
