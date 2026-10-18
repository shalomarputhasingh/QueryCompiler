import { describe, expect, it } from "vitest";
import { highlightSql } from "@/lib/utils/highlight";

describe("highlightSql", () => {
  it("classifies keywords, identifiers, numbers, strings, operators and comments, and loses no text", () => {
    const code = "SELECT name -- who\nFROM students WHERE marks >= 80 AND city = 'it''s'";
    const segs = highlightSql(code);
    expect(segs.map((s) => s.text).join("")).toBe(code);
    const cls = (t: string) => segs.find((s) => s.text === t)?.cls;
    expect(cls("SELECT")).toBe("keyword");
    expect(cls("name")).toBe("ident");
    expect(cls("-- who")).toBe("comment");
    expect(cls("80")).toBe("number");
    expect(cls(">=")).toBe("operator");
    expect(cls("'it''s'")).toBe("string");
  });
  it("copes with broken input without dropping characters", () => {
    for (const code of ["SELECT 'oops", "SELECT # FROM", "/* open", ""]) expect(highlightSql(code).map((s) => s.text).join("")).toBe(code);
  });
});
