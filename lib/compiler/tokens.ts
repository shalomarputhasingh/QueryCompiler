import type { Range } from "./diagnostics";

export type TokenType =
  | "KEYWORD"
  | "IDENTIFIER"
  | "QUOTED_IDENTIFIER"
  | "NUMBER"
  | "STRING"
  | "OPERATOR"
  | "PUNCTUATION"
  | "INVALID"
  | "EOF";

export const TOKEN_TYPES: readonly TokenType[] = [
  "KEYWORD",
  "IDENTIFIER",
  "QUOTED_IDENTIFIER",
  "NUMBER",
  "STRING",
  "OPERATOR",
  "PUNCTUATION",
  "INVALID",
  "EOF",
];

export interface Token {
  type: TokenType;
  /** Exact source text of the token. */
  lexeme: string;
  /**
   * Normalised value: upper-cased text for keywords, the unescaped content for strings and
   * quoted identifiers, the numeric value for numbers, and the lexeme otherwise.
   */
  value: string | number;
  range: Range;
}

export interface Comment {
  text: string;
  block: boolean;
  range: Range;
}

/** Keywords the grammar understands. */
export const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  "SELECT",
  "DISTINCT",
  "FROM",
  "WHERE",
  "GROUP",
  "BY",
  "HAVING",
  "ORDER",
  "ASC",
  "DESC",
  "LIMIT",
  "OFFSET",
  "AS",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "TRUE",
  "FALSE",
  "IS",
  "IN",
  "LIKE",
  "BETWEEN",
  "JOIN",
  "INNER",
  "ON",
]);

/**
 * SQL keywords that are recognised (so they can be reported precisely) but are outside the
 * supported subset. Using them yields an "unsupported construct" diagnostic.
 */
export const UNSUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  "LEFT",
  "RIGHT",
  "FULL",
  "OUTER",
  "CROSS",
  "NATURAL",
  "USING",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "WITH",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "EXISTS",
  "ALL",
  "ANY",
  "VALUES",
  "SET",
  "INTO",
  "TABLE",
  "REPLACE",
  "VACUUM",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "WINDOW",
  "OVER",
  "PARTITION",
  "CAST",
  "ESCAPE",
  "GLOB",
  "COLLATE",
]);

export const KEYWORDS: ReadonlySet<string> = new Set([...SUPPORTED_KEYWORDS, ...UNSUPPORTED_KEYWORDS]);

export const COMPARISON_OPERATORS: ReadonlySet<string> = new Set(["=", "<>", "!=", "<", "<=", ">", ">="]);
