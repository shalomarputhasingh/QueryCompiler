import { lex } from "@/lib/compiler/lexer";

export type SqlClass = "keyword" | "string" | "number" | "operator" | "comment" | "ident" | "plain";
export interface Segment {
  text: string;
  cls: SqlClass;
}

/** Syntax highlighting powered by the project's own lexer. */
export function highlightSql(code: string): Segment[] {
  const { tokens, comments } = lex(code);
  const spans: { start: number; end: number; cls: SqlClass }[] = [];
  for (const t of tokens) {
    if (t.type === "EOF") continue;
    const cls: SqlClass =
      t.type === "KEYWORD" ? "keyword" : t.type === "STRING" ? "string" : t.type === "NUMBER" ? "number" : t.type === "OPERATOR" ? "operator" : t.type === "INVALID" ? (t.lexeme.startsWith("'") ? "string" : "plain") : t.type === "PUNCTUATION" ? "plain" : "ident";
    spans.push({ start: t.range.start.offset, end: t.range.end.offset, cls });
  }
  for (const c of comments) spans.push({ start: c.range.start.offset, end: c.range.end.offset, cls: "comment" });
  spans.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start < pos) continue;
    if (s.start > pos) out.push({ text: code.slice(pos, s.start), cls: "plain" });
    out.push({ text: code.slice(s.start, s.end), cls: s.cls });
    pos = s.end;
  }
  if (pos < code.length) out.push({ text: code.slice(pos), cls: "plain" });
  return out;
}
