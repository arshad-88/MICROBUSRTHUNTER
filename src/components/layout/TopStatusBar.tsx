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
    <header className="sticky top-0 z-30 border-b border-border bg-background/92 backdrop-blur-md">
      {/* Row 1 — identity, primary controls */}
      <div className="flex h-[57px] items-center gap-3 px-4 lg:px-6">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 rounded-sm lg:hidden"
          onClick={onOpenMenu}
          aria-label="Open navigation"
        >
          <Menu className="size-4" />
        </Button>

        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="data-mono hidden text-[10px] text-primary/80 sm:inline">
            {page.code}
          </span>
          <h1 className="truncate text-[14px] font-semibold tracking-tight text-foreground">
            {page.label}
          </h1>
          <span
            key={burst?.id ?? "idle"}
            className={cn(
              "hidden truncate text-[11px] text-muted-foreground lg:inline",
              burst && "mbh-flash rounded-sm px-1.5",
            )}
          >
            {burst
              ? `Burst on ${burst.hostName} · ${burst.peakMbps.toFixed(1)} Mbps`
              : page.description}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-2 border border-border bg-surface px-2.5 py-1.5 md:flex">
            <span
              className={cn(
                "size-1.5 rounded-full",
                snapshot.running ? "bg-success mbh-pulse" : "bg-muted-foreground",
              )}
            />
            <span
              className={cn(
                "label-caps text-[9px]",
                snapshot.running ? "text-success" : "text-muted-foreground",
              )}
            >
              {snapshot.running ? "Monitoring" : "Halted"}
            </span>
          </span>

          <Button
            type="button"
            size="sm"
            className="gap-1.5 rounded-sm"
            onClick={handleStart}
            disabled={snapshot.running}
          >
            <Play className="size-3.5" />
            <span className="hidden sm:inline">Start</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-sm"
            onClick={handleStop}
            disabled={!snapshot.running}
          >
            <Square className="size-3.5" />
            <span className="hidden sm:inline">Stop</span>
          </Button>
        </div>
      </div>

      {/* Row 2 — telemetry strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border px-4 py-2 lg:px-6">
        <Telemetry label="state" tone={snapshot.running ? "live" : "muted"}>
          {snapshot.running ? "SAMPLING" : "HALTED"}
        </Telemetry>
        <Telemetry label="source" tone={snapshot.dataSource === "simulated" ? "muted" : "live"}>
          {snapshot.dataSource === "simulated" ? "SIMULATED" : "LIVE CAPTURE"}
        </Telemetry>
        <Telemetry label="interface" tone="muted">
          {interfaceLabel}
        </Telemetry>
        <Telemetry label="session" tone="muted">
          {localMode ? "LOCAL (NO BACKEND)" : "ACCOUNT"}
        </Telemetry>
        <Telemetry label="sim clock" tone="muted">
          {formatSimTime(snapshot.simTime)}
        </Telemetry>
        <Telemetry label="last update" tone="muted">
          {snapshot.running ? formatClock(updatedAt) : "frozen"}
        </Telemetry>

        <span
          key={`alert-${burst?.id ?? (snapshot.mitigation.active ? "mit" : "none")}`}
          className={cn(
            "ml-auto flex items-center gap-2 whitespace-nowrap",
            (burst || snapshot.mitigation.active) && "mbh-flash rounded-sm px-1.5",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              alertTone === "burst"
                ? "bg-burst mbh-pulse"
                : alertTone === "mitigated"
                  ? "bg-warning mbh-pulse"
                  : "bg-success",
            )}
          />
          <span
            className={cn(
              "label-caps text-[9px]",
              alertTone === "burst"
                ? "text-burst"
                : alertTone === "mitigated"
                  ? "text-warning"
                  : "text-success",
            )}
          >
            {burst
              ? `Burst active · ${burst.peakMbps.toFixed(1)} Mbps`
              : snapshot.mitigation.active
                ? `Capping ${snapshot.mitigation.targetName ?? "flow"} @ ${snapshot.mitigation.rateLimitMbps.toFixed(0)} Mbps`
                : "Fabric nominal"}
          </span>
        </span>
      </div>
    </header>
  );
}

export { NAV_ITEMS };
