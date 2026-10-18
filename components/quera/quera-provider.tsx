"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/components/layout/workspace-provider";
import type { ChatEvent } from "@/lib/chat/groq";

export type QueraErrorCode = "not_configured" | "unauthorized" | "unavailable" | "bad_request";

export interface QueraMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  state: "streaming" | "done" | "error";
  errorCode?: QueraErrorCode;
}

export type QueraStatus = "idle" | "thinking" | "streaming";

interface QueraContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  wide: boolean;
  setWide: (wide: boolean) => void;
  messages: QueraMessage[];
  status: QueraStatus;
  configured: boolean | null;
  send: (text: string) => Promise<void>;
  ask: (text: string) => void;
  stop: () => void;
  regenerate: () => void;
  clear: () => void;
}

const QueraContext = createContext<QueraContextValue | null>(null);

export function useQuera(): QueraContextValue {
  const ctx = useContext(QueraContext);
  if (!ctx) throw new Error("useQuera must be used inside <QueraProvider>");
  return ctx;
}

const STORAGE_KEY = "qc.quera.v1";
const HISTORY_SENT = 10;
export const MAX_MESSAGE_CHARS = 1500;

function load(): QueraMessage[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is QueraMessage => typeof m?.id === "string" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ ...m, state: m.state === "streaming" ? "done" : m.state }))
      .slice(-40);
  } catch {
    return [];
  }
}

function save(messages: QueraMessage[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.filter((m) => m.state !== "streaming").slice(-40)));
  } catch {
    // storage unavailable: the chat still works for this session
  }
}

const uid = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function QueraProvider({ children }: { children: React.ReactNode }) {
  const { sql } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [messages, setMessages] = useState<QueraMessage[]>([]);
  const [status, setStatus] = useState<QueraStatus>("idle");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const controller = useRef<AbortController | null>(null);
  const messagesRef = useRef<QueraMessage[]>([]);
  const sqlRef = useRef(sql);
  const hydrated = useRef(false);
  sqlRef.current = sql;
  messagesRef.current = messages;

  useEffect(() => {
    setMessages(load());
    hydrated.current = true;
    fetch("/api/chat")
      .then((r) => r.json())
      .then((b: { configured?: boolean }) => setConfigured(Boolean(b.configured)))
      .catch(() => setConfigured(null));
  }, []);

  useEffect(() => {
    if (hydrated.current && status === "idle") save(messages);
  }, [messages, status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const patchLast = useCallback((patch: (m: QueraMessage) => QueraMessage) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice();
      next[next.length - 1] = patch(next[next.length - 1]!);
      return next;
    });
  }, []);

  const run = useCallback(
    async (history: QueraMessage[]) => {
      const ctl = new AbortController();
      controller.current = ctl;
      setStatus("thinking");
      const assistant: QueraMessage = { id: uid(), role: "assistant", content: "", state: "streaming" };
      setMessages([...history, assistant]);

      const fail = (code: QueraErrorCode): void => {
        patchLast((m) => ({ ...m, state: "error", errorCode: code }));
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sql: sqlRef.current,
            messages: history.slice(-HISTORY_SENT).map((m) => ({ role: m.role, content: m.content })),
          }),
          signal: ctl.signal,
        });
        if (!res.ok || !res.body) {
          fail("unavailable");
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finished = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev: ChatEvent;
            try {
              ev = JSON.parse(line) as ChatEvent;
            } catch {
              continue;
            }
            if (ev.type === "delta") {
              setStatus("streaming");
              patchLast((m) => ({ ...m, content: m.content + ev.text }));
            } else if (ev.type === "done") {
              finished = true;
              patchLast((m) => ({ ...m, state: "done" }));
            } else if (ev.type === "error") {
              if (ev.code === "aborted") {
                finished = true;
                patchLast((m) => ({ ...m, state: "done" }));
              } else {
                finished = true;
                fail(ev.code);
              }
            }
            // "ping" only keeps the connection alive; the UI keeps showing the thinking animation.
          }
        }
        if (!finished) patchLast((m) => (m.content ? { ...m, state: "done" } : { ...m, state: "error", errorCode: "unavailable" }));
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") patchLast((m) => ({ ...m, state: "done" }));
        else fail("unavailable");
      } finally {
        controller.current = null;
        setStatus("idle");
        setMessages((prev) => (prev.length > 0 && prev[prev.length - 1]!.role === "assistant" && prev[prev.length - 1]!.content === "" && prev[prev.length - 1]!.state === "done" ? prev.slice(0, -1) : prev));
      }
    },
    [patchLast],
  );

  const send = useCallback(
    async (text: string) => {
      const content = text.trim().slice(0, MAX_MESSAGE_CHARS);
      if (!content || controller.current) return;
      const base = messagesRef.current.filter((m) => m.state !== "error");
      await run([...base, { id: uid(), role: "user", content, state: "done" }]);
    },
    [run],
  );

  const ask = useCallback(
    (text: string) => {
      setOpen(true);
      void send(text);
    },
    [send],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  const regenerate = useCallback(() => {
    if (controller.current) return;
    const prev = messagesRef.current.slice();
    while (prev.length > 0 && prev[prev.length - 1]!.role === "assistant") prev.pop();
    if (prev.length > 0 && prev[prev.length - 1]!.role === "user") void run(prev);
  }, [run]);

  const clear = useCallback(() => {
    controller.current?.abort();
    setMessages([]);
    save([]);
  }, []);

  const value = useMemo<QueraContextValue>(
    () => ({ open, setOpen, wide, setWide, messages, status, configured, send, ask, stop, regenerate, clear }),
    [open, wide, messages, status, configured, send, ask, stop, regenerate, clear],
  );
  return <QueraContext.Provider value={value}>{children}</QueraContext.Provider>;
}
