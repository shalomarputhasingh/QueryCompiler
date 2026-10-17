"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { WorkspaceProvider } from "./workspace-provider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <WorkspaceProvider>
      <div className="flex h-dvh overflow-hidden">
        <div className="hidden md:block">
          <Sidebar />
        </div>
        {open ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
            <div className="relative h-full w-60">
              <Sidebar onNavigate={() => setOpen(false)} />
            </div>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <Header onMenu={() => setOpen(true)} />
          <main id="main" className="scroll-thin flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
