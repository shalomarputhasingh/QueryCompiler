import { describe, expect, it } from "vitest";
import { errorCodes, run, semantic } from "./helpers";

const messages = (sql: string) => run(sql).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("semantic: tables", () => {
  it("accepts existing tables and resolves them from the real catalog", () => {
    const r = run("SELECT name FROM students");
    expect(r.success).toBe(true);
    expect(r.semantic?.scope).toMatchObject([{ name: "students", tableName: "students" }]);
  });

  it("is case-insensitive for identifiers", () => {
    expect(run("SELECT NAME FROM Students").success).toBe(true);
  });

  it("reports unknown tables with a suggestion", () => {
    const r = run("SELECT name FROM studnts");
    expect(errorCodes(r)).toEqual(["QC3001"]);
    expect(r.diagnostics[0]?.hint).toContain("students");
    expect(r.failedPhase).toBe("semantic");
  });

  it("lists available tables when no suggestion is close", () => {
    expect(run("SELECT x FROM zzzzzz").diagnostics[0]?.hint).toContain("departments");
  });

  it("rejects duplicate aliases and self-joins without aliases", () => {
    expect(errorCodes(run("SELECT s.id FROM students s INNER JOIN courses s ON s.id = s.id"))).toContain("QC3002");
    expect(errorCodes(run("SELECT id FROM students INNER JOIN students ON 1 = 1"))).toContain("QC3002");
  });

  it("allows a self-join with distinct aliases", () => {
    expect(run("SELECT a.name, b.name FROM students a INNER JOIN students b ON a.department_id = b.department_id WHERE a.id < b.id").success).toBe(true);
  });
});

describe("semantic: columns and aliases", () => {
  it("reports unknown columns with a suggestion", () => {
    const r = run("SELECT nme FROM students");
    expect(errorCodes(r)).toEqual(["QC3004"]);
    expect(r.diagnostics[0]?.hint).toContain("name");
  });

  it("reports unknown columns in WHERE", () => {
    expect(messages("SELECT name FROM students WHERE mark > 5")[0]).toContain("Unknown column 'mark'");
  });

  it("resolves qualified columns through aliases", () => {
    const { sem } = semantic("SELECT s.name FROM students AS s WHERE s.marks > 1");
    expect(sem.ok).toBe(true);
    expect(Object.values(sem.resolutions).every((r) => r.table === "s" && r.tableName === "students")).toBe(true);
  });

  it("hides the original table name once an alias is given", () => {
    expect(errorCodes(run("SELECT students.name FROM students s"))).toEqual(["QC3003"]);
  });

  it("reports unknown qualifiers and columns missing from the qualified table", () => {
    expect(errorCodes(run("SELECT x.name FROM students s"))).toEqual(["QC3003"]);
    expect(errorCodes(run("SELECT s.title FROM students s"))).toEqual(["QC3004"]);
  });

  it("detects ambiguous unqualified columns across joined tables", () => {
    const r = run("SELECT id FROM students s INNER JOIN departments d ON s.department_id = d.id");
    expect(errorCodes(r)).toEqual(["QC3005"]);
    expect(r.diagnostics[0]?.message).toContain("'s' and 'd'");
    expect(r.diagnostics[0]?.hint).toContain("s.id");
  });

  it("accepts unqualified columns that are unique to one table", () => {
    expect(run("SELECT title, city FROM courses c INNER JOIN students s ON c.id = s.id").success).toBe(true);
  });

  it("limits a JOIN condition to tables declared so far", () => {
    const r = run("SELECT s.id FROM students s INNER JOIN enrollments e ON s.id = c.id INNER JOIN courses c ON c.id = e.course_id");
    expect(errorCodes(r)).toEqual(["QC3003"]);
    expect(r.diagnostics[0]?.message).toContain("not yet in scope");
  });

  it("expands stars into output columns", () => {
    const r = run("SELECT * FROM departments");
    expect(r.semantic?.outputColumns.map((c) => c.name)).toEqual(["id", "name", "building", "budget"]);
    const two = run("SELECT d.* FROM students s INNER JOIN departments d ON s.department_id = d.id");
    expect(two.semantic?.outputColumns).toHaveLength(4);
  });

  it("names unaliased expressions from their text and respects aliases", () => {
    const r = run("SELECT marks + 1, name AS n, COUNT(*) FROM students GROUP BY name, marks");
    expect(r.semantic?.outputColumns.map((c) => c.name)).toEqual(["marks + 1", "n", "COUNT(*)"]);
  });

  it("allows ORDER BY to use select aliases", () => {
    expect(run("SELECT marks AS m FROM students ORDER BY m DESC").success).toBe(true);
    expect(errorCodes(run("SELECT marks AS m FROM students WHERE m > 5"))).toEqual(["QC3004"]);
  });

  it("rejects duplicate select aliases", () => {
    expect(errorCodes(run("SELECT name AS x, city AS x FROM students"))).toEqual(["QC3014"]);
  });
});

