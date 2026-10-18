"use client";

import { Check, Copy, CornerDownLeft, Play } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type Block, type Inline, parseMarkdown } from "@/lib/utils/markdown";
import { type SqlClass, highlightSql } from "@/lib/utils/highlight";
import { cn } from "@/lib/utils/cn";

function renderInline(nodes: Inline[]): React.ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return n.v;
      case "code":
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-accent-foreground">
            {n.v}
          </code>
        );
      case "bold":
        return (
          <strong key={i} className="font-semibold">
            {renderInline(n.v)}
          </strong>
        );
      case "italic":
        return <em key={i}>{renderInline(n.v)}</em>;
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
            {n.v}
          </a>
        );
    }
  });
}

const SQL_COLOR: Record<SqlClass, string> = {
  keyword: "font-semibold text-violet-600 dark:text-violet-300",
  string: "text-emerald-700 dark:text-emerald-300",
  number: "text-amber-700 dark:text-amber-300",
  operator: "text-pink-600 dark:text-pink-300",
  comment: "italic text-muted-foreground",
  ident: "text-sky-700 dark:text-sky-200",
  plain: "",
};

function CodeBlock({ block, onUseSql, onRunSql }: { block: Extract<Block, { t: "code" }>; onUseSql?: (sql: string) => void; onRunSql?: (sql: string) => void }) {
  const [copied, setCopied] = useState(false);
  const isSql = block.lang === "sql" || (block.lang === "" && /^\s*select\b/i.test(block.v));
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-1 border-b border-border bg-muted/50 px-2 py-1">
        <span className="mr-auto font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{block.lang || "text"}</span>
        {isSql && block.closed && onUseSql ? (
          <Button variant="ghost" size="xs" onClick={() => onUseSql(block.v)} title="Replace the editor contents with this query">
            <CornerDownLeft /> Use in editor
          </Button>
        ) : null}
        {isSql && block.closed && onRunSql ? (
          <Button variant="ghost" size="xs" onClick={() => onRunSql(block.v)} title="Load into the editor and analyze it">
            <Play /> Analyze
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="xs"
          aria-label="Copy code"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(block.v);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            } catch {
              // clipboard may be blocked
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <pre className="scroll-thin overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">
        {isSql
          ? highlightSql(block.v).map((seg, i) => (
              <span key={i} className={SQL_COLOR[seg.cls]}>
                {seg.text}
              </span>
            ))
          : block.v}
      </pre>
    </div>
  );
}

export function QueraMarkdown({ text, onUseSql, onRunSql, streaming }: { text: string; onUseSql?: (sql: string) => void; onRunSql?: (sql: string) => void; streaming?: boolean }) {
  const blocks = parseMarkdown(text);
  return (
    <div className={cn("space-y-2 text-[14px] leading-relaxed", streaming && "quera-streaming")}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "heading":
            return (
              <h4 key={i} className={cn("pt-1 font-semibold tracking-tight", b.level === 1 ? "text-[16px]" : "text-[14.5px]")}>
                {renderInline(b.v)}
              </h4>
            );
          case "p":
            return <p key={i}>{renderInline(b.v)}</p>;
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5 marker:text-primary">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} start={b.start} className="list-decimal space-y-1 pl-5 marker:font-medium marker:text-primary">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-primary/60 pl-3 text-muted-foreground">
                {renderInline(b.v)}
              </blockquote>
            );
          case "hr":
            return <hr key={i} className="border-border" />;
          case "code":
            return <CodeBlock key={i} block={b} onUseSql={onUseSql} onRunSql={onRunSql} />;
          case "table":
            return (
              <div key={i} className="scroll-thin overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-left text-[12.5px]">
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j} className="border-b border-border bg-muted px-2 py-1.5 font-semibold">
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} className="border-b border-border/60 px-2 py-1.5">
                            {renderInline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
