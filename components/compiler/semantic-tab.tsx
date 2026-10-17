"use client";

import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/data-table";
import type { CompileResult } from "@/lib/compiler/pipeline";
import { DiagnosticList, SectionTitle, StatusBadge, Unavailable } from "./shared";

interface Check {
  label: string;
  codes: string[];
}

const CHECKS: Check[] = [
  { label: "Referenced tables exist and aliases are unique", codes: ["QC3001", "QC3002"] },
  { label: "Referenced columns exist; qualifiers are in scope", codes: ["QC3003", "QC3004"] },
  { label: "No ambiguous column references", codes: ["QC3005"] },
  { label: "Operand types are compatible (comparisons, arithmetic, LIKE, BETWEEN, IN)", codes: ["QC3010", "QC3011"] },
  { label: "WHERE / HAVING / ON are boolean conditions", codes: ["QC3013"] },
  { label: "Functions are known, with valid arity and argument types", codes: ["QC3006", "QC3009", "QC3012"] },
  { label: "Aggregate and GROUP BY rules", codes: ["QC3007", "QC3008", "QC3015", "QC3016", "QC3017"] },
  { label: "Select aliases, DISTINCT / ORDER BY and positional references", codes: ["QC3014", "QC3018", "QC3019"] },
];

function checkState(result: CompileResult, c: Check): "pass" | "fail" {
  return result.diagnostics.some((d) => d.severity === "error" && c.codes.includes(d.code)) ? "fail" : "pass";
}

export function SemanticTab() {
  const { analysis } = useWorkspace();
  if (!analysis || !analysis.semantic) return <Unavailable what="semantic results" requires="semantic" />;
  const sem = analysis.semantic;
  const diags = analysis.diagnostics.filter((d) => d.phase === "semantic");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <StatusBadge ok={sem.ok} okText="Semantic validation passed" failText="Semantic validation failed" />
        <span className="text-xs text-muted-foreground">Checked against the live SQLite schema, not a hardcoded list.</span>
      </div>

      <section>
        <SectionTitle>Checks performed</SectionTitle>
        <ul className="grid gap-1.5 md:grid-cols-2">
          {CHECKS.map((c) => {
            const state = checkState(analysis, c);
            return (
              <li key={c.label} className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
                {state === "pass" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />}
                {c.label}
              </li>
            );
          })}
          <li className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-[13px] text-muted-foreground">
            <CircleDashed className="mt-0.5 size-4 shrink-0" aria-hidden />
            Aggregate query: {sem.isAggregateQuery ? "yes (grouping rules enforced)" : "no"}
          </li>
        </ul>
      </section>

      {diags.length > 0 ? (
        <section>
          <SectionTitle>Diagnostics</SectionTitle>
          <DiagnosticList diagnostics={diags} />
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <SectionTitle>Tables in scope</SectionTitle>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Name in query</Th>
                  <Th>Table</Th>
                  <Th>Declared at</Th>
                </tr>
              </thead>
              <tbody>
                {sem.scope.map((s) => (
                  <tr key={s.name}>
                    <Td className="font-mono">{s.name}</Td>
                    <Td className="font-mono">{s.tableName}</Td>
                    <Td className="font-mono text-xs">
                      {s.location.start.line}:{s.location.start.column}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </section>
        <section>
          <SectionTitle>Output columns</SectionTitle>
          {sem.outputColumns.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No output columns could be determined.</p>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Type</Th>
                  </tr>
                </thead>
                <tbody>
                  {sem.outputColumns.map((c, i) => (
                    <tr key={`${c.name}-${i}`}>
                      <Td className="font-mono">{c.name}</Td>
                      <Td>
                        <Badge tone="info">{c.dataType}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </section>
      </div>
    </div>
  );
}
