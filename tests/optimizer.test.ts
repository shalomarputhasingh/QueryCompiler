import { describe, expect, it } from "vitest";
import { generateSql } from "@/lib/compiler/code-generator";
import { optimize } from "@/lib/compiler/optimizer";
import { type RaNode, raToText } from "@/lib/compiler/relational-algebra";
import type { RExpr } from "@/lib/compiler/rexpr";
import { catalog, db, multiset, optimizeSql, rowsOf, run } from "./helpers";

const ruleIds = (sql: string) => optimizeSql(sql).result.steps.map((s) => s.ruleId);
const optimized = (sql: string) => raToText(optimizeSql(sql).result.optimized);
const skippedFor = (sql: string, rule: string) => optimizeSql(sql).result.skipped.filter((s) => s.ruleId === rule);

describe("optimizer: constant folding", () => {
  it("folds arithmetic on literals", () => {
    expect(optimized("SELECT name FROM students WHERE marks > 10 * 8")).toBe("π_{name}(σ_{marks > 80}(students))");
    expect(optimized("SELECT name FROM students WHERE marks > (2 + 3) * 4 - 1")).toBe("π_{name}(σ_{marks > 19}(students))");
  });

  it("follows SQLite integer division and division-by-zero semantics", () => {
    expect(optimized("SELECT name FROM students WHERE marks > 7 / 2")).toContain("marks > 3");
    expect(optimized("SELECT name FROM students WHERE marks > 7.0 / 2")).toContain("marks > 3.5");
    expect(optimized("SELECT name FROM students WHERE marks > 1 / 0")).toContain("σ_{NULL}");
    expect(optimized("SELECT name FROM students WHERE marks > 7 % 4")).toContain("marks > 3");
  });

  it("folds comparisons, IS NULL, BETWEEN and IN of literals using three-valued logic", () => {
    expect(optimized("SELECT name FROM students WHERE 3 < 5 AND marks > 1")).toBe("π_{name}(σ_{marks > 1}(students))");
    expect(optimized("SELECT name FROM students WHERE 5 BETWEEN 1 AND 10 AND marks > 1")).toBe("π_{name}(σ_{marks > 1}(students))");
    expect(optimized("SELECT name FROM students WHERE 5 IN (1, 5, NULL) AND marks > 1")).toBe("π_{name}(σ_{marks > 1}(students))");
    expect(optimized("SELECT name FROM students WHERE NULL IS NULL AND marks > 1")).toBe("π_{name}(σ_{marks > 1}(students))");
    // 2 NOT IN (1, NULL) is NULL, not TRUE.
    expect(optimized("SELECT name FROM students WHERE 2 NOT IN (1, NULL)")).toContain("σ_{NULL}");
    expect(optimized("SELECT name FROM students WHERE 'a' = 'a' AND marks > 1")).toBe("π_{name}(σ_{marks > 1}(students))");
  });

  it("folds unary operators", () => {
    expect(optimized("SELECT name FROM students WHERE marks > -(-5)")).toContain("marks > 5");
    expect(optimized("SELECT name FROM students WHERE marks > +5")).toContain("marks > 5");
  });

  it("does not fold expressions that involve columns", () => {
    const { result } = optimizeSql("SELECT name FROM students WHERE marks > 10 * gpa");
    expect(result.steps).toEqual([]);
    expect(raToText(result.optimized)).toBe("π_{name}(σ_{marks > 10 * gpa}(students))");
  });

  it("does not fold string ordering for non-ASCII text", () => {
    expect(ruleIds("SELECT name FROM students WHERE 'é' < 'z'")).not.toContain("constant-folding");
  });

  it("does not fold integer results outside the exact range", () => {
    expect(ruleIds("SELECT name FROM students WHERE marks > 9007199254740991 * 9007199254740991")).not.toContain("constant-folding");
  });

  it("propagates NULL through arithmetic even with a column operand", () => {
    expect(optimized("SELECT name FROM students WHERE marks + NULL > 1")).toContain("σ_{NULL}");
  });

  it("records an explanation naming the rewrite", () => {
    const step = optimizeSql("SELECT name FROM students WHERE marks > 10 * 8").result.steps[0]!;
    expect(step.ruleId).toBe("constant-folding");
    expect(step.explanation).toContain("`10 * 8` → `80`");
    expect(step.precondition).toBeTruthy();
    expect(step.before).toContain("10 * 8");
    expect(step.after).toContain("80");
  });
});

