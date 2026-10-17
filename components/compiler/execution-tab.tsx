"use client";

import { AlertCircle, CheckCircle2, Clock, Play, Rows3 } from "lucide-react";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableWrap, Td, Th } from "@/components/ui/data-table";
import { Spinner } from "@/components/ui/spinner";
import { CodeBlock, DiagnosticList, Metric } from "./shared";

export function ResultsTable({ columns, rows, max }: { columns: string[]; rows: (string | number | null)[][]; max?: number }) {
  const shown = max ? rows.slice(0, max) : rows;
  return (
    <TableWrap className={max ? undefined : "max-h-[440px]"}>
      <Table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <Th key={`${c}-${i}`}>{c}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="hover:bg-muted/40">
              {r.map((v, j) => (
                <Td key={j} className={typeof v === "number" ? "text-right font-mono tabular-nums" : "font-mono"}>
                  {v === null ? <span className="italic text-muted-foreground">NULL</span> : String(v)}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      {shown.length === 0 ? <p className="p-4 text-center text-[13px] text-muted-foreground">The query returned no rows.</p> : null}
    </TableWrap>
  );
}

export function ExecutionTab() {
  const { execution, analysis, execute, plan, setPlan, stale, sql } = useWorkspace();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => execute()} disabled={execution.status === "loading" || sql.trim() === ""} data-testid="execute-in-tab">
          {execution.status === "loading" ? <Spinner /> : <Play />}
          Execute query
        </Button>
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          Run
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value === "original" ? "original" : "optimized")}
            className="h-8 rounded-md border border-input bg-card px-2 text-[13px] text-foreground"
            aria-label="Plan to execute"
          >
            <option value="optimized">optimized plan</option>
            <option value="original">original plan</option>
          </select>
        </label>
        {stale ? <span className="text-xs text-warning">The editor text changed after the last analysis; execution always compiles the current text.</span> : null}
      </div>

      {execution.status === "idle" ? (
        <EmptyState
          icon={Rows3}
          title="Not executed yet"
          description={analysis && !analysis.success ? "This query has compile errors, so it cannot be executed." : "Press “Execute” to run the compiled query against the sample SQLite database (read-only)."}
        />
      ) : null}

      {execution.status === "loading" ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner /> Compiling and executing…
        </p>
      ) : null}

      {execution.status === "error" ? (
        <div className="space-y-2" role="alert" data-testid="execution-error">
          <p className="flex items-center gap-2 text-[13px] text-destructive">
            <AlertCircle className="size-4" aria-hidden /> {execution.message}
          </p>
          <DiagnosticList diagnostics={execution.diagnostics} />
        </div>
      ) : null}

      {execution.status === "ok" ? (
        <div className="space-y-3" data-testid="execution-result">
          <div className="flex flex-wrap items-center gap-4">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-success">
              <CheckCircle2 className="size-4" aria-hidden /> Query executed successfully
            </p>
            <Metric label="Rows returned" value={<span data-testid="row-count">{execution.data.rowCount}</span>} />
            <Metric
              label={`Measured SQLite time (${execution.data.plan} plan)`}
              value={
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-4 text-muted-foreground" aria-hidden />
                  {execution.data.durationMs < 1 ? "<1" : execution.data.durationMs.toFixed(1)} ms
                </span>
              }
            />
          </div>
          {execution.data.truncated ? <p className="text-xs text-warning">Showing the first {execution.data.rowCount} rows; the result was truncated.</p> : null}
          <ResultsTable columns={execution.data.columns} rows={execution.data.rows} />
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">SQL executed ({execution.data.paramCount} bound parameter{execution.data.paramCount === 1 ? "" : "s"})</summary>
            <CodeBlock text={execution.data.sql} label="executed SQL" className="rounded-none border-0 border-t" />
          </details>
        </div>
      ) : null}
    </div>
  );
}
