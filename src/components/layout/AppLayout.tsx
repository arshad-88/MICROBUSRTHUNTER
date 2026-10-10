import { useState } from "react";
import { Outlet } from "react-router";
import { motion } from "framer-motion";
import { AppSidebar } from "./AppSidebar";
import { TopStatusBar } from "./TopStatusBar";
import { BurstAlert } from "@/components/BurstAlert";

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopStatusBar onOpenMenu={() => setMobileOpen(true)} />

        <main className="flex-1 px-4 py-5 lg:px-6">
          <div className="mx-auto w-full max-w-[1400px] space-y-5">
            <BurstAlert />
            <motion.div
              key={window.location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <Outlet />
            </motion.div>
          </div>
        </main>

        <footer className="border-t border-border px-4 py-4 text-[11px] text-muted-foreground lg:px-6">
          MicroburstHunter — Computer Networks course prototype. All metrics are
          simulated in the browser; real capture and Linux{" "}
          <code className="text-foreground/80">tc</code> shaping live in the
          separate Python backend.
        </footer>
      </div>
    </div>
  );
}
