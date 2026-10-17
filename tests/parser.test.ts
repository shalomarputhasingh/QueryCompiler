import { describe, expect, it } from "vitest";
import { type Expr, printAst } from "@/lib/compiler/ast";
import { parseSql } from "./helpers";

const parseOk = (sql: string) => {
  const r = parseSql(sql);
  expect(r.diagnostics.map((d) => d.message)).toEqual([]);
  expect(r.ast).not.toBeNull();
  return r.ast!;
};
const errors = (sql: string) => parseSql(sql).diagnostics.filter((d) => d.severity === "error");

/** Compact S-expression of an expression tree to assert on structure/precedence. */
function sx(e: Expr): string {
  switch (e.kind) {
    case "NumberLiteral":
      return String(e.value);
    case "StringLiteral":
      return `'${e.value}'`;
    case "NullLiteral":
      return "NULL";
    case "BooleanLiteral":
      return e.value ? "TRUE" : "FALSE";
    case "ColumnRef":
      return e.table ? `${e.table}.${e.name}` : e.name;
    case "BinaryExpr":
      return `(${e.operator} ${sx(e.left)} ${sx(e.right)})`;
    case "UnaryExpr":
      return `(${e.operator} ${sx(e.operand)})`;
    case "FunctionCall":
      return `${e.name}(${e.star ? "*" : (e.distinct ? "DISTINCT " : "") + e.args.map(sx).join(", ")})`;
    case "IsNullExpr":
      return `(${e.negated ? "IS NOT NULL" : "IS NULL"} ${sx(e.operand)})`;
    case "LikeExpr":
      return `(${e.negated ? "NOT LIKE" : "LIKE"} ${sx(e.operand)} ${sx(e.pattern)})`;
    case "BetweenExpr":
      return `(${e.negated ? "NOT BETWEEN" : "BETWEEN"} ${sx(e.operand)} ${sx(e.low)} ${sx(e.high)})`;
    case "InExpr":
      return `(${e.negated ? "NOT IN" : "IN"} ${sx(e.operand)} [${e.items.map(sx).join(", ")}])`;
  }
}
const where = (sql: string) => sx(parseOk(sql).where!);

describe("parser: valid SELECT statements", () => {
  it("parses the minimal query", () => {
    const ast = parseOk("SELECT name FROM students");
    expect(ast.kind).toBe("SelectStatement");
    expect(ast.items).toHaveLength(1);
    expect(ast.from).toMatchObject({ name: "students", alias: null });
    expect(ast.where).toBeNull();
  });

  it("parses DISTINCT, star, qualified star and aliases", () => {
    expect(parseOk("SELECT DISTINCT city FROM students").distinct).toBe(true);
    expect(parseOk("SELECT * FROM students").items[0]).toMatchObject({ kind: "StarItem", table: null });
    expect(parseOk("SELECT s.* FROM students s").items[0]).toMatchObject({ kind: "StarItem", table: "s" });
    const items = parseOk("SELECT name AS n, marks m FROM students AS s").items;
    expect(items.map((i) => (i.kind === "ExprItem" ? i.alias : null))).toEqual(["n", "m"]);
    expect(parseOk("SELECT name FROM students s").from.alias).toBe("s");
  });

  it("parses every clause together", () => {
    const ast = parseOk(
      "SELECT d.name, COUNT(*) AS n FROM students s INNER JOIN departments d ON s.department_id = d.id WHERE s.marks > 50 GROUP BY d.name HAVING COUNT(*) > 1 ORDER BY n DESC, d.name LIMIT 5 OFFSET 2;",
    );
    expect(ast.joins).toHaveLength(1);
    expect(ast.joins[0]?.joinType).toBe("INNER");
    expect(ast.groupBy).toHaveLength(1);
    expect(ast.having).not.toBeNull();
    expect(ast.orderBy.map((o) => o.direction)).toEqual(["DESC", "ASC"]);
    expect(ast.limit).toBe(5);
    expect(ast.offset).toBe(2);
  });

  it("accepts plain JOIN as INNER JOIN and chained joins", () => {
    const ast = parseOk("SELECT 1 FROM a JOIN b ON a.x = b.x INNER JOIN c ON b.y = c.y");
    expect(ast.joins).toHaveLength(2);
  });

  it("assigns unique node ids and source ranges", () => {
    const ast = parseOk("SELECT name FROM students WHERE marks > 80");
    const ids = new Set<number>();
    const walk = (n: unknown): void => {
      if (n && typeof n === "object") {
        if ("id" in n && typeof (n as { id: unknown }).id === "number") {
          const id = (n as { id: number }).id;
          expect(ids.has(id)).toBe(false);
          ids.add(id);
        }
        Object.values(n).forEach(walk);
      }
    };
    walk(ast);
    expect(ast.where?.range.start.column).toBe(33);
  });

  it("renders a textual AST", () => {
    const text = printAst(parseOk("SELECT name FROM students WHERE marks > 80"));
    expect(text).toContain("SelectStatement SELECT");
    expect(text).toContain("BinaryExpr >");
    expect(text).toContain("where: BinaryExpr >");
  });
});

