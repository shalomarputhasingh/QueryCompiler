"use client";

import { useMemo, useState } from "react";
import { buildPlanTree } from "@/components/visualizations/graph-builders";
import { TreeGraph } from "@/components/visualizations/tree-graph";
import { Badge } from "@/components/ui/badge";
import { describeRaNode, raNodeParts, type RaNode } from "@/lib/compiler/relational-algebra";

/** Query-plan graph with a node inspector, generated from a relational algebra tree. */
export function PlanView({ plan, prefix, height = 320, label }: { plan: RaNode; prefix: string; height?: number; label: string }) {
  const built = useMemo(() => buildPlanTree(plan, prefix), [plan, prefix]);
  const [selected, setSelected] = useState<string | null>(null);
  const node = selected ? built.index.get(selected) : undefined;
  const info = node ? describeRaNode(node, built.qualify) : null;

  return (
    <div className="space-y-2">
      <TreeGraph root={built.root} selectedId={selected} onSelect={setSelected} height={height} ariaLabel={label} />
      <div className="min-h-10 rounded-md border border-border px-3 py-2 text-[13px]" aria-live="polite">
        {node && info ? (
          <p>
            <Badge tone="primary" className="mr-2">
              {info.symbol} {info.name}
            </Badge>
            {info.description}
            {node.op !== "scan" ? <span className="ml-2 font-mono text-xs text-muted-foreground">{raNodeParts(node, built.qualify).param}</span> : null}
          </p>
        ) : (
          <p className="text-muted-foreground">Select an operator to see its role.</p>
        )}
      </div>
    </div>
  );
}

export function countNodes(plan: RaNode): number {
  if (plan.op === "scan") return 1;
  if (plan.op === "join") return 1 + countNodes(plan.left) + countNodes(plan.right);
  return 1 + countNodes(plan.input);
}
