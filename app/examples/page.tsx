import type { Metadata } from "next";
import { ExamplesList } from "@/components/compiler/examples-list";

export const metadata: Metadata = { title: "Example Queries" };

export default function ExamplesPage() {
  return <ExamplesList />;
}
