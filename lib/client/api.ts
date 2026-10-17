import type { ApiError, ExecuteResponse, SchemaResponse } from "@/lib/api/contracts";
import type { Diagnostic } from "@/lib/compiler/diagnostics";
import type { CompileResult } from "@/lib/compiler/pipeline";

export type AnalysisResponse = CompileResult & { database: { name: string; storage: "file" | "memory" } };

export type ExecutionOutcome =
  | { ok: true; data: ExecuteResponse }
  | { ok: false; message: string; diagnostics: Diagnostic[] };

const NETWORK_MESSAGE = "Could not reach the server. Check your connection and try again.";

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error(NETWORK_MESSAGE);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Partial<ApiError>;
    if (body.error?.message) return body.error.message;
  } catch {
    // fall through
  }
  return `The server responded with status ${res.status}.`;
}

export async function analyzeQuery(sql: string, signal?: AbortSignal): Promise<AnalysisResponse> {
  const res = await postJson("/api/analyze", { sql }, signal);
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as AnalysisResponse;
}

export async function executeQuery(sql: string, plan: "optimized" | "original", signal?: AbortSignal): Promise<ExecutionOutcome> {
  const res = await postJson("/api/execute", { sql, plan }, signal);
  if (res.ok) return { ok: true, data: (await res.json()) as ExecuteResponse };
  let diagnostics: Diagnostic[] = [];
  let message = `The server responded with status ${res.status}.`;
  try {
    const body = (await res.json()) as Partial<ApiError> & { diagnostics?: Diagnostic[] };
    if (body.error?.message) message = body.error.message;
    if (Array.isArray(body.diagnostics)) diagnostics = body.diagnostics;
  } catch {
    // keep the generic message
  }
  return { ok: false, message, diagnostics };
}

export async function fetchSchema(signal?: AbortSignal): Promise<SchemaResponse> {
  let res: Response;
  try {
    res = await fetch("/api/schema", { signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error(NETWORK_MESSAGE);
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as SchemaResponse;
}
