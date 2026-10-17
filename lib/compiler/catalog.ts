/** Plain-data description of a database schema; the semantic analyzer's source of truth. */
export type ColumnType = "INTEGER" | "REAL" | "TEXT";

export interface ColumnSchema {
  name: string;
  /** Declared type as stored in the database (e.g. "INTEGER", "TEXT"). */
  declaredType: string;
  type: ColumnType;
  notNull: boolean;
  primaryKey: boolean;
}

export interface ForeignKey {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  rowCount: number;
}

export interface Catalog {
  name: string;
  tables: TableSchema[];
}

export function findTable(catalog: Catalog, name: string): TableSchema | undefined {
  const lower = name.toLowerCase();
  return catalog.tables.find((t) => t.name.toLowerCase() === lower);
}

export function findColumn(table: TableSchema, name: string): ColumnSchema | undefined {
  const lower = name.toLowerCase();
  return table.columns.find((c) => c.name.toLowerCase() === lower);
}