describe("optimizer: boolean simplification", () => {
  it("applies TRUE/FALSE identities", () => {
    expect(optimized("SELECT name FROM students WHERE TRUE AND marks > 1")).toBe("π_{name}(σ_{marks > 1}(students))");
    expect(optimized("SELECT name FROM students WHERE marks > 1 AND TRUE")).toBe("π_{name}(σ_{marks > 1}(students))");
    expect(optimized("SELECT name FROM students WHERE FALSE OR marks > 1")).toBe("π_{name}(σ_{marks > 1}(students))");
    expect(optimized("SELECT name FROM students WHERE marks > 1 OR TRUE")).toBe("π_{name}(students)");
    expect(optimized("SELECT name FROM students WHERE marks > 1 AND FALSE")).toContain("σ_{FALSE}");
  });

  it("removes double negation and duplicate operands", () => {
    expect(optimized("SELECT name FROM students WHERE NOT NOT marks > 1")).toBe("π_{name}(σ_{marks > 1}(students))");
    expect(optimized("SELECT name FROM students WHERE marks > 1 AND age < 30 AND marks > 1")).toBe("π_{name}(σ_{marks > 1 AND age < 30}(students))");
    expect(optimized("SELECT name FROM students WHERE (marks > 1 OR age < 3) OR marks > 1")).toBe("π_{name}(σ_{marks > 1 OR age < 3}(students))");
  });

  it("leaves non-trivial boolean structure alone", () => {
    expect(ruleIds("SELECT name FROM students WHERE marks > 1 AND age < 30 OR city = 'Pune'")).toEqual([]);
    expect(ruleIds("SELECT name FROM students WHERE NOT marks > 1")).toEqual([]);
  });
});

describe("optimizer: trivial selections", () => {
  it("removes σ_TRUE", () => {
    expect(optimized("SELECT name FROM students WHERE 1 = 1")).toBe("π_{name}(students)");
    expect(ruleIds("SELECT name FROM students WHERE 1 = 1")).toEqual(["constant-folding", "remove-trivial-selection"]);
  });

  it("keeps always-false/NULL selections and explains why", () => {
    expect(optimized("SELECT name FROM students WHERE 1 = 2")).toBe("π_{name}(σ_{FALSE}(students))");
    const skipped = skippedFor("SELECT name FROM students WHERE NULL = NULL", "remove-trivial-selection");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toContain("never TRUE");
  });
});

const scan = (table: string, alias = table): RaNode => ({ op: "scan", table, alias });
const col = (table: string, name: string): RExpr => ({ t: "col", table, name });
const num = (value: number): RExpr => ({ t: "num", value, isInt: true });
const gt = (l: RExpr, r: RExpr): RExpr => ({ t: "bin", op: ">", left: l, right: r });

describe("optimizer: merging selections", () => {
  it("merges stacked selections (inner predicate first)", () => {
    const plan: RaNode = {
      op: "select",
      predicate: gt(col("students", "age"), num(18)),
      input: { op: "select", predicate: gt(col("students", "marks"), num(50)), input: scan("students") },
    };
    const r = optimize(plan, catalog);
    expect(r.steps.map((s) => s.ruleId)).toEqual(["merge-selections"]);
    expect(raToText(r.optimized)).toBe("σ_{marks > 50 AND age > 18}(students)");
  });

  it("does not merge selections separated by another operator", () => {
    const plan: RaNode = {
      op: "select",
      predicate: gt(col("students", "age"), num(18)),
      input: { op: "sort", keys: [{ expr: col("students", "id"), direction: "ASC" }], input: { op: "select", predicate: gt(col("students", "marks"), num(50)), input: scan("students") } },
    };
    expect(optimize(plan, catalog).steps).toEqual([]);
  });
});

