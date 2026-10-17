"use client";

import { Background, Controls, type Edge, type Node, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { KeyRound, Link2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo } from "react";
import type { SchemaResponse } from "@/lib/api/contracts";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";

function erLayout(schema: SchemaResponse): { nodes: Node[]; edges: Edge[] } {
  const level = new Map<string, number>();
  const compute = (name: string, seen: Set<string>): number => {
    if (level.has(name)) return level.get(name)!;
    if (seen.has(name)) return 0;
    seen.add(name);
    const t = schema.tables.find((x) => x.name === name);
    const l = t && t.foreignKeys.length > 0 ? 1 + Math.max(...t.foreignKeys.map((f) => (f.referencesTable === name ? -1 : compute(f.referencesTable, seen)))) : 0;
    level.set(name, l);
    return l;
  };
  schema.tables.forEach((t) => compute(t.name, new Set()));
  const rows = new Map<number, string[]>();
  for (const t of schema.tables) rows.set(level.get(t.name) ?? 0, [...(rows.get(level.get(t.name) ?? 0) ?? []), t.name]);

  const nodes: Node[] = [];
  for (const [lvl, names] of rows) {
    names.forEach((name, i) => {
      const t = schema.tables.find((x) => x.name === name)!;
      nodes.push({
        id: name,
        position: { x: (i - (names.length - 1) / 2) * 260, y: lvl * 230 },
        draggable: false,
        data: {
          label: (
            <div className="text-left text-xs">
              <div className="mb-1 border-b border-border pb-1 font-semibold">{name}</div>
              {t.columns.map((c) => (
                <div key={c.name} className="flex justify-between gap-3 font-mono text-[11px]">
                  <span>
                    {c.primaryKey ? "🔑 " : ""}
                    {c.name}
                  </span>
                  <span className="text-muted-foreground">{c.type}</span>
                </div>
              ))}
            </div>
          ),
        },
        style: { width: 220, padding: 8, borderRadius: 8, background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--input)" },
      });
    });
  }
  const edges: Edge[] = schema.tables.flatMap((t) =>
    t.foreignKeys.map((f) => ({
      id: `${t.name}.${f.column}`,
      source: f.referencesTable,
      target: t.name,
      label: `${t.name}.${f.column} → ${f.referencesTable}.${f.referencesColumn}`,
      labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
      labelBgStyle: { fill: "var(--card)" },
      type: "smoothstep",
    })),
  );
  return { nodes, edges };
}

export function SchemaExplorer() {
  const { schema, schemaError } = useWorkspace();
  const { resolvedTheme } = useTheme();
  const graph = useMemo(() => (schema ? erLayout(schema) : null), [schema]);

  if (schemaError) return <div className="p-6"><EmptyState title="Schema unavailable" description={schemaError} /></div>;
  if (!schema || !graph) {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> Loading schema…
      </p>
    );
  }
  const relationships = schema.tables.flatMap((t) => t.foreignKeys.map((f) => ({ from: `${t.name}.${f.column}`, to: `${f.referencesTable}.${f.referencesColumn}` })));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <p className="text-[13px] text-muted-foreground">
        {schema.database.name} · SQLite ({schema.database.storage === "file" ? "file" : "in-memory"}) · read-only. The semantic analyzer validates every query against exactly this schema.
      </p>

      <section aria-label="Relationships">
        <h2 className="mb-2 text-base font-semibold">Relationships</h2>
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="h-[560px] overflow-hidden rounded-lg border border-border bg-card" role="img" aria-label="Entity relationship diagram">
            <ReactFlowProvider>
              <ReactFlow nodes={graph.nodes} edges={graph.edges} fitView fitViewOptions={{ padding: 0.12 }} nodesConnectable={false} colorMode={resolvedTheme === "light" ? "light" : "dark"} proOptions={{ hideAttribution: true }}>
                <Background gap={20} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
          <ul className="space-y-1.5 text-[13px]">
            {relationships.map((r) => (
              <li key={r.from} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 font-mono text-xs">
                <Link2 className="size-3.5 shrink-0 text-primary" aria-hidden />
                {r.from} → {r.to}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-4" aria-label="Tables">
        <h2 className="text-base font-semibold">Tables</h2>
        {schema.tables.map((t) => (
          <Card key={t.name} id={t.name} className="scroll-mt-4" data-testid={`table-${t.name}`}>
            <CardHeader>
              <CardTitle className="font-mono">{t.name}</CardTitle>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <Badge>{t.columns.length} columns</Badge>
                <Badge>{t.rowCount} rows</Badge>
              </div>
            </CardHeader>
            <TableWrap className="rounded-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Column</Th>
                    <Th>Type</Th>
                    <Th>Constraints</Th>
                    <Th>References</Th>
                  </tr>
                </thead>
                <tbody>
                  {t.columns.map((c) => {
                    const fk = t.foreignKeys.find((f) => f.column === c.name);
                    return (
                      <tr key={c.name}>
                        <Td className="font-mono">{c.name}</Td>
                        <Td>
                          <Badge tone="info">{c.type}</Badge>
                        </Td>
                        <Td className="space-x-1">
                          {c.primaryKey ? (
                            <Badge tone="amber">
                              <KeyRound className="size-3" aria-hidden /> PRIMARY KEY
                            </Badge>
                          ) : null}
                          {c.notNull && !c.primaryKey ? <Badge>NOT NULL</Badge> : null}
                          {!c.notNull ? <Badge tone="neutral">nullable</Badge> : null}
                        </Td>
                        <Td className="font-mono text-xs">{fk ? `${fk.referencesTable}.${fk.referencesColumn}` : ""}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        ))}
      </section>
    </div>
  );
}
