import { describe, expect, it } from "vitest";
import { lex } from "@/lib/compiler/lexer";

const types = (sql: string) => lex(sql).tokens.map((t) => t.type);
const lexemes = (sql: string) => lex(sql).tokens.filter((t) => t.type !== "EOF").map((t) => t.lexeme);

describe("lexer: keywords and identifiers", () => {
  it("recognises keywords case-insensitively and normalises their value", () => {
    const { tokens } = lex("select Distinct from");
    expect(tokens.slice(0, 3).map((t) => [t.type, t.value, t.lexeme])).toEqual([
      ["KEYWORD", "SELECT", "select"],
      ["KEYWORD", "DISTINCT", "Distinct"],
      ["KEYWORD", "FROM", "from"],
    ]);
  });

  it("distinguishes identifiers from keywords", () => {
    expect(types("students marks_2 _x")).toEqual(["IDENTIFIER", "IDENTIFIER", "IDENTIFIER", "EOF"]);
  });

  it("scans quoted identifiers and unescapes doubled quotes", () => {
    const { tokens, diagnostics } = lex('"my col" `x`');
    expect(diagnostics).toEqual([]);
    expect(tokens[0]).toMatchObject({ type: "QUOTED_IDENTIFIER", value: "my col", lexeme: '"my col"' });
    expect(tokens[1]).toMatchObject({ type: "QUOTED_IDENTIFIER", value: "x" });
    expect(lex('"a""b"').tokens[0]?.value).toBe('a"b');
  });

  it("always ends with exactly one EOF token", () => {
    expect(types("")).toEqual(["EOF"]);
    expect(types("a")).toEqual(["IDENTIFIER", "EOF"]);
  });
});

describe("lexer: literals", () => {
  it("scans integer, decimal and exponent numbers with numeric values", () => {
    const nums = lex("42 3.14 .5 1e3 2.5E-2").tokens.filter((t) => t.type === "NUMBER");
    expect(nums.map((t) => t.value)).toEqual([42, 3.14, 0.5, 1000, 0.025]);
  });

  it("scans strings with escaped quotes", () => {
    const { tokens, diagnostics } = lex("'it''s' ''");
    expect(diagnostics).toEqual([]);
    expect(tokens[0]).toMatchObject({ type: "STRING", value: "it's", lexeme: "'it''s'" });
    expect(tokens[1]).toMatchObject({ type: "STRING", value: "" });
  });

  it("reports an unterminated string with its location", () => {
    const { diagnostics, tokens } = lex("SELECT 'abc\nFROM t");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "QC1001", severity: "error", phase: "lexical" });
    expect(diagnostics[0]?.range.start).toMatchObject({ line: 1, column: 8 });
    expect(tokens.some((t) => t.type === "INVALID")).toBe(true);
    // Scanning resumes on the next line.
    expect(lexemes("SELECT 'abc\nFROM t")).toContain("FROM");
  });

  it("reports a digit-led identifier as one invalid token", () => {
    const { diagnostics, tokens } = lex("12abc");
    expect(diagnostics[0]?.code).toBe("QC1004");
    expect(tokens.filter((t) => t.type === "INVALID")).toHaveLength(1);
  });
});

describe("lexer: operators and punctuation", () => {
  it("scans multi-character comparison operators greedily", () => {
    expect(lexemes("<= >= <> != = < >")).toEqual(["<=", ">=", "<>", "!=", "=", "<", ">"]);
    expect(types("<= >=").slice(0, 2)).toEqual(["OPERATOR", "OPERATOR"]);
  });

  it("scans arithmetic operators and punctuation", () => {
    expect(lexemes("a+b-c*d/e%f")).toEqual(["a", "+", "b", "-", "c", "*", "d", "/", "e", "%", "f"]);
    const punct = lex("( ) , . ;").tokens.filter((t) => t.type === "PUNCTUATION");
    expect(punct.map((t) => t.lexeme)).toEqual(["(", ")", ",", ".", ";"]);
  });

  it("splits qualified names into identifier, dot, identifier", () => {
    expect(lexemes("s.name")).toEqual(["s", ".", "name"]);
  });
});

describe("lexer: whitespace and comments", () => {
  it("skips whitespace and comments but keeps correct positions", () => {
    const sql = "SELECT -- pick\n  /* block\ncomment */ name";
    const { tokens, comments, diagnostics } = lex(sql);
    expect(diagnostics).toEqual([]);
    expect(comments.map((c) => c.block)).toEqual([false, true]);
    const name = tokens.find((t) => t.lexeme === "name");
    expect(name?.range.start).toMatchObject({ line: 3, column: 12 });
    expect(name?.range.start.offset).toBe(sql.indexOf("name"));
  });

  it("reports an unterminated block comment", () => {
    const { diagnostics } = lex("SELECT /* never closed");
    expect(diagnostics.map((d) => d.code)).toEqual(["QC1003"]);
  });

  it("does not treat a minus sign between operands as a comment", () => {
    expect(lexemes("a - b")).toEqual(["a", "-", "b"]);
  });
});

describe("lexer: line and column tracking", () => {
  it("tracks lines, columns and offsets, including CRLF", () => {
    const { tokens } = lex("SELECT a\r\nFROM t");
    const from = tokens.find((t) => t.lexeme === "FROM")!;
    expect(from.range.start).toMatchObject({ line: 2, column: 1, offset: 10 });
    expect(from.range.end).toMatchObject({ line: 2, column: 5, offset: 14 });
  });

  it("uses an exclusive end column", () => {
    const t = lex("abc").tokens[0]!;
    expect(t.range.start.column).toBe(1);
    expect(t.range.end.column).toBe(4);
  });
});

describe("lexer: invalid characters", () => {
  it("reports each invalid character but keeps scanning", () => {
    const { tokens, diagnostics } = lex("SELECT # FROM @ t");
    expect(diagnostics.map((d) => d.code)).toEqual(["QC1006", "QC1006"]);
    expect(diagnostics[0]?.message).toContain("'#'");
    expect(tokens.filter((t) => t.type === "INVALID").map((t) => t.lexeme)).toEqual(["#", "@"]);
    expect(lexemes("SELECT # FROM @ t")).toContain("FROM");
  });

  it("suggests != for a lone exclamation mark", () => {
    expect(lex("a ! b").diagnostics[0]?.hint).toContain("!=");
  });
});
