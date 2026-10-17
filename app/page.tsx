import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const PHASES: [string, string][] = [
  ["Lexical analysis", "A hand-written scanner turns characters into tokens with exact line/column positions."],
  ["Syntax analysis", "A recursive-descent / Pratt parser builds a typed abstract syntax tree and recovers from errors."],
  ["Semantic analysis", "Names and types are checked against the real SQLite schema using a symbol table."],
  ["Relational algebra", "The validated AST becomes π, σ, ⋈, γ, τ, δ, λ operators — a query plan."],
  ["Optimization", "Provably equivalent rewrites (constant folding, selection pushdown, column pruning…) with an explanation for each."],
  ["Code generation & execution", "Plans become parameterised SQL that runs read-only on the sample database."],
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-8">
      <section className="space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight">See how a SQL query is compiled</h2>
        <p className="max-w-2xl text-[15px] text-muted-foreground">
          QueryCompiler is an educational workbench for Compiler Design. Type a query, then inspect the tokens, syntax tree, symbol table, relational algebra and optimizer decisions — all produced by a real compiler pipeline, not canned output.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/playground">
              Open the SQL Playground <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/examples">Browse example queries</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/documentation">Read the documentation</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="phases">
        <h2 id="phases" className="mb-3 text-base font-semibold">
          The pipeline
        </h2>
        <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {PHASES.map(([title, text], i) => (
            <li key={title}>
              <Card className="h-full p-4">
                <p className="mb-1 text-xs font-semibold text-primary">Phase {i + 1}</p>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-[13px] text-muted-foreground">{text}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
