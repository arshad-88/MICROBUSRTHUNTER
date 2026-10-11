import { cn } from "@/lib/utils";
import { formatMbpsValue, formatPercent } from "@/lib/format";
import type { HostState, LinkState, TrafficState } from "@/types";

/**
 * SIGNATURE FABRIC PLANE
 * ---------------------------------------------------------------------------
 * The network is drawn as a patch-panel instrument, not as glowing server
 * icons: a source bank on the left, a hexagonal aggregation backplane in the
 * centre, the destination plate on the right and the monitor node below.
 *
 * Every visual property is derived from the same window data the charts and
 * tables use — stroke weight from the measured rate, colour from the detector
 * state, meters from burst contribution. Nothing animates unless the engine
 * reports traffic, and nothing turns red unless the detector declared a burst.
 */

const VIEW_W = 1000;
const VIEW_H = 566;

const PORT_W = 214;
const PORT_H = 76;
const PORT_X = 152; // centre of the source column
const PORT_TOP = 62;
const PORT_GAP = 106;

const SW = { x: 566, y: 250, r: 62 };
const RX = { x: 886, y: 250, w: 150, h: 104 };
const MON = { x: 566, y: 468, w: 96, h: 58 };

const STATE_STROKE: Record<TrafficState, string> = {
  idle: "stroke-border",
  normal: "stroke-primary/70",
  burst: "stroke-burst",
  mitigated: "stroke-warning",
};
const STATE_FILL: Record<TrafficState, string> = {
  idle: "fill-muted-foreground/50",
  normal: "fill-primary",
  burst: "fill-burst",
  mitigated: "fill-warning",
};
const STATE_TEXT: Record<TrafficState, string> = {
  idle: "text-muted-foreground",
  normal: "text-primary",
  burst: "text-burst",
  mitigated: "text-warning",
};
const STATE_FLOW: Record<TrafficState, string> = {
  idle: "stroke-border",
  normal: "stroke-primary",
  burst: "stroke-burst",
  mitigated: "stroke-warning",
};

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 })
    .map((_, i) => {
      const a = ((-90 + 60 * i) * Math.PI) / 180;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(" ");
}

/** Cubic path from a source port to an ingress port on the switch's left face. */
function fanPath(fromX: number, fromY: number, toX: number, toY: number): string {
  return `M ${fromX} ${fromY} C ${fromX + 96} ${fromY}, ${toX - 72} ${toY}, ${toX} ${toY}`;
}

function ContributionMeter({ value, tone }: { value: number; tone: TrafficState }) {
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * 14);
  return (
    <g>
      {Array.from({ length: 14 }).map((_, i) => (
        <rect
          key={i}
          x={i * 5.4}
          y={0}
          width={3.6}
          height={7}
          rx={0.8}
          className={cn(
            i < filled ? STATE_FILL[tone] : "fill-muted-foreground/25",
            i < filled && tone === "burst" && "mbh-pulse",
          )}
        />
      ))}
    </g>
  );
}

export interface NetworkTopologyProps {
  hosts: HostState[];
  links: LinkState[];
  running: boolean;
  selectedNodeId: string | null;
  selectedLinkId: string | null;
  onSelectNode: (id: string) => void;
  onSelectLink: (id: string) => void;
}

