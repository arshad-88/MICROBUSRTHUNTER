import { useState } from "react";
import { Outlet, useLocation } from "react-router";
import { motion } from "framer-motion";
import { AppSidebar } from "./AppSidebar";
import { TopStatusBar } from "./TopStatusBar";
import { BurstAlert } from "@/components/BurstAlert";

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="relative min-h-screen bg-[#050814] text-foreground">
      {/* High-Tech Cyber Datacenter Background Image */}
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-25 mix-blend-screen"
        style={{ backgroundImage: "url('/server-room-bg.jpg')" }}
      />
      {/* Ambient Cyber Vignette & Gradient Lighting */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-b from-[#050814]/85 via-[#050814]/92 to-[#050814]" />
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-950/25 via-transparent to-black/70" />

      <div className="relative z-10 flex min-h-screen">
        <AppSidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <TopStatusBar onOpenMenu={() => setMobileOpen(true)} />

          <main className="flex-1 px-3 py-4 lg:px-5 lg:py-5">
            <div className="mx-auto w-full max-w-[1680px] space-y-4">
              <BurstAlert />
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
              >
                <Outlet />
              </motion.div>
            </div>
          </main>

          <footer className="mt-2 border-t border-border/70 bg-background/60 backdrop-blur-md px-4 py-3 lg:px-6">
            <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center justify-between gap-2">
              <span className="label-caps text-muted-foreground/60">
                MicroburstHunter · Computer Networks coursework
              </span>
              <span className="text-[10.5px] text-muted-foreground/70">
                All in-browser measurements are simulated by the deterministic traffic model. Real
                capture and Linux <code className="text-muted-foreground">tc</code> shaping live in
                the separate Python backend.
              </span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
