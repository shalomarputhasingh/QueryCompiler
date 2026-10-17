"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EXAMPLES, type ExampleCategory } from "@/lib/utils/examples";

const GROUPS: { id: ExampleCategory; title: string; blurb: string }[] = [
  { id: "valid", title: "Valid queries", blurb: "Core SQL features that compile and run." },
  { id: "optimizer", title: "Optimizer demonstrations", blurb: "Queries where optimization rules visibly change the plan." },
  { id: "invalid", title: "Intentionally invalid queries", blurb: "See how errors are reported with line and column locations." },
];

export function ExamplesList() {
  const { setSql, analyze, setActiveTab } = useWorkspace();
  const router = useRouter();

  const open = (sql: string) => {
    setSql(sql);
    setActiveTab("overview");
    void analyze(sql);
    router.push("/playground");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6">
      {GROUPS.map((g) => (
        <section key={g.id} aria-labelledby={`g-${g.id}`}>
          <h2 id={`g-${g.id}`} className="text-base font-semibold">
            {g.title}
          </h2>
          <p className="mb-3 text-[13px] text-muted-foreground">{g.blurb}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {EXAMPLES.filter((e) => e.category === g.id).map((e) => (
              <Card key={e.id} className="flex flex-col gap-2 p-4" data-testid={`example-${e.id}`}>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{e.title}</h3>
                  <Badge tone={e.category === "invalid" ? "danger" : e.category === "optimizer" ? "violet" : "primary"}>{e.topic}</Badge>
                </div>
                <p className="text-[13px] text-muted-foreground">{e.description}</p>
                <pre className="scroll-thin overflow-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-xs">{e.sql}</pre>
                <p className="text-xs">
                  <b className="font-medium">Expected:</b> <span className="text-muted-foreground">{e.expectedBehavior}</span>
                </p>
                <Button size="sm" variant="secondary" className="mt-auto self-start" onClick={() => open(e.sql)}>
                  Load &amp; analyze <ArrowRight />
                </Button>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
