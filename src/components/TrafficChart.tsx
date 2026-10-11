import type { BurstInterval } from "@/simulation";
import type { TrafficSample } from "@/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Traffic intelligence chart.
 *
 * Drawn directly as SVG rather than through a charting library so the plot can
 * carry the console's own visual language: a cyan observed-rate trace, a violet
 * rolling baseline, the amber configured threshold, and coral bands for the
 * intervals the detector actually declared. Hovering reports the real sample
 * values at that window — nothing is invented for the tooltip.
 */

const PAD = { top: 16, right: 62, bottom: 24, left: 46 };

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function niceCeil(value: number): number {
  if (value <= 0) return 20;
  const step = value > 400 ? 100 : value > 120 ? 40 : 20;
  return Math.ceil((value * 1.12) / step) * step;
}

export function TrafficChart({
  history,
  intervals,
  height = 320,
  showBaseline = true,
  className,
}: {
  history: TrafficSample[];
  intervals: BurstInterval[];
  height?: number;
  showBaseline?: boolean;
  className?: string;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const points = history;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = Math.max(0, height - PAD.top - PAD.bottom);

  const geometry = useMemo(() => {
    if (points.length < 2 || plotW <= 0) return null;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const maxValue = Math.max(
      ...points.map((p) => Math.max(p.rateMbps, p.thresholdMbps, p.baselineMbps)),
    );
    const yMax = niceCeil(maxValue);

    const x = (t: number) => PAD.left + ((t - t0) / span) * plotW;
    const y = (v: number) => PAD.top + plotH * (1 - Math.min(1, v / yMax));

    const line = (key: "rateMbps" | "baselineMbps" | "thresholdMbps") =>
      points
        .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p[key]).toFixed(1)}`)
        .join(" ");

    const rateLine = line("rateMbps");
    const area = `${rateLine} L ${x(t1).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L ${x(t0).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`;

    // Coral overlay: only the windows the detector reported inside a burst.
    const inBurst = (t: number) =>
      intervals.some((iv) => t >= iv.start && t <= (iv.end ?? t1 + 1));
    const segments: string[] = [];
    let current: TrafficSample[] = [];
    points.forEach((p, i) => {
      const inside = inBurst(p.t);
      if (inside) {
        if (current.length === 0 && i > 0) current.push(points[i - 1]);
        current.push(p);
      } else if (current.length > 0) {
        current.push(p);
        segments.push(
          current
            .map(
              (s, j) =>
                `${j === 0 ? "M" : "L"} ${x(s.t).toFixed(1)} ${y(s.rateMbps).toFixed(1)}`,
            )
            .join(" "),
        );
        current = [];
      }
    });
    if (current.length > 1) {
      segments.push(
        current
          .map(
            (s, j) =>
              `${j === 0 ? "M" : "L"} ${x(s.t).toFixed(1)} ${y(s.rateMbps).toFixed(1)}`,
          )
          .join(" "),
      );
    }

    const bands = intervals
      .map((iv) => {
        const start = Math.max(t0, iv.start);
        const end = Math.min(t1, iv.end ?? t1);
        if (end <= start) return null;
        return { x1: x(start), x2: x(end) };
      })
      .filter((b): b is { x1: number; x2: number } => b !== null);

    const timeTicks = 6;
    const ticks = Array.from({ length: timeTicks + 1 }, (_, i) => {
      const t = t0 + (span * i) / timeTicks;
      return { t, x: x(t) };
    });

    const yTicks = 4;
    const valueTicks = Array.from({ length: yTicks + 1 }, (_, i) => {
      const v = (yMax / yTicks) * i;
      return { v, y: y(v) };
    });

    return { t0, t1, span, yMax, x, y, rateLine, area, segments, bands, ticks, valueTicks };
  }, [points, plotW, plotH, intervals]);

  const thresholds = points[points.length - 1]?.thresholdMbps ?? 0;
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className={cn("relative w-full", className)} ref={ref} style={{ height }}>
      {!geometry ? (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 border border-dashed border-border/70 text-center">
          <p className="text-[12px] text-muted-foreground">
            No samples yet — start monitoring to plot observed rate.
          </p>
          <p className="text-[10.5px] text-muted-foreground/70">
            Rate, baseline and threshold all come from the same simulated windows.
          </p>
        </div>
      ) : (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Observed traffic rate, rolling baseline and burst threshold over simulation time"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const px = event.clientX - rect.left;
            const ratio = (px - PAD.left) / Math.max(1, plotW);
            const idx = Math.round(ratio * (points.length - 1));
            setHover(idx >= 0 && idx < points.length ? idx : null);
          }}
        >
          {/* value gridlines */}
          {geometry.valueTicks.map((tick) => (
            <g key={`y-${tick.v}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={tick.y}
                y2={tick.y}
                className="stroke-border/50"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={tick.y + 3}
                textAnchor="end"
                className="data-mono fill-muted-foreground/70 text-[9.5px]"
              >
                {Math.round(tick.v)}
              </text>
            </g>
          ))}
          <text
            x={PAD.left - 8}
            y={PAD.top - 6}
            textAnchor="end"
            className="label-caps fill-muted-foreground/50 text-[8px]"
          >
            Mbps
          </text>

          {/* burst bands */}
          {geometry.bands.map((band, i) => (
            <g key={`band-${i}`}>
              <rect
                x={band.x1}
                y={PAD.top}
                width={Math.max(1, band.x2 - band.x1)}
                height={plotH}
                className="fill-burst/[0.09]"
              />
              <line x1={band.x1} x2={band.x1} y1={PAD.top} y2={PAD.top + plotH} className="stroke-burst/50" strokeWidth={1} />
              {band.x2 - band.x1 > 46 && (
                <text
                  x={band.x1 + 5}
                  y={PAD.top + 11}
                  className="label-caps fill-burst/90 text-[8px]"
                >
                  burst
                </text>
              )}
            </g>
          ))}

          {/* threshold + baseline */}
          <path
            d={points
              .map(
                (p, i) =>
                  `${i === 0 ? "M" : "L"} ${geometry.x(p.t).toFixed(1)} ${geometry.y(p.thresholdMbps).toFixed(1)}`,
              )
              .join(" ")}
            fill="none"
            strokeWidth={1.2}
            strokeDasharray="5 4"
            className="stroke-warning/85"
          />
          {showBaseline && (
            <path
              d={points
                .map(
                  (p, i) =>
                    `${i === 0 ? "M" : "L"} ${geometry.x(p.t).toFixed(1)} ${geometry.y(p.baselineMbps).toFixed(1)}`,
                )
                .join(" ")}
              fill="none"
              strokeWidth={1.2}
              strokeDasharray="2 3"
              className="stroke-violet/85"
            />
          )}

          {/* observed rate */}
          <path d={geometry.area} className="fill-primary/[0.09]" />
          <path
            d={geometry.rateLine}
            fill="none"
            strokeWidth={1.6}
            strokeLinejoin="round"
            className="stroke-primary"
          />
          {geometry.segments.map((d, i) => (
            <path
              key={`seg-${i}`}
              d={d}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              className="stroke-burst"
            />
          ))}

          {/* time axis */}
          {geometry.ticks.map((tick, i) => (
            <g key={`t-${i}`}>
              <line
                x1={tick.x}
                x2={tick.x}
                y1={PAD.top + plotH}
                y2={PAD.top + plotH + 4}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={tick.x}
                y={PAD.top + plotH + 16}
                textAnchor="middle"
                className="data-mono fill-muted-foreground/70 text-[9.5px]"
              >
                {(tick.t / 1000).toFixed(1)}s
              </text>
            </g>
          ))}
          <text
            x={PAD.left + plotW}
            y={PAD.top + plotH + 16}
            textAnchor="end"
            className="label-caps fill-muted-foreground/50 text-[8px]"
          >
            sim time
          </text>

          {/* current-value markers in the right gutter */}
          {points.length > 0 && (
            <>
              <circle
                cx={geometry.x(points[points.length - 1].t)}
                cy={geometry.y(points[points.length - 1].rateMbps)}
                r={2.6}
                className="fill-primary"
              />
              <text
                x={PAD.left + plotW + 8}
                y={geometry.y(points[points.length - 1].rateMbps) + 3}
                className="data-mono fill-primary text-[10px]"
              >
                {points[points.length - 1].rateMbps.toFixed(1)}
              </text>
              <text
                x={PAD.left + plotW + 8}
                y={geometry.y(thresholds) + 3}
                className="data-mono fill-warning/90 text-[10px]"
              >
                {thresholds.toFixed(0)}
              </text>
            </>
          )}

          {/* crosshair */}
          {hovered && (
            <g>
              <line
                x1={geometry.x(hovered.t)}
                x2={geometry.x(hovered.t)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="stroke-foreground/25"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle
                cx={geometry.x(hovered.t)}
                cy={geometry.y(hovered.rateMbps)}
                r={3.2}
                className="fill-primary stroke-background"
                strokeWidth={1.5}
              />
            </g>
          )}
        </svg>
      )}

      {hovered && geometry && (
        <div
          className="panel-raised pointer-events-none absolute z-10 w-[184px] rounded-sm border border-border bg-popover px-2.5 py-2"
          style={{
            left: Math.min(
              Math.max(geometry.x(hovered.t) - 92, 4),
              Math.max(4, width - 190),
            ),
            top: 8,
          }}
        >
          <p className="data-mono border-b border-border pb-1.5 text-[10px] text-muted-foreground">
            t = {(hovered.t / 1000).toFixed(2)} s
          </p>
          <dl className="mt-1.5 space-y-1">
            <TipRow label="rate" value={`${hovered.rateMbps.toFixed(2)} Mbps`} tone="live" />
            <TipRow
              label="baseline"
              value={`${hovered.baselineMbps.toFixed(2)} Mbps`}
              tone="analysis"
            />
            <TipRow
              label="threshold"
              value={`${hovered.thresholdMbps.toFixed(2)} Mbps`}
              tone="mitigated"
            />
            <TipRow label="packets" value={hovered.packets.toLocaleString("en-US")} />
            <TipRow
              label="drops"
              value={
                hovered.dropBytes > 0
                  ? `${((hovered.dropBytes * 8) / 1_000_000).toFixed(3)} Mb`
                  : "none"
              }
              tone={hovered.dropBytes > 0 ? "burst" : "neutral"}
            />
          </dl>
        </div>
      )}
    </div>
  );
}

