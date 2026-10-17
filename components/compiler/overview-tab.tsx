"use client";

import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { type ResultTab, useWorkspace } from "@/components/layout/workspace-provider";
import { buildAstTree } from "@/components/visualizations/graph-builders";
import { TreeGraph } from "@/components/visualizations/tree-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";
import { ResultsTable } from "./execution-tab";
import { DiagnosticList, StatusBadge } from "./shared";
import { TOKEN_TONE } from "./tokens-tab";
import { shouldQualify, describeRaNode, raChildren, type RaNode } from "@/lib/compiler/relational-algebra";

function Panel({ title, badge, tab, children }: { title: string; badge?: React.ReactNode; tab: ResultTab; children: React.ReactNode }) {
  const { setActiveTab } = useWorkspace();
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-2">
          {badge}
          <Button variant="ghost" size="xs" onClick={() => setActiveTab(tab)}>
            Details
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
    </Card>
  );
}

const PHASE_STYLE = {
  success: "border-success/40 bg-success/10 text-success",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  skipped: "border-border text-muted-foreground",
} as const;

function bottomUp(plan: RaNode): RaNode[] {
  return [...raChildren(plan).flatMap(bottomUp), plan];
}

export function OverviewTab() {
  const { analysis, execution } = useWorkspace();
  const built = useMemo(() => (analysis?.ast ? buildAstTree(analysis.ast) : null), [analysis?.ast]);

  if (!analysis) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Nothing analyzed yet"
        description="Write or load a SQL query, then press Analyze. Each compiler phase will appear here with its real output."
      />
    );
  }

  const tokens = analysis.tokens.filter((t) => t.type !== "EOF");
  const qualify = analysis.algebra ? shouldQualify(analysis.algebra.plan) : false;

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2" aria-label="Compiler phases">
        {analysis.phases.map((p, i) => (
          <li key={p.id} className={cn("flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs", PHASE_STYLE[p.status])}>
            <span className="font-semibold tabular-nums">{i + 1}</span>
            <span>{p.label}</span>
            <span className="opacity-70">{p.status === "skipped" ? "skipped" : p.status === "error" ? "failed" : `${p.durationMs < 0.1 ? "<0.1" : p.durationMs.toFixed(1)} ms`}</span>
          </li>
        ))}
      </ol>

      {analysis.diagnostics.length > 0 ? <DiagnosticList diagnostics={analysis.diagnostics} /> : null}

      <div className="grid gap-4 xl:grid-cols-3 md:grid-cols-2">
        <Panel title="1. Lexical Analysis" tab="tokens" badge={<Badge tone="primary">{tokens.length} tokens</Badge>}>
          {tokens.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No tokens.</p>
          ) : (
            <TableWrap className="max-h-64">
              <Table>
                <thead>
                  <tr>
                    <Th>Lexeme</Th>
                    <Th>Type</Th>
                    <Th>Line:Col</Th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.slice(0, 40).map((t, i) => (
                    <tr key={i}>
                      <Td className="font-mono">{t.lexeme}</Td>
                      <Td>
                        <Badge tone={TOKEN_TONE[t.type]}>{t.type}</Badge>
                      </Td>
                      <Td className="font-mono text-xs">
                        {t.range.start.line}:{t.range.start.column}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {tokens.length > 40 ? <p className="p-2 text-center text-xs text-muted-foreground">+ {tokens.length - 40} more</p> : null}
            </TableWrap>
          )}
        </Panel>

        <Panel title="2. Syntax Tree (AST)" tab="ast" badge={<StatusBadge ok={Boolean(analysis.ast)} okText="Parsed" failText={analysis.phases.find((p) => p.id === "syntax")?.status === "skipped" ? "Not reached" : "Syntax errors"} />}>
          {built ? <TreeGraph root={built.root} height={260} ariaLabel="Abstract syntax tree overview" /> : <p className="text-[13px] text-muted-foreground">No syntax tree: parsing did not succeed.</p>}
        </Panel>

        <Panel
          title="3. Semantic Analysis"
          tab="semantic"
          badge={analysis.semantic ? <StatusBadge ok={analysis.semantic.ok} okText="No semantic errors" failText="Semantic errors" /> : <Badge>Not reached</Badge>}
        >
          {analysis.semantic ? (
            <div className="space-y-2 text-[13px]">
              <p>
                <b className="font-medium">Tables:</b> <span className="font-mono">{analysis.semantic.scope.map((s) => (s.name === s.tableName ? s.name : `${s.tableName} AS ${s.name}`)).join(", ")}</span>
              </p>
              <p>
                <b className="font-medium">References resolved:</b> {Object.keys(analysis.semantic.resolutions).length}
              </p>
              <p className="font-medium">Output columns</p>
              <ul className="flex flex-wrap gap-1.5">
                {analysis.semantic.outputColumns.map((c, i) => (
                  <li key={i}>
                    <Badge tone="info" className="font-mono">
                      {c.name}: {c.dataType}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Semantic analysis requires a successfully parsed query.</p>
          )}
        </Panel>

        <Panel title="4. Relational Algebra" tab="ir" badge={analysis.algebra ? <Badge tone="primary">{bottomUp(analysis.algebra.plan).length} operators</Badge> : <Badge>Not reached</Badge>}>
          {analysis.algebra ? (
            <div className="space-y-3">
              <pre className="scroll-thin overflow-auto rounded-md border border-primary/30 bg-accent/40 p-3 font-mono text-[13px] whitespace-pre-wrap break-all">{analysis.algebra.text}</pre>
              <ul className="space-y-1">
                {bottomUp(analysis.algebra.plan)
                  .reverse()
                  .map((n, i) => {
                    const info = describeRaNode(n, qualify);
                    return (
                      <li key={i} className="flex items-baseline gap-2 text-[13px]">
                        <span className="w-5 shrink-0 text-center font-mono text-primary">{info.symbol}</span>
                        {info.name}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Relational algebra is produced after semantic validation.</p>
          )}
        </Panel>

        <Panel title="5. Query Optimization" tab="optimization" badge={analysis.optimization ? <Badge tone={analysis.optimization.steps.length > 0 ? "success" : "neutral"}>{analysis.optimization.steps.length} rule{analysis.optimization.steps.length === 1 ? "" : "s"} applied</Badge> : <Badge>Not reached</Badge>}>
          {analysis.optimization ? (
            <div className="space-y-2 text-[13px]">
              <div>
                <p className="text-xs text-muted-foreground">Original</p>
                <code className="block break-all font-mono text-xs">{analysis.optimization.original.text}</code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Optimized</p>
                <code className="block break-all font-mono text-xs">{analysis.optimization.optimized.text}</code>
              </div>
              {analysis.optimization.steps.length === 0 ? (
                <p className="text-muted-foreground">No rule applied — the plan is already minimal.</p>
              ) : (
                <ol className="space-y-1.5">
                  {analysis.optimization.steps.slice(0, 4).map((s) => (
                    <li key={s.index} className="flex gap-2">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{s.index}</span>
                      <span>
                        <b className="font-medium">{s.ruleName}</b>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Optimization runs on the relational algebra.</p>
          )}
        </Panel>

        <Panel title="6. Execution Results" tab="execution" badge={execution.status === "ok" ? <Badge tone="success">{execution.data.rowCount} rows</Badge> : <Badge>{execution.status === "error" ? "Failed" : "Not run"}</Badge>}>
          {execution.status === "ok" ? (
            <div className="space-y-2">
              <ResultsTable columns={execution.data.columns} rows={execution.data.rows} max={5} />
              <p className="text-xs text-muted-foreground">
                {execution.data.rowCount} rows · {execution.data.durationMs < 1 ? "<1" : execution.data.durationMs.toFixed(1)} ms (measured)
              </p>
            </div>
          ) : execution.status === "error" ? (
            <p className="text-[13px] text-destructive">{execution.message}</p>
          ) : execution.status === "loading" ? (
            <p className="text-[13px] text-muted-foreground">Executing…</p>
          ) : (
            <p className="text-[13px] text-muted-foreground">{analysis.success ? "Press Execute to run this query on the sample database." : "Fix the errors above to execute this query."}</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
