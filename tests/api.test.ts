import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let handlers: typeof import("@/lib/api/handlers");
let connection: typeof import("@/lib/database/connection");
let executor: typeof import("@/lib/database/safe-executor");
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-test-"));
  process.env.SQLITE_PATH = path.join(dir, "test.db");
  handlers = await import("@/lib/api/handlers");
  connection = await import("@/lib/database/connection");
  executor = await import("@/lib/database/safe-executor");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function post(route: "analyze" | "execute", body: unknown, init: RequestInit = {}): Request {
  return new Request(`http://localhost/api/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}
const analyze = (body: unknown, init?: RequestInit) => handlers.handleAnalyze(post("analyze", body, init));
const execute = (body: unknown, init?: RequestInit) => handlers.handleExecute(post("execute", body, init));

describe("database lifecycle", () => {
  it("creates and seeds the SQLite file on first use and reuses it", () => {
    const first = connection.getDatabase();
    expect(first.storage).toBe("file");
    expect(fs.existsSync(path.join(dir, "test.db"))).toBe(true);
    expect(first.catalog.tables.map((t) => t.name)).toEqual(["departments", "students", "courses", "enrollments"]);
    expect(first.catalog.tables.find((t) => t.name === "students")?.rowCount).toBe(30);
    expect(connection.getDatabase()).toBe(first);
  });

  it("includes foreign keys and NULLs in the sample data", () => {
    const { catalog, db } = connection.getDatabase();
    expect(catalog.tables.find((t) => t.name === "enrollments")?.foreignKeys.map((f) => f.referencesTable).sort()).toEqual(["courses", "students"]);
    expect((db.prepare("SELECT COUNT(*) c FROM students WHERE email IS NULL").get() as { c: number }).c).toBeGreaterThan(0);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("is read-only for the application connection", () => {
    const { db } = connection.getDatabase();
    expect(() => db.exec("DELETE FROM students")).toThrow();
    expect(() => db.exec("DROP TABLE students")).toThrow();
    expect(() => db.exec("INSERT INTO departments VALUES (99, 'x', 'y', 1)")).toThrow();
  });
});

describe("POST /api/analyze", () => {
  it("returns the full compiler output", async () => {
    const res = await analyze({ sql: "SELECT name FROM students WHERE marks > 80" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.tokens.length).toBeGreaterThan(0);
    expect(body.ast.kind).toBe("SelectStatement");
    expect(body.symbolTable.length).toBeGreaterThan(0);
    expect(body.algebra.text).toBe("π_{name}(σ_{marks > 80}(students))");
    expect(body.optimization.steps).toEqual([]);
    expect(body.database.storage).toBe("file");
  });

  it("returns diagnostics (HTTP 200) for invalid SQL", async () => {
    const body = await (await analyze({ sql: "SELECT nme FROM students" })).json();
    expect(body.success).toBe(false);
    expect(body.failedPhase).toBe("semantic");
    expect(body.diagnostics[0]).toMatchObject({ code: "QC3004", range: { start: { line: 1, column: 8 } } });
  });

  it("validates the request shape", async () => {
    expect((await analyze({})).status).toBe(400);
    expect((await analyze({ sql: 42 })).status).toBe(400);
    expect((await analyze({ sql: "SELECT 1", extra: true })).status).toBe(400);
    expect((await analyze([])).status).toBe(400);
    expect((await analyze("{not json")).status).toBe(400);
    const res = await analyze({ sql: "x".repeat(10_001) });
    expect(res.status).toBe(400);
  });

  it("enforces content type and body size", async () => {
    expect((await analyze({ sql: "SELECT 1" }, { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const big = await analyze({ sql: "a".repeat(40_000) });
    expect(big.status).toBe(413);
  });
});

describe("POST /api/execute", () => {
  it("executes a supported query and returns columns, rows and measured duration", async () => {
    const res = await execute({ sql: "SELECT name, marks FROM students WHERE marks > 90 ORDER BY marks DESC, id" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.columns).toEqual(["name", "marks"]);
    expect(body.rowCount).toBe(body.rows.length);
    expect(body.rowCount).toBeGreaterThan(0);
    expect(body.rows.every((r: [string, number]) => r[1] > 90)).toBe(true);
    expect(body.rows.map((r: [string, number]) => r[1])).toEqual([...body.rows.map((r: [string, number]) => r[1])].sort((a, b) => b - a));
    expect(typeof body.durationMs).toBe("number");
    expect(body.parameterizedSql).toContain("?");
    expect(body.paramCount).toBe(1);
  });

  it("returns the same rows for the original and optimised plans", async () => {
    const sql = "SELECT s.name, d.name AS dept FROM students s INNER JOIN departments d ON s.department_id = d.id WHERE s.marks > 70 AND d.budget > 600000 ORDER BY s.id";
    const a = await (await execute({ sql, plan: "original" })).json();
    const b = await (await execute({ sql, plan: "optimized" })).json();
    expect(a.plan).toBe("original");
    expect(b.plan).toBe("optimized");
    expect(b.rows).toEqual(a.rows);
    expect(b.columns).toEqual(["name", "dept"]);
  });

  it("keeps SQLite integer semantics for bound literals", async () => {
    const body = await (await execute({ sql: "SELECT id, 7 / 2 AS q, 7.0 / 2 AS r FROM departments WHERE id = 1" })).json();
    expect(body.rows).toEqual([[1, 3, 3.5]]);
  });

  it("treats quotes in string literals as data, not SQL", async () => {
    const res = await execute({ sql: "SELECT name FROM students WHERE city = '''; DROP TABLE students; --'" });
    expect(res.status).toBe(200);
    expect((await res.json()).rowCount).toBe(0);
    expect(connection.getDatabase().catalog.tables.some((t) => t.name === "students")).toBe(true);
    const still = await (await execute({ sql: "SELECT COUNT(*) AS n FROM students" })).json();
    expect(still.rows).toEqual([[30]]);
  });

  it("flags truncated results", async () => {
    const body = await (await execute({ sql: "SELECT * FROM enrollments" })).json();
    expect(body.rowCount).toBe(72);
    expect(body.truncated).toBe(false);
  });

  it("rejects every write, DDL and administrative statement before execution", async () => {
    const blocked = [
      "INSERT INTO students VALUES (1)",
      "UPDATE students SET marks = 100",
      "DELETE FROM students",
      "DROP TABLE students",
      "ALTER TABLE students ADD COLUMN x",
      "CREATE TABLE t (a)",
      "ATTACH DATABASE 'x.db' AS x",
      "PRAGMA table_info(students)",
      "VACUUM",
      "REPLACE INTO students VALUES (1)",
      "WITH x AS (SELECT 1) SELECT * FROM x",
      "SELECT name FROM students; DROP TABLE students",
      "SELECT name FROM students; SELECT 1",
      "SELECT load_extension('x') FROM students",
      "SELECT name FROM sqlite_master",
      "SELECT * FROM students WHERE id IN (SELECT id FROM students)",
    ];
    for (const sql of blocked) {
      const res = await execute({ sql });
      expect(res.status, sql).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("query_rejected");
      expect(body.diagnostics.length).toBeGreaterThan(0);
    }
    const count = await (await execute({ sql: "SELECT COUNT(*) AS n FROM students" })).json();
    expect(count.rows).toEqual([[30]]);
  });

  it("ignores client-supplied validation flags", async () => {
    expect((await execute({ sql: "DROP TABLE students", validated: true })).status).toBe(400);
    expect((await execute({ sql: "DROP TABLE students", plan: "optimized", semanticOk: true })).status).toBe(400);
  });

  it("validates the request", async () => {
    expect((await execute({})).status).toBe(400);
    expect((await execute({ sql: "SELECT 1 FROM students", plan: "fastest" })).status).toBe(400);
    expect((await execute({ sql: "SELECT name FROM students" }, { headers: { "content-type": "text/plain" } })).status).toBe(415);
  });

  it("returns sanitised errors", async () => {
    const res = await execute({ sql: "SELECT nme FROM students" });
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/sqlite|SqliteError|\/tmp|node_modules/i);
  });
});

describe("safe executor (second line of defence)", () => {
  it("refuses anything that is not a single SELECT", () => {
    const { db } = connection.getDatabase();
    for (const sql of ["DELETE FROM students", "SELECT 1; SELECT 2", "PRAGMA table_info(students)", "  insert into students values (1)"]) {
      expect(() => executor.executeReadOnly(db, { sql, params: [], displaySql: sql }), sql).toThrow(executor.ExecutionError);
    }
  });

  it("hides database internals when execution fails", () => {
    const { db } = connection.getDatabase();
    try {
      executor.executeReadOnly(db, { sql: "SELECT missing_column FROM students", params: [], displaySql: "" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(executor.ExecutionError);
      expect((e as Error).message).not.toMatch(/missing_column|no such/i);
    }
  });

  it("caps the number of returned rows", () => {
    const { db } = connection.getDatabase();
    const sql = "SELECT a.id FROM enrollments a INNER JOIN enrollments b ON 1 = 1";
    const out = executor.executeReadOnly(db, { sql, params: [], displaySql: sql });
    expect(out.rowCount).toBe(executor.MAX_RESULT_ROWS);
    expect(out.truncated).toBe(true);
  });
});

describe("GET /api/schema", () => {
  it("describes tables, columns, keys and relationships", async () => {
    const res = handlers.handleSchema();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tables.map((t: { name: string }) => t.name)).toEqual(["departments", "students", "courses", "enrollments"]);
    const students = body.tables.find((t: { name: string }) => t.name === "students");
    expect(students.rowCount).toBe(30);
    expect(students.primaryKey).toEqual(["id"]);
    expect(students.foreignKeys).toEqual([{ column: "department_id", referencesTable: "departments", referencesColumn: "id" }]);
    expect(students.columns.find((c: { name: string }) => c.name === "email")).toMatchObject({ type: "TEXT", notNull: false });
  });
});
