import { useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { KeyValue, Meter, Panel, PanelHeader, Tag } from "@/components/kit";
import { useMonitoring } from "@/state/monitoring";
import { formatMbpsValue, formatMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MitigationComparison } from "@/types";
import { AlertTriangle, Gauge, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";

const avg = (c: MitigationComparison) => (c.samples > 0 ? c.throughputMbps / c.samples : 0);
const lat = (c: MitigationComparison) => (c.samples > 0 ? c.latencyMs / c.samples : 0);

interface CompareRow {
  label: string;
  unit: string;
  before: number;
  after: number;
  digits: number;
  /** Lower is better for peak, drops and latency. */
  lowerIsBetter: boolean;
}

function ComparisonPanel({
  before,
  after,
  durationMs,
}: {
  before: MitigationComparison;
  after: MitigationComparison;
  durationMs: number;
}) {
  const rows: CompareRow[] = [
    { label: "Peak rate", unit: "Mbps", before: before.peakMbps, after: after.peakMbps, digits: 1, lowerIsBetter: true },
    { label: "Mean rate", unit: "Mbps", before: avg(before), after: avg(after), digits: 1, lowerIsBetter: false },
    { label: "Dropped traffic", unit: "Mb", before: before.dropMb, after: after.dropMb, digits: 3, lowerIsBetter: true },
    { label: "Latency", unit: "ms", before: lat(before), after: lat(after), digits: 2, lowerIsBetter: true },
  ];

  const hasData = before.samples > 0 || after.samples > 0;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Before / after comparison"
        index="05"
        icon={Gauge}
        note="Windows immediately before the cap and while it is enforced. Both sides use the same scale and units."
        actions={<Tag tone="mitigated">simulated model</Tag>}
      />
      {!hasData ? (
        <div className="px-4 py-8 text-center">
          <p className="text-[12px] text-foreground">No mitigation recorded yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[11px] leading-4 text-muted-foreground">
            The comparison fills in once a burst triggers the policy (or a manual cap is applied)
            and windows are sampled on each side of the action.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4 px-4 py-3.5">
            {rows.map((row) => {
              const max = Math.max(row.before, row.after, 0.0001);
              const delta = row.after - row.before;
              const improving =
                Math.abs(delta) < 0.0005
                  ? null
                  : row.lowerIsBetter
                    ? delta < 0
                    : delta > 0;
              return (
                <div key={row.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[11.5px] text-foreground">{row.label}</span>
                    <span className="flex items-baseline gap-2">
                      <span className="data-mono text-[10.5px] text-muted-foreground">
                        {row.before.toFixed(row.digits)}
                      </span>
                      <span className="text-muted-foreground/50">→</span>
                      <span className="data-mono text-[11px] text-warning">
                        {row.after.toFixed(row.digits)}
                      </span>
                      <span className="data-mono text-[9.5px] text-muted-foreground/70">
                        {row.unit}
                      </span>
                      {improving !== null && (
                        <span
                          className={cn(
                            "data-mono w-14 text-right text-[10px]",
                            improving ? "text-success" : "text-burst",
                          )}
                        >
                          {delta > 0 ? "+" : ""}
                          {delta.toFixed(row.digits)}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="label-caps w-9 text-[8px] text-muted-foreground/60">
                        before
                      </span>
                      <Meter
                        value={(row.before / max) * 100}
                        tone="analysis"
                        ariaLabel={`${row.label} before cap`}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="label-caps w-9 text-[8px] text-warning/70">after</span>
                      <Meter
                        value={(row.after / max) * 100}
                        tone="mitigated"
                        ariaLabel={`${row.label} after cap`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border">
            <KeyValue className="px-4" label="Before samples" mono>
              {before.samples}
            </KeyValue>
            <KeyValue className="px-4" label="After samples" mono>
              {after.samples}
            </KeyValue>
            <KeyValue className="px-4" label="Enforced" mono>
              {formatMs(durationMs, 0)}
            </KeyValue>
          </div>
          <p className="border-t border-border px-4 py-2.5 text-[10.5px] leading-4 text-muted-foreground">
            Both columns come from the same queue/latency model as the charts. These are simulated
            values, not measurements from a physical switch buffer — mitigation does not guarantee
            an improvement in every metric, so read the numbers rather than assuming a direction.
          </p>
        </>
      )}
    </Panel>
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
  const [targetHost, setTargetHost] = useState(
    () => snapshot.selectedBurstHostId,
  );
  const [limit, setLimit] = useState(() => String(config.mitigation.rateLimitMbps));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const limitValue = Number(limit);
  const limitValid = Number.isFinite(limitValue) && limitValue > 0;
  const needsConfirmation = snapshot.dataSource === "live";

  const applyCap = () => {
    applyManualMitigation(targetHost, limitValue);
    toast.success("Rate cap applied", {
      description: `${targetHost.toUpperCase()} clamped to ${limitValue} Mbps inside the traffic model — the chart, map and source table all follow.`,
    });
  };

  const currentAction = mitigation.failureReason
    ? "policy rejected — previous state retained"
    : mitigation.active
      ? `enforcing ${formatMbpsValue(mitigation.rateLimitMbps, 0)} Mbps cap on ${mitigation.targetName}`
      : config.mitigation.autoEnabled
        ? "armed — waiting for a qualifying burst"
        : "disabled — bursts are recorded but not capped";

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Panel className="overflow-hidden xl:col-span-7">
        <PanelHeader
          title="Mitigation control"
          index="05"
          icon={ShieldCheck}
          note="Operates on the simulation model. The offending source is clamped before rates and queue effects are computed."
          actions={
            <StatusPill
              tone={
                mitigation.state === "applied"
                  ? "mitigated"
                  : mitigation.state === "recovering"
                    ? "normal"
                    : mitigation.state === "failed"
                      ? "burst"
                      : "idle"
              }
              pulse={mitigation.state === "applied" || mitigation.state === "recovering"}
            >
              {mitigation.state === "applied"
                ? "cap enforced"
                : mitigation.state === "recovering"
                  ? "recovering"
                  : mitigation.state === "disabled"
                    ? "disabled"
                    : mitigation.state === "failed"
                      ? "policy failed"
                      : "idle"}
            </StatusPill>
          }

        />


        <div className="space-y-3 px-4 py-3.5">
          <label
            htmlFor="auto-mitigation"
            className="flex cursor-pointer items-center justify-between gap-3 rounded-sm border border-border bg-surface-2/60 px-3 py-2.5"
          >
            <span>
              <span className="block text-[12px] font-medium text-foreground">
                Automatic mitigation
              </span>
              <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                Cap the leading contributor as soon as the detector declares a burst
              </span>
            </span>
            <Switch
              id="auto-mitigation"
              checked={config.mitigation.autoEnabled}
              onCheckedChange={(checked) => {
                setMitigationEnabled(checked);
                toast(checked ? "Automatic mitigation enabled" : "Automatic mitigation disabled");
              }}
            />
          </label>

          <div className="divide-y divide-border/60">
            <KeyValue label="Selected source">
              <span className="flex items-center justify-end gap-2">
                <span>{mitigation.targetName ?? "—"}</span>
                <span className="data-mono text-[10.5px] text-muted-foreground">
                  {mitigation.targetIp ?? ""}
                </span>
              </span>
            </KeyValue>
            <KeyValue label="Configured limit" mono>
              {formatMbpsValue(config.mitigation.rateLimitMbps, 0)} Mbps (moderate) ·{" "}
              {config.mitigation.severeRateLimitMbps.toFixed(0)} Mbps (severe)
            </KeyValue>
            <KeyValue label="Policy duration" mono>
              {formatMs(mitigation.durationMs, 0)} enforced / {config.mitigation.maxDurationMs} ms max
            </KeyValue>
            <KeyValue label="Cooldown" mono>
              {formatMs(config.mitigation.cooldownMs, 0)} after release
            </KeyValue>
            <KeyValue label="Recovery status">
              <StatusPill
                tone={
                  mitigation.recovery === "recovered"
                    ? "success"
                    : mitigation.recovery === "pending"
                      ? "mitigated"
                      : "idle"
                }
              >
                {mitigation.recovery}
              </StatusPill>
            </KeyValue>
            {mitigation.actionReason && (
              <div className="py-2 text-[11px] leading-4 text-muted-foreground">
                <span className="font-semibold text-foreground">Action reason: </span>
                {mitigation.actionReason}
              </div>
            )}
          </div>


          <div>
            <div className="flex items-center justify-between">
              <span className="label-caps text-muted-foreground">policy duration meter</span>
              <span className="data-mono text-[10px] text-muted-foreground">
                auto-release at {config.mitigation.maxDurationMs} ms
              </span>
            </div>
            <Meter
              className="mt-1.5"
              value={mitigation.durationMs}
              max={config.mitigation.maxDurationMs}
              tone="mitigated"
              ariaLabel="Mitigation duration against maximum"
            />
          </div>

          <p className="rounded-sm border border-border bg-surface-2/60 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="label-caps mr-2 text-muted-foreground/70">current action</span>
            {currentAction}
          </p>

          {mitigation.failureReason && (
            <p className="flex items-start gap-2 rounded-sm border border-burst/40 bg-burst/[0.07] px-3 py-2 text-[11px] leading-4 text-burst">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              {mitigation.failureReason}
            </p>
          )}

          <div className="space-y-2.5 rounded-sm border border-border bg-surface-2/40 p-3">
            <div className="flex items-center justify-between">
              <span className="label-caps text-muted-foreground">manual override</span>
              <Tag tone="neutral">with rollback</Tag>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[9rem] flex-1">
                <Label
                  htmlFor="mitigation-target"
                  className="text-[10px] text-muted-foreground"
                >
                  Source
                </Label>
                <Select value={targetHost} onValueChange={setTargetHost}>
                  <SelectTrigger id="mitigation-target" className="mt-1 h-9 w-full rounded-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="data-mono text-[11px]">
                        {s.name} · {s.ip}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32">
                <Label htmlFor="manual-limit" className="text-[10px] text-muted-foreground">
                  Rate limit (Mbps)
                </Label>
                <Input
                  id="manual-limit"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="mt-1 h-9 rounded-sm data-mono"
                  inputMode="numeric"
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="gap-1.5 rounded-sm"
                disabled={!limitValid}
                onClick={() => {
                  if (needsConfirmation) setConfirmOpen(true);
                  else applyCap();
                }}
              >
                <ShieldCheck className="size-3.5" />
                Apply cap
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 rounded-sm"
                disabled={!mitigation.active}
                onClick={() => {
                  removeMitigation();
                  toast("Rate cap removed", {
                    description: "The flow is restored to unrestricted traffic in the model.",
                  });
                }}
              >
                <Undo2 className="size-3.5" />
                Roll back
              </Button>
            </div>
            {!limitValid && (
              <p className="text-[10.5px] text-burst">
                Enter a rate limit greater than 0 Mbps — the policy fails safe and keeps the
                previous state otherwise.
              </p>
            )}
            <p className="border-t border-border pt-2 text-[10.5px] leading-4 text-muted-foreground">
              This control acts on the deterministic traffic model only. The browser build never
              executes Linux <code className="text-muted-foreground">tc</code>; shaping a real
              interface is performed by the separate Python backend, which runs dry by default and
              supports rollback.
            </p>
          </div>
        </div>
      </Panel>

      <div className="space-y-4 xl:col-span-5">
        <ComparisonPanel
          before={mitigation.before}
          after={mitigation.after}
          durationMs={mitigation.durationMs}
        />
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply a rate cap to a live source?</AlertDialogTitle>
            <AlertDialogDescription>
              The console is configured for live capture. Applying the cap will request the
              privileged shaping operation for {targetHost.toUpperCase()} at {limitValue} Mbps
              through the backend, which validates parameters and keeps a rollback path.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                applyCap();
                setConfirmOpen(false);
              }}
            >
              Apply cap
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
