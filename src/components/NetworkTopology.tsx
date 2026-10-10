import { cn } from "@/lib/utils";
import { formatMbpsValue, formatPercent } from "@/lib/format";
import type { HostState, LinkState, TrafficState } from "@/types";

const VIEW_WIDTH = 900;
const VIEW_HEIGHT = 520;
const BOX_W = 140;
const BOX_H = 66;
const HALF_DIAG = 76;

const stateStroke: Record<TrafficState, string> = {
  idle: "stroke-border",
  normal: "stroke-info/60",
  burst: "stroke-burst",
  mitigated: "stroke-warning",
};

const stateDot: Record<TrafficState, string> = {
  idle: "fill-muted-foreground",
  normal: "fill-success",
  burst: "fill-burst",
  mitigated: "fill-warning",
};

const stateText: Record<TrafficState, string> = {
  idle: "text-muted-foreground",
  normal: "text-success",
  burst: "text-burst",
  mitigated: "text-warning",
};

function anchorPoints(from: HostState, to: HostState) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const startPad = HALF_DIAG;
  const endPad = HALF_DIAG;
  return {
    x1: from.x + ux * startPad,
    y1: from.y + uy * startPad,
    x2: to.x - ux * endPad,
    y2: to.y - uy * endPad,
    ux,
    uy,
  };
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
  const nodeById = new Map(hosts.map((h) => [h.id, h]));

  return (
    <div className="noc-grid overflow-hidden rounded-lg border border-border bg-[oklch(0.14_0.02_255)]">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Interactive network topology"
      >
        {/* Links */}
        {links.map((link) => {
          const from = nodeById.get(link.from);
          const to = nodeById.get(link.to);
          if (!from || !to) return null;
          const p = anchorPoints(from, to);
          const selected = selectedLinkId === link.id;
          const d = `M ${p.x1} ${p.y1} L ${p.x2} ${p.y2}`;
          const active = link.rateMbps > 0.5 && running;
          return (
            <g key={link.id}>
              {selected && (
                <path
                  d={d}
                  className="stroke-primary/40"
                  strokeWidth={7}
                  fill="none"
                  strokeLinecap="round"
                />
              )}
              <path
                d={d}
                fill="none"
                strokeWidth={link.control ? 1.4 : selected ? 3 : 2.2}
                strokeLinecap="round"
                strokeDasharray={link.control ? "5 6" : undefined}
                className={cn(
                  "cursor-pointer transition-colors",
                  link.control
                    ? running
                      ? "stroke-info/50 mbh-flow"
                      : "stroke-border"
                    : stateStroke[link.state],
                )}
                onClick={() => onSelectLink(link.id)}
              />
              {/* Direction arrow */}
              {!link.control && (
                <polygon
                  points="-6,-4 6,0 -6,4"
                  className={cn(stateDot[link.state], "pointer-events-none")}
                  transform={`translate(${p.x2}, ${p.y2}) rotate(${(Math.atan2(p.uy, p.ux) * 180) / Math.PI})`}
                />
              )}
              {/* Moving particles only while monitoring produces traffic */}
              {active && !link.control && (
                <circle r={2.6} className={cn(stateDot[link.state], "pointer-events-none")}>
                  <animateMotion
                    dur={link.state === "burst" ? "0.7s" : "1.5s"}
                    repeatCount="indefinite"
                    path={d}
                  />
                </circle>
              )}
              {link.control && running && (
                <circle r={2.2} className="fill-info/70 pointer-events-none">
                  <animateMotion dur="2.4s" repeatCount="indefinite" path={d} />
                </circle>
              )}
              {/* Link utilization label on the uplink */}
              {link.id === "s1-r1" && (
                <text
                  x={(p.x1 + p.x2) / 2}
                  y={(p.y1 + p.y2) / 2 - 12}
                  textAnchor="middle"
                  className="pointer-events-none fill-muted-foreground text-[11px]"
                >
                  {formatMbpsValue(link.rateMbps)} Mbps · {formatPercent(link.utilization * 100, 0)} util
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {hosts.map((node) => {
          const selected = selectedNodeId === node.id;
          return (
            <g
              key={node.id}
              onClick={() => onSelectNode(node.id)}
              className="cursor-pointer"
              role="button"
              aria-label={`${node.name} ${node.ip}`}
            >
              {selected && (
                <rect
                  x={node.x - BOX_W / 2 - 4}
                  y={node.y - BOX_H / 2 - 4}
                  width={BOX_W + 8}
                  height={BOX_H + 8}
                  rx={13}
                  className="fill-primary/10 stroke-primary/60"
                  strokeWidth={1.5}
                />
              )}
              <rect
                x={node.x - BOX_W / 2}
                y={node.y - BOX_H / 2}
                width={BOX_W}
                height={BOX_H}
                rx={11}
                strokeWidth={node.state === "idle" ? 1.2 : 1.8}
                className={cn(
                  "fill-card transition-colors",
                  stateStroke[node.state],
                )}
              />
              <circle
                cx={node.x - BOX_W / 2 + 14}
                cy={node.y - BOX_H / 2 + 14}
                r={4}
                className={cn(stateDot[node.state], node.state === "burst" && "mbh-pulse")}
              />
              <text
                x={node.x - BOX_W / 2 + 26}
                y={node.y - BOX_H / 2 + 18}
                className="fill-foreground text-[13px] font-semibold"
              >
                {node.name}
              </text>
              <text
                x={node.x}
                y={node.y + 2}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
                style={{ fontFamily: "ui-monospace, monospace" }}
              >
                {node.ip}
              </text>
              <text
                x={node.x}
                y={node.y + 20}
                textAnchor="middle"
                className={cn("text-[11px] font-medium", stateText[node.state])}
              >
                {node.transmits
                  ? `${formatMbpsValue(node.rateMbps)} Mbps`
                  : node.role === "controller"
                    ? running
                      ? "Monitoring"
                      : "Standby"
                    : node.role === "switch"
                      ? "Aggregation"
                      : "Receiver"}
              </text>
              {node.rateCapMbps !== null && (
                <text
                  x={node.x}
                  y={node.y + 32 - 6}
                  textAnchor="middle"
                  className="fill-warning text-[9px]"
                >
                  cap {node.rateCapMbps.toFixed(0)} Mbps
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <Legend />
    </div>
  );
}

function Legend() {
  const items: { label: string; dot: string; desc: string }[] = [
    { label: "Idle", dot: "bg-muted-foreground", desc: "No traffic / monitoring stopped" },
    { label: "Normal", dot: "bg-success", desc: "Traffic below the burst threshold" },
    { label: "Burst", dot: "bg-burst", desc: "Rate above the adaptive threshold" },
    { label: "Mitigated", dot: "bg-warning", desc: "Rate cap enforced on the flow" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Legend
      </span>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className={cn("size-2 rounded-full", item.dot)} />
          <span className="font-medium text-foreground/90">{item.label}</span>
          <span>— {item.desc}</span>
        </span>
      ))}
    </div>
  );
}
