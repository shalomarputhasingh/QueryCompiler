"use client";

import { Binary, ChevronRight, Table2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { NAV_ITEMS } from "./nav";
import { useWorkspace } from "./workspace-provider";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { schema } = useWorkspace();
  return (
    <nav aria-label="Main" className="flex h-full w-60 flex-col border-r border-border bg-sidebar">
      <Link href="/" onClick={onNavigate} className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
          <Binary className="size-4" aria-hidden />
        </span>
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-tight">QueryCompiler</span>
          <span className="block text-[11px] text-muted-foreground">SQL Compiler &amp; Optimizer</span>
        </span>
      </Link>
      <ul className="flex-1 space-y-0.5 p-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <section aria-label="Sample database" className="m-2 rounded-lg border border-border p-2">
        <h2 className="flex items-center gap-2 px-1.5 pb-1.5 text-xs font-semibold text-muted-foreground">
          <Table2 className="size-3.5" aria-hidden /> Sample Database
        </h2>
        <ul className="scroll-thin max-h-56 space-y-0.5 overflow-auto">
          {(schema?.tables ?? []).map((t) => (
            <li key={t.name}>
              <Link href={`/schema#${t.name}`} onClick={onNavigate} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted">
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] font-medium">{t.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{t.columns.length} columns · {t.rowCount} rows</span>
                </span>
                <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
          {!schema ? <li className="px-1.5 py-1 text-xs text-muted-foreground">Loading schema…</li> : null}
        </ul>
      </section>
    </nav>
  );
}
