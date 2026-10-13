import { navItemForPath, NAV_ITEMS } from "./nav";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useMonitoring } from "@/state/monitoring";
import { formatClock, formatSimTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Menu, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";

/** Wall-clock time of the most recent sample, so "last update" stays truthful. */
function useLastUpdate(simTime: number, running: boolean) {
  const [at, setAt] = useState(() => Date.now());
  useEffect(() => {
    setAt(Date.now());
  }, [simTime, running]);
  return at;
}

function Telemetry({
  label,
  children,
  tone = "default",
}: {
  label: string;
  children: React.ReactNode;
  tone?: "default" | "muted" | "live" | "burst" | "mitigated";
}) {
  const toneClass = {
    default: "text-foreground",
    muted: "text-muted-foreground",
    live: "text-primary",
    burst: "text-burst",
    mitigated: "text-warning",
  }[tone];
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="label-caps text-muted-foreground/60">{label}</span>
      <span className={cn("data-mono text-[11px]", toneClass)}>{children}</span>
    </span>
  );
}

export function TopStatusBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { snapshot, start, stop } = useMonitoring();
  const { localMode } = useAuth();
  const { pathname } = useLocation();
  const page = navItemForPath(pathname);
  const updatedAt = useLastUpdate(snapshot.simTime, snapshot.running);
  const burst = snapshot.currentBurst;

  const alertTone: "burst" | "mitigated" | "default" = burst
    ? "burst"
    : snapshot.mitigation.active
      ? "mitigated"
      : "default";

  const handleStart = () => {
    start();
    toast.success("Monitoring started", {
      description: "Sampling the simulated fabric with the current detector settings.",
    });
  };
  const handleStop = () => {
    stop();
    toast("Monitoring stopped", {
      description: "Live view is frozen; history and events are retained.",
    });
  };

  const interfaceLabel =
    snapshot.dataSource === "live"
      ? snapshot.interfaceName ?? "not selected"
      : "sim://fabric";

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#080910]/95 backdrop-blur-xl">
      {/* Row 1 — identity, primary controls */}
      <div className="flex h-[58px] items-center gap-3 px-4 lg:px-6">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10 text-white lg:hidden"
          onClick={onOpenMenu}
          aria-label="Open navigation"
        >
          <Menu className="size-4" />
        </Button>

        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-white">
            {page.label}
          </h1>
          <span
            key={burst?.id ?? "idle"}
            className={cn(
              "hidden truncate text-[12px] text-slate-400 lg:inline",
              burst && "mbh-flash rounded-md px-1.5 bg-rose-500/20 text-rose-300 border border-rose-500/30",
            )}
          >
            {burst
              ? `Burst on ${burst.hostName} · ${burst.peakMbps.toFixed(1)} Mbps`
              : page.description}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs md:flex shadow-inner">
            <span
              className={cn(
                "size-2 rounded-full",
                snapshot.running
                  ? "bg-emerald-400 shadow-[0_0_8px_rgba(0,210,148,0.8)] animate-pulse"
                  : "bg-slate-500",
              )}
            />
            <span
              className={cn(
                "font-medium",
                snapshot.running ? "text-emerald-400" : "text-slate-400",
              )}
            >
              {snapshot.running ? "Active" : "Halted"}
            </span>
          </span>

          <button
            type="button"
            className={cn(
              "gradient-button text-white text-xs font-semibold px-4 py-2 gap-1.5 shadow-[0_0_20px_-3px_rgba(141,84,255,0.4)] transition-all",
              snapshot.running && "opacity-60 cursor-not-allowed",
            )}
            onClick={handleStart}
            disabled={snapshot.running}
          >
            <Play className="size-3.5 fill-current" />
            <span className="hidden sm:inline">Start capture</span>
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-slate-300 transition-all hover:bg-white/10 hover:text-white",
              snapshot.running && "hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300",
              !snapshot.running && "opacity-50 cursor-not-allowed",
            )}
            onClick={handleStop}
            disabled={!snapshot.running}
          >
            <Square className="size-3.5" />
            <span className="hidden sm:inline">Stop</span>
          </button>
        </div>
      </div>

      {/* Row 2 — telemetry strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-white/5 bg-black/30 px-4 py-2 text-xs lg:px-6">
        <Telemetry label="State" tone={snapshot.running ? "live" : "muted"}>
          {snapshot.running ? (snapshot.dataSource === "live" ? "Sniffing" : "Sampling") : "Halted"}
        </Telemetry>
        <Telemetry label="Engine" tone={snapshot.dataSource === "simulated" ? "muted" : "live"}>
          {snapshot.dataSource === "simulated" ? "SIMULATED" : "LIVE CAPTURE (SCAPY)"}
        </Telemetry>
        <Telemetry label="Interface" tone={snapshot.dataSource === "live" ? "live" : "muted"}>
          {interfaceLabel}
        </Telemetry>
        <Telemetry label="Session" tone="muted">
          {snapshot.dataSource === "live" ? "PYTHON BACKEND" : (localMode ? "LOCAL (NO BACKEND)" : "ACCOUNT")}
        </Telemetry>
        <Telemetry label="Elapsed" tone="muted">
          {snapshot.dataSource === "live" ? `${(snapshot.simTime / 1000).toFixed(1)}s` : formatSimTime(snapshot.simTime)}
        </Telemetry>
        <Telemetry label="Last update" tone="muted">
          {snapshot.running ? formatClock(updatedAt) : "Frozen"}
        </Telemetry>

        <span
          key={`alert-${burst?.id ?? (snapshot.mitigation.active ? "mit" : "none")}`}
          className={cn(
            "ml-auto flex items-center gap-2 whitespace-nowrap rounded-full px-2.5 py-0.5 border text-xs font-medium transition-colors",
            alertTone === "burst"
              ? "border-rose-500/40 bg-rose-500/10 text-rose-300 shadow-[0_0_12px_rgba(255,35,87,0.3)] mbh-flash"
              : alertTone === "mitigated"
                ? "border-amber-400/40 bg-amber-400/10 text-amber-300 shadow-[0_0_12px_rgba(252,187,0,0.25)] mbh-flash"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_10px_rgba(0,210,148,0.2)]",
          )}
        >
          <span
            className={cn(
              "size-2 rounded-full",
              alertTone === "burst"
                ? "bg-rose-400 shadow-[0_0_6px_rgba(255,35,87,0.8)] animate-pulse"
                : alertTone === "mitigated"
                  ? "bg-amber-400 shadow-[0_0_6px_rgba(252,187,0,0.8)] animate-pulse"
                  : "bg-emerald-400 shadow-[0_0_6px_rgba(0,210,148,0.8)]",
            )}
          />
          <span>
            {burst
              ? `Burst active · ${burst.peakMbps.toFixed(1)} Mbps`
              : snapshot.mitigation.active
                ? `Capping ${snapshot.mitigation.targetName ?? "flow"} @ ${snapshot.mitigation.rateLimitMbps.toFixed(0)} Mbps (dry-run)`
                : "Fabric nominal"}
          </span>
        </span>
      </div>
    </header>
  );
}

export { NAV_ITEMS };
