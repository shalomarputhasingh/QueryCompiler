import type Database from "better-sqlite3";
import type { Catalog, ColumnType, ForeignKey, TableSchema } from "../compiler/catalog";

/** Declared-type → type mapping following SQLite's affinity rules. */
export function affinityOf(declared: string): ColumnType {
  const d = declared.toUpperCase();
  if (d.includes("INT")) return "INTEGER";
  if (d.includes("CHAR") || d.includes("CLOB") || d.includes("TEXT")) return "TEXT";
  return "REAL";
}

interface TableInfoRow {
  name: string;
  type: string;
  not_null: number;
  pk: number;
}
interface ForeignKeyRow {
  table: string;
  from: string;
  to: string;
}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Reads the live schema from SQLite; this is the semantic analyzer's source of truth. */
export function readCatalog(db: Database.Database, name = "Sample university database"): Catalog {
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
    .all() as { name: string }[];

  const tables: TableSchema[] = names.map(({ name: tableName }) => {
    const info = db.prepare('SELECT name, type, "notnull" AS not_null, pk FROM pragma_table_info(?)').all(tableName) as TableInfoRow[];
    const fks = db.prepare('SELECT "table" AS "table", "from" AS "from", "to" AS "to" FROM pragma_foreign_key_list(?)').all(tableName) as ForeignKeyRow[];
    const { count } = db.prepare(`SELECT COUNT(*) AS count FROM ${quote(tableName)}`).get() as { count: number };
    const foreignKeys: ForeignKey[] = fks.map((f) => ({ column: f.from, referencesTable: f.table, referencesColumn: f.to }));
    return {
      name: tableName,
      columns: info.map((c) => ({
        name: c.name,
        declaredType: c.type || "BLOB",
        type: affinityOf(c.type),
        notNull: c.not_null === 1 || c.pk > 0,
        primaryKey: c.pk > 0,
      })),
      primaryKey: info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name),
      foreignKeys,
      rowCount: count,
    };
  });
  return { name, tables };
}
