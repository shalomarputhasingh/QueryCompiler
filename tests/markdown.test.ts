import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "@/lib/utils/markdown";

describe("markdown inline", () => {
  it("parses code, bold, italic and http links", () => {
    expect(parseInline("a `b` **c** *d* [e](https://x.dev/y)")).toEqual([
      { t: "text", v: "a " },
      { t: "code", v: "b" },
      { t: "text", v: " " },
      { t: "bold", v: [{ t: "text", v: "c" }] },
      { t: "text", v: " " },
      { t: "italic", v: [{ t: "text", v: "d" }] },
      { t: "text", v: " " },
      { t: "link", href: "https://x.dev/y", v: "e" },
    ]);
  });
  it("leaves snake_case, stray asterisks and unclosed markers literal", () => {
    expect(parseInline("department_id and enrollment_year")).toEqual([{ t: "text", v: "department_id and enrollment_year" }]);
    expect(parseInline("2 * 3 * 4")).toEqual([{ t: "text", v: "2 * 3 * 4" }]);
    expect(parseInline("**oops and `tick")).toEqual([{ t: "text", v: "**oops and `tick" }]);
  });
  it("never turns javascript: or relative URLs into links", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ t: "text", v: "[x](javascript:alert(1))" }]);
  });
  it("keeps HTML as plain text", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("markdown blocks", () => {
  it("parses headings, lists, quotes, rules and paragraphs", () => {
    const b = parseMarkdown("## Title\nintro line\nsecond line\n\n- a\n- b\n\n1. one\n2. two\n\n> note\n\n---");
    expect(b.map((x) => x.t)).toEqual(["heading", "p", "ul", "ol", "quote", "hr"]);
    expect(b[1]).toMatchObject({ t: "p", v: [{ t: "text", v: "intro line second line" }] });
    expect(b[2]).toMatchObject({ items: [expect.anything(), expect.anything()] });
  });
  it("parses fenced code, including a block still streaming (unclosed)", () => {
    expect(parseMarkdown("```sql\nSELECT 1\nFROM t\n```")[0]).toEqual({ t: "code", lang: "sql", v: "SELECT 1\nFROM t", closed: true });
    expect(parseMarkdown("Try:\n```sql\nSELECT na")[1]).toEqual({ t: "code", lang: "sql", v: "SELECT na", closed: false });
  });
  it("parses tables", () => {
    const t = parseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")[0];
    expect(t).toMatchObject({ t: "table", rows: [[[{ t: "text", v: "1" }], [{ t: "text", v: "2" }]]] });
  });
});