function TipRow({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "live" | "analysis" | "mitigated" | "burst";
}) {
  const toneClass = {
    neutral: "text-foreground",
    live: "text-primary",
    analysis: "text-violet",
    mitigated: "text-warning",
    burst: "text-burst",
  }[tone];
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className={cn("data-mono text-[10px]", toneClass)}>{value}</dd>
    </div>
  );
}

export function ChartLegend({
  showBaseline = true,
  className,
}: {
  showBaseline?: boolean;
  className?: string;
}) {
  const items = [
    { label: "Observed rate", swatch: "bg-primary", style: "solid" },
    ...(showBaseline
      ? [{ label: "Rolling baseline", swatch: "bg-violet", style: "dotted" }]
      : []),
    { label: "Burst threshold", swatch: "bg-warning", style: "dashed" },
    { label: "Detected burst window", swatch: "bg-burst", style: "band" },
  ];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", className)}>
      {items.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-2 text-[10.5px] text-muted-foreground"
        >
          <span
            className={cn(
              "h-[3px] w-5 rounded-full",
              item.swatch,
              item.style === "solid" && "opacity-100",
              item.style === "dashed" && "opacity-85",
              item.style === "dotted" && "opacity-85",
              item.style === "band" && "h-2.5 w-2.5 rounded-[2px] opacity-70",
            )}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
