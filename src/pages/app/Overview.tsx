import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ControlBar } from "@/components/ControlBar";
import { HostInspector } from "@/components/DetailsPanel";
import { NetworkTopology } from "@/components/NetworkTopology";
import { ChartLegend, TrafficChart } from "@/components/TrafficChart";
import {
  EmptyState,
  KeyValue,
  Meter,
  Panel,
  PanelHeader,
  SegmentBar,
  Stat,
  Tag,
  eventTone,
  toneFill,
  toneText,
  type Tone,
} from "@/components/kit";
import { StatusPill } from "@/components/StatusPill";
import { useMonitoring } from "@/state/monitoring";
import {
  formatBytes,
  formatClock,
  formatCount,
  formatMb,
  formatMbpsValue,
  formatMs,
  formatPercent,
  formatSimTime,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_LABELS } from "@/types";
import {
  Activity,
  ArrowUpRight,
  Gauge,
  OctagonAlert,
  PackageX,
  ScrollText,
  Share2,
  ShieldCheck,
  Timer,
  TrendingUp,
  Waves,
  Zap,
} from "lucide-react";

export default function Overview() {
  const { snapshot } = useMonitoring();
  const latest = snapshot.latest;
  const windowSeconds = snapshot.config.detection.windowMs / 1000;
  const burst = snapshot.currentBurst;
  const mitigation = snapshot.mitigation;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  const selectedHost = snapshot.hosts.find((h) => h.id === selectedNodeId) ?? null;

  const packetRate = latest ? latest.packets / windowSeconds : 0;
  const dropMb = (snapshot.summary.totalDropBytes * 8) / 1_000_000;

  const ranked = useMemo(
    () => [...snapshot.sources].sort((a, b) => b.contributionPct - a.contributionPct),
    [snapshot.sources],
  );
  const topShare = ranked[0]?.contributionPct ?? 0;

  const events = useMemo(() => [...snapshot.events].reverse().slice(0, 7), [snapshot.events]);
  const trafficLinks = snapshot.links.filter((l) => !l.control);

  const rateTone: Tone = snapshot.burstActive
    ? "burst"
    : mitigation.active
      ? "mitigated"
      : "live";

  return (
    <div className="space-y-4">
      {/* Operations Control Bar (Live Capture vs Sim, Interfaces, Scenarios) */}
      <ControlBar />

      {/* ----------------- Concept B Hero: Primary Waveform Oscilloscope & Gauge Deck ----------------- */}
      <div className="grid gap-4 xl:grid-cols-12">
        {/* Main Waveform Oscilloscope (8 cols) */}
        <Panel className="overflow-hidden xl:col-span-8 flex flex-col justify-between">
          <PanelHeader
            title="Traffic oscilloscope"
            icon={Activity}
            note="High-resolution rate against adaptive threshold and baseline. Coral bands indicate detected microbursts."
            actions={
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-xs">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      snapshot.running ? "bg-success mbh-pulse" : "bg-muted-foreground/60",
                    )}
                  />
                  <span className="font-medium text-muted-foreground">
                    {snapshot.running ? "Active" : "Frozen"}
                  </span>
                </span>
                <Link
                  to="/dashboard/traffic"
                  className="flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:text-primary/85"
                >
                  Inspect details
                  <ArrowUpRight className="size-3" />
                </Link>
              </div>
            }
          />
          <div className="p-4 flex-1 flex flex-col justify-between">
            <TrafficChart
              history={snapshot.history.slice(-240)}
              intervals={snapshot.burstIntervals}
              height={260}
            />
            <ChartLegend className="mt-3 border-t border-border pt-3" />
          </div>
        </Panel>

        {/* Live Telemetry Deck (4 cols) */}
        <div className="grid grid-cols-2 gap-3 xl:col-span-4 xl:grid-cols-1">
          <Panel className="overflow-hidden">
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Observed rate</span>
                <span className={cn("size-2 rounded-full", toneFill[rateTone])} />
              </div>
              <div className="flex items-baseline gap-2">
                <span className={cn("readout text-[32px] font-bold tracking-tight", toneText[rateTone])}>
                  {formatMbpsValue(latest?.rateMbps ?? 0)}
                </span>
                <span className="data-mono text-xs text-muted-foreground">Mbps</span>
              </div>
              <div className="space-y-1.5 border-t border-border pt-2 text-xs">
                <KeyValue label="Adaptive threshold" mono>
                  {formatMbpsValue(latest?.thresholdMbps ?? 0)} Mbps
                </KeyValue>
                <KeyValue label="Rolling baseline" mono>
                  {formatMbpsValue(latest?.baselineMbps ?? 0)} Mbps
                </KeyValue>
              </div>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Burst summary</span>
                <Zap className={cn("size-4", snapshot.burstCount > 0 ? "text-burst" : "text-muted-foreground/60")} />
              </div>
              <div className="flex items-baseline gap-2">
                <span className={cn("readout text-[28px] font-bold", snapshot.burstCount > 0 ? "text-burst" : "text-foreground")}>
                  {snapshot.burstCount}
                </span>
                <span className="text-xs text-muted-foreground">events recorded</span>
              </div>
              <div className="space-y-1.5 border-t border-border pt-2 text-xs">
                <KeyValue label="Peak throughput" mono>
                  {formatMbpsValue(snapshot.summary.peakMbps)} Mbps
                </KeyValue>
                <KeyValue label="Observed packets" mono>
                  {formatCount(snapshot.summary.totalPackets)} pkts
                </KeyValue>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {/* ----------------- Middle Observability Plane: Network Topology & Burst Attribution ----------------- */}
      <div className="grid gap-4 xl:grid-cols-12">
        {/* Network Topology (7 cols) */}
        <Panel className="overflow-hidden xl:col-span-7">
          <PanelHeader
            title="Network topology"
            icon={Share2}
            note="Observed endpoints, switch fabric and uplink paths. Stroke width represents real-time load."
            actions={
              <Link
                to="/dashboard/topology"
                className="flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:text-primary/85"
              >
                Expand topology
                <ArrowUpRight className="size-3" />
              </Link>
            }
          />
          <NetworkTopology
            hosts={snapshot.hosts}
            links={snapshot.links}
            running={snapshot.running}
            selectedNodeId={selectedNodeId}
            selectedLinkId={selectedLinkId}
            onSelectNode={(id) => {
              setSelectedNodeId((prev) => (prev === id ? null : id));
              setSelectedLinkId(null);
            }}
            onSelectLink={(id) => {
              setSelectedLinkId(id);
              setSelectedNodeId(null);
            }}
          />
          {selectedHost ? (
            <HostInspector
              host={selectedHost}
              history={snapshot.history}
              onClose={() => setSelectedNodeId(null)}
            />
          ) : (
            <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
              Select any endpoint node or link to inspect live traffic counters and policy state.
            </p>
          )}
        </Panel>

        {/* Burst Attribution & Mitigation Deck (5 cols) */}
        <div className="space-y-4 xl:col-span-5">
          {/* Burst Attribution */}
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Burst attribution"
              icon={OctagonAlert}
              note="Reported directly by the detector — never fabricated."
              actions={
                burst ? (
                  <StatusPill tone="burst" pulse>
                    {burst.severity === "severe" ? "Severe spike" : "Moderate burst"}
                  </StatusPill>
                ) : (
                  <StatusPill tone="normal">Nominal</StatusPill>
                )
              }
            />
            {burst ? (
              <div className="p-4 space-y-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <span className="readout text-[26px] font-bold text-burst">
                      {formatMbpsValue(burst.peakMbps)}
                    </span>
                    <span className="data-mono ml-1.5 text-xs text-muted-foreground">Mbps peak</span>
                  </div>
                  <Tag tone="burst">{burst.severity.toUpperCase()}</Tag>
                </div>
                <div className="text-xs font-medium text-foreground">
                  Source: <span className="font-semibold">{burst.hostName}</span>
                  <span className="data-mono ml-2 text-muted-foreground">({burst.sourceIp})</span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Share of burst traffic</span>
                    <span className="data-mono font-semibold text-burst">
                      {formatPercent(burst.contributionPct)}
                    </span>
                  </div>
                  <SegmentBar value={burst.contributionPct} tone="burst" />
                </div>
                <div className="divide-y divide-border/60 text-xs border-t border-border pt-2">
                  <KeyValue label="Threshold exceeded" mono>
                    {formatMbpsValue(burst.thresholdMbps)} Mbps
                  </KeyValue>
                  <KeyValue label="Baseline rate" mono>
                    {formatMbpsValue(burst.baselineMbps)} Mbps
                  </KeyValue>
                  <KeyValue label="Detection timestamp" mono>
                    t+{formatSimTime(burst.detectedAtSim)}
                  </KeyValue>
                  <KeyValue label="Detection latency" mono>
                    {burst.detectionDelayMs !== null ? formatMs(burst.detectionDelayMs, 0) : "Immediate"}
                  </KeyValue>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  No active flow exceeds the adaptive burst threshold. Detector is sampling normally.
                </p>
                <div className="divide-y divide-border/60 text-xs border-t border-border pt-2">
                  <KeyValue label="Window width" mono>
                    {snapshot.config.detection.windowMs} ms
                  </KeyValue>
                  <KeyValue label="Baseline multiplier" mono>
                    ×{snapshot.config.detection.baselineMultiplier}
                  </KeyValue>
                  <KeyValue label="Current threshold" mono>
                    {formatMbpsValue(latest?.thresholdMbps ?? 0)} Mbps
                  </KeyValue>
                </div>
              </div>
            )}
          </Panel>

          {/* Mitigation Status */}
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Adaptive mitigation"
              icon={ShieldCheck}
              note="Dry-run safety gate preserves host network adapter integrity."
              actions={
                mitigation.active ? (
                  <StatusPill tone="mitigated" pulse>
                    Dry-run cap active
                  </StatusPill>
                ) : (
                  <StatusPill tone={snapshot.config.mitigation.autoEnabled ? "normal" : "idle"}>
                    {snapshot.config.mitigation.autoEnabled ? "Armed (Dry-run)" : "Disabled"}
                  </StatusPill>
                )
              }
            />
            <div className="p-4 space-y-3">
              <div className="divide-y divide-border/60 text-xs">
                <KeyValue label="Target endpoint">
                  {mitigation.targetName ? (
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold">{mitigation.targetName}</span>
                      <span className="data-mono text-muted-foreground">({mitigation.targetIp})</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </KeyValue>
                <KeyValue label="Rate cap limit" mono>
                  {mitigation.active ? `${formatMbpsValue(mitigation.rateLimitMbps, 0)} Mbps` : "—"}
                </KeyValue>
                <KeyValue label="Recovery phase" mono>
                  {mitigation.recovery}
                </KeyValue>
              </div>

              {mitigation.active && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Enforcement duration</span>
                    <span className="data-mono text-muted-foreground">
                      {formatMs(mitigation.durationMs, 0)} / {snapshot.config.mitigation.maxDurationMs} ms
                    </span>
                  </div>
                  <Meter
                    value={mitigation.durationMs}
                    max={snapshot.config.mitigation.maxDurationMs}
                    tone="mitigated"
                  />
                </div>
              )}

              <Link
                to="/dashboard/mitigation"
                className="flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:text-primary/85 border-t border-border pt-2"
              >
                Open mitigation console
                <ArrowUpRight className="size-3" />
              </Link>
            </div>
          </Panel>
        </div>
      </div>

      {/* ----------------- Bottom Row: Ranked Source Contributions & Event Timeline ----------------- */}
      <div className="grid gap-4 xl:grid-cols-12">
        {/* Source Contribution (6 cols) */}
        <Panel className="overflow-hidden xl:col-span-6">
          <PanelHeader
            title="Source contribution ranking"
            icon={Share2}
            note="Ranked by bytes observed during the detection window. High traffic does not imply malicious intent."
            actions={
              <Link
                to="/dashboard/sources"
                className="flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:text-primary/85"
              >
                Full analysis
                <ArrowUpRight className="size-3" />
              </Link>
            }
          />
          <ul className="divide-y divide-border/60">
            {ranked.map((source, index) => {
              const tone: Tone = source.state === "burst" ? "burst" : source.state === "mitigated" ? "mitigated" : "live";
              return (
                <li key={source.id} className="px-4 py-2.5 hover:bg-surface-2/40 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="data-mono w-4 shrink-0 text-xs text-muted-foreground/70">
                      {index + 1}
                    </span>
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        source.state === "idle" ? "bg-muted-foreground/40" : toneFill[tone],
                      )}
                    />
                    <div className="min-w-0 flex-1 truncate">
                      <span className="text-xs font-medium text-foreground">
                        {source.name}
                      </span>
                      <span className="data-mono ml-2 text-xs text-muted-foreground">
                        {source.ip}
                      </span>
                    </div>
                    <span className="data-mono shrink-0 text-xs text-foreground">
                      {formatMbpsValue(source.rateMbps)} Mbps
                    </span>
                    <div className="w-20 shrink-0">
                      <SegmentBar
                        value={source.contributionPct}
                        tone={tone}
                        className="justify-end"
                      />
                    </div>
                    <span
                      className={cn(
                        "data-mono w-12 shrink-0 text-right text-xs",
                        source.contributionPct > 0 ? toneText[tone] : "text-muted-foreground",
                      )}
                    >
                      {source.contributionPct > 0 ? formatPercent(source.contributionPct) : "—"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>

        {/* Recent Activity Log (6 cols) */}
        <Panel className="overflow-hidden xl:col-span-6">
          <PanelHeader
            title="Event audit stream"
            icon={ScrollText}
            note="Newest events first. Detections, policy adjustments and recoveries are recorded verbatim."
            actions={
              <Link
                to="/dashboard/events"
                className="flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:text-primary/85"
              >
                Full audit trail
                <ArrowUpRight className="size-3" />
              </Link>
            }
          />
          {events.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No events recorded yet"
              description="Start monitoring or inject a burst to generate detector events."
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {events.map((event) => {
                const tone = eventTone(event.severity);
                return (
                  <li key={event.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-2/40 transition-colors">
                    <span className="data-mono w-16 shrink-0 pt-0.5 text-xs text-muted-foreground">
                      {formatClock(event.timestamp)}
                    </span>
                    <span
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", toneFill[tone])}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          {EVENT_TYPE_LABELS[event.type]}
                        </span>
                        {event.rateMbps !== undefined && (
                          <span className={cn("data-mono text-xs font-semibold", toneText[tone])}>
                            {formatMbpsValue(event.rateMbps)} Mbps
                          </span>
                        )}
                      </div>
                      <span className="mt-0.5 block truncate text-xs text-foreground">
                        {event.action}
                      </span>
                    </div>
                    {event.sourceIp && (
                      <span className="data-mono hidden shrink-0 pt-0.5 text-xs text-muted-foreground sm:block">
                        {event.sourceIp}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
