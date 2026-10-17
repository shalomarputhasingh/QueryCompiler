import type { Metadata } from "next";
import { Playground } from "@/components/editor/playground";

export const metadata: Metadata = { title: "SQL Playground" };

export default function PlaygroundPage() {
  return <Playground />;
}
