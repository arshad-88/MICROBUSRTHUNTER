import { useMonitoring } from "@/state/monitoring";
import { formatMbpsValue, formatMs, formatPercent, formatSimTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OctagonAlert, ShieldCheck, Zap } from "lucide-react";

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="label-caps text-muted-foreground/60">{label}</span>
      <span className="data-mono text-[11px] text-foreground">{value}</span>
    </span>
  );
}

/**
 * Global state banner. It reports exactly what the detection engine reported —
 * nothing is animated or highlighted unless a burst actually exists.
 */
export function BurstAlert() {
  const { snapshot } = useMonitoring();
  const burst = snapshot.currentBurst;
  const mitigation = snapshot.mitigation;

  if (burst) {
    const severe = burst.severity === "severe";
    return (
      <div
        key={burst.id}
        className="mbh-flash flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-burst/45 bg-burst/[0.07] px-3.5 py-2.5"
      >
        <span className="flex items-center gap-2">
          <OctagonAlert className="size-4 shrink-0 text-burst" aria-hidden="true" />
          <span className="label-caps text-burst">
            {severe ? "Severe microburst" : "Microburst detected"}
          </span>
        </span>
        <span className="text-[12px] text-foreground">
          {burst.hostName}
          <span className="data-mono ml-2 text-[11px] text-muted-foreground">
            {burst.sourceIp}
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Cell label="peak" value={`${formatMbpsValue(burst.peakMbps)} Mbps`} />
          <Cell label="threshold" value={`${formatMbpsValue(burst.thresholdMbps)} Mbps`} />
          <Cell label="share" value={formatPercent(burst.contributionPct)} />
          <Cell label="detected at" value={`t+${formatSimTime(burst.detectedAtSim)}`} />
          {burst.detectionDelayMs !== null && (
            <Cell label="latency" value={formatMs(burst.detectionDelayMs, 0)} />
          )}
        </div>
        <span className="ml-auto">
          {mitigation.active ? (
            <span className="flex items-center gap-2 rounded-sm border border-warning/40 bg-warning/[0.08] px-2 py-[3px]">
              <ShieldCheck className="size-3.5 text-warning" aria-hidden="true" />
              <span className="label-caps text-warning">
                cap {formatMbpsValue(mitigation.rateLimitMbps, 0)} Mbps on{" "}
                {mitigation.targetName}
              </span>
            </span>
          ) : (
            <span className="label-caps rounded-sm border border-border bg-surface-2 px-2 py-[3px] text-muted-foreground">
              recording only · no cap applied
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-3.5 py-2.5",
        snapshot.running
          ? "border-success/25 bg-success/[0.04]"
          : "border-border bg-surface",
      )}
    >
      <span className="flex items-center gap-2">
        {snapshot.running ? (
          <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <Zap className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span
          className={cn(
            "label-caps",
            snapshot.running ? "text-success" : "text-muted-foreground",
          )}
        >
          {snapshot.running ? "Fabric nominal" : "Monitoring halted"}
        </span>
      </span>
      <span className="text-[11.5px] text-muted-foreground">
        {snapshot.running
          ? "No flow is currently above the adaptive burst threshold."
          : "Start monitoring to sample the fabric; retained history stays available."}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
        <Cell
          label="threshold"
          value={`${formatMbpsValue(snapshot.latest?.thresholdMbps ?? 0)} Mbps`}
        />
        <Cell
          label="baseline"
          value={`${formatMbpsValue(snapshot.latest?.baselineMbps ?? 0)} Mbps`}
        />
        <Cell label="bursts" value={String(snapshot.burstCount)} />
      </div>
    </div>
  );
}