const JOIN = "FROM students s INNER JOIN departments d ON s.department_id = d.id";

describe("optimizer: selection pushdown", () => {
  it("pushes single-table conjuncts below the join", () => {
    const sql = `SELECT s.name, d.name AS dept ${JOIN} WHERE s.marks > 80 AND d.budget > 600000`;
    const text = optimized(sql);
    expect(text).toContain("σ_{s.marks > 80}(students AS s)");
    expect(text).toContain("σ_{d.budget > 600000}(departments AS d)");
    expect(text).not.toMatch(/σ_\{[^}]*\}\(\(students/);
    expect(ruleIds(sql)).toContain("selection-pushdown");
  });

  it("keeps conjuncts that need both sides above the join", () => {
    const sql = `SELECT s.name ${JOIN} WHERE s.marks > 80 AND s.age > d.id`;
    const text = optimized(sql);
    expect(text).toContain("σ_{s.marks > 80}(students AS s)");
    expect(text).toMatch(/σ_\{s\.age > d\.id\}\(\(/);
  });

  it("does nothing when every conjunct spans both sides, and says why", () => {
    const sql = `SELECT s.name ${JOIN} WHERE s.age > d.id`;
    expect(ruleIds(sql)).not.toContain("selection-pushdown");
    expect(skippedFor(sql, "selection-pushdown")[0]?.reason).toContain("both sides");
  });

  it("pushes through several levels of joins", () => {
    const sql =
      "SELECT s.name FROM students s INNER JOIN enrollments e ON s.id = e.student_id INNER JOIN courses c ON c.id = e.course_id WHERE s.marks > 80 AND c.credits >= 4";
    const text = optimized(sql);
    expect(text).toContain("σ_{s.marks > 80}(students AS s)");
    expect(text).toContain("σ_{c.credits >= 4}(courses AS c)");
  });

  it("merges a pushed predicate with one already below the join", () => {
    const plan: RaNode = {
      op: "select",
      predicate: gt(col("s", "age"), num(18)),
      input: {
        op: "join",
        joinType: "inner",
        condition: { t: "bin", op: "=", left: col("s", "department_id"), right: col("d", "id") },
        left: { op: "select", predicate: gt(col("s", "marks"), num(50)), input: scan("students", "s") },
        right: scan("departments", "d"),
      },
    };
    const r = optimize(plan, catalog);
    expect(r.steps.map((x) => x.ruleId)).toEqual(["selection-pushdown", "merge-selections"]);
    expect(raToText(r.optimized)).toContain("σ_{s.marks > 50 AND s.age > 18}(students AS s)");
  });
});

describe("optimizer: join-condition pushdown", () => {
  it("moves single-input ON conjuncts to that input when a join condition remains", () => {
    const sql = "SELECT s.name FROM students s INNER JOIN departments d ON s.department_id = d.id AND d.budget > 600000.0 AND s.age > 18";
    const text = optimized(sql);
    expect(text).toContain("σ_{s.age > 18}(students AS s)");
    expect(text).toContain("σ_{d.budget > 600000.0}(departments AS d)");
    expect(text).toContain("⋈_{s.department_id = d.id}");
    expect(ruleIds(sql)).toContain("join-condition-pushdown");
  });

  it("never strips a join of its last condition", () => {
    const sql = "SELECT s.name FROM students s INNER JOIN departments d ON s.age > 18";
    const r = optimizeSql(sql).result;
    expect(r.steps.filter((s) => s.ruleId === "join-condition-pushdown")).toEqual([]);
    expect(r.skipped.some((s) => s.ruleId === "join-condition-pushdown" && s.reason.includes("without a condition"))).toBe(true);
  });
});

describe("optimizer: HAVING pushdown", () => {
  const base = "SELECT department_id, COUNT(*) AS n FROM students GROUP BY department_id";

  it("moves grouping-column conditions below the aggregation", () => {
    const text = optimized(`${base} HAVING department_id > 2 AND COUNT(*) > 1`);
    expect(text).toContain("γ_{department_id; COUNT(*)}(σ_{department_id > 2}(students))");
    expect(text).toContain("σ_{COUNT(*) > 1}(γ");
  });

  it("keeps aggregate conditions above and explains why", () => {
    const sql = `${base} HAVING COUNT(*) > 1`;
    expect(ruleIds(sql)).toEqual([]);
    expect(skippedFor(sql, "having-pushdown")[0]?.reason).toContain("aggregate");
  });

  it("never pushes below a global aggregate", () => {
    const sql = "SELECT COUNT(*) FROM students HAVING COUNT(*) > 100";
    expect(ruleIds(sql)).toEqual([]);
    expect(skippedFor(sql, "having-pushdown")[0]?.reason).toContain("no GROUP BY");
  });

  it("does not push conditions on non-grouping columns or expressions", () => {
    expect(ruleIds("SELECT city, MAX(marks) AS m FROM students GROUP BY city HAVING MAX(marks) > 90")).toEqual([]);
  });
});

describe("optimizer: redundant DISTINCT", () => {
  it("removes DISTINCT when the primary key is projected", () => {
    expect(optimized("SELECT DISTINCT id, city FROM students")).toBe("π_{id, city}(students)");
  });

  it("keeps DISTINCT when the key is missing and explains why", () => {
    const sql = "SELECT DISTINCT city FROM students";
    expect(optimized(sql)).toBe("δ(π_{city}(students))");
    expect(skippedFor(sql, "eliminate-redundant-distinct")[0]?.reason).toContain("students.id");
  });

  it("requires every table's key in a join", () => {
    const keep = `SELECT DISTINCT s.id, s.name ${JOIN}`;
    expect(optimized(keep)).toContain("δ(");
    const drop = `SELECT DISTINCT s.id, d.id AS dept ${JOIN}`;
    expect(optimized(drop)).not.toContain("δ(");
  });

  it("removes DISTINCT over GROUP BY output that contains all grouping expressions", () => {
    expect(optimized("SELECT DISTINCT city, COUNT(*) FROM students GROUP BY city")).not.toContain("δ(");
    expect(optimized("SELECT DISTINCT COUNT(*) FROM students GROUP BY city")).toContain("δ(");
  });

  it("collapses DISTINCT of DISTINCT", () => {
    const plan: RaNode = { op: "distinct", input: { op: "distinct", input: scan("departments") } };
    expect(raToText(optimize(plan, catalog).optimized)).toBe("δ(departments)");
  });
});

describe("optimizer: identity projection and column pruning", () => {
  it("removes SELECT * on a single table", () => {
    expect(optimized("SELECT * FROM students")).toBe("students");
  });

  it("keeps projections that reorder, subset or rename", () => {
    expect(optimized("SELECT name, id FROM departments")).toContain("π_");
    expect(optimized("SELECT id AS key, name, building, budget FROM departments")).toContain("π_");
  });

  it("prunes unused columns of join inputs but keeps join-key columns", () => {
    const sql = `SELECT s.name ${JOIN}`;
    const { result } = optimizeSql(sql);
    expect(result.steps.map((s) => s.ruleId)).toContain("projection-pruning");
    const text = raToText(result.optimized);
    expect(text).toContain("π_{s.name, s.department_id}(students AS s)");
    expect(text).toContain("π_{d.id}(departments AS d)");
  });

  it("does not prune when all columns are needed (SELECT * over a join)", () => {
    expect(ruleIds(`SELECT * ${JOIN}`)).not.toContain("projection-pruning");
  });

  it("keeps at least one column when no column is referenced above", () => {
    const text = optimized("SELECT COUNT(*) FROM students s INNER JOIN departments d ON 1 = 1");
    expect(text).toMatch(/π_\{s\.id\}\(students AS s\)/);
  });
});

describe("optimizer: engine properties", () => {
  const corpus = [
    "SELECT name FROM students WHERE marks > 10 * 8 AND 1 = 1",
    `SELECT s.name, d.name AS dept ${JOIN} WHERE s.marks > 80 AND d.budget > 600000`,
    "SELECT department_id, COUNT(*) AS n FROM students GROUP BY department_id HAVING department_id > 2 AND COUNT(*) > 1",
    "SELECT DISTINCT id, city FROM students WHERE TRUE AND marks > 50",
  ];

  it("is idempotent: optimising an optimised plan changes nothing", () => {
    for (const sql of corpus) {
      const first = optimizeSql(sql).result;
      const second = optimize(first.optimized, catalog);
      expect(second.steps).toEqual([]);
      expect(raToText(second.optimized)).toBe(raToText(first.optimized));
    }
  });

  it("records a full plan snapshot after every step", () => {
    const { steps, optimized: final } = optimizeSql(corpus[0]!).result;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((s) => s.index)).toEqual(steps.map((_, i) => i + 1));
    expect(steps.at(-1)?.planAfter).toEqual(final);
  });

  it("is deterministic", () => {
    for (const sql of corpus) {
      expect(JSON.stringify(optimizeSql(sql).result)).toBe(JSON.stringify(optimizeSql(sql).result));
    }
  });

  it("describes every rule with its applicability and safety argument", () => {
    const { rules } = optimizeSql(corpus[0]!).result;
    expect(rules.length).toBeGreaterThanOrEqual(9);
    for (const r of rules) {
      expect(r.appliesWhen.length).toBeGreaterThan(10);
      expect(r.whySafe.length).toBeGreaterThan(10);
    }
  });
});

/** The same queries must return identical rows as written, as translated, and as optimised. */
describe("optimizer: result equivalence on the sample database", () => {
  const queries = [
    "SELECT name FROM students WHERE marks > 10 * 8",
    "SELECT name FROM students WHERE marks > 7 / 2 * 10",
    "SELECT name FROM students WHERE marks > 1 / 0",
    "SELECT name FROM students WHERE marks + NULL > 1",
    "SELECT name FROM students WHERE 1 = 1",
    "SELECT name FROM students WHERE 1 = 2",
    "SELECT name FROM students WHERE NULL = NULL",
    "SELECT name FROM students WHERE marks > 80 OR NULL",
    "SELECT name FROM students WHERE NOT (marks > 80 AND NULL)",
    "SELECT name FROM students WHERE FALSE OR gpa IS NULL",
    "SELECT name FROM students WHERE gpa > 3 AND gpa > 3 AND TRUE",
    "SELECT name FROM students WHERE NOT NOT (marks > 50)",
    "SELECT name FROM students WHERE marks > 50 OR TRUE",
    "SELECT name FROM students WHERE 2 NOT IN (1, NULL)",
    "SELECT name FROM students WHERE 5 IN (1, 5, NULL) AND marks BETWEEN 10 + 10 AND 100 - 1",
    "SELECT name FROM students WHERE gpa IS NOT NULL AND email IS NULL",
    "SELECT name FROM students WHERE city LIKE 'C%' AND age NOT BETWEEN 19 AND 21",
    "SELECT name FROM students WHERE city IN ('Pune', 'Delhi') OR (age < 20 AND marks >= 90)",
    "SELECT -marks, +marks, marks * 2 + age FROM students WHERE -(-marks) = marks",
    "SELECT * FROM students",
    "SELECT * FROM students WHERE age > 20 ORDER BY id",
    "SELECT name, marks FROM students ORDER BY marks DESC, id LIMIT 5 OFFSET 2",
    "SELECT DISTINCT city FROM students",
    "SELECT DISTINCT id, city FROM students WHERE marks > 60",
    "SELECT DISTINCT department_id, COUNT(*) FROM students GROUP BY department_id",
    "SELECT COUNT(*), AVG(marks), MIN(name), MAX(gpa), SUM(age) FROM students",
    "SELECT COUNT(DISTINCT city), COUNT(gpa), COUNT(*) FROM students WHERE marks > 1000",
    "SELECT department_id, COUNT(*) AS n, AVG(marks) AS avg_marks FROM students GROUP BY department_id HAVING department_id > 2 AND COUNT(*) > 4 ORDER BY n DESC, department_id",
    "SELECT COUNT(*) FROM students HAVING COUNT(*) > 100",
    "SELECT COUNT(*) FROM students HAVING 1 = 0",
    "SELECT city, MAX(marks) AS m FROM students GROUP BY city HAVING MAX(marks) > 70 ORDER BY m, city",
    "SELECT s.name, d.name AS dept FROM students s INNER JOIN departments d ON s.department_id = d.id WHERE s.marks > 70 AND d.budget > 600000.0 ORDER BY s.id",
    "SELECT s.name FROM students s INNER JOIN departments d ON s.department_id = d.id AND d.budget > 600000.0 AND s.age > 19",
    "SELECT * FROM students s INNER JOIN departments d ON s.department_id = d.id WHERE d.id = 1",
    "SELECT COUNT(*) FROM students s INNER JOIN departments d ON 1 = 1",
    "SELECT s.name, c.title, e.score FROM students s INNER JOIN enrollments e ON s.id = e.student_id INNER JOIN courses c ON c.id = e.course_id WHERE s.marks > 80 AND c.credits >= 4 AND e.score > s.marks - 10",
    "SELECT c.title, COUNT(*) AS n, AVG(e.score) AS avg_score FROM courses c INNER JOIN enrollments e ON c.id = e.course_id WHERE e.score IS NOT NULL GROUP BY c.title HAVING COUNT(*) >= 2 ORDER BY avg_score DESC, c.title",
    "SELECT DISTINCT s.id, e.id AS eid FROM students s INNER JOIN enrollments e ON s.id = e.student_id",
    "SELECT DISTINCT s.id FROM students s INNER JOIN enrollments e ON s.id = e.student_id",
    "SELECT a.name, b.name FROM students a INNER JOIN students b ON a.department_id = b.department_id WHERE a.id < b.id AND a.marks > 95 AND b.marks > 90",
    "SELECT s.name FROM students s INNER JOIN enrollments e ON s.id = e.student_id INNER JOIN courses c ON c.id = e.course_id INNER JOIN departments d ON d.id = c.department_id WHERE d.name = 'Computer Science' AND e.grade = 'A'",
    "SELECT \"name\" AS \"student name\" FROM students WHERE city = 'it''s'",
  ];

  for (const sql of queries) {
    it(sql, () => {
      const r = run(sql);
      expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const direct = multiset(db.prepare(sql).raw(true).all() as unknown[][]);
      const original = multiset(rowsOf(r.codegen!.original));
      const optimizedRows = multiset(rowsOf(r.codegen!.optimized));
      expect(original).toEqual(direct);
      expect(optimizedRows).toEqual(direct);
    });
  }

  it("preserves row order for ORDER BY queries", () => {
    const sql = "SELECT s.id, s.marks FROM students s INNER JOIN departments d ON s.department_id = d.id WHERE s.marks > 60 ORDER BY s.marks DESC, s.id LIMIT 7";
    const r = run(sql);
    expect(rowsOf(r.codegen!.optimized)).toEqual(db.prepare(sql).raw(true).all());
    expect(rowsOf(generateSql(r.algebra!.plan))).toEqual(db.prepare(sql).raw(true).all());
  });
});
