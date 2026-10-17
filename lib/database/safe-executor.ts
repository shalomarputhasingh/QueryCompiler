import type Database from "better-sqlite3";
import { type GeneratedSql, toBindValue } from "../compiler/code-generator";

export const MAX_RESULT_ROWS = 500;
export const MAX_EXECUTION_MS = 2_000;

export interface ExecutionOutput {
  columns: string[];
  rows: (string | number | null)[][];
  rowCount: number;
  /** True when more rows existed than MAX_RESULT_ROWS. */
  truncated: boolean;
  durationMs: number;
}

/** Raised for rejected or failed executions; messages are safe to show to users. */
export class ExecutionError extends Error {
  constructor(
    message: string,
    public readonly kind: "rejected" | "failed" | "timeout",
  ) {
    super(message);
  }
}

/**
 * Executes compiler-generated SQL. The statement has already passed lexing, parsing and semantic
 * analysis; the checks here are an independent second layer of defence.
 */
export function executeReadOnly(db: Database.Database, generated: GeneratedSql): ExecutionOutput {
  const sql = generated.sql.trim();
  if (!/^SELECT\b/i.test(sql) || sql.includes(";")) {
    throw new ExecutionError("Only a single read-only SELECT statement can be executed.", "rejected");
  }
  if (generated.params.length > 100) {
    throw new ExecutionError("The query contains too many literal values.", "rejected");
  }

  try {
    const stmt = db.prepare(sql);
    if (!stmt.reader) throw new ExecutionError("Only statements that return rows can be executed.", "rejected");
    const columns = stmt.columns().map((c) => c.name);
    const rows: (string | number | null)[][] = [];
    let truncated = false;
    const started = performance.now();
    for (const row of stmt.raw(true).iterate(...generated.params.map(toBindValue)) as IterableIterator<(string | number | null)[]>) {
      if (rows.length >= MAX_RESULT_ROWS) {
        truncated = true;
        break;
      }
      rows.push(row);
      if (rows.length % 50 === 0 && performance.now() - started > MAX_EXECUTION_MS) {
        throw new ExecutionError(`The query exceeded the ${MAX_EXECUTION_MS} ms time limit.`, "timeout");
      }
    }
    const durationMs = performance.now() - started;
    return { columns, rows, rowCount: rows.length, truncated, durationMs };
  } catch (e) {
    if (e instanceof ExecutionError) throw e;
    // Never leak SQLite internals (paths, messages) to the client.
    throw new ExecutionError("The sample database could not run this query.", "failed");
  }
}
