import {
  AGGREGATE_FUNCTIONS,
  type BinaryExpr,
  type ColumnRef,
  type Expr,
  type FunctionCall,
  type SelectStatement,
  type TableRef,
  childrenOf,
} from "./ast";
import { type Catalog, type TableSchema, findColumn, findTable } from "./catalog";
import { type Diagnostic, type Range, makeDiagnostic, suggestName } from "./diagnostics";
import { type RExpr, type ResolvedColumn, exprEquals, printExpr, toRExpr } from "./rexpr";
import { type DataType, SymbolTable } from "./symbol-table";

export interface ScopeEntry {
  /** Name visible in the query (alias if present, otherwise the table name). */
  name: string;
  tableName: string;
  location: Range;
}

export interface OutputColumn {
  name: string;
  dataType: DataType;
  expr: RExpr;
}

export interface SemanticResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  scope: ScopeEntry[];
  /** Resolution of every ColumnRef node, keyed by AST node id. */
  resolutions: Record<number, ResolvedColumn>;
  /** Static type of every expression node, keyed by AST node id. */
  types: Record<number, DataType>;
  /** Select-list aliases that ORDER BY keys referred to, keyed by the ColumnRef node id (value: output column index). */
  aliasReferences: Record<number, number>;
  outputColumns: OutputColumn[];
  symbols: SymbolTable["entries"];
  isAggregateQuery: boolean;
}

const NUMERIC = new Set<DataType>(["INTEGER", "REAL"]);
const isNumeric = (t: DataType): boolean => NUMERIC.has(t);

type ExprContext = "select" | "where" | "on" | "group" | "having" | "order";

interface AnalyzerState {
  stmt: SelectStatement;
  catalog: Catalog;
  diagnostics: Diagnostic[];
  scope: { entry: ScopeEntry; schema: TableSchema | null }[];
  resolutions: Record<number, ResolvedColumn>;
  types: Record<number, DataType>;
  aliasReferences: Record<number, number>;
  symbols: SymbolTable;
  selectAliases: Map<string, number>;
}

