"use client";

import { Background, Controls, Handle, type Node, type NodeProps, Position, ReactFlow, ReactFlowProvider, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { memo, useMemo } from "react";
import { cn } from "@/lib/utils/cn";

export type Tone = "violet" | "blue" | "green" | "amber" | "pink" | "slate" | "red";

export interface TreeNodeData {
  id: string;
  label: string;
  /** Small caption above the label (node kind or edge role). */
  caption?: string;
  tone: Tone;
  children: TreeNodeData[];
}

const TONES: Record<Tone, string> = {
  violet: "border-violet-500/60 bg-violet-500/15 text-violet-900 dark:text-violet-200",
  blue: "border-sky-500/60 bg-sky-500/15 text-sky-900 dark:text-sky-200",
  green: "border-emerald-500/60 bg-emerald-500/15 text-emerald-900 dark:text-emerald-200",
  amber: "border-amber-500/60 bg-amber-500/15 text-amber-900 dark:text-amber-200",
  pink: "border-pink-500/60 bg-pink-500/15 text-pink-900 dark:text-pink-200",
  slate: "border-slate-500/50 bg-slate-500/15 text-slate-800 dark:text-slate-200",
  red: "border-red-500/60 bg-red-500/15 text-red-900 dark:text-red-200",
};

interface FlowNodeData extends Record<string, unknown> {
  label: string;
  caption?: string;
  tone: Tone;
  selected: boolean;
}

const QcNode = memo(function QcNode({ data }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-1.5 text-center text-xs font-medium shadow-sm transition-shadow",
        TONES[data.tone],
        data.selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
      )}
    >
      <Handle type="target" position={Position.Top} className="!size-1 !border-0 !bg-transparent" isConnectable={false} />
      {data.caption ? <div className="text-[10px] font-normal opacity-70">{data.caption}</div> : null}
      <div className="whitespace-nowrap font-mono">{data.label}</div>
      <Handle type="source" position={Position.Bottom} className="!size-1 !border-0 !bg-transparent" isConnectable={false} />
    </div>
  );
});

const nodeTypes = { qc: QcNode };
const H_GAP = 18;
const V_GAP = 74;

function widthOf(n: TreeNodeData): number {
  return Math.max(64, Math.min(n.label.length, 44) * 7.4 + 26);
}

/** Tidy top-down layout: each node is centred over its children. */
export function layoutTree(root: TreeNodeData, selectedId: string | null): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];
  const slot = new Map<string, number>();

  const measure = (n: TreeNodeData): number => {
    const kids = n.children.reduce((sum, c) => sum + measure(c), 0) + Math.max(0, n.children.length - 1) * H_GAP;
    const w = Math.max(widthOf(n), kids);
    slot.set(n.id, w);
    return w;
  };
  measure(root);

  const place = (n: TreeNodeData, left: number, depth: number, parent: string | null): void => {
    const w = slot.get(n.id) ?? 0;
    const own = widthOf(n);
    nodes.push({
      id: n.id,
      type: "qc",
      position: { x: left + (w - own) / 2, y: depth * V_GAP },
      data: { label: n.label.length > 44 ? `${n.label.slice(0, 43)}…` : n.label, caption: n.caption, tone: n.tone, selected: n.id === selectedId },
      draggable: false,
    });
    if (parent) edges.push({ id: `${parent}->${n.id}`, source: parent, target: n.id, type: "smoothstep" });
    const kidsWidth = n.children.reduce((s, c) => s + (slot.get(c.id) ?? 0), 0) + Math.max(0, n.children.length - 1) * H_GAP;
    let x = left + (w - kidsWidth) / 2;
    for (const c of n.children) {
      place(c, x, depth + 1, n.id);
      x += (slot.get(c.id) ?? 0) + H_GAP;
    }
  };
  place(root, 0, 0, null);
  return { nodes, edges };
}

interface TreeGraphProps {
  root: TreeNodeData;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  height?: number | string;
  ariaLabel: string;
}

function Inner({ root, selectedId = null, onSelect, height = 380, ariaLabel }: TreeGraphProps) {
  const { resolvedTheme } = useTheme();
  const { nodes, edges } = useMemo(() => layoutTree(root, selectedId), [root, selectedId]);
  const signature = useMemo(() => nodes.map((n) => n.id).join("|"), [nodes]);
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel} className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <ReactFlow
        key={signature}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={resolvedTheme === "light" ? "light" : "dark"}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
        minZoom={0.2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={Boolean(onSelect)}
        onNodeClick={(_, node) => onSelect?.(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function TreeGraph(props: TreeGraphProps) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
