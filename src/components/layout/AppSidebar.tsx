import { NAV_ITEMS } from "./nav";
import { StatusPill } from "@/components/StatusPill";
import { useMonitoring } from "@/state/monitoring";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Radio, X } from "lucide-react";
import { NavLink } from "react-router";

function NetworkLogo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" className="fill-primary/10 stroke-primary/50" />
      <circle cx="9" cy="10" r="2.4" className="fill-primary" />
      <circle cx="23" cy="10" r="2.4" className="fill-primary/70" />
      <circle cx="16" cy="23" r="2.4" className="fill-primary/70" />
      <path
        d="M9 10 L16 16 L23 10 M16 16 L16 23"
        className="stroke-primary/70"
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M16 22.5 L16 17"
        className="stroke-burst"
        strokeWidth="1.6"
        fill="none"
        strokeDasharray="2 2"
      />
    </svg>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { snapshot } = useMonitoring();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4">
        <NetworkLogo />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold tracking-tight text-sidebar-foreground">
            MicroburstHunter
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            Microburst detection &amp; mitigation
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/dashboard"}
            onClick={onNavigate}
            title={item.description}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn(
                    "size-4 shrink-0",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary",
                  )}
                />
                <span className="truncate">{item.label}</span>
                {item.to === "/dashboard/events" && snapshot.burstActive && (
                  <span className="ml-auto size-1.5 rounded-full bg-burst mbh-pulse" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Monitor state
          </span>
          <StatusPill tone={snapshot.running ? "success" : "idle"} pulse={snapshot.running}>
            {snapshot.running ? "Running" : "Stopped"}
          </StatusPill>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Radio className="size-3.5" />
          <span className="truncate">
            {snapshot.dataSource === "simulated" ? "Simulation data source" : "Live capture"}
          </span>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground/70">
          Simulated measurements only — the browser build does not capture real traffic.
        </p>
      </div>
    </div>
  );
}

export function AppSidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {/* Desktop / tablet */}
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <div className="sticky top-0 h-screen">
          <SidebarContent />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            transition={{ type: "tween", duration: 0.2 }}
            className="absolute left-0 top-0 h-full w-72 border-r border-sidebar-border bg-sidebar"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-4 rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent"
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
            <SidebarContent onNavigate={onClose} />
          </motion.aside>
        </div>
      )}
    </>
  );
}
