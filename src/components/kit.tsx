/**
 * MicroburstHunter design-system kit.
 *
 * The shared primitives every screen is built from: matte panels separated by
 * hairline rules, instrument readouts, meters, state indicators and sparklines.
 * Keeping them in one place is what makes the console read as a single
 * instrument rather than a collection of unrelated cards.
 */
import { cn } from "@/lib/utils";
import type { EventSeverity, TrafficState } from "@/types";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ tones */

export type Tone =
  | "neutral"
  | "live"
  | "burst"
  | "mitigated"
  | "recovered"
  | "analysis";

export const toneText: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  live: "text-primary",
  burst: "text-burst",
  mitigated: "text-warning",
  recovered: "text-success",
  analysis: "text-violet",
};

export const toneFill: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  live: "bg-primary",
  burst: "bg-burst",
  mitigated: "bg-warning",
  recovered: "bg-success",
  analysis: "bg-violet",
};

export const toneStroke: Record<Tone, string> = {
  neutral: "stroke-muted-foreground",
  live: "stroke-primary",
  burst: "stroke-burst",
  mitigated: "stroke-warning",
  recovered: "stroke-success",
  analysis: "stroke-violet",
};

export function trafficTone(state: TrafficState): Tone {
  switch (state) {
    case "burst":
      return "burst";
    case "mitigated":
      return "mitigated";
    case "normal":
      return "live";
    default:
      return "neutral";
  }
}

/** Severity of a logged event mapped onto the same signal palette. */
export function eventTone(severity: EventSeverity): Tone {
  switch (severity) {
    case "critical":
      return "burst";
    case "warning":
      return "mitigated";
    case "success":
      return "recovered";
    default:
      return "neutral";
  }
}

/* ----------------------------------------------------------------- panels */

export function Panel({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
}) {
  return (
    <Tag
      className={cn(
        "panel-edge relative rounded-md border border-border bg-surface",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * Panel header: an editorial eyebrow (optional index number), a title, an
 * optional one-line note and right-aligned controls. The short accent bar is
 * the repeated "signal rule" motif of the interface.
 */
export function PanelHeader({
  title,
  index,
  note,
  actions,
  icon: Icon,
  className,
}: {
  title: string;
  index?: string;
  note?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 h-7 w-[3px] shrink-0 rounded-full bg-primary/70" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {index && (
              <span className="data-mono text-[10px] text-primary/80">
                {index}
              </span>
            )}
            <h2 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
          </div>
          {note && (
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {note}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/* ------------------------------------------------------------- readouts */

export function Stat({
  label,
  value,
  unit,
  tone = "neutral",
  hint,
  icon: Icon,
  size = "md",
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  hint?: ReactNode;
  icon?: LucideIcon;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const valueSize =
    size === "lg"
      ? "text-[30px]"
      : size === "sm"
        ? "text-[17px]"
        : "text-[23px]";
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-2 px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground truncate">
          {label}
        </span>
        {Icon && <Icon className={cn("size-3.5 shrink-0", toneText[tone])} />}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn("readout font-semibold", valueSize, toneText[tone])}
        >
          {value}
        </span>
        {unit && (
          <span className="data-mono text-[11px] text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <div className="text-[11px] leading-4 text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- meters */

export function Meter({
  value,
  max = 100,
  tone = "live",
  className,
  ariaLabel,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  className?: string;
  ariaLabel?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn("h-1 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", toneFill[tone])}
        style={{ width: `${pct}%`, transitionDuration: "var(--dur-base)" }}
      />
    </div>
  );
}

/** Segmented bar used for burst contribution — precise, not decorative. */
export function SegmentBar({
  value,
  segments = 20,
  tone = "live",
  className,
}: {
  value: number;
  segments?: number;
  tone?: Tone;
  className?: string;
}) {
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * segments);
  return (
    <div
      className={cn("flex items-center gap-[3px]", className)}
      aria-hidden="true"
    >
      {Array.from({ length: segments }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-2.5 w-[3px] rounded-[1px]",
            i < filled ? toneFill[tone] : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- indicators */

export function StateDot({
  state,
  pulse = false,
  className,
}: {
  state: TrafficState | Tone;
  pulse?: boolean;
  className?: string;
}) {
  const tone =
    state === "idle" || state === "normal" || state === "burst" || state === "mitigated"
      ? trafficTone(state)
      : (state as Tone);
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        toneFill[tone],
        pulse && "mbh-pulse",
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------ sparkline */

export function Sparkline({
  values,
  tone = "live",
  height = 38,
  className,
  ariaLabel,
}: {
  values: number[];
  tone?: Tone;
  height?: number;
  className?: string;
  ariaLabel?: string;
}) {
  if (values.length < 2) {
    return (
      <div
        className={cn(
          "flex items-center justify-center border border-dashed border-border/70 text-[10px] text-muted-foreground",
          className,
        )}
        style={{ height }}
      >
        awaiting samples
      </div>
    );
  }
  const width = 240;
  const max = Math.max(...values, 0.001);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - (v / max) * (height - 4) - 2]);
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const gradientId = `spark-${tone}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={`var(--${tone === "live" ? "primary" : tone === "burst" ? "burst" : tone === "mitigated" ? "warning" : tone === "recovered" ? "success" : tone === "analysis" ? "violet" : "muted-foreground"})`}
            stopOpacity="0.28"
          />
          <stop
            offset="100%"
            stopColor={`var(--${tone === "live" ? "primary" : tone === "burst" ? "burst" : tone === "mitigated" ? "warning" : tone === "recovered" ? "success" : tone === "analysis" ? "violet" : "muted-foreground"})`}
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={line}
        fill="none"
        strokeWidth={1.4}
        className={cn(toneStroke[tone])}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ------------------------------------------------------------ key/value */

export function KeyValue({
  label,
  children,
  className,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 py-1.5",
        className,
      )}
    >
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 text-right text-[12px] font-medium text-foreground",
          mono && "data-mono",
        )}
      >
        {children}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- states */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="flex size-9 items-center justify-center rounded-sm border border-border bg-surface-2">
          <Icon className="size-4 text-muted-foreground" />
        </span>
      )}
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-[11px] leading-4 text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

/** Small monospace tag used for units, identifiers and honesty notes. */
export function Tag({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const bg: Record<Tone, string> = {
    neutral: "border-border bg-surface-2 text-muted-foreground",
    live: "border-primary/35 bg-primary/10 text-primary",
    burst: "border-burst/40 bg-burst/10 text-burst",
    mitigated: "border-warning/40 bg-warning/10 text-warning",
    recovered: "border-success/35 bg-success/10 text-success",
    analysis: "border-violet/35 bg-violet/10 text-violet",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium tracking-wide",
        bg[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Explanation strip used to keep simulated vs measured unambiguous. */
export function Note({
  children,
  className,
  icon: Icon,
}: {
  children: ReactNode;
  className?: string;
  icon?: LucideIcon;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 border-t border-border px-4 py-2.5 text-[11px] leading-4 text-muted-foreground",
        className,
      )}
    >
      {Icon && <Icon className="mt-px size-3 shrink-0 text-muted-foreground/70" />}
      <span>{children}</span>
    </p>
  );
}
