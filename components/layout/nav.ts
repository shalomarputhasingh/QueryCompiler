import { BookOpen, Database, FileText, History, type LucideIcon, SquareTerminal, Workflow } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  title: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/playground", label: "SQL Playground", title: "SQL Playground", icon: SquareTerminal },
  { href: "/pipeline", label: "Compiler Pipeline", title: "Compiler Pipeline & Learning Mode", icon: Workflow },
  { href: "/schema", label: "Schema Explorer", title: "Schema Explorer", icon: Database },
  { href: "/examples", label: "Example Queries", title: "Example Queries", icon: BookOpen },
  { href: "/history", label: "Query History", title: "Query History", icon: History },
  { href: "/documentation", label: "Documentation", title: "Documentation", icon: FileText },
];

const SUBTITLES: Record<string, string> = {
  "/playground": "Write SQL, analyze the compilation process, and execute queries.",
  "/pipeline": "Follow a query through every compiler phase with plain-language explanations.",
  "/schema": "Tables, columns, keys and relationships of the sample database.",
  "/examples": "Valid, optimizer and intentionally invalid queries to learn from.",
  "/history": "Recent analyses stored in this browser.",
  "/documentation": "Supported grammar, notation, optimization rules and limitations.",
};

export function subtitleFor(pathname: string): string {
  return SUBTITLES[pathname] ?? "SQL compiler workbench for Compiler Design.";
}

export function titleFor(pathname: string): string {
  if (pathname === "/") return "Overview";
  return NAV_ITEMS.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`))?.title ?? "QueryCompiler";
}
