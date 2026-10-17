import type { Range } from "./diagnostics";

interface NodeBase {
  /** Unique within one parse; semantic results are keyed by it. */
  id: number;
  range: Range;
}

export interface NumberLiteral extends NodeBase {
  kind: "NumberLiteral";
  value: number;
  /** True when the literal has no fraction or exponent. */
  isInteger: boolean;
}
export interface StringLiteral extends NodeBase {
  kind: "StringLiteral";
  value: string;
}
export interface NullLiteral extends NodeBase {
  kind: "NullLiteral";
}
export interface BooleanLiteral extends NodeBase {
  kind: "BooleanLiteral";
  value: boolean;
}
export interface ColumnRef extends NodeBase {
  kind: "ColumnRef";
  table: string | null;
  name: string;
}

export type BinaryOperator = "OR" | "AND" | "=" | "<>" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "%";
export interface BinaryExpr extends NodeBase {
  kind: "BinaryExpr";
  operator: BinaryOperator;
  left: Expr;
  right: Expr;
}
export type UnaryOperator = "NOT" | "-" | "+";
export interface UnaryExpr extends NodeBase {
  kind: "UnaryExpr";
  operator: UnaryOperator;
  operand: Expr;
}
export interface FunctionCall extends NodeBase {
  kind: "FunctionCall";
  /** Upper-cased function name. */
  name: string;
  distinct: boolean;
  /** True for COUNT(*). */
  star: boolean;
  args: Expr[];
}
export interface IsNullExpr extends NodeBase {
  kind: "IsNullExpr";
  operand: Expr;
  negated: boolean;
}
export interface LikeExpr extends NodeBase {
  kind: "LikeExpr";
  operand: Expr;
  pattern: Expr;
  negated: boolean;
}
export interface BetweenExpr extends NodeBase {
  kind: "BetweenExpr";
  operand: Expr;
  low: Expr;
  high: Expr;
  negated: boolean;
}
export interface InExpr extends NodeBase {
  kind: "InExpr";
  operand: Expr;
  items: Expr[];
  negated: boolean;
}

export type Expr =
  | NumberLiteral
  | StringLiteral
  | NullLiteral
  | BooleanLiteral
  | ColumnRef
  | BinaryExpr
  | UnaryExpr
  | FunctionCall
  | IsNullExpr
  | LikeExpr
  | BetweenExpr
  | InExpr;

export interface ExprItem extends NodeBase {
  kind: "ExprItem";
  expr: Expr;
  alias: string | null;
}
export interface StarItem extends NodeBase {
  kind: "StarItem";
  /** Qualifier for `t.*`, otherwise null. */
  table: string | null;
}
export type SelectItem = ExprItem | StarItem;

export interface TableRef extends NodeBase {
  kind: "TableRef";
  name: string;
  alias: string | null;
}
export interface JoinClause extends NodeBase {
  kind: "JoinClause";
  joinType: "INNER";
  table: TableRef;
  on: Expr;
}
export interface OrderItem extends NodeBase {
  kind: "OrderItem";
  expr: Expr;
  direction: "ASC" | "DESC";
}

export interface SelectStatement extends NodeBase {
  kind: "SelectStatement";
  distinct: boolean;
  items: SelectItem[];
  from: TableRef;
  joins: JoinClause[];
  where: Expr | null;
  groupBy: Expr[];
  having: Expr | null;
  orderBy: OrderItem[];
  limit: number | null;
  offset: number | null;
}

export type AstNode = SelectStatement | SelectItem | TableRef | JoinClause | OrderItem | Expr;

export const AGGREGATE_FUNCTIONS: ReadonlySet<string> = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

