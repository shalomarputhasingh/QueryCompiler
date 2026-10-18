"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { QueraLauncher } from "@/components/quera/quera-launcher";
import { QueraPanel } from "@/components/quera/quera-panel";
import { QueraProvider, useQuera } from "@/components/quera/quera-provider";
import { cn } from "@/lib/utils/cn";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { WorkspaceProvider } from "./workspace-provider";

function Shell({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState(false);
  const pathname = usePathname();
  const { open, wide } = useQuera();
  useEffect(() => setMenu(false), [pathname]);

  return (
    <>
      <div className="flex h-dvh overflow-hidden">
        <div className="hidden md:block">
          <Sidebar />
        </div>
        {menu ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/50" onClick={() => setMenu(false)} />
            <div className="relative h-full w-60">
              <Sidebar onNavigate={() => setMenu(false)} />
            </div>
          </div>
        ) : null}
        {/* On wide screens the page makes room for Quera instead of being covered by her. */}
        <div className={cn("flex min-w-0 flex-1 flex-col transition-[padding] duration-300 ease-out", open && (wide ? "xl:pr-[680px]" : "xl:pr-[440px]"))}>
          <Header onMenu={() => setMenu(true)} />
          <main id="main" className="scroll-thin flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
      <QueraPanel />
      <QueraLauncher />
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <QueraProvider>
        <Shell>{children}</Shell>
      </QueraProvider>
    </WorkspaceProvider>
  );
}
