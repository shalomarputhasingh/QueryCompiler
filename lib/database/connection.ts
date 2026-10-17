import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Catalog } from "../compiler/catalog";
import { readCatalog } from "./schema";
import { seedDatabase } from "./seed";

export interface DatabaseHandle {
  db: Database.Database;
  catalog: Catalog;
  /** "file" when backed by SQLITE_PATH, "memory" when the file system was not writable. */
  storage: "file" | "memory";
  path: string;
}

const globalForDb = globalThis as unknown as { __queryCompilerDb?: DatabaseHandle };

export function databasePath(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.SQLITE_PATH ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "querycompiler.db"));
}

function createSeededFile(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Seed into a temporary file and rename, so concurrent workers never see a half-built database.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const db = new Database(tmp);
  try {
    seedDatabase(db);
  } finally {
    db.close();
  }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (!fs.existsSync(file)) throw e;
  }
}

function open(): DatabaseHandle {
  const file = databasePath();
  try {
    if (!fs.existsSync(file)) createSeededFile(file);
    // The application never writes: open read-only and also forbid writes at the SQL level.
    const db = new Database(file, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
    return { db, catalog: readCatalog(db), storage: "file", path: file };
  } catch {
    // Read-only or ephemeral file systems: fall back to a seeded in-memory database.
    const db = new Database(":memory:");
    seedDatabase(db);
    db.pragma("query_only = ON");
    return { db, catalog: readCatalog(db), storage: "memory", path: ":memory:" };
  }
}

/** Lazily opened, process-wide read-only handle to the sample database. */
export function getDatabase(): DatabaseHandle {
  globalForDb.__queryCompilerDb ??= open();
  return globalForDb.__queryCompilerDb;
}

/** Fresh seeded in-memory database (tests and tooling). */
export function createMemoryDatabase(): Database.Database {
  const db = new Database(":memory:");
  seedDatabase(db);
  return db;
}
