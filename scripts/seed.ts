/**
 * Creates (or with --reset, rebuilds) the SQLite sample database.
 *   npm run db:seed            create it if it does not exist
 *   npm run db:seed -- --reset drop everything and re-seed
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { resetDatabase, seedDatabase } from "../lib/database/seed";
import { readCatalog } from "../lib/database/schema";

const file = path.resolve(process.env.SQLITE_PATH ?? path.join("data", "querycompiler.db"));
const reset = process.argv.includes("--reset");

fs.mkdirSync(path.dirname(file), { recursive: true });
const existed = fs.existsSync(file);
const db = new Database(file);
try {
  if (!existed) seedDatabase(db);
  else if (reset) resetDatabase(db);
  else console.log(`Database already exists at ${file}; use --reset to rebuild it.`);
  const catalog = readCatalog(db);
  console.log(`${file}\n${catalog.tables.map((t) => `  ${t.name}: ${t.rowCount} rows`).join("\n")}`);
} finally {
  db.close();
}
