import type { PhaseId } from "@/lib/compiler/pipeline";

export interface HistoryEntry {
  id: string;
  sql: string;
  timestamp: number;
  status: "success" | "error";
  diagnosticCount: number;
  failedPhase: PhaseId | null;
}

const HISTORY_KEY = "qc.history.v1";
const DRAFT_KEY = "qc.draft.v1";
export const MAX_HISTORY = 50;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, blocked, quota): the app works without it.
  }
}

function isEntry(v: unknown): v is HistoryEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.sql === "string" &&
    typeof e.timestamp === "number" &&
    (e.status === "success" || e.status === "error") &&
    typeof e.diagnosticCount === "number"
  );
}

export function loadHistory(): HistoryEntry[] {
  const raw = read(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  write(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
}

export function loadDraft(): string | null {
  return read(DRAFT_KEY);
}

export function saveDraft(sql: string): void {
  write(DRAFT_KEY, sql);
}
