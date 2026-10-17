"use client";

import { useMemo, useState } from "react";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type AstNode, childrenOf } from "@/lib/compiler/ast";
import { buildAstTree } from "@/components/visualizations/graph-builders";
import { TreeGraph } from "@/components/visualizations/tree-graph";
import { CodeBlock, Unavailable } from "./shared";

export function AstTab() {
  const { analysis, reveal, stale } = useWorkspace();
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "text">("graph");
  const built = useMemo(() => (analysis?.ast ? buildAstTree(analysis.ast) : null), [analysis?.ast]);

  if (!analysis || !analysis.ast || !built) return <Unavailable what="syntax tree" requires="syntax" />;

  const node: AstNode | undefined = selected ? built.index.get(selected) : undefined;
  const type = node && "id" in node ? analysis.semantic?.types[node.id] : undefined;
  const resolved = node && node.kind === "ColumnRef" ? analysis.semantic?.resolutions[node.id] : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Generated from the parser output ({built.index.size} nodes). Select a node to inspect it.</p>
        <div role="group" aria-label="Tree view" className="flex gap-1">
          <Button size="xs" variant={view === "graph" ? "secondary" : "ghost"} aria-pressed={view === "graph"} onClick={() => setView("graph")}>
            Graph
          </Button>
          <Button size="xs" variant={view === "text" ? "secondary" : "ghost"} aria-pressed={view === "text"} onClick={() => setView("text")}>
            Text
          </Button>
        </div>
      </div>
      {view === "graph" ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <TreeGraph root={built.root} selectedId={selected} onSelect={setSelected} height={440} ariaLabel="Abstract syntax tree" />
          <aside aria-label="Node details" className="rounded-lg border border-border p-3 text-[13px]">
            {node ? (
              <dl className="space-y-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Node</dt>
                  <dd className="font-mono">{node.kind}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Source text</dt>
                  <dd className="break-words font-mono text-xs">{analysis.source.slice(node.range.start.offset, node.range.end.offset)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Location</dt>
                  <dd className="font-mono text-xs">
                    {node.range.start.line}:{node.range.start.column} → {node.range.end.line}:{node.range.end.column}
                  </dd>
                </div>
                {type ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Static type</dt>
                    <dd>
                      <Badge tone="info">{type}</Badge>
                    </dd>
                  </div>
                ) : null}
                {resolved ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Resolves to</dt>
                    <dd className="font-mono text-xs">
                      {resolved.tableName}.{resolved.column}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-muted-foreground">Children</dt>
                  <dd>{childrenOf(node).length}</dd>
                </div>
                <Button size="xs" variant="outline" disabled={stale} onClick={() => reveal(node.range)}>
                  Show in editor
                </Button>
              </dl>
            ) : (
              <p className="text-muted-foreground">Select a node in the tree to see its source text, location, type and resolved column.</p>
            )}
          </aside>
        </div>
      ) : (
        <CodeBlock text={analysis.astText ?? ""} label="syntax tree" />
      )}
    </div>
  );
}
