"use client";

import { useMemo, useState } from "react";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import type { SymbolKind } from "@/lib/compiler/symbol-table";
import { cn } from "@/lib/utils/cn";
import { Unavailable } from "./shared";

const KIND_TONE: Record<SymbolKind, BadgeProps["tone"]> = {
  table: "violet",
  alias: "pink",
  column: "blue",
  "column-alias": "amber",
  reference: "green",
};

export function SymbolsTab() {
  const { analysis } = useWorkspace();
  const [kinds, setKinds] = useState<Set<SymbolKind>>(new Set());
  const [query, setQuery] = useState("");
  const symbols = analysis?.symbolTable ?? [];

  const kindCounts = useMemo(() => {
    const m = new Map<SymbolKind, number>();
    for (const s of symbols) m.set(s.kind, (m.get(s.kind) ?? 0) + 1);
    return m;
  }, [symbols]);

  if (!analysis || symbols.length === 0) return <Unavailable what="symbol table" requires="semantic" />;

  const q = query.trim().toLowerCase();
  const rows = symbols.filter(
    (s) => (kinds.size === 0 || kinds.has(s.kind)) && (q === "" || `${s.name} ${s.scope} ${s.dataType ?? ""} ${s.detail ?? ""}`.toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by symbol kind" className="flex flex-wrap gap-1.5">
          {[...kindCounts.entries()].map(([kind, n]) => (
            <button
              key={kind}
              type="button"
              aria-pressed={kinds.has(kind)}
              onClick={() =>
                setKinds((prev) => {
                  const next = new Set(prev);
                  if (next.has(kind)) next.delete(kind);
                  else next.add(kind);
                  return next;
                })
              }
              className={cn("rounded-md border px-2 py-1 text-xs", kinds.has(kind) ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted")}
            >
              {kind} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
        <Input className="ml-auto h-8 max-w-56" placeholder="Search symbols…" aria-label="Search symbols" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">
        {rows.length} of {symbols.length} symbols. Columns come from the database schema; references are the identifiers found in your query.
      </p>
      <TableWrap className="max-h-[440px]">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Kind</Th>
              <Th>Data type</Th>
              <Th>Scope / owning table</Th>
              <Th>Location</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={`${s.kind}-${s.name}-${s.scope}-${i}`} className="hover:bg-muted/40">
                <Td className="font-mono">{s.name}</Td>
                <Td>
                  <Badge tone={KIND_TONE[s.kind]}>{s.kind}</Badge>
                </Td>
                <Td className="font-mono text-xs">{s.dataType ?? "—"}</Td>
                <Td className="font-mono text-xs">{s.scope}</Td>
                <Td className="font-mono text-xs">{s.location ? `${s.location.start.line}:${s.location.start.column}` : "schema"}</Td>
                <Td className="text-xs text-muted-foreground">{s.detail ?? ""}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 ? <p className="p-4 text-center text-[13px] text-muted-foreground">No symbols match.</p> : null}
      </TableWrap>
    </div>
  );
}
