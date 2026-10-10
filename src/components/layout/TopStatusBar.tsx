import { NAV_ITEMS } from "./nav";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/StatusPill";
import { useMonitoring } from "@/state/monitoring";
import { formatMbpsValue } from "@/lib/format";
import { Menu, OctagonAlert, Play, Plug, ShieldAlert, Square, Usb } from "lucide-react";
import { useLocation } from "react-router";
import { toast } from "sonner";

function useCurrentPage() {
  const { pathname } = useLocation();
  const match =
    NAV_ITEMS.find((item) => item.to === pathname) ??
    (pathname.startsWith("/dashboard/")
      ? NAV_ITEMS.find((item) => pathname.startsWith(item.to))
      : undefined);
  return match ?? NAV_ITEMS[0];
}

export function TopStatusBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { snapshot, start, stop } = useMonitoring();
  const page = useCurrentPage();

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
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 lg:px-6">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="lg:hidden"
          onClick={onOpenMenu}
          aria-label="Open navigation"
        >
          <Menu className="size-4" />
        </Button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight">MicroburstHunter</span>
            <span className="text-muted-foreground">/</span>
            <span className="truncate text-sm text-muted-foreground">{page.label}</span>
          </div>
          <p className="mt-0.5 hidden text-[11px] text-muted-foreground sm:block">
            {page.description}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <StatusPill tone={snapshot.running ? "success" : "idle"} pulse={snapshot.running}>
            {snapshot.running ? "Monitoring Running" : "Monitoring Stopped"}
          </StatusPill>

          <StatusPill tone={snapshot.dataSource === "simulated" ? "info" : "success"}>
            <Plug className="size-3" />
            {snapshot.dataSource === "simulated" ? "Simulation" : "Live Capture"}
          </StatusPill>

          <span className="hidden items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground md:inline-flex">
            <Usb className="size-3" />
            {interfaceLabel}
          </span>

          {snapshot.burstActive ? (
            <StatusPill tone="burst" pulse>
              <OctagonAlert className="size-3" />
              Burst active · {formatMbpsValue(snapshot.latest?.rateMbps ?? 0)} Mbps
            </StatusPill>
          ) : snapshot.mitigation.active ? (
            <StatusPill tone="mitigated" pulse>
              <ShieldAlert className="size-3" />
              Mitigation active
            </StatusPill>
          ) : (
            <StatusPill tone="normal">No active alert</StatusPill>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handleStart}
              disabled={snapshot.running}
            >
              <Play className="size-3.5" />
              Start
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handleStop}
              disabled={!snapshot.running}
            >
              <Square className="size-3.5" />
              Stop
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
