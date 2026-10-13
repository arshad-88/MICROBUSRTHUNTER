import { useMemo, useState } from "react";
import { ChartLegend, TrafficChart } from "@/components/TrafficChart";
import { StatusPill } from "@/components/StatusPill";
import {
  EmptyState,
  KeyValue,
  Panel,
  PanelHeader,
  Stat,
  Tag,
  type Tone,
} from "@/components/kit";
import { useMonitoring } from "@/state/monitoring";
import {
  formatClock,
  formatMb,
  formatMbpsValue,
  formatMs,
  formatPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { Activity, Info, OctagonAlert, PackageX, Timer, Zap } from "lucide-react";

const RANGES = [
  { label: "2 s", value: 2000 },
  { label: "4 s", value: 4000 },
  { label: "6 s", value: 6000 },
];

interface BurstRow {
  id: string;
  detectedAt: number;
  endedAt: number | null;
  hostName: string;
  sourceIp: string;
  peakMbps: number | null;
  severity: "moderate" | "severe";
}

/** Pair detection/end events so each row describes one burst without inventing data. */
function buildBurstRows(
  events: { id: string; type: string; timestamp: number; severity: string; hostName?: string; sourceIp?: string; rateMbps?: number }[],
): BurstRow[] {
  const rows: BurstRow[] = [];
  const open = new Map<string, BurstRow>();
  for (const event of events) {
    const key = event.hostName ?? event.sourceIp ?? "flow";
    if (event.type === "burst_detected") {
      const row: BurstRow = {
        id: event.id,
        detectedAt: event.timestamp,
        endedAt: null,
        hostName: event.hostName ?? "unknown host",
        sourceIp: event.sourceIp ?? "—",
        peakMbps: event.rateMbps ?? null,
        severity: event.severity === "critical" ? "severe" : "moderate",
      };
      rows.push(row);
      open.set(key, row);
    } else if (event.type === "burst_ended") {
      const row = open.get(key);
      if (row) {
        row.endedAt = event.timestamp;
        if (row.peakMbps === null) row.peakMbps = event.rateMbps ?? null;
        open.delete(key);
      }
    }
  }
  return rows.reverse();
}

export default function TrafficMonitor() {
  const { snapshot } = useMonitoring();
  const [rangeMs, setRangeMs] = useState(4000);

  const history = useMemo(() => {
    if (snapshot.history.length === 0) return snapshot.history;
    const latest = snapshot.history[snapshot.history.length - 1].t;
    return snapshot.history.filter((s) => s.t >= latest - rangeMs);
  }, [snapshot.history, rangeMs]);

  const burstRows = useMemo(() => buildBurstRows(snapshot.events), [snapshot.events]);
  const dropMb = (snapshot.summary.totalDropBytes * 8) / 1_000_000;
  const dropPct =
    snapshot.latest && snapshot.latest.bytes > 0
      ? (snapshot.latest.dropBytes / snapshot.latest.bytes) * 100
      : 0;

  const tiles: {
    label: string;
    value: string;
    unit?: string;
    tone: Tone;
    icon: typeof Activity;
    hint: string;
  }[] = [
    {
      label: "Current rate",
      value: formatMbpsValue(snapshot.latest?.rateMbps ?? 0),
      unit: "Mbps",
      tone: snapshot.burstActive ? "burst" : snapshot.running ? "live" : "neutral",
      icon: Activity,
      hint: `threshold ${formatMbpsValue(snapshot.latest?.thresholdMbps ?? 0)} Mbps`,
    },
    {
      label: "Peak rate",
      value: formatMbpsValue(snapshot.summary.peakMbps),
      unit: "Mbps",
      tone: "burst",
      icon: Zap,
      hint: "highest window observed this session",
    },
    {
      label: "Average rate",
      value: formatMbpsValue(snapshot.summary.avgMbps),
      unit: "Mbps",
      tone: "analysis",
      icon: Activity,
      hint: `over ${snapshot.history.length} windows`,
    },
    {
      label: "Burst events",
      value: String(snapshot.burstCount),
      tone: snapshot.burstCount > 0 ? "burst" : "neutral",
      icon: OctagonAlert,
      hint: snapshot.burstActive ? "one burst in progress" : "none in progress",
    },
    {
      label: "Packet drops",
      value: formatMb(dropMb),
      tone: dropMb > 0 ? "mitigated" : "recovered",
      icon: PackageX,
      hint:
        dropMb > 0
          ? `${formatPercent(dropPct)} of current window · modelled queue`
          : "no modelled drops",
    },
    {
      label: "Estimated queue",
      value: `${(snapshot.latest?.estimatedQueuePct ?? 0).toFixed(1)}%`,
      tone: (snapshot.latest?.estimatedQueuePct ?? 0) > 60 ? "burst" : "neutral",
      icon: Timer,
      hint: `${((snapshot.latest?.estimatedQueueBytes ?? 0) / 1024).toFixed(1)} KB (modelled buffer estimate)`,
    },
  ];

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((tile, i) => (

            <div
              key={tile.label}
              className={cn(
                "border-border/60",
                i % 2 === 1 && "border-l",
                i >= 2 && "border-t sm:border-t-0",
                i === 2 && "sm:border-l",
                i !== 0 && "lg:border-l lg:border-t-0",
              )}
            >
              <Stat {...tile} size="sm" />
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-12">
        <Panel className="overflow-hidden xl:col-span-9">
          <PanelHeader
            title="Traffic time series"
            icon={Activity}
            note="Observed rate, rolling baseline and the adaptive burst threshold over time."
            actions={
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">Range</span>
                <span
                  role="group"
                  aria-label="Time range"
                  className="flex overflow-hidden rounded border border-border"
                >
                  {RANGES.map((range) => (
                    <button
                      key={range.value}
                      type="button"
                      aria-pressed={rangeMs === range.value}
                      onClick={() => setRangeMs(range.value)}
                      className={cn(
                        "data-mono px-2.5 py-1 text-[11px] transition-colors",
                        rangeMs === range.value
                          ? "bg-primary text-primary-foreground font-medium"
                          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      {range.label}
                    </button>
                  ))}
                </span>
              </div>
            }
          />
          <div className="px-4 py-3">
            <TrafficChart
              history={history}
              intervals={snapshot.burstIntervals}
              height={330}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <ChartLegend />
              <div className="flex items-center gap-2">
                <StatusPill tone={snapshot.running ? "normal" : "idle"} pulse={snapshot.running}>
                  {snapshot.running ? (snapshot.dataSource === "live" ? "sniffing" : "sampling") : "paused"}
                </StatusPill>
                <Tag tone={snapshot.dataSource === "live" ? "live" : "neutral"}>
                  {snapshot.dataSource === "live" ? "Live capture" : "Simulated"}
                </Tag>
              </div>
            </div>
          </div>
          <p className="border-t border-border px-4 py-2.5 text-[10.5px] leading-4 text-muted-foreground">
            Coral bands mark intervals the detector declared as bursts. A rate spike on this chart
            is a rate measurement — it is not a measurement of switch-buffer occupancy.
          </p>
        </Panel>

        <div className="space-y-4 xl:col-span-3">
          <Panel className="overflow-hidden">
            <PanelHeader title="Detector in force" icon={Timer} />
            <div className="px-4 py-3">
              <div className="divide-y divide-border/60">
                <KeyValue label="Sampling window" mono>
                  {snapshot.config.detection.windowMs} ms
                </KeyValue>
                <KeyValue label="Minimum rate" mono>
                  {snapshot.config.detection.minRateMbps} Mbps
                </KeyValue>
                <KeyValue label="Baseline multiplier" mono>
                  ×{snapshot.config.detection.baselineMultiplier}
                </KeyValue>
                <KeyValue label="Baseline window" mono>
                  {snapshot.config.detection.baselineWindowMs} ms
                </KeyValue>
                <KeyValue label="Persistence" mono>
                  {snapshot.config.detection.persistenceWindows} windows
                </KeyValue>
                <KeyValue label="Recovery" mono>
                  {snapshot.config.detection.recoveryWindows} windows
                </KeyValue>
                <KeyValue label="Burst cooldown" mono>
                  {formatMs(snapshot.config.detection.cooldownMs, 0)}
                </KeyValue>
                <KeyValue label="Live threshold" mono>
                  {formatMbpsValue(snapshot.latest?.thresholdMbps ?? 0)} Mbps
                </KeyValue>
              </div>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Observation" icon={Info} />
            <div className="space-y-2 px-4 py-3 text-[11px] leading-5 text-muted-foreground">
              <p>
                Advantage over baseline:{" "}
                <span className="data-mono text-foreground">
                  {snapshot.latest && snapshot.latest.baselineMbps > 0
                    ? formatPercent(
                        ((snapshot.latest.rateMbps - snapshot.latest.baselineMbps) /
                          snapshot.latest.baselineMbps) *
                          100,
                      )
                    : "—"}
                </span>
              </p>
              <p>
                A burst is declared only when the measured rate exceeds both the absolute minimum
                and baseline × multiplier for the persistence window.
              </p>
              <p className="text-muted-foreground/70">
                Windows are simulated deterministically from seed{" "}
                {snapshot.config.simulation.seed}.
              </p>
            </div>
          </Panel>
        </div>
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Recent burst events"
          icon={OctagonAlert}
          note="Every detected burst with the source host, observed peak throughput, and recovery state."
          actions={<Tag tone="neutral">{burstRows.length} recorded</Tag>}
        />
        {burstRows.length === 0 ? (
          <EmptyState
            icon={OctagonAlert}
            title="No bursts detected yet"
            description="Under the current settings no window has exceeded the adaptive threshold. Inject a burst from the operations strip to exercise the detector."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-border">
                  {["Detected", "Host", "Source IP", "Peak rate", "Severity", "Status"].map(
                    (head) => (
                      <th
                        key={head}
                        className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground"
                      >
                        {head}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {burstRows.slice(0, 14).map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className="data-mono whitespace-nowrap px-4 py-2.5 text-[11px] text-muted-foreground">
                      {formatClock(row.detectedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-[11.5px] text-foreground">
                      {row.hostName}
                    </td>
                    <td className="data-mono whitespace-nowrap px-4 py-2.5 text-[11px] text-muted-foreground">
                      {row.sourceIp}
                    </td>
                    <td className="data-mono px-4 py-2.5 text-[11.5px] text-burst">
                      {row.peakMbps !== null ? `${formatMbpsValue(row.peakMbps)} Mbps` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill tone={row.severity === "severe" ? "burst" : "warning"}>
                        {row.severity}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-2.5">
                      {row.endedAt === null ? (
                        <StatusPill tone="burst" pulse>
                          active
                        </StatusPill>
                      ) : (
                        <span className="flex items-center gap-2">
                          <StatusPill tone="success">recovered</StatusPill>
                          <span className="data-mono text-[10.5px] text-muted-foreground">
                            {formatMs(row.endedAt - row.detectedAt, 0)}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-border px-4 py-2.5 text-[10.5px] text-muted-foreground">
          Status is derived from the detector's own burst start/end events — the interface does not
          decide on its own that a burst has recovered.
        </p>
      </Panel>
    </div>
  );
}