describe("parser: precedence and parentheses", () => {
  it("binds AND tighter than OR", () => {
    expect(where("SELECT a FROM t WHERE a = 1 OR b = 2 AND c = 3")).toBe("(OR (= a 1) (AND (= b 2) (= c 3)))");
  });

  it("lets parentheses override precedence", () => {
    expect(where("SELECT a FROM t WHERE (a = 1 OR b = 2) AND c = 3")).toBe("(AND (OR (= a 1) (= b 2)) (= c 3))");
  });

  it("binds multiplication tighter than addition and is left-associative", () => {
    expect(where("SELECT a FROM t WHERE a + b * c - d = 0")).toBe("(= (- (+ a (* b c)) d) 0)");
    expect(where("SELECT a FROM t WHERE a - b - c = 0")).toBe("(= (- (- a b) c) 0)");
  });

  it("binds comparison tighter than AND and NOT looser than comparison", () => {
    expect(where("SELECT a FROM t WHERE NOT a = 1 AND b = 2")).toBe("(AND (NOT (= a 1)) (= b 2))");
  });

  it("handles unary minus", () => {
    expect(where("SELECT a FROM t WHERE -a * 2 < -1")).toBe("(< (* (- a) 2) (- 1))");
  });

  it("parses IS NULL, LIKE, BETWEEN and IN", () => {
    expect(where("SELECT a FROM t WHERE a IS NOT NULL AND b LIKE 'x%'")).toBe("(AND (IS NOT NULL a) (LIKE b 'x%'))");
    expect(where("SELECT a FROM t WHERE a BETWEEN 1 AND 5 AND b = 2")).toBe("(AND (BETWEEN a 1 5) (= b 2))");
    expect(where("SELECT a FROM t WHERE a NOT BETWEEN 1 + 1 AND 5")).toBe("(NOT BETWEEN a (+ 1 1) 5)");
    expect(where("SELECT a FROM t WHERE a NOT IN (1, 2, 3)")).toBe("(NOT IN a [1, 2, 3])");
    expect(where("SELECT a FROM t WHERE a NOT LIKE 'x'")).toBe("(NOT LIKE a 'x')");
  });

  it("parses function calls including COUNT(*) and COUNT(DISTINCT x)", () => {
    expect(parseOk("SELECT COUNT(*), COUNT(DISTINCT city), AVG(marks) FROM students").items.map((i) => (i.kind === "ExprItem" ? sx(i.expr) : ""))).toEqual([
      "COUNT(*)",
      "COUNT(DISTINCT city)",
      "AVG(marks)",
    ]);
  });
});