export function analyzeSemantics(stmt: SelectStatement, catalog: Catalog): SemanticResult {
  const st: AnalyzerState = {
    stmt,
    catalog,
    diagnostics: [],
    scope: [],
    resolutions: {},
    types: {},
    aliasReferences: {},
    symbols: new SymbolTable(),
    selectAliases: new Map(),
  };

  const err = (code: string, message: string, range: Range, hint?: string): void => {
    st.diagnostics.push(makeDiagnostic("error", "semantic", code, message, range, hint));
  };
  const warn = (code: string, message: string, range: Range, hint?: string): void => {
    st.diagnostics.push(makeDiagnostic("warning", "semantic", code, message, range, hint));
  };

  // ---- FROM / JOIN scope ---------------------------------------------------------------

  const declareTable = (ref: TableRef): void => {
    const schema = findTable(catalog, ref.name) ?? null;
    const visible = ref.alias ?? ref.name;
    if (!schema) {
      const hint = suggestName(ref.name, catalog.tables.map((t) => t.name));
      err("QC3001", `Unknown table '${ref.name}'`, ref.range, hint ? `Did you mean '${hint}'?` : `Available tables: ${catalog.tables.map((t) => t.name).join(", ")}.`);
    }
    if (st.scope.some((s) => s.entry.name.toLowerCase() === visible.toLowerCase())) {
      err("QC3002", `Duplicate table name or alias '${visible}' in FROM clause`, ref.range, "Give each table a unique alias, e.g. FROM students AS s1 INNER JOIN students AS s2 ...");
    }
    st.scope.push({ entry: { name: visible, tableName: schema?.name ?? ref.name, location: ref.range }, schema });
    if (schema) {
      st.symbols.add({ name: schema.name, kind: "table", dataType: null, scope: "global", location: ref.range, detail: `${schema.columns.length} columns, ${schema.rowCount} rows` });
    }
    if (ref.alias) {
      st.symbols.add({ name: ref.alias, kind: "alias", dataType: null, scope: "query", location: ref.range, detail: `alias for table ${ref.name}` });
    }
  };

  // Declare the base table first, then each join in order. A join's ON clause may only see
  // tables declared up to and including that join.
  declareTable(stmt.from);
  for (const j of stmt.joins) declareTable(j.table);
  const scopeAfter = (count: number) => st.scope.slice(0, count);

  // ---- column resolution ---------------------------------------------------------------

  const resolveColumn = (ref: ColumnRef, visible: AnalyzerState["scope"]): ResolvedColumn | null => {
    if (ref.table !== null) {
      const hit = visible.find((s) => s.entry.name.toLowerCase() === ref.table!.toLowerCase());
      if (!hit) {
        const wholeScope = st.scope.find((s) => s.entry.name.toLowerCase() === ref.table!.toLowerCase());
        const hint = suggestName(ref.table, visible.map((s) => s.entry.name));
        err(
          "QC3003",
          wholeScope ? `Table '${ref.table}' is not yet in scope here` : `Unknown table or alias '${ref.table}'`,
          ref.range,
          wholeScope ? "A JOIN condition can only use tables listed before and including that JOIN." : hint ? `Did you mean '${hint}'?` : undefined,
        );
        return null;
      }
      if (!hit.schema) return null; // already reported as unknown table
      const col = findColumn(hit.schema, ref.name);
      if (!col) {
        const hint = suggestName(ref.name, hit.schema.columns.map((c) => c.name));
        err("QC3004", `Unknown column '${ref.name}' in table '${hit.schema.name}'`, ref.range, hint ? `Did you mean '${hit.schema.name}.${hint}'?` : undefined);
        return null;
      }
      return { table: hit.entry.name, tableName: hit.schema.name, column: col.name };
    }
    const matches = visible.filter((s) => s.schema && findColumn(s.schema, ref.name));
    if (matches.length === 0) {
      const all = visible.flatMap((s) => s.schema?.columns.map((c) => c.name) ?? []);
      const hint = suggestName(ref.name, all);
      // If a table failed to resolve we cannot be sure the column is truly missing.
      if (visible.some((s) => !s.schema)) return null;
      err("QC3004", `Unknown column '${ref.name}'`, ref.range, hint ? `Did you mean '${hint}'?` : "Open the Schema Explorer to see the available columns.");
      return null;
    }
    if (matches.length > 1) {
      err(
        "QC3005",
        `Ambiguous column '${ref.name}': it exists in ${matches.map((m) => `'${m.entry.name}'`).join(" and ")}`,
        ref.range,
        `Qualify it, e.g. ${matches[0]!.entry.name}.${ref.name}.`,
      );
      return null;
    }
    const m = matches[0]!;
    const col = findColumn(m.schema!, ref.name)!;
    return { table: m.entry.name, tableName: m.schema!.name, column: col.name };
  };

  // ---- type checking -------------------------------------------------------------------

  const comparable = (a: DataType, b: DataType): boolean => {
    if (a === "UNKNOWN" || b === "UNKNOWN" || a === "NULL" || b === "NULL") return true;
    if (isNumeric(a) && isNumeric(b)) return true;
    return a === b;
  };

  const record = (e: Expr, t: DataType): DataType => {
    st.types[e.id] = t;
    return t;
  };

  const typeOfExpr = (e: Expr, ctx: ExprContext, visible: AnalyzerState["scope"], inAggregate: boolean): DataType => {
    const go = (child: Expr, agg = inAggregate): DataType => typeOfExpr(child, ctx, visible, agg);

    switch (e.kind) {
      case "NumberLiteral":
        return record(e, e.isInteger ? "INTEGER" : "REAL");
      case "StringLiteral":
        return record(e, "TEXT");
      case "NullLiteral":
        return record(e, "NULL");
      case "BooleanLiteral":
        return record(e, "BOOLEAN");
      case "ColumnRef": {
        // ORDER BY may refer to a select-list alias.
        if (ctx === "order" && e.table === null) {
          const idx = st.selectAliases.get(e.name.toLowerCase());
          if (idx !== undefined) {
            st.aliasReferences[e.id] = idx;
            return record(e, outputTypes[idx] ?? "UNKNOWN");
          }
        }
        const r = resolveColumn(e, visible);
        if (!r) {
          if (ctx === "group" && e.table === null && st.selectAliases.has(e.name.toLowerCase())) {
            st.diagnostics.pop();
            err("QC3004", `Column '${e.name}' is a select-list alias, which GROUP BY cannot reference`, e.range, "Repeat the underlying expression in GROUP BY.");
          }
          return record(e, "UNKNOWN");
        }
        st.resolutions[e.id] = r;
        const schema = findTable(catalog, r.tableName)!;
        const col = findColumn(schema, r.column)!;
        st.symbols.add({ name: e.table ? `${e.table}.${e.name}` : e.name, kind: "reference", dataType: col.type, scope: r.table, location: e.range, detail: `resolves to ${r.tableName}.${col.name}` });
        return record(e, col.type);
      }
      case "UnaryExpr": {
        const t = go(e.operand);
        if (e.operator === "NOT") {
          if (t !== "BOOLEAN" && t !== "NULL" && t !== "UNKNOWN") {
            err("QC3010", `NOT requires a boolean operand but found ${t}`, e.operand.range);
          }
          return record(e, "BOOLEAN");
        }
        if (!isNumeric(t) && t !== "UNKNOWN" && t !== "NULL") {
          err("QC3010", `Unary '${e.operator}' requires a numeric operand but found ${t}`, e.operand.range);
          return record(e, "UNKNOWN");
        }
        return record(e, t === "NULL" ? "NULL" : t);
      }
      case "BinaryExpr":
        return record(e, typeOfBinary(e, go));
      case "IsNullExpr":
        go(e.operand);
        return record(e, "BOOLEAN");
      case "LikeExpr": {
        const a = go(e.operand);
        const b = go(e.pattern);
        for (const [t, node] of [[a, e.operand], [b, e.pattern]] as const) {
          if (t !== "TEXT" && t !== "NULL" && t !== "UNKNOWN") err("QC3010", `LIKE requires text operands but found ${t}`, node.range);
        }
        return record(e, "BOOLEAN");
      }
      case "BetweenExpr": {
        const a = go(e.operand);
        const lo = go(e.low);
        const hi = go(e.high);
        if (!comparable(a, lo)) err("QC3011", `Cannot compare ${a} with ${lo} in BETWEEN`, e.low.range);
        if (!comparable(a, hi)) err("QC3011", `Cannot compare ${a} with ${hi} in BETWEEN`, e.high.range);
        return record(e, "BOOLEAN");
      }
      case "InExpr": {
        const a = go(e.operand);
        for (const item of e.items) {
          const t = go(item);
          if (!comparable(a, t)) err("QC3011", `Cannot compare ${a} with ${t} in IN list`, item.range);
        }
        return record(e, "BOOLEAN");
      }
      case "FunctionCall":
        return record(e, typeOfCall(e, ctx, visible, inAggregate));
    }
  };

  const typeOfBinary = (e: BinaryExpr, go: (c: Expr) => DataType): DataType => {
    const l = go(e.left);
    const r = go(e.right);
    const unknown = l === "UNKNOWN" || r === "UNKNOWN";
    switch (e.operator) {
      case "AND":
      case "OR": {
        for (const [t, node] of [[l, e.left], [r, e.right]] as const) {
          if (t !== "BOOLEAN" && t !== "NULL" && t !== "UNKNOWN") {
            err("QC3010", `${e.operator} requires boolean operands but found ${t}`, node.range, "Compare the value explicitly, e.g. marks > 0.");
          }
        }
        return "BOOLEAN";
      }
      case "=":
      case "<>":
      case "!=":
      case "<":
      case "<=":
      case ">":
      case ">=":
        if (!comparable(l, r)) {
          err("QC3011", `Cannot compare ${l} with ${r} using '${e.operator}'`, e.range, "Both sides must be numeric, or both text.");
        }
        return "BOOLEAN";
      default: {
        // + - * / %
        if (unknown) return "UNKNOWN";
        let bad = false;
        for (const [t, node] of [[l, e.left], [r, e.right]] as const) {
          if (!isNumeric(t) && t !== "NULL") {
            err("QC3010", `Operator '${e.operator}' requires numeric operands but found ${t}`, node.range);
            bad = true;
          }
        }
        if (bad) return "UNKNOWN";
        if (e.operator === "%" && (l === "REAL" || r === "REAL")) {
          err("QC3010", "Operator '%' requires integer operands", e.range);
          return "UNKNOWN";
        }
        if (e.operator === "/" && l === "INTEGER" && r === "INTEGER") {
          warn("QC3020", "Integer division truncates the result (7 / 2 = 3)", e.range, "Use a REAL operand, e.g. x / 2.0, for fractional results.");
        }
        if (l === "NULL" && r === "NULL") return "NULL";
        if (l === "NULL") return r;
        if (r === "NULL") return l;
        return l === "INTEGER" && r === "INTEGER" ? "INTEGER" : "REAL";
      }
    }
  };

  const typeOfCall = (e: FunctionCall, ctx: ExprContext, visible: AnalyzerState["scope"], inAggregate: boolean): DataType => {
    if (!AGGREGATE_FUNCTIONS.has(e.name)) {
      err(
        "QC3006",
        `Unknown or unsupported function '${e.name}'`,
        e.range,
        `Supported functions: ${[...AGGREGATE_FUNCTIONS].join(", ")}.`,
      );
      e.args.forEach((a) => typeOfExpr(a, ctx, visible, inAggregate));
      return "UNKNOWN";
    }
    if (inAggregate) {
      err("QC3007", "Aggregate functions cannot be nested", e.range);
    }
    if (ctx === "where" || ctx === "on" || ctx === "group") {
      const clause = ctx === "where" ? "WHERE" : ctx === "on" ? "JOIN ... ON" : "GROUP BY";
      err("QC3008", `Aggregate function ${e.name} is not allowed in ${clause}`, e.range, ctx === "where" ? "Use HAVING to filter on aggregate results." : undefined);
    }
    if (e.star) {
      if (e.name !== "COUNT") err("QC3009", `${e.name}(*) is not valid: '*' is only allowed in COUNT(*)`, e.range);
      return "INTEGER";
    }
    if (e.args.length !== 1) {
      err("QC3009", `${e.name} takes exactly one argument but ${e.args.length} were given`, e.range);
      e.args.forEach((a) => typeOfExpr(a, ctx, visible, true));
      return "UNKNOWN";
    }
    const arg = e.args[0]!;
    const t = typeOfExpr(arg, ctx, visible, true);
    switch (e.name) {
      case "COUNT":
        return "INTEGER";
      case "SUM":
      case "AVG":
        if (!isNumeric(t) && t !== "UNKNOWN" && t !== "NULL") {
          err("QC3012", `${e.name} requires a numeric argument but found ${t}`, arg.range);
          return "UNKNOWN";
        }
        return e.name === "AVG" ? "REAL" : t === "NULL" || t === "UNKNOWN" ? "INTEGER" : t;
      default: // MIN / MAX
        if (t === "BOOLEAN") {
          err("QC3012", `${e.name} does not accept BOOLEAN arguments`, arg.range);
          return "UNKNOWN";
        }
        return t;
    }
  };

  const requireBoolean = (e: Expr, t: DataType, clause: string): void => {
    if (t !== "BOOLEAN" && t !== "UNKNOWN" && t !== "NULL") {
      err("QC3013", `${clause} must be a boolean condition but this expression has type ${t}`, e.range, "Use a comparison such as <column> > 0.");
    }
  };

  // ---- select list ---------------------------------------------------------------------

  const outputTypes: DataType[] = [];
  const outputColumns: OutputColumn[] = [];
  const hasStarItem = stmt.items.some((i) => i.kind === "StarItem");
  const resolver = (id: number): ResolvedColumn | undefined => st.resolutions[id];

  // Pass 1: pre-register aliases so ORDER BY can see them (types are filled in below).
  stmt.items.forEach((item) => {
    if (item.kind === "ExprItem" && item.alias) {
      const key = item.alias.toLowerCase();
      if (st.selectAliases.has(key)) {
        err("QC3014", `Duplicate column alias '${item.alias}'`, item.range);
      } else {
        st.selectAliases.set(key, -1);
      }
    }
  });

  const fullScope = st.scope;
  const itemExprs: { expr: Expr; item: (typeof stmt.items)[number] }[] = [];
  stmt.items.forEach((item) => {
    if (item.kind === "StarItem") {
      const targets = item.table
        ? fullScope.filter((s) => s.entry.name.toLowerCase() === item.table!.toLowerCase())
        : fullScope;
      if (item.table && targets.length === 0) {
        err("QC3003", `Unknown table or alias '${item.table}' in '${item.table}.*'`, item.range);
      }
      for (const s of targets) {
        if (!s.schema) continue;
        for (const c of s.schema.columns) {
          outputColumns.push({ name: c.name, dataType: c.type, expr: { t: "col", table: s.entry.name, name: c.name } });
          outputTypes.push(c.type);
        }
      }
      return;
    }
    const t = typeOfExpr(item.expr, "select", fullScope, false);
    itemExprs.push({ expr: item.expr, item });
    const name = item.alias ?? (item.expr.kind === "ColumnRef" ? (st.resolutions[item.expr.id]?.column ?? item.expr.name) : null);
    // Expression text is computed after resolution (below) when no explicit name exists.
    outputColumns.push({ name: name ?? "", dataType: t, expr: { t: "null" } });
    outputTypes.push(t);
    if (item.alias) {
      st.selectAliases.set(item.alias.toLowerCase(), outputColumns.length - 1);
      st.symbols.add({ name: item.alias, kind: "column-alias", dataType: t, scope: "query", location: item.range, detail: "select-list alias" });
    }
  });

  // Fill in converted expressions for ExprItems (needs resolutions to be complete).
  const safeToR = (e: Expr): RExpr | null => {
    try {
      return toRExpr(e, resolver);
    } catch {
      return null;
    }
  };
  {
    // Walk the items again so outputColumns line up with them once all columns are resolved.
    let idx = 0;
    for (const item of stmt.items) {
      if (item.kind === "StarItem") {
        const targets = item.table ? fullScope.filter((s) => s.entry.name.toLowerCase() === item.table!.toLowerCase()) : fullScope;
        idx += targets.reduce((n, s) => n + (s.schema?.columns.length ?? 0), 0);
        continue;
      }
      const converted = safeToR(item.expr);
      const col = outputColumns[idx]!;
      if (converted) {
        col.expr = converted;
        if (col.name === "") col.name = printExpr(converted, { qualify: false });
      } else if (col.name === "") {
        col.name = "?";
      }
      idx++;
    }
  }

  // ---- JOIN ... ON, WHERE --------------------------------------------------------------

  stmt.joins.forEach((j, idx) => {
    const t = typeOfExpr(j.on, "on", scopeAfter(idx + 2), false);
    requireBoolean(j.on, t, "A JOIN condition");
  });
  if (stmt.where) {
    const t = typeOfExpr(stmt.where, "where", fullScope, false);
    requireBoolean(stmt.where, t, "The WHERE clause");
  }

  // ---- grouping ------------------------------------------------------------------------

  for (const g of stmt.groupBy) typeOfExpr(g, "group", fullScope, false);
  const havingType = stmt.having ? typeOfExpr(stmt.having, "having", fullScope, false) : null;
  if (stmt.having && havingType) requireBoolean(stmt.having, havingType, "The HAVING clause");

  stmt.orderBy.forEach((o) => typeOfExpr(o.expr, "order", fullScope, false));
  for (const [clause, exprs] of [["GROUP BY", stmt.groupBy], ["ORDER BY", stmt.orderBy.map((o) => o.expr)]] as const) {
    for (const e of exprs) {
      if (e.kind === "NumberLiteral") {
        err("QC3019", `Positional ${clause} references (${clause} ${e.value}) are not supported`, e.range, "Name the column or expression instead.");
      }
    }
  }

  // ---- aggregate / GROUP BY rules --------------------------------------------------------

  const containsAgg = (e: Expr): boolean => (e.kind === "FunctionCall" && AGGREGATE_FUNCTIONS.has(e.name)) || childrenOf(e).some((c) => containsAgg(c as Expr));
  const anyAggregate =
    stmt.items.some((i) => i.kind === "ExprItem" && containsAgg(i.expr)) ||
    (stmt.having ? containsAgg(stmt.having) : false) ||
    stmt.orderBy.some((o) => containsAgg(o.expr));
  const isAggregateQuery = stmt.groupBy.length > 0 || anyAggregate;

  if (stmt.having && !isAggregateQuery) {
    err("QC3015", "HAVING requires GROUP BY or an aggregate function", stmt.having.range, "Use WHERE to filter individual rows.");
  }

  if (isAggregateQuery) {
    const groupExprs = stmt.groupBy.map(safeToR);
    if (hasStarItem) {
      const star = stmt.items.find((i) => i.kind === "StarItem")!;
      err("QC3016", "SELECT * cannot be combined with GROUP BY or aggregate functions", star.range, "List the grouped columns and aggregates explicitly.");
    }
    const checkGrouped = (e: Expr, where: string): void => {
      if (e.kind === "FunctionCall" && AGGREGATE_FUNCTIONS.has(e.name)) return;
      const converted = safeToR(e);
      if (converted && groupExprs.some((g) => g && exprEquals(g, converted))) return;
      if (e.kind === "ColumnRef") {
        if (!st.resolutions[e.id] && !(e.id in st.aliasReferences)) return; // already reported
        if (e.id in st.aliasReferences) return; // alias is checked through its own expression
        err(
          "QC3017",
          `Column '${e.table ? `${e.table}.` : ""}${e.name}' in ${where} must appear in GROUP BY or be used inside an aggregate function`,
          e.range,
          stmt.groupBy.length === 0 ? "Add a GROUP BY clause, or aggregate every column." : `Add ${e.name} to GROUP BY.`,
        );
        return;
      }
      for (const c of childrenOf(e)) checkGrouped(c as Expr, where);
    };
    for (const item of stmt.items) if (item.kind === "ExprItem") checkGrouped(item.expr, "the select list");
    if (stmt.having) checkGrouped(stmt.having, "HAVING");
    for (const o of stmt.orderBy) checkGrouped(o.expr, "ORDER BY");
  }

  // DISTINCT + ORDER BY: keys must come from the select list (else the ordering is undefined).
  if (stmt.distinct) {
    for (const o of stmt.orderBy) {
      if (o.expr.kind === "ColumnRef" && o.expr.id in st.aliasReferences) continue;
      const converted = safeToR(o.expr);
      const inList = converted && outputColumns.some((c) => exprEquals(c.expr, converted));
      if (converted && !inList) {
        err("QC3018", "With SELECT DISTINCT, ORDER BY expressions must appear in the select list", o.expr.range);
      }
    }
  }

  // ---- column symbols ------------------------------------------------------------------

  const columnSymbols: typeof st.symbols.entries = [];
  for (const s of fullScope) {
    if (!s.schema) continue;
    for (const c of s.schema.columns) {
      columnSymbols.push({
        name: c.name,
        kind: "column",
        dataType: c.type,
        scope: s.entry.name,
        location: null,
        detail: [c.primaryKey ? "PRIMARY KEY" : "", c.notNull ? "NOT NULL" : "", s.entry.name !== s.schema.name ? `of ${s.schema.name}` : ""].filter(Boolean).join(", "),
      });
    }
  }
  // Tables/aliases first, then in-scope columns, then references/aliases found in the query.
  const ordered = [
    ...st.symbols.entries.filter((e) => e.kind === "table" || e.kind === "alias"),
    ...columnSymbols,
    ...st.symbols.entries.filter((e) => e.kind === "column-alias"),
    ...st.symbols.entries.filter((e) => e.kind === "reference"),
  ];

  const ok = !st.diagnostics.some((d) => d.severity === "error");
  return {
    ok,
    diagnostics: st.diagnostics,
    scope: st.scope.map((s) => s.entry),
    resolutions: st.resolutions,
    types: st.types,
    aliasReferences: st.aliasReferences,
    outputColumns,
    symbols: ordered,
    isAggregateQuery,
  };
}
