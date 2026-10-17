import type { Range } from "./diagnostics";

export type SymbolKind = "table" | "alias" | "column" | "column-alias" | "reference";
export type DataType = "INTEGER" | "REAL" | "TEXT" | "BOOLEAN" | "NULL" | "UNKNOWN";

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  dataType: DataType | null;
  /** Owning scope: "global" for tables, the alias/table for columns, "query" for aliases. */
  scope: string;
  /** Where the symbol is declared or used in the query (absent for schema-only columns). */
  location: Range | null;
  detail?: string;
}

/** Collects symbols during semantic analysis; entries are kept in insertion order. */
export class SymbolTable {
  readonly entries: SymbolEntry[] = [];

  add(entry: SymbolEntry): void {
    this.entries.push(entry);
  }

  byKind(kind: SymbolKind): SymbolEntry[] {
    return this.entries.filter((e) => e.kind === kind);
  }
}
