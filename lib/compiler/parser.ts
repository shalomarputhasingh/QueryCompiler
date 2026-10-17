import type {
  BinaryOperator,
  ColumnRef,
  Expr,
  JoinClause,
  OrderItem,
  SelectItem,
  SelectStatement,
  TableRef,
} from "./ast";
import { type Diagnostic, type Range, makeDiagnostic } from "./diagnostics";
import { COMPARISON_OPERATORS, type Token, UNSUPPORTED_KEYWORDS } from "./tokens";

export interface ParseResult {
  /** Null when any syntax error was found: a partial tree would not be a valid SelectStatement. */
  ast: SelectStatement | null;
  diagnostics: Diagnostic[];
}

class ParseError extends Error {
  constructor(public readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

/** Binding powers for the Pratt expression parser (higher binds tighter). */
const BP = { OR: 1, AND: 2, NOT: 3, COMPARE: 4, ADD: 5, MUL: 6, UNARY: 7 } as const;

const CLAUSE_STARTS = new Set(["FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "JOIN", "INNER"]);
const STATEMENT_KEYWORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "REPLACE",
  "VACUUM",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "WITH",
]);

class Parser {
  private i = 0;
  private nextId = 1;
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly tokens: Token[]) {}

  // ---- token helpers -------------------------------------------------------------------

  private peek(ahead = 0): Token {
    const idx = Math.min(this.i + ahead, this.tokens.length - 1);
    return this.tokens[idx] as Token;
  }

  private advance(): Token {
    const t = this.peek();
    if (t.type !== "EOF") this.i++;
    return t;
  }

  private isKw(word: string, ahead = 0): boolean {
    const t = this.peek(ahead);
    return t.type === "KEYWORD" && t.value === word;
  }

  private isPunct(ch: string, ahead = 0): boolean {
    const t = this.peek(ahead);
    return t.type === "PUNCTUATION" && t.lexeme === ch;
  }

  private isOp(op: string, ahead = 0): boolean {
    const t = this.peek(ahead);
    return t.type === "OPERATOR" && t.lexeme === op;
  }

  private matchKw(word: string): Token | null {
    return this.isKw(word) ? this.advance() : null;
  }

  private describe(t: Token): string {
    return t.type === "EOF" ? "end of input" : `'${t.lexeme}'`;
  }

  private fail(code: string, message: string, range: Range, hint?: string): ParseError {
    return new ParseError(makeDiagnostic("error", "syntax", code, message, range, hint));
  }

  private unexpected(expected: string, t: Token = this.peek(), hint?: string): ParseError {
    if (t.type === "KEYWORD" && UNSUPPORTED_KEYWORDS.has(t.value as string)) {
      return this.unsupported(t);
    }
    return this.fail("QC2002", `Expected ${expected} but found ${this.describe(t)}`, t.range, hint);
  }

  private unsupported(t: Token, what?: string): ParseError {
    const word = String(t.value);
    const text = what ?? `${word} is not supported`;
    return this.fail(
      "QC2010",
      `${text} in this SQL subset`,
      t.range,
      "See the Documentation page for the supported grammar and the list of unsupported constructs.",
    );
  }

  private expectKw(word: string, expectedText = word): Token {
    if (this.isKw(word)) return this.advance();
    throw this.unexpected(expectedText);
  }

  private expectPunct(ch: string, expectedText = `'${ch}'`): Token {
    if (this.isPunct(ch)) return this.advance();
    throw this.unexpected(expectedText);
  }

  private expectClose(open: Token): Token {
    if (this.isPunct(")")) return this.advance();
    const t = this.peek();
    throw this.fail(
      "QC2003",
      `Missing closing parenthesis ')' for '(' opened at line ${open.range.start.line}, column ${open.range.start.column}`,
      t.type === "EOF" ? open.range : t.range,
      `Found ${this.describe(t)} where ')' was expected.`,
    );
  }

  private newId(): number {
    return this.nextId++;
  }

  // ---- recovery ------------------------------------------------------------------------

  /** Runs one clause parser; on a syntax error records it, resynchronises at the next clause and returns `fallback`. */
  private guard<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ParseError) {
        this.diagnostics.push(e.diagnostic);
        this.synchronize();
        return fallback;
      }
      throw e;
    }
  }

  private synchronize(): void {
    let depth = 0;
    for (;;) {
      const t = this.peek();
      if (t.type === "EOF") return;
      if (this.isPunct("(")) depth++;
      else if (this.isPunct(")")) depth = Math.max(0, depth - 1);
      else if (depth === 0 && (this.isPunct(";") || (t.type === "KEYWORD" && CLAUSE_STARTS.has(t.value as string)))) return;
      this.advance();
    }
  }

  // ---- statements ----------------------------------------------------------------------

  parseProgram(): SelectStatement | null {
    const first = this.peek();
    if (first.type === "EOF") {
      this.diagnostics.push(
        makeDiagnostic("error", "syntax", "QC2001", "The query is empty", first.range, "Type a SELECT statement, e.g. SELECT name FROM students;"),
      );
      return null;
    }
    if (!this.isKw("SELECT")) {
      const word = String(first.value).toUpperCase();
      const message =
        first.type === "KEYWORD" && STATEMENT_KEYWORDS.has(word)
          ? `${word} statements are not allowed: only SELECT queries are supported`
          : `Expected a SELECT statement but found ${this.describe(first)}`;
      this.diagnostics.push(
        makeDiagnostic("error", "syntax", first.type === "KEYWORD" && STATEMENT_KEYWORDS.has(word) ? "QC2011" : "QC2002", message, first.range),
      );
      return null;
    }

    let stmt: SelectStatement | null = null;
    try {
      stmt = this.parseSelect();
    } catch (e) {
      if (e instanceof ParseError) this.diagnostics.push(e.diagnostic);
      else throw e;
    }

    if (this.isPunct(";")) {
      this.advance();
      if (this.peek().type !== "EOF") {
        this.diagnostics.push(
          makeDiagnostic(
            "error",
            "syntax",
            "QC2012",
            "Multiple statements are not supported",
            this.peek().range,
            "Submit one SELECT statement at a time.",
          ),
        );
      }
    } else if (this.peek().type !== "EOF" && !this.diagnostics.some((d) => d.severity === "error")) {
      this.diagnostics.push(this.trailingTokenError(this.peek()).diagnostic);
    }
    return this.diagnostics.some((d) => d.severity === "error") ? null : stmt;
  }

  private trailingTokenError(t: Token): ParseError {
    if (this.isPunct(")")) {
      return this.fail("QC2004", "Unmatched closing parenthesis ')'", t.range, "There is no matching '(' for this ')'.");
    }
    if (t.type === "KEYWORD" && CLAUSE_STARTS.has(t.value as string)) {
      return this.fail(
        "QC2005",
        `Unexpected ${t.value} clause: clauses must appear in the order FROM, JOIN, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT and each may appear only once`,
        t.range,
      );
    }
    return this.unexpected("end of statement or ';'", t);
  }

  private parseSelect(): SelectStatement {
    const selectTok = this.expectKw("SELECT");
    const distinct = this.matchKw("DISTINCT") !== null;
    if (this.isKw("ALL")) throw this.unsupported(this.peek(), "SELECT ALL");

    const items = this.guard(() => this.parseSelectList(), [] as SelectItem[]);

    let from: TableRef | null = null;
    const joins: JoinClause[] = [];
    if (this.isKw("FROM")) {
      this.advance();
      from = this.guard(() => this.parseTableRef(), null);
      while (from && (this.isKw("INNER") || this.isKw("JOIN") || this.isUnsupportedJoinStart() || this.isPunct(","))) {
        const join = this.guard(() => this.parseJoin(), null);
        if (join) joins.push(join);
        else break;
      }
    } else {
      const t = this.peek();
      this.diagnostics.push(
        makeDiagnostic(
          "error",
          "syntax",
          "QC2006",
          t.type === "EOF" ? "Missing FROM clause: a SELECT must name its source table" : `Expected FROM clause but found ${this.describe(t)}`,
          t.range,
          "Add FROM <table> after the select list.",
        ),
      );
      this.synchronize();
    }

    let where: Expr | null = null;
    if (this.isKw("WHERE")) {
      this.advance();
      where = this.guard(() => this.parseExpr(0), null);
    }

    const groupBy: Expr[] = [];
    if (this.isKw("GROUP")) {
      this.advance();
      this.guard(() => {
        this.expectKw("BY", "BY after GROUP");
        groupBy.push(...this.parseExprList());
      }, undefined);
    }

    let having: Expr | null = null;
    if (this.isKw("HAVING")) {
      this.advance();
      having = this.guard(() => this.parseExpr(0), null);
    }

    const orderBy: OrderItem[] = [];
    if (this.isKw("ORDER")) {
      this.advance();
      this.guard(() => {
        this.expectKw("BY", "BY after ORDER");
        orderBy.push(...this.parseOrderList());
      }, undefined);
    }

    let limit: number | null = null;
    let offset: number | null = null;
    if (this.isKw("LIMIT")) {
      this.advance();
      this.guard(() => {
        limit = this.parseNonNegativeInteger("LIMIT");
        if (this.isKw("OFFSET")) {
          this.advance();
          offset = this.parseNonNegativeInteger("OFFSET");
        } else if (this.isPunct(",")) {
          throw this.fail("QC2010", "LIMIT <offset>, <count> is not supported in this SQL subset", this.peek().range, "Use LIMIT <count> OFFSET <offset>.");
        }
      }, undefined);
    } else if (this.isKw("OFFSET")) {
      throw this.fail("QC2007", "OFFSET requires a LIMIT clause", this.peek().range);
    }

    const endTok = this.tokens[Math.max(0, this.i - 1)] as Token;
    const placeholder = from ?? this.makeTableRef("", null, selectTok.range);
    return {
      id: this.newId(),
      kind: "SelectStatement",
      range: { start: selectTok.range.start, end: endTok.range.end },
      distinct,
      items,
      from: placeholder,
      joins,
      where,
      groupBy,
      having,
      orderBy,
      limit,
      offset,
    };
  }

  private parseNonNegativeInteger(clause: string): number {
    const t = this.peek();
    if (t.type === "NUMBER" && /^\d+$/.test(t.lexeme)) {
      this.advance();
      return t.value as number;
    }
    throw this.fail(
      "QC2008",
      `${clause} requires a non-negative integer literal but found ${this.describe(t)}`,
      t.range,
      "Expressions and parameters are not supported here.",
    );
  }

  // ---- select list ---------------------------------------------------------------------

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [this.parseSelectItem(true)];
    while (this.isPunct(",")) {
      const comma = this.advance();
      if (this.peek().type === "EOF" || this.isKw("FROM")) {
        throw this.fail("QC2009", "Missing select item after ','", this.peek().type === "EOF" ? comma.range : this.peek().range, "Remove the trailing comma or add another column.");
      }
      items.push(this.parseSelectItem(false));
    }
    return items;
  }

  private parseSelectItem(first: boolean): SelectItem {
    const t = this.peek();
    if (this.isOp("*")) {
      this.advance();
      return { id: this.newId(), kind: "StarItem", range: t.range, table: null };
    }
    if (this.isIdentifierToken(t) && this.isPunct(".", 1) && this.isOp("*", 2)) {
      this.advance();
      this.advance();
      const star = this.advance();
      return { id: this.newId(), kind: "StarItem", range: { start: t.range.start, end: star.range.end }, table: String(t.value) };
    }
    if (first && (this.isKw("FROM") || t.type === "EOF")) {
      throw this.fail("QC2009", "Missing select list: expected '*' or at least one column or expression after SELECT", t.range);
    }
    const expr = this.parseExpr(0);
    let alias: string | null = null;
    let end = expr.range.end;
    if (this.isKw("AS")) {
      this.advance();
      const a = this.peek();
      if (!this.isIdentifierToken(a)) throw this.unexpected("an alias name after AS", a);
      this.advance();
      alias = String(a.value);
      end = a.range.end;
    } else if (this.isIdentifierToken(this.peek())) {
      const a = this.advance();
      alias = String(a.value);
      end = a.range.end;
    }
    return { id: this.newId(), kind: "ExprItem", range: { start: expr.range.start, end }, expr, alias };
  }

  private isIdentifierToken(t: Token): boolean {
    return t.type === "IDENTIFIER" || t.type === "QUOTED_IDENTIFIER";
  }

  // ---- FROM / JOIN ---------------------------------------------------------------------

  private makeTableRef(name: string, alias: string | null, range: Range): TableRef {
    return { id: this.newId(), kind: "TableRef", range, name, alias };
  }

  private parseTableRef(): TableRef {
    const t = this.peek();
    if (this.isPunct("(")) {
      throw this.fail("QC2010", "Subqueries and parenthesised table expressions are not supported in this SQL subset", t.range);
    }
    if (!this.isIdentifierToken(t)) throw this.unexpected("a table name", t);
    this.advance();
    let alias: string | null = null;
    let end = t.range.end;
    if (this.isKw("AS")) {
      this.advance();
      const a = this.peek();
      if (!this.isIdentifierToken(a)) throw this.unexpected("an alias name after AS", a);
      this.advance();
      alias = String(a.value);
      end = a.range.end;
    } else if (this.isIdentifierToken(this.peek())) {
      const a = this.advance();
      alias = String(a.value);
      end = a.range.end;
    }
    return this.makeTableRef(String(t.value), alias, { start: t.range.start, end });
  }

  private isUnsupportedJoinStart(): boolean {
    return ["LEFT", "RIGHT", "FULL", "CROSS", "NATURAL", "OUTER"].some((k) => this.isKw(k));
  }

  private parseJoin(): JoinClause {
    const start = this.peek();
    if (this.isPunct(",")) {
      throw this.fail(
        "QC2010",
        "Comma-separated tables (implicit cross joins) are not supported in this SQL subset",
        start.range,
        "Use INNER JOIN <table> ON <condition>.",
      );
    }
    if (this.isUnsupportedJoinStart()) {
      throw this.fail("QC2010", `${String(start.value)} JOIN is not supported in this SQL subset`, start.range, "Only INNER JOIN ... ON is supported.");
    }
    if (this.isKw("INNER")) this.advance();
    this.expectKw("JOIN", "JOIN after INNER");
    const table = this.parseTableRef();
    if (this.isKw("USING")) throw this.unsupported(this.peek(), "JOIN ... USING");
    if (!this.isKw("ON")) {
      throw this.unexpected(`ON condition for the join with '${table.name}'`, this.peek(), "Write INNER JOIN <table> ON <condition>.");
    }
    this.advance();
    const on = this.parseExpr(0);
    return { id: this.newId(), kind: "JoinClause", range: { start: start.range.start, end: on.range.end }, joinType: "INNER", table, on };
  }

  // ---- lists ---------------------------------------------------------------------------

  private parseExprList(): Expr[] {
    const list = [this.parseExpr(0)];
    while (this.isPunct(",")) {
      this.advance();
      list.push(this.parseExpr(0, "',' (list item expected)"));
    }
    return list;
  }

  private parseOrderList(): OrderItem[] {
    const list: OrderItem[] = [];
    do {
      if (list.length > 0) this.advance();
      const expr = this.parseExpr(0);
      let direction: "ASC" | "DESC" = "ASC";
      let end = expr.range.end;
      if (this.isKw("ASC") || this.isKw("DESC")) {
        const d = this.advance();
        direction = d.value === "DESC" ? "DESC" : "ASC";
        end = d.range.end;
      }
      list.push({ id: this.newId(), kind: "OrderItem", range: { start: expr.range.start, end }, expr, direction });
    } while (this.isPunct(","));
    return list;
  }

  // ---- expressions (Pratt) -------------------------------------------------------------

  private binary(op: BinaryOperator, left: Expr, right: Expr): Expr {
    return { id: this.newId(), kind: "BinaryExpr", range: { start: left.range.start, end: right.range.end }, operator: op, left, right };
  }

  /** `context` names what precedes the expression so a missing operand can be reported precisely. */
  private parseExpr(minBp: number, context?: string): Expr {
    let left = this.parsePrefix(context);
    for (;;) {
      const t = this.peek();

      if (t.type === "KEYWORD") {
        const kw = t.value as string;
        if (kw === "OR" && BP.OR >= minBp) {
          this.advance();
          left = this.binary("OR", left, this.parseExpr(BP.OR + 1, "'OR'"));
          continue;
        }
        if (kw === "AND" && BP.AND >= minBp) {
          this.advance();
          left = this.binary("AND", left, this.parseExpr(BP.AND + 1, "'AND'"));
          continue;
        }
        if (BP.COMPARE >= minBp) {
          if (kw === "IS") {
            this.advance();
            const negated = this.matchKw("NOT") !== null;
            const nul = this.peek();
            if (!this.isKw("NULL")) throw this.unexpected("NULL after IS" + (negated ? " NOT" : ""), nul);
            this.advance();
            left = { id: this.newId(), kind: "IsNullExpr", range: { start: left.range.start, end: nul.range.end }, operand: left, negated };
            continue;
          }
          const negatable = kw === "NOT" ? this.peek(1) : t;
          if (negatable.type === "KEYWORD" && ["LIKE", "BETWEEN", "IN"].includes(negatable.value as string)) {
            const negated = kw === "NOT";
            if (negated) this.advance();
            const which = (this.advance().value as string);
            if (which === "LIKE") {
              const pattern = this.parseExpr(BP.ADD, "'LIKE'");
              left = { id: this.newId(), kind: "LikeExpr", range: { start: left.range.start, end: pattern.range.end }, operand: left, pattern, negated };
            } else if (which === "BETWEEN") {
              const low = this.parseExpr(BP.ADD, "'BETWEEN'");
              this.expectKw("AND", "AND in BETWEEN ... AND ...");
              const high = this.parseExpr(BP.ADD, "'AND'");
              left = { id: this.newId(), kind: "BetweenExpr", range: { start: left.range.start, end: high.range.end }, operand: left, low, high, negated };
            } else {
              const open = this.expectPunct("(", "'(' after IN");
              if (this.isKw("SELECT")) throw this.fail("QC2010", "Subqueries are not supported in this SQL subset", this.peek().range);
              if (this.isPunct(")")) throw this.fail("QC2013", "IN requires at least one value", this.peek().range);
              const items = this.parseExprList();
              const close = this.expectClose(open);
              left = { id: this.newId(), kind: "InExpr", range: { start: left.range.start, end: close.range.end }, operand: left, items, negated };
            }
            continue;
          }
        }
        break;
      }

      if (t.type === "OPERATOR") {
        const op = t.lexeme;
        if (COMPARISON_OPERATORS.has(op) && BP.COMPARE >= minBp) {
          this.advance();
          left = this.binary(op as BinaryOperator, left, this.parseExpr(BP.COMPARE + 1, `'${op}'`));
          continue;
        }
        if ((op === "+" || op === "-") && BP.ADD >= minBp) {
          this.advance();
          left = this.binary(op, left, this.parseExpr(BP.ADD + 1, `'${op}'`));
          continue;
        }
        if ((op === "*" || op === "/" || op === "%") && BP.MUL >= minBp) {
          this.advance();
          left = this.binary(op, left, this.parseExpr(BP.MUL + 1, `'${op}'`));
          continue;
        }
      }
      break;
    }
    return left;
  }

  private parsePrefix(context?: string): Expr {
    const t = this.peek();
    switch (t.type) {
      case "NUMBER":
        if (/^\d+$/.test(t.lexeme) && !Number.isSafeInteger(t.value as number)) {
          throw this.fail("QC2015", `Integer literal ${t.lexeme} is too large`, t.range, "Integers up to 9007199254740991 are supported.");
        }
        this.advance();
        return { id: this.newId(), kind: "NumberLiteral", range: t.range, value: t.value as number, isInteger: /^\d+$/.test(t.lexeme) };
      case "STRING":
        this.advance();
        return { id: this.newId(), kind: "StringLiteral", range: t.range, value: t.value as string };
      case "IDENTIFIER":
      case "QUOTED_IDENTIFIER":
        return this.parseNameOrCall();
      case "KEYWORD": {
        const kw = t.value as string;
        if (kw === "NULL") {
          this.advance();
          return { id: this.newId(), kind: "NullLiteral", range: t.range };
        }
        if (kw === "TRUE" || kw === "FALSE") {
          this.advance();
          return { id: this.newId(), kind: "BooleanLiteral", range: t.range, value: kw === "TRUE" };
        }
        if (kw === "NOT") {
          this.advance();
          const operand = this.parseExpr(BP.COMPARE, "'NOT'");
          return { id: this.newId(), kind: "UnaryExpr", range: { start: t.range.start, end: operand.range.end }, operator: "NOT", operand };
        }
        if (kw === "SELECT") throw this.fail("QC2010", "Subqueries are not supported in this SQL subset", t.range);
        break;
      }
      case "OPERATOR":
        if (t.lexeme === "-" || t.lexeme === "+") {
          this.advance();
          const operand = this.parseExpr(BP.UNARY, `'${t.lexeme}'`);
          return { id: this.newId(), kind: "UnaryExpr", range: { start: t.range.start, end: operand.range.end }, operator: t.lexeme, operand };
        }
        break;
      case "PUNCTUATION":
        if (t.lexeme === "(") {
          this.advance();
          if (this.isKw("SELECT")) throw this.fail("QC2010", "Subqueries are not supported in this SQL subset", this.peek().range);
          const inner = this.parseExpr(0, "'('");
          this.expectClose(t);
          return inner;
        }
        break;
      default:
        break;
    }
    if (t.type === "KEYWORD" && UNSUPPORTED_KEYWORDS.has(t.value as string)) throw this.unsupported(t);
    if (context) {
      throw this.fail("QC2014", `Missing operand after ${context}: found ${this.describe(t)}`, t.type === "EOF" ? this.previousRange() : t.range, "Provide a column, literal or parenthesised expression.");
    }
    throw this.fail("QC2002", `Expected an expression but found ${this.describe(t)}`, t.range);
  }

  private previousRange(): Range {
    const prev = this.tokens[Math.max(0, this.i - 1)] as Token;
    return prev.range;
  }

  private parseNameOrCall(): Expr {
    const first = this.advance();
    const name = String(first.value);

    if (this.isPunct("(")) {
      if (first.type !== "IDENTIFIER") throw this.fail("QC2002", "A quoted identifier cannot be used as a function name", first.range);
      const open = this.advance();
      let distinct = false;
      let star = false;
      const args: Expr[] = [];
      if (this.isOp("*")) {
        this.advance();
        star = true;
      } else if (!this.isPunct(")")) {
        if (this.isKw("DISTINCT")) {
          this.advance();
          distinct = true;
        }
        args.push(...this.parseExprList());
      }
      const close = this.expectClose(open);
      return {
        id: this.newId(),
        kind: "FunctionCall",
        range: { start: first.range.start, end: close.range.end },
        name: name.toUpperCase(),
        distinct,
        star,
        args,
      };
    }

    if (this.isPunct(".")) {
      this.advance();
      const col = this.peek();
      if (this.isOp("*")) {
        throw this.fail("QC2002", `'${name}.*' is only allowed in the select list`, col.range);
      }
      if (!this.isIdentifierToken(col)) throw this.unexpected(`a column name after '${name}.'`, col);
      this.advance();
      const ref: ColumnRef = {
        id: this.newId(),
        kind: "ColumnRef",
        range: { start: first.range.start, end: col.range.end },
        table: name,
        name: String(col.value),
      };
      return ref;
    }

    return { id: this.newId(), kind: "ColumnRef", range: first.range, table: null, name };
  }
}

export function parse(tokens: Token[]): ParseResult {
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  return { ast, diagnostics: parser.diagnostics };
}
