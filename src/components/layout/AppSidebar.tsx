import { NAV_ITEMS, type NavItem } from "./nav";
import { MHMark, Wordmark } from "@/components/Wordmark";
import { useMonitoring } from "@/state/monitoring";
import { formatSimTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { NavLink } from "react-router";

const GROUP_LABEL = "Instrumentation";

function NavRailItem({
  item,
  burstActive,
  onNavigate,
  expanded,
}: {
  item: NavItem;
  burstActive: boolean;
  onNavigate?: () => void;
  expanded: boolean;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/dashboard"}
      onClick={onNavigate}
      title={item.description}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-xl transition-all",
          expanded ? "px-3 py-2.5" : "flex-col gap-1.5 px-1 py-2.5",
          isActive
            ? "bg-violet-500/15 text-white font-medium border border-violet-500/30 shadow-[0_0_15px_-4px_rgba(141,84,255,0.3)]"
            : "text-slate-400 hover:bg-white/5 hover:text-white border border-transparent",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-violet-400 transition-opacity shadow-[0_0_8px_#a685ff]",
              isActive ? "opacity-100" : "opacity-0",
            )}
          />
          <span className="relative">
            <item.icon
              className={cn(
                "size-[18px] shrink-0 transition-colors",
                isActive
                  ? "text-violet-400"
                  : "text-slate-400 group-hover:text-violet-300",
              )}
            />
            {!expanded && burstActive && item.to === "/dashboard/events" && (
              <span className="absolute -right-1 -top-1 size-2 rounded-full bg-rose-500 shadow-[0_0_6px_#ff2357] animate-pulse" />
            )}
          </span>
          <span
            className={cn(
              "truncate font-medium",
              expanded
                ? "text-[13px]"
                : "text-[10px]",
              isActive ? "text-white font-semibold" : "text-slate-400 group-hover:text-slate-200",
            )}
          >
            {expanded ? item.label : item.label.split(" ")[0]}
          </span>
          {expanded && burstActive && item.to === "/dashboard/events" && (
            <span className="ml-auto size-2 shrink-0 rounded-full bg-rose-500 shadow-[0_0_6px_#ff2357] animate-pulse" />
          )}
        </>
      )}
    </NavLink>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { snapshot, mode } = useMonitoring();
  const isLive = mode === "live" || snapshot.dataSource === "live";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[58px] items-center gap-3 border-b border-white/10 px-4">
        <MHMark className="size-8" active={snapshot.burstActive || snapshot.running} />
        <Wordmark className="min-w-0" />
      </div>

      <nav
        aria-label="Primary"
        className="flex-1 overflow-y-auto px-3 py-4"
      >
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {GROUP_LABEL}
        </p>
        <div className="flex flex-col gap-1.5">
          {NAV_ITEMS.map((item) => (
            <NavRailItem
              key={item.to}
              item={item}
              burstActive={snapshot.burstActive}
              onNavigate={onNavigate}
              expanded
            />
          ))}
        </div>
      </nav>

      <div className="p-3">
        <div className="rounded-2xl border border-white/10 bg-[#0c0d15] p-3 shadow-md">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-400">Status</span>
            <span
              className={cn(
                "data-mono text-[11px] font-semibold rounded-full px-2 py-0.5 border",
                snapshot.running
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : "bg-white/5 text-slate-400 border-white/10",
              )}
            >
              {snapshot.running ? (isLive ? "SNIFFING" : "SAMPLING") : "HALTED"}
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2 text-xs">
            <span className="text-[11px] text-slate-400">Source</span>
            <span className="data-mono text-[11px] text-white truncate max-w-[110px]" title={isLive ? (snapshot.interfaceName ?? "Live adapter") : "Simulated fabric"}>
              {isLive ? (snapshot.interfaceName ?? "Live adapter") : "Simulated fabric"}
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="text-[11px] text-slate-400">Elapsed</span>
            <span className="data-mono text-[11px] text-violet-300">
              {isLive ? `${(snapshot.simTime / 1000).toFixed(1)}s` : formatSimTime(snapshot.simTime)}
            </span>
          </div>
          <div className="mt-2.5 border-t border-white/5 pt-2 flex items-center gap-2">
            <span className={cn("size-2 rounded-full", isLive ? "bg-violet-400 shadow-[0_0_6px_#a685ff]" : "bg-emerald-400 shadow-[0_0_6px_#00d294]")} />
            <span className="text-[10px] text-slate-400 truncate">
              {isLive ? "Live Npcap packet capture" : "Synthetic traffic generator"}
            </span>
          </div>
        </div>
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
  const { snapshot } = useMonitoring();

  return (
    <>
      {/* Desktop: slim rail below xl, expanding with labels at xl and up. */}
      <aside className="sticky top-0 hidden h-screen w-[74px] shrink-0 border-r border-white/10 bg-[#080910] lg:block xl:w-[230px]">
        <div className="hidden h-full xl:block">
          <SidebarContent />
        </div>
        <div className="flex h-full flex-col items-center xl:hidden">
          <div className="flex h-[58px] w-full items-center justify-center border-b border-white/10">
            <MHMark className="size-8" active={snapshot.burstActive || snapshot.running} />
          </div>
          <nav
            aria-label="Primary"
            className="flex w-full flex-1 flex-col gap-1.5 overflow-y-auto px-2 py-3"
          >
            {NAV_ITEMS.map((item) => (
              <NavRailItem
                key={item.to}
                item={item}
                burstActive={snapshot.burstActive}
                expanded={false}
              />
            ))}
          </nav>
          <div className="w-full border-t border-white/10 px-2 py-3 text-center">
            <span
              className={cn(
                "mx-auto block size-2.5 rounded-full shadow-sm",
                snapshot.running
                  ? "bg-emerald-400 shadow-[0_0_8px_#00d294]"
                  : "bg-slate-600",
              )}
            />
            <span className="label-caps mt-1.5 block text-[8px] text-slate-400">
              {snapshot.running ? "live" : "halt"}
            </span>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: -260 }}
            animate={{ x: 0 }}
            transition={{ type: "tween", duration: 0.2 }}
            className="absolute left-0 top-0 h-full w-[256px] border-r border-white/10 bg-[#080910]"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
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
