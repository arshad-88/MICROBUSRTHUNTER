import { ControlBar } from "@/components/ControlBar";
import { MetricCard } from "@/components/MetricCard";
import { StatusPill } from "@/components/StatusPill";
import { TrafficChart, ChartLegend } from "@/components/TrafficChart";
import { useMonitoring } from "@/state/monitoring";
import {
  formatBytes,
  formatCount,
  formatMb,
  formatMbpsValue,
  formatMs,
  formatPercent,
} from "@/lib/format";
import {
  Activity,
  Gauge,
  Network,
  PackageX,
  Timer,
  Users,
  Waves,
  Zap,
} from "lucide-react";
import { Link } from "react-router";

export default function Overview() {
  const { snapshot } = useMonitoring();
  const latest = snapshot.latest;
  const windowSeconds = snapshot.config.detection.windowMs / 1000;

  const packetRate = latest ? latest.packets / windowSeconds : 0;
  const dropPct =
    latest && latest.bytes > 0 ? (latest.dropBytes / latest.bytes) * 100 : 0;
  const dropMb = snapshot.summary.totalDropBytes * 8 / 1_000_000;

  const mitigationStatus = snapshot.mitigation.active
    ? `Capping ${snapshot.mitigation.targetName} @ ${formatMbpsValue(snapshot.mitigation.rateLimitMbps, 0)} Mbps`
    : snapshot.config.mitigation.autoEnabled
      ? "Armed — automatic"
      : "Disabled";

  const experimentMode = snapshot.experiment.active
    ? `Experiment ${snapshot.experiment.scenario} running`
    : `Scenario ${snapshot.experiment.scenario} selected`;

  return (
    <div className="space-y-5">
      <ControlBar />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Current traffic rate"
          value={formatMbpsValue(latest?.rateMbps ?? 0)}
          unit="Mbps"
          icon={Activity}
          tone={snapshot.burstActive ? "burst" : "default"}
          hint={`Threshold ${formatMbpsValue(latest?.thresholdMbps ?? 0)} Mbps`}
        />
        <MetricCard
          label="Packet rate"
          value={formatCount(packetRate)}
          unit="pps"
          icon={Waves}
          hint={`${formatCount(latest?.packets ?? 0)} pkts / ${snapshot.config.detection.windowMs} ms window`}
        />
        <MetricCard
          label="Packet drops"
          value={formatMb(dropMb)}
          icon={PackageX}
          tone={dropMb > 0 ? "warning" : "success"}
          hint={
            dropMb > 0
              ? `${formatPercent(dropPct)} of current window · simulated queue overflow`
              : "No simulated drops"
          }
        />
        <MetricCard
          label="Latency"
          value={formatMs(latest?.latencyMs ?? 0, 2)}
          icon={Timer}
          tone={(latest?.latencyMs ?? 0) > 5 ? "warning" : "default"}
          hint="Simulated queueing latency"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Detected bursts"
          value={formatCount(snapshot.burstCount)}
          icon={Zap}
          tone={snapshot.burstActive ? "burst" : "default"}
          hint={
            snapshot.currentBurst
              ? `Active: ${snapshot.currentBurst.severity} on ${snapshot.currentBurst.hostName}`
              : "No burst in progress"
          }
        />
        <MetricCard
          label="Active source IPs"
          value={formatCount(snapshot.activeSourceIps)}
          unit={`/ ${snapshot.hosts.filter((h) => h.transmits).length}`}
          icon={Users}
          hint="Transmitting hosts in the fabric"
        />
        <MetricCard
          label="Mitigation status"
          value={snapshot.mitigation.active ? "Active" : "Idle"}
          icon={Gauge}
          tone={snapshot.mitigation.active ? "mitigated" : "default"}
          hint={mitigationStatus}
        />
        <MetricCard
          label="Experiment mode"
          value={`Mode ${snapshot.experiment.scenario}`}
          icon={Network}
          tone="info"
          hint={experimentMode}
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold tracking-tight">Traffic rate vs threshold</p>
            <p className="text-[11px] text-muted-foreground">
              Same data source as the topology and source ranking
            </p>
          </div>
          <StatusPill tone={snapshot.running ? "success" : "idle"} pulse={snapshot.running}>
            {snapshot.running ? "Live (simulated)" : "Paused"}
          </StatusPill>
        </div>
        <TrafficChart history={snapshot.history.slice(-220)} intervals={snapshot.burstIntervals} height={260} />
        <div className="mt-3">
          <ChartLegend />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
          <span>Peak: <span className="text-foreground">{formatMbpsValue(snapshot.summary.peakMbps)} Mbps</span></span>
          <span>Average: <span className="text-foreground">{formatMbpsValue(snapshot.summary.avgMbps)} Mbps</span></span>
          <span>Total bytes: <span className="text-foreground">{formatBytes(snapshot.summary.totalBytes)}</span></span>
          <span>Windows: <span className="text-foreground">{formatCount(snapshot.history.length)}</span></span>
          <Link to="/dashboard/traffic" className="text-primary hover:underline">
            Open Traffic Monitor →
          </Link>
        </div>
      </div>
    </div>
  );
}
