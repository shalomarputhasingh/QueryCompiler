import type Database from "better-sqlite3";
import { type CompileResult, compile } from "@/lib/compiler/pipeline";
import { type GeneratedSql, toBindValue } from "@/lib/compiler/code-generator";
import { createMemoryDatabase } from "@/lib/database/connection";
import { readCatalog } from "@/lib/database/schema";
import { lex } from "@/lib/compiler/lexer";
import { parse } from "@/lib/compiler/parser";
import type { Catalog } from "@/lib/compiler/catalog";
import { analyzeSemantics } from "@/lib/compiler/semantic-analyzer";
import { translateToAlgebra } from "@/lib/compiler/relational-algebra";
import { optimize } from "@/lib/compiler/optimizer";

export const db: Database.Database = createMemoryDatabase();
export const catalog: Catalog = readCatalog(db);

export function run(sql: string): CompileResult {
  return compile(sql, catalog);
}

export function parseSql(sql: string) {
  const lexed = lex(sql);
  return { lexed, ...parse(lexed.tokens) };
}

export function semantic(sql: string) {
  const { ast } = parseSql(sql);
  if (!ast) throw new Error(`Test SQL failed to parse: ${sql}`);
  return { ast, sem: analyzeSemantics(ast, catalog) };
}

export function optimizeSql(sql: string) {
  const { ast, sem } = semantic(sql);
  if (!sem.ok) throw new Error(`Test SQL failed semantic analysis: ${sql}\n${sem.diagnostics.map((d) => d.message).join("\n")}`);
  const plan = translateToAlgebra(ast, sem);
  return { plan, result: optimize(plan, catalog) };
}

export function rowsOf(generated: GeneratedSql): unknown[][] {
  return db.prepare(generated.sql).raw(true).all(...generated.params.map(toBindValue)) as unknown[][];
}

/** Rows as a sorted multiset, for order-insensitive comparison. */
export function multiset(rows: unknown[][]): string[] {
  return rows.map((r) => JSON.stringify(r)).sort();
}

export function errorCodes(result: { diagnostics: { severity: string; code: string }[] }): string[] {
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
}
