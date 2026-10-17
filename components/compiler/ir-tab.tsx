"use client";

import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { describeRaNode, raChildren, shouldQualify, type RaNode } from "@/lib/compiler/relational-algebra";
import { CodeBlock, SectionTitle, Unavailable } from "./shared";
import { PlanView } from "./plan-view";

const NOTATION: [string, string, string][] = [
  ["π", "Projection", "π_{a, b}(R) keeps the listed columns / expressions"],
  ["σ", "Selection", "σ_{p}(R) keeps rows where predicate p is TRUE"],
  ["⋈", "Inner join", "(R ⋈_{c} S) combines rows satisfying condition c"],
  ["γ", "Aggregation", "γ_{g; f}(R) groups by g and computes aggregates f"],
  ["τ", "Sort", "τ_{k DESC}(R) orders rows by keys"],
  ["δ", "Distinct", "δ(R) removes duplicate rows"],
  ["λ", "Limit", "λ_{n}(R) returns at most n rows (offset optional)"],
];

function operatorsBottomUp(plan: RaNode): RaNode[] {
  return [...raChildren(plan).flatMap(operatorsBottomUp), plan];
}

export function IrTab() {
  const { analysis } = useWorkspace();
  if (!analysis?.algebra) return <Unavailable what="relational algebra" requires="semantic" />;
  const { plan, text, tree } = analysis.algebra;
  const qualify = shouldQualify(plan);

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle>Relational algebra expression</SectionTitle>
        <CodeBlock text={text} label="relational algebra" wrap className="[&_pre]:text-base" />
        <p className="mt-1.5 text-xs text-muted-foreground">Translated from the validated AST (never from the SQL text). Read it from the innermost table outwards.</p>
      </section>

      <section>
        <SectionTitle>Query plan</SectionTitle>
        <PlanView plan={plan} prefix="ir" label="Relational algebra plan graph" height={340} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <SectionTitle>Operator tree</SectionTitle>
          <CodeBlock text={tree} label="operator tree" />
        </section>
        <section>
          <SectionTitle>Operators, bottom-up</SectionTitle>
          <ol className="space-y-1.5">
            {operatorsBottomUp(plan).map((n, i) => {
              const info = describeRaNode(n, qualify);
              return (
                <li key={i} className="flex gap-2 text-[13px]">
                  <Badge tone="primary" className="h-fit shrink-0">
                    {info.symbol} {info.name}
                  </Badge>
                  <span className="text-muted-foreground">{info.description}</span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <section>
        <SectionTitle>Notation</SectionTitle>
        <ul className="grid gap-1.5 text-[13px] md:grid-cols-2">
          {NOTATION.map(([sym, name, desc]) => (
            <li key={sym} className="flex gap-2">
              <span className="w-5 text-center font-mono text-primary">{sym}</span>
              <span>
                <b className="font-medium">{name}</b> <span className="text-muted-foreground">— {desc}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Structured JSON (debugging)</summary>
        <CodeBlock text={JSON.stringify(plan, null, 2)} label="plan JSON" className="rounded-none border-0 border-t" />
      </details>
    </div>
  );
}
