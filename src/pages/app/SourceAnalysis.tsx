import { useMemo, useState } from "react";
import { ControlBar } from "@/components/ControlBar";
import { StatusPill, trafficStateLabel, trafficStateTone } from "@/components/StatusPill";
import {
  EmptyState,
  KeyValue,
  Panel,
  PanelHeader,
  SegmentBar,
  Stat,
  Tag,
  eventTone,
  toneFill,
  toneText,
  trafficTone,
  type Tone,
} from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useMonitoring } from "@/state/monitoring";
import { downloadCsv, timestampSlug, toCsv } from "@/simulation";
import {
  formatBytes,
  formatClock,
  formatCount,
  formatMbpsValue,
  formatPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_LABELS } from "@/types";
import { Download, Info, ScrollText, Share2, Waves } from "lucide-react";

/** Compact per-source history plot: HTML labels, distortion-free SVG strokes. */
function SourceRateChart({
  values,
  maxValue,
  thresholdMbps,
  burstFlags,
}: {
  values: number[];
  maxValue: number;
  thresholdMbps: number;
  burstFlags: boolean[];
}) {
  if (values.length < 2) {
    return (
      <div className="flex h-[150px] items-center justify-center border border-dashed border-border/70 text-[11px] text-muted-foreground">
        Per-source history builds as windows are sampled.
      </div>
    );
  }
  const top = Math.max(maxValue, thresholdMbps, 1) * 1.15;
  const step = 100 / (values.length - 1);
  const y = (v: number) => 40 - (Math.min(v, top) / top) * 40;
  const line = values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${y(v).toFixed(2)}`)
    .join(" ");
  const area = `${line} L 100 40 L 0 40 Z`;

  // Coral overlay limited to windows inside a declared burst interval.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (burstFlags[i]) {
      if (current.length === 0 && i > 0) current.push(`M ${((i - 1) * step).toFixed(2)} ${y(values[i - 1]).toFixed(2)}`);
      current.push(`L ${(i * step).toFixed(2)} ${y(v).toFixed(2)}`);
    } else if (current.length > 0) {
      current.push(`L ${(i * step).toFixed(2)} ${y(v).toFixed(2)}`);
      segments.push(current.join(" "));
      current = [];
    }
  });
  if (current.length > 1) segments.push(current.join(" "));

  const thresholdY = y(thresholdMbps);

  return (
    <div className="flex gap-2">
      <div className="data-mono flex h-[150px] w-11 flex-col justify-between text-right text-[9px] text-muted-foreground/70">
        <span>{top.toFixed(0)}</span>
        <span>{(top / 2).toFixed(0)}</span>
        <span>0</span>
      </div>
      <div className="relative flex-1">
        <svg
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          className="h-[150px] w-full"
          role="img"
          aria-label="Per-source observed rate history"
        >
          <rect x="0" y="20" width="100" height="20" className="fill-border/20" />
          <line
            x1="0"
            x2="100"
            y1={thresholdY}
            y2={thresholdY}
            className="stroke-warning/80"
            strokeWidth={1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          <path d={area} className="fill-primary/10" />
          <path
            d={line}
            fill="none"
            className="stroke-primary"
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
          />
          {segments.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              className="stroke-burst"
              strokeWidth={1.8}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <span className="label-caps absolute right-0 top-0 text-[8px] text-muted-foreground/50">
          Mbps
        </span>
      </div>
    </div>
  );
}

export default function SourceAnalysis() {
  const { snapshot } = useMonitoring();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ranked = useMemo(
    () => [...snapshot.sources].sort((a, b) => b.contributionPct - a.contributionPct || b.rateMbps - a.rateMbps),
    [snapshot.sources],
  );

  const selected =
    snapshot.sources.find((s) => s.id === selectedId) ?? ranked[0] ?? null;

  const burstOpen = snapshot.burstTotalBytes > 0 && snapshot.burstActive === true;
  const leader = ranked[0];
  const attributed = snapshot.sources.some((s) => s.contributionPct > 0);

  const series = useMemo(() => {
    if (!selected) return { values: [] as number[], flags: [] as boolean[] };
    const history = snapshot.history.slice(-180);
    return {
      values: history.map((s) => s.perSource[selected.id] ?? 0),
      flags: history.map((s) =>
        snapshot.burstIntervals.some(
          (iv) => s.t >= iv.start && s.t <= (iv.end ?? Number.MAX_SAFE_INTEGER),
        ),
      ),
    };
  }, [selected, snapshot.history, snapshot.burstIntervals]);

  const relatedEvents = useMemo(() => {
    if (!selected) return [];
    return [...snapshot.events]
      .reverse()
      .filter(
        (e) => e.sourceIp === selected.ip || e.hostName === selected.name,
      )
      .slice(0, 6);
  }, [selected, snapshot.events]);

  const handleExport = () => {
    const csv = toCsv(snapshot.sources, [
      { key: "name", header: "Host", value: (r) => r.name },
      { key: "ip", header: "IP address", value: (r) => r.ip },
      { key: "packets", header: "Packets observed", value: (r) => r.packets },
      { key: "bytes", header: "Bytes observed", value: (r) => Math.round(r.bytes) },
      { key: "rate", header: "Rate (Mbps)", value: (r) => r.rateMbps.toFixed(3) },
      {
        key: "contribution",
        header: "Burst contribution (%)",
        value: (r) => r.contributionPct.toFixed(2),
      },
      { key: "policy", header: "Policy", value: (r) => r.policy },
      { key: "state", header: "Status", value: (r) => r.state },
    ]);
    downloadCsv(`microbursthunter-sources-${timestampSlug()}.csv`, csv);
  };

  return (
    <div className="space-y-4">
      <ControlBar />

      <Panel className="overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-3">
          <div className="border-border/60 sm:border-r">
            <Stat
              label="Leading contributor"
              value={burstOpen && leader ? leader.name : "—"}
              unit={burstOpen && leader ? formatPercent(leader.contributionPct) : undefined}
              tone={burstOpen ? "burst" : "neutral"}
              size="sm"
              icon={Share2}
              hint={
                burstOpen && leader
                  ? `${leader.ip} · share of burst bytes`
                  : "no burst window open — shares are not attributed"
              }
            />
          </div>
          <div className="border-border/60 border-t sm:border-t-0 sm:border-r">
            <Stat
              label="Active sources"
              value={`${snapshot.activeSourceIps}`}
              unit={`/ ${snapshot.sources.length}`}
              tone="live"
              size="sm"
              icon={Waves}
              hint="transmitting hosts in the fabric"
            />
          </div>
          <div className="border-t border-border/60 sm:border-t-0">
            <Stat
              label="Bytes attributed"
              value={(snapshot.burstTotalBytes / 1_000_000).toFixed(2)}
              unit="MB"
              tone={attributed ? "analysis" : "neutral"}
              size="sm"
              icon={Info}
              hint="accounted inside the current burst window"
            />
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-12">
        {/* ranked list */}
        <Panel className="overflow-hidden xl:col-span-5">
          <PanelHeader
            title="Ranked contributors"
            icon={Share2}
            note="Ordered by measured byte share during the burst window, then by observed rate."
            actions={
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 rounded-sm"
                onClick={handleExport}
              >
                <Download className="size-3.5" />
                CSV
              </Button>
            }
          />
          <ul className="divide-y divide-border/60">
            {ranked.map((source, index) => {
              const isSelected = selected?.id === source.id;
              const tone = trafficTone(source.state);
              const isLeader = attributed && index === 0 && source.contributionPct > 0;
              return (
                <li key={source.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(source.id)}
                    className={cn(
                      "w-full px-4 py-2.5 text-left transition-colors",
                      isSelected ? "bg-surface-2" : "hover:bg-surface-2/60",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "data-mono shrink-0 text-[10px]",
                          isLeader ? "text-burst" : "text-muted-foreground/60",
                        )}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          source.state === "idle" ? "bg-muted-foreground/50" : toneFill[tone],
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span
                            className={cn(
                              "text-[12px] font-medium",
                              isLeader ? "text-burst" : "text-foreground",
                            )}
                          >
                            {source.name}
                          </span>
                          <span className="data-mono text-[10.5px] text-muted-foreground">
                            {source.ip}
                          </span>
                        </span>
                        <span className="data-mono mt-0.5 block text-[10px] text-muted-foreground/80">
                          {formatBytes(source.bytes)} · {formatCount(source.packets)} pkts
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="data-mono block text-[11px] text-foreground">
                          {formatMbpsValue(source.rateMbps)}
                          <span className="ml-1 text-muted-foreground">Mbps</span>
                        </span>
                        <span
                          className={cn(
                            "data-mono block text-[10px]",
                            source.contributionPct > 0
                              ? toneText[tone]
                              : "text-muted-foreground/60",
                          )}
                        >
                          {source.contributionPct > 0
                            ? `${formatPercent(source.contributionPct)} share`
                            : "not attributed"}
                        </span>
                      </span>
                      {isSelected && (
                        <span className="h-8 w-[2px] shrink-0 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-3 pl-7">
                      <SegmentBar
                        value={source.contributionPct}
                        tone={tone}
                        segments={24}
                        className="flex-1"
                      />
                      <StatusPill tone={trafficStateTone(source.state)} pulse={source.state === "burst"}>
                        {trafficStateLabel(source.state)}
                      </StatusPill>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-border px-4 py-2.5 text-[10.5px] leading-4 text-muted-foreground">
            Contribution = source bytes during the burst ÷ total burst bytes × 100. A high share
            indicates volume observed in a window, not malicious intent — legitimate bulk traffic
            produces microbursts too.
          </p>
        </Panel>

        {/* detail */}
        <Panel className="overflow-hidden xl:col-span-7">
          <PanelHeader
            title={selected ? `${selected.name} · ${selected.ip}` : "Source detail"}
            icon={Share2}
            note={
              selected
                ? selected.state === "burst"
                  ? "Currently contributing to a detected burst."
                  : selected.state === "mitigated"
                    ? "Currently rate limited by the mitigation policy."
                    : "No burst attribution for this source right now."
                : undefined
            }
            actions={
              selected ? (
                <StatusPill tone={trafficStateTone(selected.state)} pulse={selected.state === "burst"}>
                  {trafficStateLabel(selected.state)}
                </StatusPill>
              ) : undefined
            }
          />
          {!selected ? (
            <EmptyState
              icon={Share2}
              title="No transmitting sources"
              description="The fabric has no sources configured."
            />
          ) : (
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="label-caps text-muted-foreground">
                    observed rate · last {series.values.length} windows
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="label-caps text-warning/80">threshold</span>
                    <span className="label-caps text-primary/80">rate</span>
                    <span className="label-caps text-burst/80">in burst</span>
                  </span>
                </div>
                <div className="mt-2">
                  <SourceRateChart
                    values={series.values}
                    maxValue={Math.max(...series.values, 0)}
                    thresholdMbps={snapshot.latest?.thresholdMbps ?? 0}
                    burstFlags={series.flags}
                  />
                </div>

                <div className="mt-4 border-t border-border pt-3">
                  <span className="label-caps text-muted-foreground">
                    recent events for this source
                  </span>
                  {relatedEvents.length === 0 ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      No events have been recorded for this source in the current session.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {relatedEvents.map((event) => {
                        const tone = eventTone(event.severity);
                        return (
                          <li key={event.id} className="flex items-start gap-3">
                            <span className="data-mono w-16 shrink-0 pt-0.5 text-[10.5px] text-muted-foreground">
                              {formatClock(event.timestamp)}
                            </span>
                            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", toneFill[tone])} />
                            <span className="min-w-0">
                              <span className="label-caps text-muted-foreground/70">
                                {EVENT_TYPE_LABELS[event.type]}
                              </span>
                              <span className="mt-0.5 block text-[11.5px] text-foreground">
                                {event.action}
                              </span>
                              <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                                {event.outcome}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <div className="border-t border-border px-4 py-3 lg:border-l lg:border-t-0">
                <span className="label-caps text-muted-foreground">counters</span>
                <div className="mt-1 divide-y divide-border/60">
                  <KeyValue label="Traffic rate" mono>
                    {formatMbpsValue(selected.rateMbps)} Mbps
                  </KeyValue>
                  <KeyValue label="Bytes observed" mono>
                    {formatBytes(selected.bytes)}
                  </KeyValue>
                  <KeyValue label="Packets observed" mono>
                    {formatCount(selected.packets)}
                  </KeyValue>
                  <KeyValue label="Burst share" mono>
                    {selected.contributionPct > 0
                      ? formatPercent(selected.contributionPct)
                      : "—"}
                  </KeyValue>
                </div>

                <span className="label-caps mt-4 block text-muted-foreground">policy</span>
                <div className="mt-1 divide-y divide-border/60">
                  <KeyValue label="Current policy">
                    {selected.rateCapMbps !== null ? (
                      <Tag tone="mitigated">cap {selected.rateCapMbps.toFixed(0)} Mbps</Tag>
                    ) : (
                      <span className="text-muted-foreground">unrestricted</span>
                    )}
                  </KeyValue>
                  <KeyValue label="Mitigation target">
                    {snapshot.mitigation.targetHostId === selected.id ? (
                      <Tag tone="mitigated">yes</Tag>
                    ) : (
                      <span className="text-muted-foreground">no</span>
                    )}
                  </KeyValue>
                  <KeyValue label="Status">
                    <StatusPill tone={trafficStateTone(selected.state)}>
                      {trafficStateLabel(selected.state)}
                    </StatusPill>
                  </KeyValue>
                </div>

                {selected.state === "burst" && (
                  <p className="mt-3 flex items-start gap-2 rounded-sm border border-burst/40 bg-burst/[0.07] px-2.5 py-2 text-[10.5px] leading-4 text-burst">
                    <ScrollText className="mt-px size-3 shrink-0" />
                    Elevated volume observed during a detected burst window. Recorded for review —
                    not classified as malicious.
                  </p>
                )}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
