import { type AstNode, childRoles, childrenOf, nodeLabel } from "@/lib/compiler/ast";
import type { SelectStatement } from "@/lib/compiler/ast";
import { type RaNode, raChildren, raNodeParts, shouldQualify } from "@/lib/compiler/relational-algebra";
import type { Tone, TreeNodeData } from "./tree-graph";

function astTone(node: AstNode): Tone {
  switch (node.kind) {
    case "SelectStatement":
      return "violet";
    case "TableRef":
    case "JoinClause":
    case "StarItem":
    case "ExprItem":
    case "OrderItem":
      return "blue";
    case "ColumnRef":
      return "green";
    case "NumberLiteral":
    case "StringLiteral":
    case "NullLiteral":
    case "BooleanLiteral":
      return "amber";
    case "FunctionCall":
      return "red";
    default:
      return "pink";
  }
}

export function astNodeId(node: AstNode): string {
  return `ast-${node.id}`;
}

export function buildAstTree(ast: SelectStatement): { root: TreeNodeData; index: Map<string, AstNode> } {
  const index = new Map<string, AstNode>();
  const build = (node: AstNode, role: string): TreeNodeData => {
    const id = astNodeId(node);
    index.set(id, node);
    const roles = childRoles(node);
    return {
      id,
      label: nodeLabel(node),
      caption: role || node.kind.replace(/Expr$|Literal$|Item$/, ""),
      tone: astTone(node),
      children: childrenOf(node).map((c, i) => build(c, roles[i] ?? "")),
    };
  };
  return { root: build(ast, ""), index };
}

const PLAN_TONE: Record<RaNode["op"], Tone> = {
  scan: "green",
  select: "pink",
  project: "violet",
  join: "blue",
  aggregate: "amber",
  sort: "slate",
  distinct: "red",
  limit: "slate",
};

export function buildPlanTree(plan: RaNode, prefix = "plan"): { root: TreeNodeData; index: Map<string, RaNode>; qualify: boolean } {
  const qualify = shouldQualify(plan);
  const index = new Map<string, RaNode>();
  const build = (n: RaNode, path: string): TreeNodeData => {
    index.set(path, n);
    const { symbol, param } = raNodeParts(n, qualify);
    return {
      id: path,
      label: n.op === "scan" ? param : `${symbol} ${param}`.trim(),
      caption: n.op,
      tone: PLAN_TONE[n.op],
      children: raChildren(n).map((c, i) => build(c, `${path}.${i}`)),
    };
  };
  return { root: build(plan, prefix), index, qualify };
}
