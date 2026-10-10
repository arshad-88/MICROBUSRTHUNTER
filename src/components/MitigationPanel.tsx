import { useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useMonitoring } from "@/state/monitoring";
import { formatMbpsValue, formatMs } from "@/lib/format";
import type { MitigationComparison } from "@/types";
import { toast } from "sonner";

function ComparisonTable({
  before,
  after,
}: {
  before: MitigationComparison;
  after: MitigationComparison;
}) {
  const avg = (c: MitigationComparison) =>
    c.samples > 0 ? c.throughputMbps / c.samples : 0;
  const lat = (c: MitigationComparison) =>
    c.samples > 0 ? c.latencyMs / c.samples : 0;

  const rows = [
    {
      label: "Peak rate",
      before: `${formatMbpsValue(before.peakMbps)} Mbps`,
      after: `${formatMbpsValue(after.peakMbps)} Mbps`,
    },
    {
      label: "Mean rate (throughput)",
      before: `${formatMbpsValue(avg(before))} Mbps`,
      after: `${formatMbpsValue(avg(after))} Mbps`,
    },
    {
      label: "Dropped traffic (simulated)",
      before: `${before.dropMb.toFixed(2)} Mb`,
      after: `${after.dropMb.toFixed(2)} Mb`,
    },
    {
      label: "Latency (simulated)",
      before: formatMs(lat(before)),
      after: formatMs(lat(after)),
    },
    {
      label: "Samples",
      before: String(before.samples),
      after: String(after.samples),
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Metric</th>
            <th className="px-3 py-2 font-medium">Before cap</th>
            <th className="px-3 py-2 font-medium">After cap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-border/60 last:border-0">
              <td className="px-3 py-2 text-muted-foreground">{row.label}</td>
              <td className="px-3 py-2 tabular-nums">{row.before}</td>
              <td className="px-3 py-2 tabular-nums text-warning">{row.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        All values are explicitly simulated by the queue/overflow model — not measurements from a
        real switch buffer.
      </p>
    </div>
  );
}

export function MitigationPanel() {
  const {
    snapshot,
    config,
    setMitigationEnabled,
    applyManualMitigation,
    removeMitigation,
  } = useMonitoring();
  const mitigation = snapshot.mitigation;
  const sources = snapshot.hosts.filter((h) => h.transmits);

  const [targetHost, setTargetHost] = useState(snapshot.selectedBurstHostId);
  const [limit, setLimit] = useState(String(config.mitigation.rateLimitMbps));

  const limitValue = Number(limit);
  const limitValid = Number.isFinite(limitValue) && limitValue > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold tracking-tight">Adaptive policy</p>
              <p className="text-[11px] text-muted-foreground">
                Rate cap applied to the offending flow
              </p>
            </div>
            <StatusPill tone={mitigation.active ? "mitigated" : "normal"} pulse={mitigation.active}>
              {mitigation.state === "failed"
                ? "Policy failed"
                : mitigation.active
                  ? "Cap applied"
                  : "Idle"}
            </StatusPill>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <div>
              <Label htmlFor="auto-mitigation" className="text-sm">
                Automatic mitigation
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Enable to cap the top contributor when a burst is detected
              </p>
            </div>
            <Switch
              id="auto-mitigation"
              checked={config.mitigation.autoEnabled}
              onCheckedChange={(checked) => {
                setMitigationEnabled(checked);
                if (!checked) toast("Automatic mitigation disabled");
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Severity">
              <span
                className={
                  mitigation.severity === "severe"
                    ? "text-burst"
                    : mitigation.severity === "moderate"
                      ? "text-warning"
                      : "text-muted-foreground"
                }
              >
                {mitigation.severity === "none" ? "—" : mitigation.severity}
              </span>
            </Field>
            <Field label="Current state">{mitigation.state}</Field>
            <Field label="Target source">
              {mitigation.targetName ? (
                <span>
                  {mitigation.targetName}{" "}
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {mitigation.targetIp}
                  </span>
                </span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Enforced cap">
              {mitigation.active ? `${formatMbpsValue(mitigation.rateLimitMbps, 0)} Mbps` : "—"}
            </Field>
            <Field label="Started at (sim)">
              {mitigation.startedAtSim !== null
                ? `${(mitigation.startedAtSim / 1000).toFixed(2)} s`
                : "—"}
            </Field>
            <Field label="Duration">{formatMs(mitigation.durationMs, 0)}</Field>
            <Field label="Recovery">{mitigation.recovery}</Field>
            <Field label="Max duration">
              {formatMs(config.mitigation.maxDurationMs, 0)}
            </Field>
          </div>

          {mitigation.failureReason && (
            <p className="rounded-md border border-burst/40 bg-burst/10 px-3 py-2 text-xs text-burst">
              {mitigation.failureReason}
            </p>
          )}

          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Manual override
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[9rem] flex-1">
                <Label className="text-[11px] text-muted-foreground">Source</Label>
                <Select value={targetHost} onValueChange={setTargetHost}>
                  <SelectTrigger className="mt-1 h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · {s.ip}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28">
                <Label htmlFor="manual-limit" className="text-[11px] text-muted-foreground">
                  Cap (Mbps)
                </Label>
                <Input
                  id="manual-limit"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="mt-1 h-9"
                  inputMode="numeric"
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!limitValid}
                onClick={() => {
                  applyManualMitigation(targetHost, limitValue);
                  toast.success("Manual cap applied", {
                    description: `${targetHost.toUpperCase()} capped at ${limitValue} Mbps in the model.`,
                  });
                }}
              >
                Apply cap
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!mitigation.active}
                onClick={() => {
                  removeMitigation();
                  toast("Mitigation cap removed");
                }}
              >
                Remove cap
              </Button>
            </div>
            {!limitValid && (
              <p className="text-[11px] text-burst">
                Enter a rate limit greater than 0 Mbps.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div>
            <p className="text-sm font-semibold tracking-tight">Before / after comparison</p>
            <p className="text-[11px] text-muted-foreground">
              Measured (simulated) windows immediately before and while the cap is enforced
            </p>
          </div>
          <ComparisonTable before={mitigation.before} after={mitigation.after} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{children}</p>
    </div>
  );
}
