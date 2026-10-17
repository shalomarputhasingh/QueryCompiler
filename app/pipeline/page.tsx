import type { Metadata } from "next";
import { PipelineView } from "@/components/compiler/pipeline-view";

export const metadata: Metadata = { title: "Compiler Pipeline" };

export default function PipelinePage() {
  return <PipelineView />;
}
