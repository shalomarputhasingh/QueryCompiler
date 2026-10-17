"use client";

import { type ResultTab, useWorkspace } from "@/components/layout/workspace-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AstTab } from "./ast-tab";
import { ExecutionTab } from "./execution-tab";
import { IrTab } from "./ir-tab";
import { OptimizationTab } from "./optimization-tab";
import { OverviewTab } from "./overview-tab";
import { SemanticTab } from "./semantic-tab";
import { SymbolsTab } from "./symbols-tab";
import { TokensTab } from "./tokens-tab";

const TABS: { id: ResultTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tokens", label: "Tokens" },
  { id: "ast", label: "Syntax Tree" },
  { id: "semantic", label: "Semantic Analysis" },
  { id: "symbols", label: "Symbol Table" },
  { id: "ir", label: "Intermediate Representation" },
  { id: "optimization", label: "Query Optimization" },
  { id: "execution", label: "Execution Results" },
];

export function ResultsTabs() {
  const { activeTab, setActiveTab } = useWorkspace();
  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ResultTab)}>
      <TabsList aria-label="Compiler results">
        {TABS.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="overview">
        <OverviewTab />
      </TabsContent>
      <TabsContent value="tokens">
        <TokensTab />
      </TabsContent>
      <TabsContent value="ast">
        <AstTab />
      </TabsContent>
      <TabsContent value="semantic">
        <SemanticTab />
      </TabsContent>
      <TabsContent value="symbols">
        <SymbolsTab />
      </TabsContent>
      <TabsContent value="ir">
        <IrTab />
      </TabsContent>
      <TabsContent value="optimization">
        <OptimizationTab />
      </TabsContent>
      <TabsContent value="execution">
        <ExecutionTab />
      </TabsContent>
    </Tabs>
  );
}
