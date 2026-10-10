import type { BurstInterval } from "@/simulation";
import type { TrafficSample } from "@/types";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Point {
  t: number;
  seconds: number;
  rate: number;
  baseline: number;
  threshold: number;
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as Point;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-none">
      <p className="mb-1 font-mono text-[11px] text-muted-foreground">
        t = {point.seconds.toFixed(2)} s
      </p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="font-medium tabular-nums">
            {Number(entry.value).toFixed(2)} Mbps
          </span>
        </p>
      ))}
    </div>
  );
}

export function TrafficChart({
  history,
  intervals,
  height = 320,
}: {
  history: TrafficSample[];
  intervals: BurstInterval[];
  height?: number;
}) {
  const points: Point[] = history.map((s) => ({
    t: s.t,
    seconds: s.t / 1000,
    rate: s.rateMbps,
    baseline: s.baselineMbps,
    threshold: s.thresholdMbps,
  }));

  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground"
        style={{ height }}
      >
        Start monitoring to plot traffic rate, baseline and threshold.
      </div>
    );
  }

  const lastT = points[points.length - 1].t;
  const maxRate = Math.max(...points.map((p) => Math.max(p.rate, p.threshold, p.baseline)));
  const yMax = Math.max(20, Math.ceil((maxRate * 1.15) / 20) * 20);
  const threshold = points[points.length - 1].threshold;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => `${(Number(v) / 1000).toFixed(1)}s`}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            stroke="var(--color-border)"
            minTickGap={40}
          />
          <YAxis
            domain={[0, yMax]}
            tickFormatter={(v) => `${v}`}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            stroke="var(--color-border)"
            width={48}
            label={{
              value: "Mbps",
              angle: -90,
              position: "insideLeft",
              fill: "var(--color-muted-foreground)",
              fontSize: 11,
            }}
          />
          <Tooltip content={<ChartTooltip />} />

          {intervals.map((interval, i) => (
            <ReferenceArea
              key={`burst-${i}`}
              x1={interval.start}
              x2={interval.end ?? lastT}
              fill="var(--color-burst)"
              fillOpacity={0.16}
              stroke="var(--color-burst)"
              strokeOpacity={0.5}
            />
          ))}

          <ReferenceLine
            y={threshold}
            stroke="var(--color-warning)"
            strokeDasharray="6 4"
            label={{
              value: `threshold ${threshold.toFixed(0)} Mbps`,
              position: "insideTopRight",
              fill: "var(--color-warning)",
              fontSize: 11,
            }}
          />

          <Area
            type="monotone"
            dataKey="rate"
            name="Traffic rate"
            stroke="var(--color-primary)"
            strokeWidth={1.8}
            fill="url(#rateFill)"
            isAnimationActive={false}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="baseline"
            name="Rolling baseline"
            stroke="var(--color-chart-2)"
            strokeWidth={1.4}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartLegend() {
  const items = [
    { label: "Traffic rate (Mbps)", color: "var(--color-primary)" },
    { label: "Rolling baseline (Mbps)", color: "var(--color-chart-2)" },
    { label: "Burst threshold (Mbps)", color: "var(--color-warning)" },
    { label: "Detected burst interval", color: "var(--color-burst)" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="size-2.5 rounded-sm" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