export function NetworkTopology({
  hosts,
  links,
  running,
  selectedNodeId,
  selectedLinkId,
  onSelectNode,
  onSelectLink,
}: NetworkTopologyProps) {
  const sources = hosts.filter((h) => h.role === "source");
  const agg = hosts.find((h) => h.role === "switch") ?? null;
  const dest = hosts.find((h) => h.role === "receiver") ?? null;
  const monitor = hosts.find((h) => h.role === "controller") ?? null;
  const nodeById = new Map(hosts.map((h) => [h.id, h]));

  const sourceY = new Map(sources.map((h, i) => [h.id, PORT_TOP + i * PORT_GAP + PORT_H / 2]));
  const ingressY = sources.map((_, i) =>
    sources.length > 1
      ? SW.y - SW.r * 0.5 + (i * (SW.r * 1.0)) / (sources.length - 1)
      : SW.y,
  );
  const ingressX = SW.x - (SW.r * Math.sqrt(3)) / 2;

  const uplink = links.find((l) => l.id === "s1-r1") ?? null;
  const control = links.find((l) => l.control) ?? null;
  const uplinkStroke = uplink ? 2 + Math.min(6, uplink.utilization * 6) : 2;
  const uplinkState: TrafficState = uplink?.state ?? "idle";
  const uplinkActive = Boolean(uplink && uplink.rateMbps > 0.5 && running);

  /* ---- selection emphasis: unrelated paths recede, never disappear ---- */
  const hasSelection = Boolean(selectedNodeId || selectedLinkId);
  const linkEmphasis = (link: LinkState) => {
    if (!hasSelection) return 1;
    if (selectedLinkId === link.id) return 1;
    if (selectedNodeId && (link.from === selectedNodeId || link.to === selectedNodeId)) return 1;
    return 0.22;
  };

  const burstNodeId = hosts.find((h) => h.state === "burst")?.id ?? null;

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-[oklch(0.145_0.014_262)]">
      <div className="fabric-grid-fine">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full"
          role="group"
          aria-label="Interactive data-centre fabric: sources, aggregation switch, destination and monitor"
        >
          <defs>
            <linearGradient id="fab-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--chart-5)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="fab-plate" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.24 0.02 261)" />
              <stop offset="100%" stopColor="oklch(0.19 0.016 262)" />
            </linearGradient>
          </defs>

          {/* Layer captions */}
          <text x={PORT_X - PORT_W / 2} y={30} className="label-caps fill-muted-foreground/50 text-[10px]">
            source bank
          </text>
          <text
            x={SW.x}
            y={SW.y - SW.r - 26}
            textAnchor="middle"
            className="label-caps fill-muted-foreground/50 text-[10px]"
          >
            aggregation layer
          </text>
          <text
            x={RX.x}
            y={RX.y - RX.h / 2 - 22}
            textAnchor="middle"
            className="label-caps fill-muted-foreground/50 text-[10px]"
          >
            destination
          </text>

          {/* ---------------------------- traffic paths ---------------------------- */}
          {sources.map((host, i) => {
            const link = links.find((l) => l.from === host.id);
            if (!link) return null;
            const y1 = sourceY.get(host.id)!;
            const y2 = ingressY[i];
            const d = fanPath(PORT_X + PORT_W / 2, y1, ingressX, y2);
            const state = link.state;
            const flowing = host.rateMbps > 0.5 && running;
            const weight = 1.4 + Math.min(4.6, host.rateMbps / 42);
            const selected = selectedLinkId === link.id;
            return (
              <g key={`flow-${host.id}`} opacity={linkEmphasis(link)}>
                {/* conduit (always present, hairline) */}
                <path
                  d={d}
                  fill="none"
                  strokeWidth={selected ? 2.4 : 1}
                  className={cn(
                    "transition-colors",
                    selected ? "stroke-primary/60" : "stroke-border/70",
                  )}
                />
                {/* live flow */}
                {(flowing || selected) && (
                  <path
                    d={d}
                    fill="none"
                    strokeWidth={weight}
                    strokeLinecap="round"
                    className={cn(
                      "transition-[stroke-width]",
                      STATE_FLOW[state],
                      flowing && "mbh-flow",
                    )}
                    style={{
                      strokeDasharray: flowing ? undefined : "3 5",
                      transitionDuration: "var(--dur-base)",
                    }}
                  />
                )}
                {/* hit target */}
                <path
                  d={d}
                  fill="none"
                  strokeWidth={16}
                  className="cursor-pointer stroke-transparent"
                  role="button"
                  tabIndex={0}
                  aria-label={`Link ${host.name} to aggregation switch, ${formatMbpsValue(host.rateMbps)} Mbps, ${state}`}
                  onClick={() => onSelectLink(link.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectLink(link.id);
                    }
                  }}
                />
                {selected && (
                  <g transform={`translate(${(PORT_X + PORT_W / 2 + ingressX) / 2 - 46}, ${(y1 + y2) / 2 - 26})`}>
                    <rect
                      width={132}
                      height={40}
                      rx={3}
                      className="fill-surface stroke-primary/60"
                      strokeWidth={1}
                    />
                    <text x={8} y={15} className="fill-muted-foreground text-[9px]">
                      {host.name} → S1
                    </text>
                    <text x={8} y={30} className="fill-foreground data-mono text-[11px]">
                      {formatMbpsValue(host.rateMbps)} Mbps ·{" "}
                      {formatPercent(Math.min(150, (host.rateMbps / Math.max(1, link.capacityMbps)) * 100), 0)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* ------------------------------- uplink ------------------------------- */}
          {uplink && (
            <g opacity={linkEmphasis(uplink)}>
              <path
                d={`M ${SW.x + (SW.r * Math.sqrt(3)) / 2} ${SW.y} L ${RX.x - RX.w / 2} ${RX.y}`}
                fill="none"
                strokeWidth={10}
                className="stroke-border/70"
              />
              <path
                d={`M ${SW.x + (SW.r * Math.sqrt(3)) / 2} ${SW.y} L ${RX.x - RX.w / 2} ${RX.y}`}
                fill="none"
                strokeWidth={uplinkStroke}
                strokeLinecap="round"
                className={cn(
                  STATE_FLOW[uplinkState],
                  uplinkActive && "mbh-flow",
                  selectedLinkId === uplink.id && "stroke-primary",
                )}
                style={{ transitionDuration: "var(--dur-base)" }}
              />
              <path
                d={`M ${SW.x + (SW.r * Math.sqrt(3)) / 2} ${SW.y} L ${RX.x - RX.w / 2} ${RX.y}`}
                fill="none"
                strokeWidth={18}
                className="cursor-pointer stroke-transparent"
                role="button"
                tabIndex={0}
                aria-label={`Uplink switch to destination, ${formatMbpsValue(uplink.rateMbps)} Mbps, ${formatPercent(uplink.utilization * 100, 0)} utilisation`}
                onClick={() => onSelectLink(uplink.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectLink(uplink.id);
                  }
                }}
              />
              <g transform={`translate(${(SW.x + RX.x) / 2 - 54}, ${SW.y - 46})`}>
                <text textAnchor="middle" x={54} y={0} className="fill-muted-foreground text-[9px]">
                  {formatPercent(uplink.utilization * 100, 0)} of{" "}
                  {uplink.capacityMbps} Mbps
                </text>
              </g>
            </g>
          )}

          {/* ------------------------------ control path -------------------------- */}
          {control && monitor && (
            <g>
              <path
                d={`M ${SW.x} ${SW.y + SW.r} L ${MON.x} ${MON.y - MON.h / 2}`}
                fill="none"
                strokeWidth={1}
                strokeDasharray="4 5"
                className={running ? "stroke-primary/50" : "stroke-border"}
              />
              {running && (
                <circle r={2.4} className="fill-primary/80">
                  <animateMotion
                    dur="2.6s"
                    repeatCount="indefinite"
                    path={`M ${SW.x} ${SW.y + SW.r} L ${MON.x} ${MON.y - MON.h / 2}`}
                  />
                </circle>
              )}
            </g>
          )}

          {/* ------------------------------- source ports ------------------------- */}
          {sources.map((host, i) => {
            const y = sourceY.get(host.id)!;
            const selected = selectedNodeId === host.id;
            const x = PORT_X - PORT_W / 2;
            const top = y - PORT_H / 2;
            const dim = hasSelection && !selected && host.state !== "burst";
            // A burst that the policy has already capped still reports a
            // non-zero contribution for the open burst window, so the port can
            // honestly show "bursting + capped" instead of hiding the burst.
            const inBurst = host.state === "burst" || host.contributionPct > 0;
            return (
              <g
                key={host.id}
                transform={`translate(${x}, ${top})`}
                opacity={dim ? 0.45 : 1}
                className="cursor-pointer transition-opacity"
                role="button"
                tabIndex={0}
                aria-label={`${host.name}, ${host.ip}, ${formatMbpsValue(host.rateMbps)} Mbps, ${host.state}`}
                onClick={() => onSelectNode(host.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectNode(host.id);
                  }
                }}
              >
                {inBurst && (
                  <rect
                    x={-5}
                    y={-5}
                    width={PORT_W + 10}
                    height={PORT_H + 10}
                    rx={6}
                    className="mbh-ring fill-none stroke-burst"
                    strokeWidth={1.2}
                  />
                )}
                <rect
                  width={PORT_W}
                  height={PORT_H}
                  rx={4}
                  className={cn(
                    "transition-colors",
                    selected ? "fill-surface-2 stroke-primary" : "fill-surface stroke-border",
                  )}
                  strokeWidth={selected ? 1.6 : 1}
                />
                {/* state bar on the leading edge — the panel's "LED" */}
                <rect x={0} y={0} width={3} height={PORT_H} rx={1.5} className={STATE_FILL[host.state]} />
                <text x={14} y={20} className="fill-foreground text-[13px] font-semibold">
                  {host.name}
                </text>
                <text x={14} y={34} className="data-mono fill-muted-foreground text-[10px]">
                  {host.ip}
                </text>
                <text
                  x={PORT_W - 12}
                  y={20}
                  textAnchor="end"
                  className={cn("data-mono text-[12px]", STATE_TEXT[host.state])}
                >
                  {running ? `${formatMbpsValue(host.rateMbps)} Mbps` : "—"}
                </text>
                <text
                  x={PORT_W - 12}
                  y={34}
                  textAnchor="end"
                  className="data-mono fill-muted-foreground/70 text-[9.5px]"
                >
                  {host.rateCapMbps !== null
                    ? `cap ${host.rateCapMbps.toFixed(0)} Mbps`
                    : host.transmits
                      ? running
                        ? `${formatPercent(host.contributionPct, 1)} of burst`
                        : "awaiting sample"
                      : host.label}
                </text>
                <g transform={`translate(14, ${PORT_H - 20})`}>
                  <ContributionMeter value={host.contributionPct} tone={host.state} />
                </g>
                <text
                  x={PORT_W - 12}
                  y={PORT_H - 13}
                  textAnchor="end"
                  className={cn(
                    "label-caps text-[8px]",
                    inBurst ? "text-burst" : STATE_TEXT[host.state],
                  )}
                >
                  {host.state === "burst"
                    ? "bursting"
                    : host.state === "mitigated"
                      ? inBurst
                        ? "bursting · capped"
                        : "rate limited"
                      : host.state === "normal"
                        ? "normal"
                        : "no signal"}
                </text>
                <circle cx={PORT_W + 4} cy={PORT_H / 2} r={2.4} className={STATE_FILL[host.state]} />
              </g>
            );
          })}

          {/* -------------------------------- switch ------------------------------ */}
          {agg && (
            <g
              transform={`translate(${SW.x}, ${SW.y})`}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`${agg.name}, ${agg.label}, ${agg.ip}`}
              onClick={() => onSelectNode(agg.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectNode(agg.id);
                }
              }}
            >
              <polygon
                points={hexPoints(0, 0, SW.r + 7)}
                className="fill-none stroke-border/60"
                strokeWidth={1}
              />
              <polygon
                points={hexPoints(0, 0, SW.r)}
                className={cn(
                  selectedNodeId === agg.id ? "fill-surface-2 stroke-primary" : "fill-surface stroke-border",
                )}
                strokeWidth={selectedNodeId === agg.id ? 1.8 : 1.2}
              />
              <polygon
                points={hexPoints(0, 0, SW.r - 14)}
                className="fill-none stroke-border/70"
                strokeWidth={1}
              />
              <text y={-8} textAnchor="middle" className="fill-foreground text-[15px] font-semibold">
                {agg.name}
              </text>
              <text y={8} textAnchor="middle" className="label-caps fill-muted-foreground text-[8px]">
                aggregation
              </text>
              <text y={24} textAnchor="middle" className="data-mono fill-muted-foreground text-[9.5px]">
                {agg.ip}
              </text>
              {/* ingress port ticks */}
              {sources.map((s, i) => (
                <rect
                  key={s.id}
                  x={-SW.r + 22}
                  y={ingressY[i] - SW.y - 3}
                  width={7}
                  height={6}
                  rx={1}
                  className={STATE_FILL[s.state === "idle" ? "idle" : s.state]}
                />
              ))}
            </g>
          )}

          {/* ------------------------------- destination --------------------------- */}
          {dest && (
            <g
              transform={`translate(${RX.x - RX.w / 2}, ${RX.y - RX.h / 2})`}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`${dest.name}, ${dest.label}, ${dest.ip}`}
              onClick={() => onSelectNode(dest.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectNode(dest.id);
                }
              }}
            >
              <rect
                width={RX.w}
                height={RX.h}
                rx={4}
                fill="url(#fab-plate)"
                className={cn(
                  selectedNodeId === dest.id ? "stroke-primary" : "stroke-border",
                )}
                strokeWidth={selectedNodeId === dest.id ? 1.8 : 1.2}
              />
              <rect x={0} y={0} width={RX.w} height={22} rx={4} className="fill-surface-2" />
              <text x={10} y={15} className="label-caps fill-muted-foreground text-[8px]">
                termination
              </text>
              <text x={10} y={46} className="fill-foreground text-[15px] font-semibold">
                {dest.name}
              </text>
              <text x={10} y={62} className="data-mono fill-muted-foreground text-[10px]">
                {dest.ip}
              </text>
              {/* utilisation bar */}
              <rect x={10} y={74} width={RX.w - 20} height={5} rx={2.5} className="fill-muted/70" />
              {uplink && (
                <rect
                  x={10}
                  y={74}
                  width={Math.max(2, Math.min(RX.w - 20, (RX.w - 20) * Math.min(1.5, uplink.utilization)))}
                  height={5}
                  rx={2.5}
                  className={cn(STATE_FILL[uplinkState === "idle" ? "idle" : uplinkState])}
                />
              )}
              <text x={10} y={92} className="data-mono fill-muted-foreground text-[9.5px]">
                {running && uplink ? `${formatMbpsValue(uplink.rateMbps)} Mbps in` : "no samples"}
              </text>
            </g>
          )}

          {/* -------------------------------- monitor ----------------------------- */}
          {monitor && (
            <g
              transform={`translate(${MON.x - MON.w / 2}, ${MON.y - MON.h / 2})`}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`${monitor.name}, ${monitor.label}`}
              onClick={() => onSelectNode(monitor.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectNode(monitor.id);
                }
              }}
            >
              <rect
                width={MON.w}
                height={MON.h}
                rx={4}
                className={cn(
                  "fill-surface",
                  selectedNodeId === monitor.id ? "stroke-primary" : "stroke-border",
                )}
                strokeWidth={selectedNodeId === monitor.id ? 1.8 : 1.2}
              />
              <text x={10} y={20} className="fill-foreground text-[11px] font-semibold">
                {monitor.name}
              </text>
              <text x={10} y={34} className="label-caps fill-muted-foreground text-[7.5px]">
                detector · policy
              </text>
              <text
                x={10}
                y={48}
                className={cn("data-mono text-[9.5px]", running ? "fill-success" : "fill-muted-foreground")}
              >
                {running ? "SAMPLING" : "STANDBY"}
              </text>
              {running && (
                <rect
                  x={MON.w - 26}
                  y={12}
                  width={16}
                  height={3}
                  rx={1.5}
                  className="fill-primary/70 mbh-signal"
                />
              )}
            </g>
          )}

          {/* active burst marker on the affected port */}
          {burstNodeId && sourceY.has(burstNodeId) && (
            <circle
              cx={PORT_X + PORT_W / 2 + 16}
              cy={sourceY.get(burstNodeId)!}
              r={3}
              className="fill-burst mbh-pulse"
            />
          )}
        </svg>
      </div>

      <Legend />
    </div>
  );
}

function Legend() {
  const items: { label: string; dot: string; desc: string }[] = [
    { label: "No signal", dot: "bg-muted-foreground/50", desc: "halted or no sample above 0.5 Mbps" },
    { label: "Normal", dot: "bg-primary", desc: "below the adaptive threshold" },
    { label: "Burst", dot: "bg-burst", desc: "rate above threshold — detector reported it" },
    { label: "Rate limited", dot: "bg-warning", desc: "cap enforced in the traffic model" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border bg-surface/60 px-4 py-2.5">
      <span className="label-caps text-muted-foreground/60">legend</span>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", item.dot)} />
          <span className="font-medium text-foreground/85">{item.label}</span>
          <span className="hidden lg:inline">— {item.desc}</span>
        </span>
      ))}
      <span className="ml-auto text-[10.5px] text-muted-foreground/70">
        select a port or path to inspect it
      </span>
    </div>
  );
}
