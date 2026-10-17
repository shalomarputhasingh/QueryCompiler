import type { Metadata } from "next";
import { OPTIMIZATION_RULES } from "@/lib/compiler/optimizer";
import { GRAMMAR, LIMITATIONS, UNSUPPORTED } from "@/lib/utils/grammar";

export const metadata: Metadata = { title: "Documentation" };

const SECTIONS = [
  ["overview", "Overview"],
  ["grammar", "Supported SQL"],
  ["unsupported", "Not supported"],
  ["phases", "Compiler phases"],
  ["notation", "Relational algebra"],
  ["rules", "Optimization rules"],
  ["safety", "Execution safety"],
  ["shortcuts", "Keyboard shortcuts"],
  ["limitations", "Limitations"],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-4 border-b border-border pb-1 text-lg font-semibold">
      {children}
    </h2>
  );
}

export default function DocumentationPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-8 p-4 sm:p-8 lg:grid-cols-[200px_1fr]">
      <nav aria-label="On this page" className="hidden lg:block">
        <ul className="sticky top-4 space-y-1 text-[13px]">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="block rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="min-w-0 space-y-8 text-[14px] leading-relaxed [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12.5px] [&_p]:text-muted-foreground [&_li]:text-muted-foreground">
        <section className="space-y-2">
          <H2 id="overview">Overview</H2>
          <p>
            QueryCompiler runs a restricted SQL dialect through a complete compiler pipeline implemented in TypeScript (<code>lib/compiler</code>) and shows each phase&apos;s real output. The browser only displays results; all compilation happens in a Next.js Route Handler, and queries run on a read-only SQLite sample database (students, courses, enrollments, departments).
          </p>
        </section>

        <section className="space-y-2">
          <H2 id="grammar">Supported SQL</H2>
          <p>Grammar (EBNF). Keywords are case-insensitive; identifiers are case-insensitive and may be quoted with double quotes or backticks. Comments (<code>-- …</code> and <code>/* … */</code>) are skipped.</p>
          <pre className="scroll-thin overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed">{GRAMMAR}</pre>
          <p>
            Operator precedence from loosest to tightest: <code>OR</code>, <code>AND</code>, <code>NOT</code>, comparisons / <code>IS</code> / <code>LIKE</code> / <code>BETWEEN</code> / <code>IN</code>, <code>+ -</code>, <code>* / %</code>, unary <code>- +</code>. Integer division truncates, as in SQLite.
          </p>
        </section>

        <section className="space-y-2">
          <H2 id="unsupported">Not supported</H2>
          <p>These constructs are recognised and reported with a clear diagnostic rather than being silently misinterpreted:</p>
          <ul className="list-disc space-y-1 pl-5">
            {UNSUPPORTED.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <H2 id="phases">Compiler phases</H2>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li><b className="text-foreground">Lexer</b> — scans characters into KEYWORD, IDENTIFIER, QUOTED_IDENTIFIER, NUMBER, STRING, OPERATOR and PUNCTUATION tokens with start/end line, column and offset. Reports unterminated strings/comments and invalid characters; a lexical error stops the pipeline.</li>
            <li><b className="text-foreground">Parser</b> — recursive descent for clauses, Pratt (precedence climbing) for expressions. Syntax errors are recovered at clause boundaries so several can be reported at once; no AST is produced when any error exists.</li>
            <li><b className="text-foreground">Semantic analyzer</b> — resolves tables, aliases and columns against the live schema, detects ambiguity, checks types, boolean conditions and aggregate/GROUP BY rules, and builds the symbol table.</li>
            <li><b className="text-foreground">Relational algebra</b> — translates the AST to scan, selection, projection, join, aggregation, sort, distinct and limit operators.</li>
            <li><b className="text-foreground">Optimizer</b> — applies the rules below until a fixed point and records every step.</li>
            <li><b className="text-foreground">Code generator</b> — emits parameterised SQL from the plan and a numbered instruction listing (an educational format, not machine code).</li>
          </ol>
        </section>

        <section className="space-y-2">
          <H2 id="notation">Relational algebra notation</H2>
          <ul className="space-y-1">
            <li><code>π_{"{a, b}"}(R)</code> projection · <code>σ_{"{p}"}(R)</code> selection · <code>(R ⋈_{"{c}"} S)</code> inner join</li>
            <li><code>γ_{"{g; f}"}(R)</code> grouping g with aggregates f · <code>τ_{"{k}"}(R)</code> sort · <code>δ(R)</code> duplicate elimination · <code>λ_{"{n}"}(R)</code> limit</li>
            <li>Example: <code>π_{"{name}"}(σ_{"{marks > 80}"}(students))</code></li>
          </ul>
        </section>

        <section className="space-y-3">
          <H2 id="rules">Optimization rules</H2>
          <p>Each rule states when it applies and why it preserves the result. The optimizer never claims a speed-up; compare measured execution times yourself.</p>
          <ul className="space-y-3">
            {OPTIMIZATION_RULES.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3">
                <b className="text-foreground">{r.name}</b> <code>{r.id}</code>
                <p><b className="font-medium text-foreground">Applies when:</b> {r.appliesWhen}</p>
                <p><b className="font-medium text-foreground">Why it is safe:</b> {r.whySafe}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <H2 id="safety">Execution safety</H2>
          <ul className="list-disc space-y-1 pl-5">
            <li>The server recompiles every query; client-side flags are never trusted and unknown request fields are rejected.</li>
            <li>Only a single SELECT that passed all compiler phases is executed. INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, PRAGMA and multiple statements are rejected during parsing.</li>
            <li>Literals are bound as parameters (<code>?</code>), never concatenated into SQL.</li>
            <li>The database connection is read-only with <code>query_only</code> enabled; results are capped at 500 rows; errors are sanitised.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <H2 id="shortcuts">Keyboard shortcuts</H2>
          <ul className="space-y-1">
            <li><code>Ctrl/⌘ + Enter</code> analyze the query</li>
            <li><code>Ctrl/⌘ + Shift + Enter</code> execute the query</li>
          </ul>
        </section>

        <section className="space-y-2">
          <H2 id="limitations">Limitations</H2>
          <ul className="list-disc space-y-1 pl-5">
            {LIMITATIONS.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      </article>
    </div>
  );
}
