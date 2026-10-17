import { describe, expect, it } from "vitest";
import { explainCompilation } from "@/lib/compiler/explain";
import { DEFAULT_QUERY, EXAMPLES } from "@/lib/utils/examples";
import { db, multiset, rowsOf, run } from "./helpers";

describe("example queries", () => {
  it("includes the required variety", () => {
    expect(EXAMPLES.filter((e) => e.category !== "invalid").length).toBeGreaterThanOrEqual(8);
    const topics = EXAMPLES.map((e) => e.sql).join("\n");
    for (const needle of ["WHERE", "ORDER BY", "LIMIT", "GROUP BY", "COUNT(", "(marks > 90 OR"]) expect(topics).toContain(needle);
    for (const id of ["bad-table", "bad-column", "missing-operand", "unterminated-string", "bad-structure"]) {
      expect(EXAMPLES.some((e) => e.id === id)).toBe(true);
    }
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
  });

  for (const ex of EXAMPLES) {
    it(`${ex.id}: ${ex.expected === "success" ? "compiles" : `stops at ${ex.expected}`}`, () => {
      const r = run(ex.sql);
      if (ex.expected === "success") {
        expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
        expect(r.success).toBe(true);
        // Every valid example also returns the same rows as SQLite does for the original text.
        expect(multiset(rowsOf(r.codegen!.optimized))).toEqual(multiset(db.prepare(ex.sql).raw(true).all() as unknown[][]));
      } else {
        expect(r.success).toBe(false);
        expect(r.failedPhase).toBe(ex.expected);
      }
    });
  }

  it("the default query is valid", () => {
    expect(run(DEFAULT_QUERY).success).toBe(true);
  });
});

describe("learning mode", () => {
  it("explains each phase from real compiler output", () => {
    const r = run("SELECT s.name FROM students s INNER JOIN departments d ON s.department_id = d.id WHERE (s.marks > 90 OR s.gpa > 3.5) AND d.budget > 600000 ORDER BY s.name LIMIT 3;");
    const sections = explainCompilation(r);
    expect(sections.map((s) => s.id)).toEqual(["query", "lexical", "syntax", "semantic", "translation", "optimization"]);
    expect(sections.every((s) => s.status === "ok")).toBe(true);
    const text = (id: string) => sections.find((s) => s.id === id)!.points.join("\n");
    expect(text("query")).toContain("Joins departments (alias d)");
    expect(text("query")).toContain("Returns at most 3 rows");
    expect(text("lexical")).toMatch(/keyword/i);
    expect(text("syntax")).toContain("root of the tree is AND");
    expect(text("syntax")).toContain("mixes AND and OR");
    expect(text("semantic")).toContain("Column check");
    expect(text("translation")).toContain("⋈ Inner join");
    expect(text("optimization")).toContain("selection-pushdown".replace("selection-pushdown", "Selection pushdown"));
  });

  it("reports the failing phase and skips the rest", () => {
    const sections = explainCompilation(run("SELECT name FROM students WHERE marks >"));
    expect(sections.find((s) => s.id === "syntax")).toMatchObject({ status: "error" });
    expect(sections.find((s) => s.id === "syntax")!.points[0]).toContain("Missing operand");
    expect(sections.find((s) => s.id === "semantic")!.status).toBe("skipped");
    expect(sections.find((s) => s.id === "query")!.status).toBe("skipped");
  });

  it("states honestly when no rule applies", () => {
    const sections = explainCompilation(run("SELECT name FROM students WHERE marks > 80"));
    expect(sections.find((s) => s.id === "optimization")!.points[0]).toContain("No rewrite rule applied");
  });
});