describe("parser: syntax errors", () => {
  it("reports a missing FROM clause", () => {
    const e = errors("SELECT name WHERE marks > 1");
    expect(e[0]).toMatchObject({ code: "QC2006", phase: "syntax" });
    expect(e[0]?.message).toContain("FROM");
    expect(errors("SELECT name")[0]?.message).toContain("Missing FROM");
  });

  it("reports a missing select list", () => {
    expect(errors("SELECT FROM students")[0]?.code).toBe("QC2009");
  });

  it("reports a trailing comma in the select list", () => {
    expect(errors("SELECT a, FROM t")[0]?.message).toContain("Missing select item");
  });

  it("reports a missing operand with its location", () => {
    const e = errors("SELECT a FROM t WHERE marks >");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ code: "QC2014" });
    expect(e[0]?.message).toContain("after '>'");
    expect(e[0]?.range.start.line).toBe(1);
    expect(errors("SELECT a FROM t WHERE a = 1 AND")[0]?.message).toContain("after 'AND'");
  });

  it("reports unmatched parentheses", () => {
    const missing = errors("SELECT a FROM t WHERE (a = 1");
    expect(missing[0]).toMatchObject({ code: "QC2003" });
    expect(missing[0]?.message).toContain("opened at line 1, column 23");
    const extra = errors("SELECT a FROM t WHERE a = 1)");
    expect(extra[0]).toMatchObject({ code: "QC2004" });
  });

  it("reports unexpected tokens", () => {
    expect(errors("SELECT a FROM t WHERE a = = 1")[0]?.message).toMatch(/Missing operand after '='|Expected an expression/);
    expect(errors("SELECT a b c FROM t")[0]?.message).toMatch(/Expected FROM|Expected/);
    expect(errors("SELECT a FROM t t2 t3")[0]?.code).toBe("QC2002");
  });

  it("reports out-of-order clauses", () => {
    const e = errors("SELECT a FROM t ORDER BY a WHERE a = 1");
    expect(e[0]?.code).toBe("QC2005");
  });

  it("reports an empty query and non-SELECT input", () => {
    expect(errors("")[0]?.code).toBe("QC2001");
    expect(errors("   -- only a comment")[0]?.code).toBe("QC2001");
    expect(errors("hello world")[0]?.message).toContain("Expected a SELECT");
  });

  it("requires ON for joins and a table name after FROM", () => {
    expect(errors("SELECT a FROM t INNER JOIN u")[0]?.message).toContain("ON condition");
    expect(errors("SELECT a FROM WHERE a = 1")[0]?.message).toContain("table name");
  });

  it("validates LIMIT and OFFSET", () => {
    expect(errors("SELECT a FROM t LIMIT x")[0]?.code).toBe("QC2008");
    expect(errors("SELECT a FROM t LIMIT -1")[0]?.code).toBe("QC2008");
    expect(errors("SELECT a FROM t LIMIT 2.5")[0]?.code).toBe("QC2008");
    expect(errors("SELECT a FROM t OFFSET 3")[0]?.code).toBe("QC2007");
  });

  it("recovers to report several independent errors", () => {
    const e = errors("SELECT a, FROM t WHERE x > ORDER BY y LIMIT z");
    expect(e.length).toBeGreaterThanOrEqual(3);
    expect(e.map((d) => d.code)).toEqual(expect.arrayContaining(["QC2009", "QC2014", "QC2008"]));
  });

  it("returns no AST when there are syntax errors", () => {
    expect(parseSql("SELECT FROM t").ast).toBeNull();
  });

  it("rejects integer literals beyond the exact range", () => {
    expect(errors("SELECT a FROM t WHERE a = 99999999999999999999")[0]?.code).toBe("QC2015");
  });
});

describe("parser: unsupported constructs", () => {
  const unsupported = (sql: string) => {
    const e = errors(sql);
    expect(e.length).toBeGreaterThan(0);
    return e[0]!;
  };

  it("rejects subqueries", () => {
    expect(unsupported("SELECT a FROM t WHERE a IN (SELECT b FROM u)").code).toBe("QC2010");
    expect(unsupported("SELECT a FROM (SELECT 1) x").message).toContain("Subqueries");
  });

  it("rejects non-inner joins, USING and comma joins", () => {
    expect(unsupported("SELECT a FROM t LEFT JOIN u ON t.x = u.x").message).toContain("LEFT JOIN");
    expect(unsupported("SELECT a FROM t CROSS JOIN u").message).toContain("CROSS JOIN");
    expect(unsupported("SELECT a FROM t, u").message).toContain("Comma-separated");
    expect(unsupported("SELECT a FROM t JOIN u USING (x)").message).toContain("USING");
  });

  it("rejects set operations, CASE and other statements", () => {
    expect(unsupported("SELECT a FROM t UNION SELECT a FROM u").code).toMatch(/QC20/);
    expect(unsupported("SELECT CASE WHEN a THEN 1 END FROM t").message).toContain("CASE");
    for (const stmt of ["INSERT INTO t VALUES (1)", "UPDATE t SET a = 1", "DELETE FROM t", "DROP TABLE t", "PRAGMA table_info(t)", "ATTACH 'x' AS y", "CREATE TABLE t(a)"]) {
      expect(unsupported(stmt).code).toBe("QC2011");
    }
  });

  it("rejects multiple statements", () => {
    expect(unsupported("SELECT a FROM t; DROP TABLE t").code).toBe("QC2012");
    expect(unsupported("SELECT a FROM t; SELECT b FROM t").message).toContain("Multiple statements");
  });
});
