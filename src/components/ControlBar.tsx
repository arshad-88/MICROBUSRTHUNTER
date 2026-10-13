import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useMonitoring } from "@/state/monitoring";
import { TRAFFIC_SCENARIOS, type TrafficScenarioType } from "@/simulation";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Square,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

function Group({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-[11px] font-medium text-muted-foreground hidden xl:inline capitalize">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Operations strip: toggles between Live Passive Packet Capture and Simulation,
 * allows interface selection, live capture start/stop, scenario injection,
 * and dry-run mitigation control.
 */
export function ControlBar({ compact = false }: { compact?: boolean }) {
  const {
    snapshot,
    mode,
    setMode,
    availableInterfaces,
    selectedInterface,
    setSelectedInterface,
    liveError,
    backendConnected,
    backendStatus,
    startLiveCapture,
    stopLiveCapture,
    refreshInterfaces,
    reset,
    simulateBurst,
    restoreNormal,
    setMitigationEnabled,
    setBurstHost,
    setScenario,
  } = useMonitoring();

  const isLive = mode === "live";
  const isCapturing = isLive && snapshot.running;
  const sources = snapshot.hosts.filter((h) => h.transmits);
  const mitigationEnabled = snapshot.config.mitigation.autoEnabled;

  return (
    <div className="space-y-2.5">
      <div className="panel-edge flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-border bg-surface px-3.5 py-3">
        {/* Mode Selector */}
        <div className="flex items-center rounded-md border border-border bg-surface-2 p-0.5">
          <button
            type="button"
            onClick={() => {
              setMode("live");
              refreshInterfaces();
              toast.info("Switched to Live Capture Mode", {
                description: "Monitoring physical network interfaces via Scapy passive sniffing.",
              });
            }}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-all",
              isLive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Radio className={cn("size-3.5", isCapturing && "text-emerald-300 animate-pulse")} />
            <span>Live Capture</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("simulated");
              toast.info("Switched to Simulation Mode", {
                description: "Generating multi-source benchmark traffic deterministically.",
              });
            }}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-all",
              !isLive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Sparkles className="size-3.5" />
            <span>Simulation</span>
          </button>
        </div>

        <span className="hidden h-6 w-px bg-border xl:block" />

        {/* Live Capture Mode Controls */}
        {isLive ? (
          <>
            <Group label="interface">
              <Select
                value={selectedInterface}
                onValueChange={(val) => {
                  setSelectedInterface(val);
                  toast.info(`Selected interface: ${val}`);
                }}
                disabled={isCapturing}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 min-w-[13rem] max-w-[18rem] rounded-sm data-mono text-[11px]"
                  aria-label="Capture network interface"
                >
                  <SelectValue placeholder="Select interface..." />
                </SelectTrigger>
                <SelectContent>
                  {availableInterfaces.length === 0 ? (
                    <SelectItem value="none" disabled className="text-[11px]">
                      No interfaces found
                    </SelectItem>
                  ) : (
                    availableInterfaces.map((iface) => (
                      <SelectItem
                        key={iface.name}
                        value={iface.name}
                        className="data-mono text-[11px]"
                      >
                        {iface.name}
                        {iface.ip ? ` (${iface.ip})` : ""}
                        {iface.is_loopback ? " [loopback]" : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="size-8 p-0"
                onClick={() => {
                  refreshInterfaces();
                  toast("Refreshed interfaces");
                }}
                title="Refresh network interfaces"
                disabled={isCapturing}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </Group>

            <Group label="capture">
              {isCapturing ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="gap-1.5 rounded-sm"
                  onClick={stopLiveCapture}
                >
                  <Square className="size-3.5" />
                  Stop capture
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5 rounded-sm bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => startLiveCapture()}
                  disabled={!selectedInterface}
                >
                  <Play className="size-3.5" />
                  Start live capture
                </Button>
              )}
            </Group>

            {/* Live Stats Pill */}
            <div className="hidden items-center gap-2 rounded-sm border border-border bg-surface-2 px-2.5 py-1.5 sm:flex">
              <span
                className={cn(
                  "size-2 rounded-full",
                  isCapturing ? "bg-emerald-500 mbh-pulse" : "bg-muted-foreground",
                )}
              />
              <span className="data-mono text-[11px]">
                {isCapturing ? (
                  <>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      LIVE
                    </span>{" "}
                    · {snapshot.summary.totalPackets.toLocaleString()} pkts ·{" "}
                    {(snapshot.latest?.rateMbps ?? 0).toFixed(1)} Mbps
                  </>
                ) : (
                  <span className="text-muted-foreground">IDLE · 0 pkts</span>
                )}
              </span>
            </div>

            {/* Safe Dry-Run Mitigation Indicator */}
            <div className="ml-auto flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="size-3.5" />
              <span className="text-[11px] font-medium">
                Dry-run mitigation active (host safe)
              </span>
            </div>
          </>
        ) : (
          /* Simulation Mode Controls */
          <>
            <Group label="scenario">
              <Select
                value={snapshot.activeScenario}
                onValueChange={(val) => {
                  const sc = val as TrafficScenarioType;
                  setScenario({ scenario: sc });
                  toast.info(`Switched scenario to ${TRAFFIC_SCENARIOS[sc].name}`, {
                    description: TRAFFIC_SCENARIOS[sc].description,
                  });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 w-[10.5rem] rounded-sm data-mono text-[11px]"
                  aria-label="Simulation scenario"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(TRAFFIC_SCENARIOS).map((sc) => (
                    <SelectItem key={sc.type} value={sc.type} className="data-mono text-[11px]">
                      {sc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Group>

            <span className="hidden h-6 w-px bg-border xl:block" />

            <Group label="inject">
              <Select value={snapshot.selectedBurstHostId} onValueChange={setBurstHost}>
                <SelectTrigger
                  size="sm"
                  className="h-8 w-[9.5rem] rounded-sm data-mono text-[11px]"
                  aria-label="Burst source host"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((host) => (
                    <SelectItem key={host.id} value={host.id} className="data-mono text-[11px]">
                      {host.name} · {host.ip}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                className="gap-1.5 rounded-sm border border-burst/50 bg-burst/[0.12] text-burst hover:bg-burst/20"
                onClick={() => {
                  simulateBurst();
                  toast.error("Burst injected", {
                    description: `${snapshot.selectedBurstHostId.toUpperCase()} emits a reproducible burst. Watch the map and source ranking respond.`,
                  });
                }}
              >
                <Zap className="size-3.5" />
                Simulate burst
              </Button>
            </Group>

            <span className="hidden h-6 w-px bg-border xl:block" />

            <Group label="recover">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 rounded-sm"
                onClick={() => {
                  restoreNormal();
                  toast("Traffic restored to normal", {
                    description: "Scheduled burst cancelled and any active cap released.",
                  });
                }}
              >
                <AlertTriangle className="size-3.5" />
                Restore normal
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1.5 rounded-sm text-muted-foreground"
                onClick={() => {
                  reset();
                  toast("Session reset", {
                    description: "History, counters and policy state cleared.",
                  });
                }}
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            </Group>

            <label
              htmlFor="auto-mitigation-strip"
              className={cn(
                "ml-auto flex cursor-pointer items-center gap-2.5 rounded-sm border px-2.5 py-1.5 transition-colors",
                mitigationEnabled
                  ? "border-success/30 bg-success/[0.05]"
                  : "border-border bg-surface-2",
              )}
            >
              {mitigationEnabled ? (
                <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
              ) : (
                <ShieldOff className="size-3.5 text-muted-foreground" aria-hidden="true" />
              )}
              <span
                className={cn(
                  "text-[11px] font-medium",
                  mitigationEnabled ? "text-success" : "text-muted-foreground",
                )}
              >
                auto mitigation
              </span>
              <Switch
                id="auto-mitigation-strip"
                checked={mitigationEnabled}
                onCheckedChange={(checked) => {
                  setMitigationEnabled(checked);
                  toast(
                    checked
                      ? "Automatic mitigation enabled"
                      : "Automatic mitigation disabled",
                    {
                      description: checked
                        ? "Detected bursts will trigger a rate cap in the traffic model."
                        : "Bursts will be recorded but no cap applied.",
                    },
                  );
                }}
              />
            </label>
          </>
        )}
      </div>

      {/* Live Error / Guidance Alert Banner */}
      {isLive && (liveError || !backendConnected) && (
        <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
          <AlertCircle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-xs leading-relaxed">
            <span className="font-semibold">Backend Connection Notice: </span>
            {liveError || "Backend API server is not running on http://127.0.0.1:8000."}
            <div className="mt-1.5 text-[11px] text-amber-800/80 dark:text-amber-300/80 font-mono">
              Start the live-capture API server: <code className="bg-amber-500/20 px-1 py-0.5 rounded">python backend/api_server.py</code> (or in WSL with root for raw packet access: <code className="bg-amber-500/20 px-1 py-0.5 rounded">wsl -u root .../python backend/api_server.py</code>)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
