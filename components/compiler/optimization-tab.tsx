"use client";

import { ArrowDown, Info } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableWrap, Td, Th } from "@/components/ui/data-table";
import { CodeBlock, Metric, SectionTitle, Unavailable } from "./shared";
import { PlanView, countNodes } from "./plan-view";

export function OptimizationTab() {
  const { analysis } = useWorkspace();
  const [viewStep, setViewStep] = useState<number | null>(null);
  if (!analysis?.optimization || !analysis.codegen) return <Unavailable what="optimization results" requires="semantic" />;
  const opt = analysis.optimization;
  const cg = analysis.codegen;
  const step = viewStep !== null ? opt.steps.find((s) => s.index === viewStep) : undefined;
  const changed = opt.steps.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4">
        <Metric label="Rules applied" value={opt.steps.length} tone={changed ? "good" : undefined} />
        <Metric label="Rules skipped (with reason)" value={opt.skipped.length} />
        <Metric label="Operators before → after" value={`${countNodes(opt.original.plan)} → ${countNodes(opt.optimized.plan)}`} />
        <Metric label="Passes over rule set" value={opt.passes} />
      </div>
      <p className="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs">
        <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
        <span>Every rewrite below preserves the query result. These are structural changes to the plan — they are not a measured speed-up. Execution time is measured separately on the Execution Results tab.</span>
      </p>

      <section aria-label="Original and optimized algebra" className="space-y-2">
        <SectionTitle>Original → optimized</SectionTitle>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Original plan</p>
          <CodeBlock text={opt.original.text} label="original algebra" wrap />
        </div>
        <div className="flex justify-center text-muted-foreground">
          <ArrowDown className="size-4" aria-hidden />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Optimized plan {changed ? "" : "(identical — no rule applied)"}</p>
          <CodeBlock text={opt.optimized.text} label="optimized algebra" wrap />
        </div>
      </section>

      <section aria-label="Plan graphs">
        <SectionTitle>Plan graphs</SectionTitle>
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Original</p>
            <PlanView plan={opt.original.plan} prefix="orig" label="Original plan graph" height={300} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Optimized</p>
            <PlanView plan={opt.optimized.plan} prefix="opt" label="Optimized plan graph" height={300} />
          </div>
        </div>
        {step ? (
          <div className="mt-4">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Plan after step {step.index} ({step.ruleName})</p>
            <PlanView plan={step.planAfter} prefix={`step${step.index}`} label={`Plan after step ${step.index}`} height={300} />
          </div>
        ) : null}
      </section>

      <section aria-label="Rules applied">
        <SectionTitle>Rules applied</SectionTitle>
        {opt.steps.length === 0 ? (
          <p className="rounded-md border border-border px-3 py-3 text-[13px] text-muted-foreground">No rule applied: the plan is already minimal for the supported rules.</p>
        ) : (
          <ol className="space-y-2">
            {opt.steps.map((s) => (
              <li key={s.index} className="rounded-lg border border-border p-3" data-testid="optimization-step">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{s.index}</span>
                  <b className="text-sm">{s.ruleName}</b>
                  <Badge tone="neutral">{s.ruleId}</Badge>
                  <Button variant="ghost" size="xs" className="ml-auto" aria-pressed={viewStep === s.index} onClick={() => setViewStep(viewStep === s.index ? null : s.index)}>
                    {viewStep === s.index ? "Hide plan after this step" : "Show plan after this step"}
                  </Button>
                </div>
                <p className="mt-1.5 text-[13px]">{s.explanation.replace(/`/g, "")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <b className="font-medium">Applicable because:</b> {s.precondition}
                </p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Before (affected subtree)</p>
                    <code className="block break-all rounded bg-muted/50 px-2 py-1 font-mono text-xs">{s.before}</code>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">After</p>
                    <code className="block break-all rounded bg-muted/50 px-2 py-1 font-mono text-xs">{s.after}</code>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {opt.skipped.length > 0 ? (
        <section aria-label="Rules skipped">
          <SectionTitle>Rules considered but not applied</SectionTitle>
          <ul className="space-y-1.5">
            {opt.skipped.map((s, i) => (
              <li key={i} className="rounded-md border border-border px-3 py-2 text-[13px]">
                <b className="font-medium">{s.ruleName}</b> <span className="text-muted-foreground">— {s.reason.replace(/`/g, "")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Generated code">
        <SectionTitle>Code generation</SectionTitle>
        <p className="mb-2 text-xs text-muted-foreground">
          The plans are turned back into SQL for SQLite. Numeric and string literals become <code>?</code> bound parameters. The instruction listing is a teaching format, not machine code.
        </p>
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Normalized SQL — original plan</p>
            <CodeBlock text={cg.original.displaySql} label="original SQL" />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Normalized SQL — optimized plan</p>
            <CodeBlock text={cg.optimized.displaySql} label="optimized SQL" />
          </div>
        </div>
        {cg.optimized.params.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Bound parameters (optimized statement)</p>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Type</Th>
                    <Th>Value</Th>
                  </tr>
                </thead>
                <tbody>
                  {cg.optimized.params.map((p, i) => (
                    <tr key={i}>
                      <Td>{i + 1}</Td>
                      <Td>{p.type}</Td>
                      <Td className="font-mono">{String(p.value)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        ) : null}
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Plan instructions (optimized)</p>
          <CodeBlock text={`${cg.optimizedInstructions.instructions.map((i) => i.text).join("\n")}\nRETURN ${cg.optimizedInstructions.result}`} label="plan instructions" />
        </div>
      </section>

      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Rule reference — conditions and safety arguments</summary>
        <ul className="divide-y divide-border border-t border-border">
          {opt.rules.map((r) => (
            <li key={r.id} className="px-3 py-2 text-[13px]">
              <b>{r.name}</b> <Badge className="ml-1">{r.id}</Badge>
              <p className="mt-1 text-muted-foreground">
                <b className="font-medium text-foreground">Applies when:</b> {r.appliesWhen}
              </p>
              <p className="text-muted-foreground">
                <b className="font-medium text-foreground">Why it is safe:</b> {r.whySafe}
              </p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
