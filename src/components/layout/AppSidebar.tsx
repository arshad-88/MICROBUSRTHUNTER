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
          "group relative flex items-center gap-3 rounded-sm transition-colors",
          expanded ? "px-2.5 py-2" : "flex-col gap-1.5 px-1 py-2.5",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/75 hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground",
        )
      }
      style={{ transitionDuration: "var(--dur-fast)" }}
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary transition-opacity",
              isActive ? "opacity-100" : "opacity-0",
            )}
          />
          <span className="relative">
            <item.icon
              className={cn(
                "size-[17px] shrink-0 transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground group-hover:text-primary/80",
              )}
            />
            {!expanded && burstActive && item.to === "/dashboard/events" && (
              <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-burst mbh-pulse" />
            )}
          </span>
          <span
            className={cn(
              "truncate font-medium",
              expanded
                ? "text-[13px]"
                : "text-[10px]",
              isActive ? "text-foreground font-semibold" : "text-muted-foreground group-hover:text-foreground",
            )}
          >
            {expanded ? item.label : item.label.split(" ")[0]}
          </span>
          {expanded && burstActive && item.to === "/dashboard/events" && (
            <span className="ml-auto size-1.5 shrink-0 rounded-full bg-burst mbh-pulse" />
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
      <div className="flex h-[57px] items-center gap-3 border-b border-sidebar-border px-3">
        <MHMark className="size-8" active={snapshot.burstActive || snapshot.running} />
        <Wordmark className="min-w-0" />
      </div>

      <nav
        aria-label="Primary"
        className="flex-1 overflow-y-auto px-2 py-4 lg:px-1.5"
      >
        <p className="px-2.5 pb-2 text-[11px] font-medium text-muted-foreground">
          {GROUP_LABEL}
        </p>
        <div className="flex flex-col gap-1">
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

      <div className="border-t border-sidebar-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Status</span>
          <span
            className={cn(
              "data-mono text-[11px] font-semibold",
              snapshot.running ? "text-success" : "text-muted-foreground",
            )}
          >
            {snapshot.running ? (isLive ? "SNIFFING" : "SAMPLING") : "HALTED"}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">Source</span>
          <span className="data-mono text-[11px] text-foreground truncate max-w-[120px]" title={isLive ? (snapshot.interfaceName ?? "Live adapter") : "Simulated fabric"}>
            {isLive ? (snapshot.interfaceName ?? "Live adapter") : "Simulated fabric"}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">Elapsed</span>
          <span className="data-mono text-[11px] text-foreground">
            {isLive ? `${(snapshot.simTime / 1000).toFixed(1)}s` : formatSimTime(snapshot.simTime)}
          </span>
        </div>
        <div className="mt-2.5 border-t border-sidebar-border/70 pt-2 flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", isLive ? "bg-primary" : "bg-muted-foreground/60")} />
          <span className="text-[10px] text-muted-foreground">
            {isLive ? "Live Npcap packet capture" : "Synthetic traffic generator"}
          </span>
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
      <aside className="sticky top-0 hidden h-screen w-[74px] shrink-0 border-r border-sidebar-border bg-rail lg:block xl:w-[228px]">
        <div className="hidden h-full xl:block">
          <SidebarContent />
        </div>
        <div className="flex h-full flex-col items-center xl:hidden">
          <div className="flex h-[57px] w-full items-center justify-center border-b border-sidebar-border">
            <MHMark className="size-8" active={snapshot.burstActive || snapshot.running} />
          </div>
          <nav
            aria-label="Primary"
            className="flex w-full flex-1 flex-col gap-1 overflow-y-auto px-2 py-3"
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
          <div className="w-full border-t border-sidebar-border px-2 py-3 text-center">
            <span
              className="mx-auto block size-2 rounded-full"
              style={{
                background: snapshot.running
                  ? "var(--success)"
                  : "var(--muted-foreground)",
              }}
            />
            <span className="label-caps mt-2 block text-[8px] text-muted-foreground">
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
            className="absolute inset-0 bg-black/65"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: -260 }}
            animate={{ x: 0 }}
            transition={{ type: "tween", duration: 0.2 }}
            className="absolute left-0 top-0 h-full w-[248px] border-r border-sidebar-border bg-rail"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-2.5 top-4 z-10 rounded-sm p-1.5 text-muted-foreground hover:bg-sidebar-accent"
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
