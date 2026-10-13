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
    <div className="relative min-h-screen bg-[#050711] text-foreground overflow-x-hidden">
      {/* ================= Aurora Borealis Atmospheric Lighting ================= */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {/* Deep base atmosphere */}
        <div className="absolute inset-0 bg-[#050711]" />

        {/* Aurora Layer 1 — Vibrant Emerald & Cyan Borealis Surge */}
        <div className="aurora-layer-1 absolute -top-[25%] -left-[10%] h-[75vw] w-[75vw] rounded-full bg-gradient-to-tr from-emerald-500/22 via-cyan-400/20 to-transparent blur-[130px] mix-blend-screen" />

        {/* Aurora Layer 2 — Electric Violet & Purple Ribbon */}
        <div className="aurora-layer-2 absolute top-[5%] -right-[15%] h-[70vw] w-[70vw] rounded-full bg-gradient-to-bl from-violet-600/25 via-fuchsia-500/15 to-transparent blur-[140px] mix-blend-screen" />

        {/* Aurora Layer 3 — Deep Teal & Indigo Ambient Glow */}
        <div className="aurora-layer-3 absolute top-[40%] left-[15%] h-[60vw] w-[60vw] rounded-full bg-gradient-to-br from-teal-400/15 via-indigo-600/18 to-transparent blur-[130px] mix-blend-screen" />

        {/* Subtle Cyber Grid Texture */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-transparent via-[#050711]/60 to-[#050711]/90" />
      </div>

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

          <footer className="mt-2 border-t border-white/10 bg-[#080910]/80 backdrop-blur-md px-4 py-3 lg:px-6">
            <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center justify-between gap-2">
              <span className="label-caps text-slate-400 font-medium">
                MicroburstHunter · Live Telemetry & Adaptive Mitigation Engine
              </span>
              <div className="flex items-center gap-2 text-xs">
                <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#00d294]" />
                <span className="text-[11px] text-slate-400">High-Precision Telemetry Fabric Active</span>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