describe("semantic: type checking", () => {
  it("accepts numeric comparisons across INTEGER and REAL", () => {
    expect(run("SELECT name FROM students WHERE gpa > marks").success).toBe(true);
    expect(run("SELECT name FROM students WHERE age >= 18.5").success).toBe(true);
  });

  it("rejects comparing text with a number", () => {
    const r = run("SELECT name FROM students WHERE name > 5");
    expect(errorCodes(r)).toEqual(["QC3011"]);
    expect(r.diagnostics[0]?.message).toContain("TEXT with INTEGER");
    expect(errorCodes(run("SELECT name FROM students WHERE marks = 'high'"))).toEqual(["QC3011"]);
  });

  it("allows comparison with NULL literals (always NULL, never an error)", () => {
    expect(run("SELECT name FROM students WHERE marks = NULL").success).toBe(true);
  });

  it("requires boolean conditions", () => {
    expect(errorCodes(run("SELECT name FROM students WHERE marks"))).toEqual(["QC3013"]);
    expect(errorCodes(run("SELECT name FROM students WHERE marks AND age > 3"))).toEqual(["QC3010"]);
    expect(errorCodes(run("SELECT name FROM students WHERE NOT marks"))).toEqual(["QC3010"]);
  });

  it("requires numeric operands for arithmetic", () => {
    expect(errorCodes(run("SELECT name + 1 FROM students"))).toEqual(["QC3010"]);
    expect(errorCodes(run("SELECT -name FROM students"))).toEqual(["QC3010"]);
    expect(errorCodes(run("SELECT gpa % 2 FROM students"))).toEqual(["QC3010"]);
  });

  it("types arithmetic results", () => {
    const r = run("SELECT marks + 1, marks + 1.5, marks / 2, AVG(marks) FROM students GROUP BY marks");
    expect(r.semantic?.outputColumns.map((c) => c.dataType)).toEqual(["INTEGER", "REAL", "INTEGER", "REAL"]);
  });

  it("warns about integer division without failing", () => {
    const r = run("SELECT marks / 2 FROM students");
    expect(r.success).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["QC3020"]);
    expect(r.stats.warningCount).toBe(1);
  });

  it("checks LIKE, BETWEEN and IN operand types", () => {
    expect(errorCodes(run("SELECT name FROM students WHERE marks LIKE 'a%'"))).toEqual(["QC3010"]);
    expect(errorCodes(run("SELECT name FROM students WHERE marks BETWEEN 'a' AND 'z'"))).toEqual(["QC3011", "QC3011"]);
    expect(errorCodes(run("SELECT name FROM students WHERE city IN ('a', 3)"))).toEqual(["QC3011"]);
    expect(run("SELECT name FROM students WHERE city IN ('a', 'b') AND marks BETWEEN 1 AND 99 AND email IS NULL").success).toBe(true);
  });

  it("records a type for expression nodes", () => {
    const { ast, sem } = semantic("SELECT name FROM students WHERE marks > 80");
    expect(sem.types[ast.where!.id]).toBe("BOOLEAN");
  });
});

