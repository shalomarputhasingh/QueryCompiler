"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ExecuteResponse, SchemaResponse } from "@/lib/api/contracts";
import { type AnalysisResponse, analyzeQuery, executeQuery, fetchSchema } from "@/lib/client/api";
import { type HistoryEntry, MAX_HISTORY, loadDraft, loadHistory, saveDraft, saveHistory } from "@/lib/client/storage";
import type { Diagnostic, Range } from "@/lib/compiler/diagnostics";
import { DEFAULT_QUERY } from "@/lib/utils/examples";

export type AnalysisStatus = "idle" | "loading" | "done" | "error";
export type ExecutionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: ExecuteResponse }
  | { status: "error"; message: string; diagnostics: Diagnostic[] };

export type ResultTab = "overview" | "tokens" | "ast" | "semantic" | "symbols" | "ir" | "optimization" | "execution";
export type PlanChoice = "optimized" | "original";

/** Registered by the editor so any component can ask it to reveal a source range. */
export type RevealHandler = (range: Range) => void;

interface WorkspaceContextValue {
  sql: string;
  setSql: (sql: string) => void;
  analysis: AnalysisResponse | null;
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  /** True when the editor text differs from the analysed text. */
  stale: boolean;
  execution: ExecutionState;
  plan: PlanChoice;
  setPlan: (plan: PlanChoice) => void;
  activeTab: ResultTab;
  setActiveTab: (tab: ResultTab) => void;
  analyze: (sqlOverride?: string) => Promise<AnalysisResponse | null>;
  execute: (sqlOverride?: string) => Promise<void>;
  resetWorkspace: () => void;
  clearWorkspace: () => void;
  history: HistoryEntry[];
  removeHistoryEntry: (id: string) => void;
  clearHistory: () => void;
  schema: SchemaResponse | null;
  schemaError: string | null;
  registerReveal: (handler: RevealHandler | null) => void;
  reveal: (range: Range) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [sql, setSqlState] = useState(DEFAULT_QUERY);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [execution, setExecution] = useState<ExecutionState>({ status: "idle" });
  const [plan, setPlan] = useState<PlanChoice>("optimized");
  const [activeTab, setActiveTab] = useState<ResultTab>("overview");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const revealRef = useRef<RevealHandler | null>(null);
  const requestId = useRef(0);
  const hydrated = useRef(false);

  // Restore the draft and history once on the client (never during SSR, to avoid hydration mismatches).
  useEffect(() => {
    const draft = loadDraft();
    if (draft !== null && draft.trim() !== "") setSqlState(draft);
    setHistory(loadHistory());
    hydrated.current = true;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSchema(controller.signal)
      .then(setSchema)
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setSchemaError(e instanceof Error ? e.message : "Schema unavailable");
      });
    return () => controller.abort();
  }, []);

  const setSql = useCallback((next: string) => {
    setSqlState(next);
    if (hydrated.current) saveDraft(next);
  }, []);

  const pushHistory = useCallback((result: AnalysisResponse) => {
    if (result.source.trim() === "") return;
    setHistory((prev) => {
      const entry: HistoryEntry = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        sql: result.source,
        timestamp: Date.now(),
        status: result.success ? "success" : "error",
        diagnosticCount: result.stats.diagnosticCount,
        failedPhase: result.failedPhase,
      };
      const next = [entry, ...prev.filter((h) => h.sql !== result.source)].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }, []);

  const analyze = useCallback(
    async (sqlOverride?: string): Promise<AnalysisResponse | null> => {
      const text = sqlOverride ?? sql;
      const id = ++requestId.current;
      setAnalysisStatus("loading");
      setAnalysisError(null);
      setExecution({ status: "idle" });
      try {
        const result = await analyzeQuery(text);
        if (id !== requestId.current) return null; // superseded by a newer request
        setAnalysis(result);
        setAnalysisStatus("done");
        pushHistory(result);
        return result;
      } catch (e) {
        if (id !== requestId.current) return null;
        setAnalysisStatus("error");
        setAnalysisError(e instanceof Error ? e.message : "Analysis failed");
        return null;
      }
    },
    [sql, pushHistory],
  );

  const execute = useCallback(
    async (sqlOverride?: string): Promise<void> => {
      const text = sqlOverride ?? sql;
      setExecution({ status: "loading" });
      setActiveTab("execution");
      try {
        const outcome = await executeQuery(text, plan);
        setExecution(outcome.ok ? { status: "ok", data: outcome.data } : { status: "error", message: outcome.message, diagnostics: outcome.diagnostics });
      } catch (e) {
        setExecution({ status: "error", message: e instanceof Error ? e.message : "Execution failed", diagnostics: [] });
      }
    },
    [sql, plan],
  );

  const resetWorkspace = useCallback(() => {
    requestId.current++;
    setSql(DEFAULT_QUERY);
    setAnalysis(null);
    setAnalysisStatus("idle");
    setAnalysisError(null);
    setExecution({ status: "idle" });
    setActiveTab("overview");
  }, [setSql]);

  const clearWorkspace = useCallback(() => {
    requestId.current++;
    setSql("");
    setAnalysis(null);
    setAnalysisStatus("idle");
    setAnalysisError(null);
    setExecution({ status: "idle" });
  }, [setSql]);

  const removeHistoryEntry = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== id);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  const registerReveal = useCallback((handler: RevealHandler | null) => {
    revealRef.current = handler;
  }, []);
  const reveal = useCallback((range: Range) => revealRef.current?.(range), []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      sql,
      setSql,
      analysis,
      analysisStatus,
      analysisError,
      stale: analysis !== null && analysis.source !== sql,
      execution,
      plan,
      setPlan,
      activeTab,
      setActiveTab,
      analyze,
      execute,
      resetWorkspace,
      clearWorkspace,
      history,
      removeHistoryEntry,
      clearHistory,
      schema,
      schemaError,
      registerReveal,
      reveal,
    }),
    [sql, setSql, analysis, analysisStatus, analysisError, execution, plan, activeTab, analyze, execute, resetWorkspace, clearWorkspace, history, removeHistoryEntry, clearHistory, schema, schemaError, registerReveal, reveal],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
