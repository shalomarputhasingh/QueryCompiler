import type { Metadata } from "next";
import { SchemaExplorer } from "@/components/compiler/schema-explorer";

export const metadata: Metadata = { title: "Schema Explorer" };

export default function SchemaPage() {
  return <SchemaExplorer />;
}
