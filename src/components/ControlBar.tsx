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
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  RotateCcw,
  ShieldOff,
  ShieldCheck,
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
      <span className="label-caps hidden text-muted-foreground/60 xl:inline">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Operations strip: inject a reproducible burst, restore normal traffic, reset
 * the session and arm/disarm automatic mitigation. Every control drives the
 * simulation engine through the monitoring context.
 */
export function ControlBar({ compact = false }: { compact?: boolean }) {
  const {
    snapshot,
    reset,
    simulateBurst,
    restoreNormal,
    setMitigationEnabled,
    setBurstHost,
  } = useMonitoring();

  const sources = snapshot.hosts.filter((h) => h.transmits);
  const mitigationEnabled = snapshot.config.mitigation.autoEnabled;

  return (
    <div className="panel-edge flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-border bg-surface px-3.5 py-3">
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
              description: `${snapshot.selectedBurstHostId.toUpperCase()} emits a reproducible burst; the detector declares it once it holds a baseline of undisturbed traffic. Watch the map and source ranking respond.`,
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
            "label-caps",
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

      {!compact && (
        <span className="text-[10.5px] text-muted-foreground/70">
          controls the deterministic model, not a real interface
        </span>
      )}
    </div>
  );
}
