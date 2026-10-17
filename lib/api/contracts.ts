import { z } from "zod";
import { MAX_SOURCE_LENGTH } from "@/lib/compiler/pipeline";

/** Largest accepted request body, in bytes. */
export const MAX_BODY_BYTES = 32_000;

export const analyzeRequestSchema = z
  .object({ sql: z.string().max(MAX_SOURCE_LENGTH, `The query is too long (limit ${MAX_SOURCE_LENGTH} characters)`) })
  .strict();

export const executeRequestSchema = z
  .object({
    sql: z.string().max(MAX_SOURCE_LENGTH, `The query is too long (limit ${MAX_SOURCE_LENGTH} characters)`),
    plan: z.enum(["optimized", "original"]).optional(),
  })
  .strict();

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
export type ExecuteRequest = z.infer<typeof executeRequestSchema>;

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface ExecuteResponse {
  status: "ok";
  plan: "optimized" | "original";
  columns: string[];
  rows: (string | number | null)[][];
  rowCount: number;
  truncated: boolean;
  /** Measured wall-clock time of the SQLite call only. */
  durationMs: number;
  /** SQL that was executed, with literals shown inline. */
  sql: string;
  parameterizedSql: string;
  paramCount: number;
}

export interface SchemaResponse {
  database: { name: string; storage: "file" | "memory" };
  tables: {
    name: string;
    rowCount: number;
    primaryKey: string[];
    columns: { name: string; type: string; declaredType: string; notNull: boolean; primaryKey: boolean }[];
    foreignKeys: { column: string; referencesTable: string; referencesColumn: string }[];
  }[];
}
