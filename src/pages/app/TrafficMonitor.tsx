import { useMemo, useState } from "react";
import { MetricCard } from "@/components/MetricCard";
import { StatusPill } from "@/components/StatusPill";
import { ChartLegend, TrafficChart } from "@/components/TrafficChart";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMonitoring } from "@/state/monitoring";
import {
  formatBytes,
  formatMbpsValue,
  formatMs,
  formatPercent,
} from "@/lib/format";
import { Activity, Pause, Play, TrendingUp, Zap } from "lucide-react";

export default function TrafficMonitor() {
  const { snapshot, start, stop } = useMonitoring();
  const [rangeMs, setRangeMs] = useState("6000");

  const history = useMemo(() => {
    const range = Number(rangeMs);
    if (historyEmpty(snapshot.history)) return snapshot.history;
    const latest = snapshot.history[snapshot.history.length - 1].t;
    return snapshot.history.filter((s) => s.t >= latest - range);
  }, [snapshot.history, rangeMs]);

  const bursts = snapshot.burstIntervals.slice(-12).reverse();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-3">
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          onClick={start}
          disabled={snapshot.running}
        >
          <Play className="size-3.5" />
          Resume monitoring
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
          Pause monitoring
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Time range</span>
          <Select value={rangeMs} onValueChange={setRangeMs}>
            <SelectTrigger size="sm" className="w-[7rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2000">2 s</SelectItem>
              <SelectItem value="4000">4 s</SelectItem>
              <SelectItem value="6000">6 s (max history)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Peak observed rate"
          value={formatMbpsValue(snapshot.summary.peakMbps)}
          unit="Mbps"
          icon={TrendingUp}
          tone={snapshot.burstActive ? "burst" : "default"}
        />
        <MetricCard
          label="Average rate"
          value={formatMbpsValue(snapshot.summary.avgMbps)}
          unit="Mbps"
          icon={Activity}
        />
        <MetricCard
          label="Total bytes observed"
          value={formatBytes(snapshot.summary.totalBytes)}
          icon={Activity}
          hint={`${snapshot.summary.totalPackets.toLocaleString("en-US")} packets`}
        />
        <MetricCard
          label="Detected burst events"
          value={String(snapshot.burstCount)}
          icon={Zap}
          tone={snapshot.burstCount > 0 ? "warning" : "default"}
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold tracking-tight">Traffic time series</p>
            <p className="text-[11px] text-muted-foreground">
              Window {snapshot.config.detection.windowMs} ms · baseline window{" "}
              {snapshot.config.detection.baselineWindowMs} ms · multiplier{" "}
              ×{snapshot.config.detection.baselineMultiplier}
            </p>
          </div>
          <StatusPill tone={snapshot.running ? "success" : "idle"} pulse={snapshot.running}>
            {snapshot.running ? "Sampling" : "Paused"}
          </StatusPill>
        </div>
        <TrafficChart history={history} intervals={snapshot.burstIntervals} height={340} />
        <div className="mt-3">
          <ChartLegend />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 text-sm font-semibold tracking-tight">Burst intervals</p>
          {bursts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bursts detected yet under the current settings.
            </p>
          ) : (
            <ul className="space-y-2">
              {bursts.map((interval, index) => (
                <li
                  key={`${interval.start}-${index}`}
                  className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    Start {(interval.start / 1000).toFixed(2)} s
                  </span>
                  <span className="text-muted-foreground">
                    {interval.end !== null
                      ? `Duration ${formatMs(interval.end - interval.start, 0)}`
                      : "Ongoing"}
                  </span>
                  <StatusPill tone={interval.end === null ? "burst" : "normal"} pulse={interval.end === null}>
                    {interval.end === null ? "Active" : "Recovered"}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 text-sm font-semibold tracking-tight">Detection configuration</p>
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            <Config label="Minimum rate">
              {formatMbpsValue(snapshot.config.detection.minRateMbps, 0)} Mbps
            </Config>
            <Config label="Baseline multiplier">
              ×{snapshot.config.detection.baselineMultiplier}
            </Config>
            <Config label="Sampling window">
              {snapshot.config.detection.windowMs} ms
            </Config>
            <Config label="Persistence">
              {snapshot.config.detection.persistenceWindows} windows
            </Config>
            <Config label="Recovery windows">
              {snapshot.config.detection.recoveryWindows}
            </Config>
            <Config label="Burst cooldown">
              {formatMs(snapshot.config.detection.cooldownMs, 0)}
            </Config>
            <Config label="Effective threshold">
              {formatMbpsValue(snapshot.latest?.thresholdMbps ?? 0)} Mbps
            </Config>
            <Config label="Advantage over baseline">
              {snapshot.latest && snapshot.latest.baselineMbps > 0
                ? formatPercent(
                    ((snapshot.latest.rateMbps - snapshot.latest.baselineMbps) /
                      snapshot.latest.baselineMbps) *
                      100,
                  )
                : "—"}
            </Config>
          </dl>
        </div>
      </div>
    </div>
  );
}

function historyEmpty(history: unknown[]): boolean {
  return history.length === 0;
}

function Config({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
