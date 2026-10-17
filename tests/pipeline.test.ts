import { describe, expect, it } from "vitest";
import { run } from "./helpers";

describe("pipeline: successful compilation", () => {
  const r = run("SELECT name FROM students WHERE marks > 80;");

  it("runs every phase and reports statistics", () => {
    expect(r.success).toBe(true);
    expect(r.failedPhase).toBeNull();
    expect(r.phases.map((p) => [p.id, p.status])).toEqual([
      ["lexical", "success"],
      ["syntax", "success"],
      ["semantic", "success"],
      ["translation", "success"],
      ["optimization", "success"],
      ["codegen", "success"],
    ]);
    expect(r.stats).toMatchObject({ tokenCount: 9, diagnosticCount: 0, errorCount: 0, semanticPassed: true, rulesApplied: 0 });
  });

  it("produces tokens, an AST, relational algebra and generated SQL from the real compiler", () => {
    expect(r.tokens.map((t) => t.lexeme)).toEqual(["SELECT", "name", "FROM", "students", "WHERE", "marks", ">", "80", ";", ""]);
    expect(r.ast?.kind).toBe("SelectStatement");
    expect(r.astText).toContain("ColumnRef marks");
    expect(r.algebra?.text).toBe("π_{name}(σ_{marks > 80}(students))");
    expect(r.algebra?.tree).toBe("π name\n└─ σ marks > 80\n   └─ scan students");
    expect(r.codegen?.optimized.displaySql).toBe("SELECT students.name\nFROM students\nWHERE students.marks > 80");
    expect(r.codegen?.optimized.params).toEqual([{ type: "integer", value: "80" }]);
    expect(r.codegen?.optimizedInstructions.instructions.map((i) => i.opcode)).toEqual(["SCAN", "FILTER", "PROJECT"]);
  });

  it("is JSON-serialisable (no BigInt, no cycles)", () => {
    expect(() => JSON.stringify(r)).not.toThrow();
  });

  it("is deterministic apart from measured timings", () => {
    const strip = (x: ReturnType<typeof run>) => JSON.stringify({ ...x, phases: x.phases.map((p) => ({ ...p, durationMs: 0 })), stats: { ...x.stats, totalMs: 0 } });
    expect(strip(run("SELECT name FROM students WHERE marks > 80;"))).toBe(strip(r));
  });

  it("counts applied optimization rules", () => {
    const opt = run("SELECT name FROM students WHERE marks > 10 * 8 AND 1 = 1");
    expect(opt.stats.rulesApplied).toBe(opt.optimization?.steps.length);
    expect(opt.stats.rulesApplied).toBe(2);
    expect(opt.optimization?.optimized.text).toBe("π_{name}(σ_{marks > 80}(students))");
    expect(opt.optimization?.original.text).toContain("10 * 8");
  });
});

describe("pipeline: invalid SQL stops at the right phase", () => {
  it("stops after lexical errors and still returns the tokens", () => {
    const r = run("SELECT name FROM students WHERE city = 'oops");
    expect(r.failedPhase).toBe("lexical");
    expect(r.tokens.length).toBeGreaterThan(5);
    expect(r.ast).toBeNull();
    expect(r.phases.map((p) => p.status)).toEqual(["error", "skipped", "skipped", "skipped", "skipped", "skipped"]);
  });

  it("stops after syntax errors; tokens remain available", () => {
    const r = run("SELECT name WHERE marks > 80");
    expect(r.failedPhase).toBe("syntax");
    expect(r.tokens.length).toBeGreaterThan(4);
    expect(r.ast).toBeNull();
    expect(r.semantic).toBeNull();
    expect(r.phases.map((p) => p.status)).toEqual(["success", "error", "skipped", "skipped", "skipped", "skipped"]);
  });

  it("stops after semantic errors; tokens and AST remain available", () => {
    const r = run("SELECT nme FROM students");
    expect(r.failedPhase).toBe("semantic");
    expect(r.ast).not.toBeNull();
    expect(r.astText).toContain("SelectStatement");
    expect(r.semantic?.ok).toBe(false);
    expect(r.algebra).toBeNull();
    expect(r.optimization).toBeNull();
    expect(r.codegen).toBeNull();
    expect(r.stats.semanticPassed).toBe(false);
  });

  it("handles empty and whitespace-only input", () => {
    for (const src of ["", "   \n\t ", "-- nothing"]) {
      const r = run(src);
      expect(r.success).toBe(false);
      expect(r.failedPhase).toBe("syntax");
      expect(r.diagnostics[0]?.code).toBe("QC2001");
    }
  });

  it("rejects oversized input without crashing", () => {
    const r = run("SELECT 1 FROM students WHERE " + "1 = 1 AND ".repeat(2000) + "1 = 1");
    expect(r.success).toBe(false);
    expect(r.diagnostics[0]?.code).toBe("QC1010");
  });

  it("survives hostile inputs", () => {
    const inputs = [
      "\u0000\u0001\u0002",
      "(".repeat(5000),
      "SELECT " + "(".repeat(2000) + "1" + ")".repeat(2000) + " FROM students",
      "SELECT 'a' FROM students WHERE " + "NOT ".repeat(1500) + "TRUE",
      "SELECT 💥 FROM students",
      "'''''''",
      "SELECT /* unterminated",
    ];
    for (const src of inputs) {
      expect(() => run(src)).not.toThrow();
    }
  });

  it("supplies line and column for every diagnostic", () => {
    const r = run("SELECT name,\n  nme2\nFROM students");
    expect(r.diagnostics[0]?.range.start).toMatchObject({ line: 2, column: 3 });
  });
});
