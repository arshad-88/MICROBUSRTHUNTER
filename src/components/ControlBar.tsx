import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMonitoring } from "@/state/monitoring";
import { AlertTriangle, Pause, Play, RotateCcw, ShieldOff, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";

export function ControlBar({ compact = false }: { compact?: boolean }) {
  const {
    snapshot,
    start,
    stop,
    reset,
    simulateBurst,
    restoreNormal,
    setMitigationEnabled,
    setBurstHost,
  } = useMonitoring();

  const sources = snapshot.hosts.filter((h) => h.transmits);
  const mitigationEnabled = snapshot.config.mitigation.autoEnabled;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-3">
      <Button
        type="button"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          start();
          toast.success("Monitoring started");
        }}
        disabled={snapshot.running}
      >
        <Play className="size-3.5" />
        Start Monitoring
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={stop}
        disabled={!snapshot.running}
      >
        <Pause className="size-3.5" />
        Stop Monitoring
      </Button>

      <div className="mx-1 hidden h-6 w-px bg-border sm:block" />

      <div className="flex items-center gap-2">
        <Select value={snapshot.selectedBurstHostId} onValueChange={setBurstHost}>
          <SelectTrigger size="sm" className="h-8 w-[8.5rem]" aria-label="Burst source host">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sources.map((host) => (
              <SelectItem key={host.id} value={host.id}>
                {host.name} · {host.ip}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="gap-1.5"
          onClick={() => {
            simulateBurst();
            toast.error("Burst injected", {
              description: `${snapshot.selectedBurstHostId.toUpperCase()} is emitting a reproducible burst — watch the detector fire.`,
            });
          }}
        >
          <Zap className="size-3.5" />
          Simulate Burst
        </Button>
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => {
          restoreNormal();
          toast("Traffic restored to normal", {
            description: "Scheduled burst cancelled and any active cap released.",
          });
        }}
      >
        <AlertTriangle className="size-3.5" />
        Restore Normal
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => {
          reset();
          toast("Experiment reset", {
            description: "History, counters and policy state cleared.",
          });
        }}
      >
        <RotateCcw className="size-3.5" />
        Reset Experiment
      </Button>

      <div className="mx-1 hidden h-6 w-px bg-border sm:block" />

      <Button
        type="button"
        size="sm"
        variant={mitigationEnabled ? "secondary" : "outline"}
        className="gap-1.5"
        onClick={() => {
          const next = !mitigationEnabled;
          setMitigationEnabled(next);
          toast(next ? "Automatic mitigation enabled" : "Automatic mitigation disabled", {
            description: next
              ? "Detected bursts will trigger a rate cap."
              : "Bursts will be logged but not capped.",
          });
        }}
      >
        {mitigationEnabled ? (
          <>
            <ShieldOff className="size-3.5" />
            Disable Mitigation
          </>
        ) : (
          <>
            <ShieldCheck className="size-3.5" />
            Enable Mitigation
          </>
        )}
      </Button>

      {!compact && (
        <span className="ml-auto text-[11px] text-muted-foreground">
          Data source:{" "}
          <span className="font-medium text-foreground">
            {snapshot.dataSource === "simulated" ? "simulation" : "live capture"}
          </span>
        </span>
      )}
    </div>
  );
}