/** Child nodes in source order. Used by the tree viewer, text dump and traversals. */
export function childrenOf(node: AstNode): AstNode[] {
  switch (node.kind) {
    case "SelectStatement":
      return [
        ...node.items,
        node.from,
        ...node.joins,
        ...(node.where ? [node.where] : []),
        ...node.groupBy,
        ...(node.having ? [node.having] : []),
        ...node.orderBy,
      ];
    case "ExprItem":
      return [node.expr];
    case "JoinClause":
      return [node.table, node.on];
    case "OrderItem":
      return [node.expr];
    case "BinaryExpr":
      return [node.left, node.right];
    case "UnaryExpr":
      return [node.operand];
    case "FunctionCall":
      return node.args;
    case "IsNullExpr":
      return [node.operand];
    case "LikeExpr":
      return [node.operand, node.pattern];
    case "BetweenExpr":
      return [node.operand, node.low, node.high];
    case "InExpr":
      return [node.operand, ...node.items];
    default:
      return [];
  }
}

/** Short human-readable label for a node. */
export function nodeLabel(node: AstNode): string {
  switch (node.kind) {
    case "SelectStatement":
      return node.distinct ? "SELECT DISTINCT" : "SELECT";
    case "StarItem":
      return node.table ? `${node.table}.*` : "*";
    case "ExprItem":
      return node.alias ? `Item AS ${node.alias}` : "Item";
    case "TableRef":
      return node.alias ? `Table ${node.name} AS ${node.alias}` : `Table ${node.name}`;
    case "JoinClause":
      return "INNER JOIN";
    case "OrderItem":
      return `ORDER ${node.direction}`;
    case "NumberLiteral":
      return String(node.value);
    case "StringLiteral":
      return `'${node.value}'`;
    case "NullLiteral":
      return "NULL";
    case "BooleanLiteral":
      return node.value ? "TRUE" : "FALSE";
    case "ColumnRef":
      return node.table ? `${node.table}.${node.name}` : node.name;
    case "BinaryExpr":
      return node.operator;
    case "UnaryExpr":
      return node.operator;
    case "FunctionCall":
      return node.star ? `${node.name}(*)` : `${node.name}()`;
    case "IsNullExpr":
      return node.negated ? "IS NOT NULL" : "IS NULL";
    case "LikeExpr":
      return node.negated ? "NOT LIKE" : "LIKE";
    case "BetweenExpr":
      return node.negated ? "NOT BETWEEN" : "BETWEEN";
    case "InExpr":
      return node.negated ? "NOT IN" : "IN";
  }
}

/** Role of a child inside its parent, shown as an edge label / indentation hint. */
export function childRoles(node: AstNode): string[] {
  switch (node.kind) {
    case "SelectStatement": {
      const roles: string[] = [];
      node.items.forEach(() => roles.push("select"));
      roles.push("from");
      node.joins.forEach(() => roles.push("join"));
      if (node.where) roles.push("where");
      node.groupBy.forEach(() => roles.push("group by"));
      if (node.having) roles.push("having");
      node.orderBy.forEach(() => roles.push("order by"));
      return roles;
    }
    case "JoinClause":
      return ["table", "on"];
    case "BinaryExpr":
      return ["left", "right"];
    case "LikeExpr":
      return ["operand", "pattern"];
    case "BetweenExpr":
      return ["operand", "low", "high"];
    case "InExpr":
      return ["operand", ...node.items.map(() => "item")];
    case "FunctionCall":
      return node.args.map(() => "arg");
    default:
      return childrenOf(node).map(() => "");
  }
}

/** Indented text dump of the AST for debugging and academic demonstrations. */
export function printAst(root: AstNode): string {
  const lines: string[] = [];
  const walk = (node: AstNode, prefix: string, isLast: boolean, role: string, isRoot: boolean): void => {
    const connector = isRoot ? "" : isLast ? "└─ " : "├─ ";
    const roleText = role ? `${role}: ` : "";
    lines.push(`${prefix}${connector}${roleText}${node.kind} ${nodeLabel(node)}`);
    const kids = childrenOf(node);
    const roles = childRoles(node);
    const childPrefix = isRoot ? "" : prefix + (isLast ? "   " : "│  ");
    kids.forEach((child, i) => walk(child, childPrefix, i === kids.length - 1, roles[i] ?? "", false));
  };
  walk(root, "", true, "", true);
  return lines.join("\n");
}