describe("semantic: aggregates and grouping", () => {
  it("accepts well-formed aggregate queries", () => {
    expect(run("SELECT COUNT(*) FROM students").success).toBe(true);
    expect(run("SELECT department_id, COUNT(*), AVG(marks), MAX(name) FROM students GROUP BY department_id HAVING COUNT(*) > 1").success).toBe(true);
    expect(run("SELECT department_id + 1, COUNT(*) FROM students GROUP BY department_id + 1").success).toBe(true);
  });

  it("requires non-aggregated columns to be grouped", () => {
    const r = run("SELECT name, COUNT(*) FROM students");
    expect(errorCodes(r)).toEqual(["QC3017"]);
    expect(messages("SELECT city, name FROM students GROUP BY city")[0]).toContain("'name'");
  });

  it("rejects aggregates in WHERE, ON and GROUP BY and nested aggregates", () => {
    expect(errorCodes(run("SELECT name FROM students WHERE COUNT(*) > 1"))).toEqual(["QC3008"]);
    expect(errorCodes(run("SELECT name FROM students GROUP BY COUNT(*)"))).toContain("QC3008");
    expect(errorCodes(run("SELECT SUM(COUNT(*)) FROM students"))).toEqual(["QC3007"]);
  });

  it("validates function names, arity and argument types", () => {
    expect(errorCodes(run("SELECT FOO(marks) FROM students"))).toEqual(["QC3006"]);
    expect(errorCodes(run("SELECT SUM(*) FROM students"))).toEqual(["QC3009"]);
    expect(errorCodes(run("SELECT SUM(name) FROM students"))).toEqual(["QC3012"]);
    expect(errorCodes(run("SELECT AVG(city) FROM students"))).toEqual(["QC3012"]);
    expect(errorCodes(run("SELECT MAX(marks, age) FROM students"))).toEqual(["QC3009"]);
    expect(run("SELECT MIN(name), MAX(city) FROM students").success).toBe(true);
  });

  it("rejects HAVING without grouping and SELECT * with grouping", () => {
    expect(errorCodes(run("SELECT name FROM students HAVING marks > 1"))).toContain("QC3015");
    expect(errorCodes(run("SELECT * FROM students GROUP BY city"))).toContain("QC3016");
  });

  it("rejects positional GROUP BY / ORDER BY", () => {
    expect(errorCodes(run("SELECT name FROM students ORDER BY 1"))).toEqual(["QC3019"]);
  });

  it("requires ORDER BY expressions to be selected with DISTINCT", () => {
    expect(errorCodes(run("SELECT DISTINCT city FROM students ORDER BY name"))).toEqual(["QC3018"]);
    expect(run("SELECT DISTINCT city FROM students ORDER BY city").success).toBe(true);
  });
});

describe("semantic: symbol table", () => {
  it("lists tables, aliases, schema columns, select aliases and references", () => {
    const r = run("SELECT s.name AS n FROM students s WHERE s.marks > 80");
    const kinds = new Set(r.symbolTable.map((s) => s.kind));
    expect(kinds).toEqual(new Set(["table", "alias", "column", "column-alias", "reference"]));
    expect(r.symbolTable.find((s) => s.kind === "table")).toMatchObject({ name: "students", scope: "global" });
    expect(r.symbolTable.find((s) => s.kind === "alias")).toMatchObject({ name: "s" });
    expect(r.symbolTable.filter((s) => s.kind === "column" && s.scope === "s")).toHaveLength(9);
    expect(r.symbolTable.find((s) => s.kind === "reference" && s.name === "s.marks")).toMatchObject({ dataType: "INTEGER" });
  });

  it("is empty when parsing failed", () => {
    expect(run("SELECT FROM").symbolTable).toEqual([]);
  });
});
