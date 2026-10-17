import { ZodError } from "zod";
import { compile } from "@/lib/compiler/pipeline";
import { getDatabase } from "@/lib/database/connection";
import { ExecutionError, executeReadOnly } from "@/lib/database/safe-executor";
import {
  type ApiError,
  type ExecuteResponse,
  MAX_BODY_BYTES,
  type SchemaResponse,
  analyzeRequestSchema,
  executeRequestSchema,
} from "./contracts";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: HEADERS });
}

function fail(status: number, code: string, message: string, details?: unknown): Response {
  const body: ApiError = { error: { code, message, ...(details === undefined ? {} : { details }) } };
  return json(body, status);
}

type BodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

/** Reads and parses a JSON body, enforcing content type and size limits. */
async function readJson(req: Request): Promise<BodyResult> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return { ok: false, response: fail(415, "unsupported_media_type", "Content-Type must be application/json.") };
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: fail(413, "payload_too_large", `Request bodies are limited to ${MAX_BODY_BYTES} bytes.`) };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: fail(400, "invalid_body", "The request body could not be read.") };
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return { ok: false, response: fail(413, "payload_too_large", `Request bodies are limited to ${MAX_BODY_BYTES} bytes.`) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: fail(400, "invalid_json", "The request body is not valid JSON.") };
  }
}

function validationFailure(e: ZodError): Response {
  return fail(
    400,
    "invalid_request",
    "The request did not match the expected shape.",
    e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

export async function handleAnalyze(req: Request): Promise<Response> {
  try {
    const body = await readJson(req);
    if (!body.ok) return body.response;
    const parsed = analyzeRequestSchema.safeParse(body.value);
    if (!parsed.success) return validationFailure(parsed.error);
    const { catalog, storage } = getDatabase();
    const result = compile(parsed.data.sql, catalog);
    return json({ ...result, database: { name: catalog.name, storage } });
  } catch {
    return fail(500, "internal_error", "The compiler could not process this request.");
  }
}

export async function handleExecute(req: Request): Promise<Response> {
  try {
    const body = await readJson(req);
    if (!body.ok) return body.response;
    const parsed = executeRequestSchema.safeParse(body.value);
    if (!parsed.success) return validationFailure(parsed.error);

    // Never trust the client: the query is compiled again here and must pass every phase.
    const { db, catalog } = getDatabase();
    const compiled = compile(parsed.data.sql, catalog);
    if (!compiled.success || !compiled.codegen) {
      return json(
        {
          error: { code: "query_rejected", message: "The query did not pass compilation, so it was not executed." },
          failedPhase: compiled.failedPhase,
          diagnostics: compiled.diagnostics,
        },
        422,
      );
    }

    const plan = parsed.data.plan ?? "optimized";
    const generated = plan === "original" ? compiled.codegen.original : compiled.codegen.optimized;
    const output = executeReadOnly(db, generated);
    const response: ExecuteResponse = {
      status: "ok",
      plan,
      ...output,
      sql: generated.displaySql,
      parameterizedSql: generated.sql,
      paramCount: generated.params.length,
    };
    return json(response);
  } catch (e) {
    if (e instanceof ExecutionError) {
      const status = e.kind === "rejected" ? 422 : e.kind === "timeout" ? 408 : 500;
      return fail(status, `execution_${e.kind}`, e.message);
    }
    return fail(500, "internal_error", "The query could not be executed.");
  }
}

export function handleSchema(): Response {
  try {
    const { catalog, storage } = getDatabase();
    const body: SchemaResponse = {
      database: { name: catalog.name, storage },
      tables: catalog.tables.map((t) => ({
        name: t.name,
        rowCount: t.rowCount,
        primaryKey: t.primaryKey,
        columns: t.columns.map((c) => ({ name: c.name, type: c.type, declaredType: c.declaredType, notNull: c.notNull, primaryKey: c.primaryKey })),
        foreignKeys: t.foreignKeys,
      })),
    };
    return json(body);
  } catch {
    return fail(500, "internal_error", "The schema could not be read.");
  }
}
