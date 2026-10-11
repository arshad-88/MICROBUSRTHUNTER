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
      <ControlBar />

      {/* ---------------------- telemetry strip (one panel, divided) ---------- */}
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            {
              label: "Observed rate",
              value: formatMbpsValue(latest?.rateMbps ?? 0),
              unit: "Mbps",
              tone: rateTone,
              icon: Activity,
              hint: `Threshold ${formatMbpsValue(latest?.thresholdMbps ?? 0)} Mbps`,
            },
            {
              label: "Peak rate",
              value: formatMbpsValue(snapshot.summary.peakMbps),
              unit: "Mbps",
              tone: (snapshot.burstCount > 0 ? "burst" : "neutral") as Tone,
              icon: TrendingUp,
              hint: `${formatCount(snapshot.history.length)} windows sampled`,
            },
            {
              label: "Average rate",
              value: formatMbpsValue(snapshot.summary.avgMbps),
              unit: "Mbps",
              tone: "analysis" as Tone,
              icon: Waves,
              hint: `Baseline ${formatMbpsValue(latest?.baselineMbps ?? 0)} Mbps`,
            },
            {
              label: "Packet rate",
              value: formatCount(packetRate),
              unit: "pps",
              tone: "neutral" as Tone,
              icon: Waves,
              hint: `${formatCount(latest?.packets ?? 0)} pkts / window`,
            },
            {
              label: "Burst events",
              value: String(snapshot.burstCount),
              tone: (snapshot.burstCount > 0 ? "burst" : "neutral") as Tone,
              icon: Zap,
              hint: burst ? `${burst.severity} · ${burst.hostName}` : "no burst in progress",
            },
            {
              label: "Drops / latency",
              value: formatMb(dropMb),
              tone: (dropMb > 0 ? "mitigated" : "recovered") as Tone,
              icon: PackageX,
              hint: `${formatMs(latest?.latencyMs ?? 0, 2)} latency · ${(latest?.estimatedQueuePct ?? 0).toFixed(0)}% est. queue`,
            },

          ].map((tile, i) => (
            <div
              key={tile.label}
              className={cn(
                "border-border/60",
                i % 2 === 1 && "border-l",
                i >= 2 && "border-t sm:border-t-0",
                i % 3 !== 0 && "sm:border-l",
                i !== 0 && "lg:border-l lg:border-t-0",
              )}
            >
              <Stat {...tile} size="sm" />
            </div>
          ))}
        </div>
      </Panel>

      {/* ---------------------- primary row: fabric plane + intelligence ------- */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel className="overflow-hidden xl:col-span-8">
          <PanelHeader
            title="Fabric plane"
            index="01"
            icon={Share2}
            note="Source bank → aggregation switch → destination. Stroke weight and colour follow the measured rate and detector state."
            actions={
              <>
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      snapshot.running ? "bg-success mbh-pulse" : "bg-muted-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "label-caps text-[9px]",
                      snapshot.running ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {snapshot.running ? "live" : "frozen"}
                  </span>
                </span>
                <Link
                  to="/dashboard/topology"
                  className="flex items-center gap-1 text-[11px] text-primary transition-colors hover:text-primary/80"
                >
                  expand
                  <ArrowUpRight className="size-3" />
                </Link>
              </>
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
            <p className="border-t border-border px-4 py-2.5 text-[10.5px] text-muted-foreground">
              Select a source port or a traffic path to inspect its counters, policy and burst
              contribution. Values derive from the same sample windows as the charts.
            </p>
          )}
        </Panel>

        <div className="space-y-4 xl:col-span-4">
          {/* burst intelligence */}
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Burst intelligence"
              index="02"
              icon={OctagonAlert}
              note="Reported by the detector — never inferred by the interface."
              actions={
                burst ? (
                  <StatusPill tone="burst" pulse>
                    {burst.severity === "severe" ? "severe" : "moderate"}
                  </StatusPill>
                ) : (
                  <StatusPill tone="normal">nominal</StatusPill>
                )
              }
            />
            {burst ? (
              <div className="px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="readout text-[26px] font-semibold text-burst">
                    {formatMbpsValue(burst.peakMbps)}
                  </span>
                  <span className="data-mono text-[11px] text-muted-foreground">
                    Mbps peak
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-foreground">
                  {burst.hostName}
                  <span className="data-mono ml-2 text-[11px] text-muted-foreground">
                    {burst.sourceIp}
                  </span>
                </p>
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="label-caps text-muted-foreground">
                      share of burst bytes
                    </span>
                    <span className="data-mono text-[11px] text-burst">
                      {formatPercent(burst.contributionPct)}
                    </span>
                  </div>
                  <SegmentBar value={burst.contributionPct} tone="burst" className="mt-1.5" />
                </div>
                <div className="mt-3 divide-y divide-border/60">
                  <KeyValue label="Threshold exceeded" mono>
                    {formatMbpsValue(burst.thresholdMbps)} Mbps
                  </KeyValue>
                  <KeyValue label="Baseline at detection" mono>
                    {formatMbpsValue(burst.baselineMbps)} Mbps
                  </KeyValue>
                  <KeyValue label="Detected at" mono>
                    t+{formatSimTime(burst.detectedAtSim)}
                  </KeyValue>
                  <KeyValue label="Detection latency" mono>
                    {burst.detectionDelayMs !== null
                      ? formatMs(burst.detectionDelayMs, 0)
                      : "n/a"}
                  </KeyValue>
                  <KeyValue label="Policy actions" mono>
                    {burst.mitigationCount}
                  </KeyValue>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3">
                <p className="text-[12px] text-muted-foreground">
                  No flow is above the adaptive threshold. Detector configuration in force:
                </p>
                <div className="mt-2 divide-y divide-border/60">
                  <KeyValue label="Sampling window" mono>
                    {snapshot.config.detection.windowMs} ms
                  </KeyValue>
                  <KeyValue label="Minimum rate" mono>
                    {snapshot.config.detection.minRateMbps} Mbps
                  </KeyValue>
                  <KeyValue label="Baseline multiplier" mono>
                    ×{snapshot.config.detection.baselineMultiplier}
                  </KeyValue>
                  <KeyValue label="Persistence / recovery" mono>
                    {snapshot.config.detection.persistenceWindows} /{" "}
                    {snapshot.config.detection.recoveryWindows} windows
                  </KeyValue>
                  <KeyValue label="Live threshold" mono>
                    {formatMbpsValue(latest?.thresholdMbps ?? 0)} Mbps
                  </KeyValue>
                </div>
              </div>
            )}
          </Panel>

          {/* mitigation status */}
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Mitigation status"
              index="03"
              icon={ShieldCheck}
              actions={
                mitigation.active ? (
                  <StatusPill tone="mitigated" pulse>
                    cap enforced
                  </StatusPill>
                ) : (
                  <StatusPill tone={snapshot.config.mitigation.autoEnabled ? "normal" : "idle"}>
                    {snapshot.config.mitigation.autoEnabled ? "armed" : "disabled"}
                  </StatusPill>
                )
              }
            />
            <div className="px-4 py-3">
              <div className="divide-y divide-border/60">
                <KeyValue label="Target">
                  {mitigation.targetName ? (
                    <span className="flex items-center justify-end gap-2">
                      <span>{mitigation.targetName}</span>
                      <span className="data-mono text-[10.5px] text-muted-foreground">
                        {mitigation.targetIp}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">none</span>
                  )}
                </KeyValue>
                <KeyValue label="Enforced limit" mono>
                  {mitigation.active
                    ? `${formatMbpsValue(mitigation.rateLimitMbps, 0)} Mbps`
                    : "—"}
                </KeyValue>
                <KeyValue label="Recovery" mono>
                  {mitigation.recovery}
                </KeyValue>
              </div>

              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <span className="label-caps text-muted-foreground">
                    enforcement duration
                  </span>
                  <span className="data-mono text-[10.5px] text-muted-foreground">
                    {formatMs(mitigation.durationMs, 0)} / {snapshot.config.mitigation.maxDurationMs} ms
                  </span>
                </div>
                <Meter
                  className="mt-1.5"
                  value={mitigation.durationMs}
                  max={snapshot.config.mitigation.maxDurationMs}
                  tone="mitigated"
                  ariaLabel="Mitigation duration against maximum"
                />
              </div>

              {mitigation.failureReason && (
                <p className="mt-3 rounded-sm border border-burst/40 bg-burst/[0.08] px-2.5 py-2 text-[10.5px] text-burst">
                  {mitigation.failureReason}
                </p>
              )}

              <Link
                to="/dashboard/mitigation"
                className="mt-3 flex items-center gap-1 border-t border-border pt-2.5 text-[11px] text-primary transition-colors hover:text-primary/80"
              >
                open mitigation console
                <ArrowUpRight className="size-3" />
              </Link>
            </div>
          </Panel>
        </div>
      </div>

      {/* ---------------------- analytics row --------------------------------- */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel className="overflow-hidden xl:col-span-7">
          <PanelHeader
            title="Live traffic behaviour"
            index="04"
            icon={Activity}
            note="Observed rate against the rolling baseline and the configured threshold; coral bands are intervals the detector declared."
            actions={
              <Link
                to="/dashboard/traffic"
                className="flex items-center gap-1 text-[11px] text-primary transition-colors hover:text-primary/80"
              >
                traffic intelligence
                <ArrowUpRight className="size-3" />
              </Link>
            }
          />
          <div className="px-4 py-3">
            <TrafficChart
              history={snapshot.history.slice(-240)}
              intervals={snapshot.burstIntervals}
              height={252}
            />
            <ChartLegend className="mt-3 border-t border-border pt-3" />
          </div>
        </Panel>

        <Panel className="overflow-hidden xl:col-span-5">
          <PanelHeader
            title="Source contribution"
            index="05"
            icon={Share2}
            note="Ranked by share of bytes observed during the burst window. High volume alone is not proof of intent."
            actions={
              <Link
                to="/dashboard/sources"
                className="flex items-center gap-1 text-[11px] text-primary transition-colors hover:text-primary/80"
              >
                investigate
                <ArrowUpRight className="size-3" />
              </Link>
            }
          />
          <ul className="divide-y divide-border/60">
            {ranked.map((source, index) => {
              const tone: Tone = source.state === "burst" ? "burst" : source.state === "mitigated" ? "mitigated" : "live";
              return (
                <li key={source.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="data-mono w-4 shrink-0 text-[10px] text-muted-foreground/60">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        source.state === "idle" ? "bg-muted-foreground/50" : toneFill[tone],
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-[12px] font-medium text-foreground">
                        {source.name}
                      </span>
                      <span className="data-mono ml-2 text-[10.5px] text-muted-foreground">
                        {source.ip}
                      </span>
                    </span>
                    <span className="data-mono shrink-0 text-[11px] text-foreground">
                      {formatMbpsValue(source.rateMbps)} Mbps
                    </span>
                    <span className="w-24 shrink-0">
                      <SegmentBar
                        value={source.contributionPct}
                        tone={tone}
                        className="justify-end"
                      />
                    </span>
                    <span
                      className={cn(
                        "data-mono w-12 shrink-0 text-right text-[10.5px]",
                        source.contributionPct > 0 ? toneText[tone] : "text-muted-foreground",
                      )}
                    >
                      {source.contributionPct > 0
                        ? formatPercent(source.contributionPct)
                        : "—"}
                    </span>
                  </div>
                  {source.rateCapMbps !== null && (
                    <p className="mt-1 pl-10 text-[10px] text-warning">
                      policy: rate cap {source.rateCapMbps.toFixed(0)} Mbps enforced in the traffic
                      model
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="border-t border-border px-4 py-2.5 text-[10.5px] text-muted-foreground">
            {topShare > 0
              ? `Leading contributor accounts for ${formatPercent(topShare)} of the current burst window.`
              : "No burst window is open, so contributions are not attributed."}
          </p>
        </Panel>
      </div>

      {/* ---------------------- audit row ------------------------------------- */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel className="overflow-hidden xl:col-span-7">
          <PanelHeader
            title="Recent activity"
            index="06"
            icon={ScrollText}
            note="Newest first. Every detection, policy change and recovery is recorded verbatim."
            actions={
              <Link
                to="/dashboard/events"
                className="flex items-center gap-1 text-[11px] text-primary transition-colors hover:text-primary/80"
              >
                full timeline
                <ArrowUpRight className="size-3" />
              </Link>
            }
          />
          {events.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No events recorded yet"
              description="Start monitoring or inject a burst — detections and policy changes will appear here."
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {events.map((event) => {
                const tone = eventTone(event.severity);
                return (
                  <li key={event.id} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="data-mono w-16 shrink-0 pt-0.5 text-[10.5px] text-muted-foreground">
                      {formatClock(event.timestamp)}
                    </span>
                    <span
                      className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", toneFill[tone])}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="label-caps text-muted-foreground/70">
                          {EVENT_TYPE_LABELS[event.type]}
                        </span>
                        {event.rateMbps !== undefined && (
                          <span className={cn("data-mono text-[10.5px]", toneText[tone])}>
                            {formatMbpsValue(event.rateMbps)} Mbps
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-foreground">
                        {event.action}
                      </span>
                    </span>
                    {event.sourceIp && (
                      <span className="data-mono hidden shrink-0 pt-0.5 text-[10.5px] text-muted-foreground sm:block">
                        {event.sourceIp}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel className="overflow-hidden xl:col-span-5">
          <PanelHeader
            title="Network state summary"
            index="07"
            icon={Gauge}
            note="Link utilisation derived from the modelled aggregate rate against nominal capacity."
          />
          <div className="px-4 py-3">
            <ul className="space-y-2.5">
              {trafficLinks.map((link) => {
                const from = snapshot.hosts.find((h) => h.id === link.from);
                const to = snapshot.hosts.find((h) => h.id === link.to);
                const tone: Tone =
                  link.state === "burst"
                    ? "burst"
                    : link.state === "mitigated"
                      ? "mitigated"
                      : link.rateMbps > 0.5
                        ? "live"
                        : "neutral";
                return (
                  <li key={link.id}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="data-mono text-[11px] text-foreground">
                        {from?.name} → {to?.name}
                      </span>
                      <span className="data-mono text-[10.5px] text-muted-foreground">
                        {formatMbpsValue(link.rateMbps)} / {link.capacityMbps} Mbps
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Meter
                        value={Math.min(100, link.utilization * 100)}
                        tone={tone}
                        ariaLabel={`${from?.name} to ${to?.name} utilisation`}
                      />
                      <span
                        className={cn(
                          "data-mono w-10 shrink-0 text-right text-[10px]",
                          toneText[tone],
                        )}
                      >
                        {formatPercent(link.utilization * 100, 0)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 grid grid-cols-2 gap-x-4 border-t border-border pt-3">
              <KeyValue label="Active sources" mono>
                {snapshot.activeSourceIps} / {snapshot.sources.length}
              </KeyValue>
              <KeyValue label="Bytes observed" mono>
                {formatBytes(snapshot.summary.totalBytes)}
              </KeyValue>
              <KeyValue label="Packets" mono>
                {formatCount(snapshot.summary.totalPackets)}
              </KeyValue>
              <KeyValue label="Modelled latency" mono>
                {formatMs(latest?.latencyMs ?? 0, 2)}
              </KeyValue>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
              <Tag tone="neutral">
                <Timer className="size-3" /> window {snapshot.config.detection.windowMs} ms
              </Tag>
              <Tag tone="neutral">capacity {snapshot.config.simulation.linkCapacityMbps} Mbps</Tag>
              <Tag tone="live">deterministic seed {snapshot.config.simulation.seed}</Tag>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
