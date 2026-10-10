import { useMonitoring } from "@/state/monitoring";
import { formatMbpsValue, formatMs, formatPercent } from "@/lib/format";
import { OctagonAlert, ShieldCheck } from "lucide-react";

export function BurstAlert() {
  const { snapshot } = useMonitoring();
  const burst = snapshot.currentBurst;
  const mitigation = snapshot.mitigation;

  if (burst) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-burst/40 bg-burst/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <OctagonAlert className="mt-0.5 size-4 shrink-0 text-burst" />
          <div className="text-sm">
            <p className="font-semibold text-burst">
              Microburst detected — {burst.hostName} ({burst.sourceIp})
            </p>
            <p className="text-muted-foreground">
              {formatMbpsValue(burst.peakMbps)} Mbps peak vs{" "}
              {formatMbpsValue(burst.thresholdMbps)} Mbps threshold ·{" "}
              {formatPercent(burst.contributionPct)} of burst bytes ·{" "}
              {burst.severity === "severe" ? "severe" : "moderate"}
              {burst.detectionDelayMs !== null
                ? ` · detected in ${formatMs(burst.detectionDelayMs, 0)} after onset`
                : ""}
            </p>
          </div>
        </div>
        {mitigation.active ? (
          <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            <ShieldCheck className="size-3.5" />
            Mitigation capping {mitigation.targetName} at{" "}
            {formatMbpsValue(mitigation.rateLimitMbps, 0)} Mbps
          </div>
        ) : (
          <span className="rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
            No mitigation applied — recording only
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-success/25 bg-success/5 px-4 py-2.5 text-sm">
      <ShieldCheck className="size-4 shrink-0 text-success" />
      <p className="text-muted-foreground">
        <span className="font-medium text-success">Fabric nominal.</span> No traffic
        burst is currently above the detection threshold.
      </p>
    </div>
  );
}
