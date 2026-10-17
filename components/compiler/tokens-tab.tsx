"use client";

import { Crosshair } from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableWrap, Td, Th } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import type { Token, TokenType } from "@/lib/compiler/tokens";
import { cn } from "@/lib/utils/cn";
import { Unavailable } from "./shared";

export const TOKEN_TONE: Record<TokenType, BadgeProps["tone"]> = {
  KEYWORD: "violet",
  IDENTIFIER: "blue",
  QUOTED_IDENTIFIER: "blue",
  NUMBER: "amber",
  STRING: "green",
  OPERATOR: "pink",
  PUNCTUATION: "neutral",
  INVALID: "danger",
  EOF: "neutral",
};

const ROW_LIMIT = 500;

export function loc(t: Token): string {
  const { start, end } = t.range;
  return start.line === end.line ? `${start.line}:${start.column}–${end.column}` : `${start.line}:${start.column}–${end.line}:${end.column}`;
}

export function TokensTab() {
  const { analysis, reveal, stale } = useWorkspace();
  const [active, setActive] = useState<Set<TokenType>>(new Set());
  const [query, setQuery] = useState("");

  const tokens = useMemo(() => (analysis?.tokens ?? []).filter((t) => t.type !== "EOF"), [analysis]);
  const counts = useMemo(() => {
    const m = new Map<TokenType, number>();
    for (const t of tokens) m.set(t.type, (m.get(t.type) ?? 0) + 1);
    return m;
  }, [tokens]);

  if (!analysis || analysis.tokens.length === 0) return <Unavailable what="tokens" requires="lexical" />;

  const q = query.trim().toLowerCase();
  const rows = tokens
    .map((t, i) => ({ t, n: i + 1 }))
    .filter(({ t }) => (active.size === 0 || active.has(t.type)) && (q === "" || t.lexeme.toLowerCase().includes(q)));

  const toggle = (type: TokenType) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by token type" className="flex flex-wrap gap-1.5">
          {[...counts.entries()].map(([type, n]) => (
            <button
              key={type}
              type="button"
              aria-pressed={active.has(type)}
              onClick={() => toggle(type)}
              className={cn("rounded-md border px-2 py-1 text-xs transition-colors", active.has(type) ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted")}
            >
              {type} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
          {active.size > 0 ? (
            <Button variant="ghost" size="xs" onClick={() => setActive(new Set())}>
              Clear filters
            </Button>
          ) : null}
        </div>
        <Input className="ml-auto h-8 max-w-48" placeholder="Search lexeme…" aria-label="Search tokens" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing {Math.min(rows.length, ROW_LIMIT)} of {tokens.length} tokens produced by the lexer
        {analysis.comments.length > 0 ? ` (${analysis.comments.length} comment${analysis.comments.length === 1 ? "" : "s"} skipped)` : ""}.
      </p>
      <TableWrap className="max-h-[420px]">
        <Table>
          <thead>
            <tr>
              <Th className="w-10">#</Th>
              <Th>Lexeme</Th>
              <Th>Token type</Th>
              <Th>Location (line:column)</Th>
              <Th>Offsets</Th>
              <Th className="w-20">
                <span className="sr-only">Locate</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, ROW_LIMIT).map(({ t, n }) => (
              <tr key={n} className="hover:bg-muted/40">
                <Td className="tabular-nums text-muted-foreground">{n}</Td>
                <Td className="font-mono">{t.lexeme}</Td>
                <Td>
                  <Badge tone={TOKEN_TONE[t.type]}>{t.type}</Badge>
                </Td>
                <Td className="font-mono text-xs">{loc(t)}</Td>
                <Td className="font-mono text-xs text-muted-foreground">
                  {t.range.start.offset}–{t.range.end.offset}
                </Td>
                <Td>
                  <Button variant="ghost" size="xs" disabled={stale} title={stale ? "The query changed since this analysis" : "Select this token in the editor"} onClick={() => reveal(t.range)} aria-label={`Locate token ${t.lexeme} in editor`}>
                    <Crosshair /> Locate
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 ? <p className="p-4 text-center text-[13px] text-muted-foreground">No tokens match the filters.</p> : null}
      </TableWrap>
    </div>
  );
}
