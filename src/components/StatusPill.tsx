import { cn } from "@/lib/utils";
import type { EventSeverity } from "@/types";
import type { TrafficState } from "@/types";

type Tone =
  | "idle"
  | "normal"
  | "burst"
  | "mitigated"
  | "info"
  | "success"
  | "warning"
  | "critical";

/**
 * Restrained status indicator: hairline border, one state dot, monospace-ish
 * caps label. No glow — colour alone carries the state.
 */
const TONES: Record<Tone, { dot: string; text: string; bg: string; border: string }> = {
  idle: {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    bg: "bg-surface-2",
    border: "border-border",
  },
  normal: {
    dot: "bg-primary",
    text: "text-primary",
    bg: "bg-primary/[0.07]",
    border: "border-primary/30",
  },
  burst: {
    dot: "bg-burst",
    text: "text-burst",
    bg: "bg-burst/[0.08]",
    border: "border-burst/40",
  },
  mitigated: {
    dot: "bg-warning",
    text: "text-warning",
    bg: "bg-warning/[0.08]",
    border: "border-warning/40",
  },
  info: {
    dot: "bg-primary",
    text: "text-primary",
    bg: "bg-primary/[0.07]",
    border: "border-primary/30",
  },
  success: {
    dot: "bg-success",
    text: "text-success",
    bg: "bg-success/[0.08]",
    border: "border-success/35",
  },
  warning: {
    dot: "bg-warning",
    text: "text-warning",
    bg: "bg-warning/[0.08]",
    border: "border-warning/40",
  },
  critical: {
    dot: "bg-burst",
    text: "text-burst",
    bg: "bg-burst/[0.08]",
    border: "border-burst/40",
  },
};

export function StatusPill({
  tone,
  children,
  className,
  pulse = false,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  pulse?: boolean;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-[3px] text-[10px] font-medium tracking-wide whitespace-nowrap",
        t.bg,
        t.text,
        t.border,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", t.dot, pulse && "mbh-pulse")} />
      {children}
    </span>
  );
}

export function trafficStateTone(state: TrafficState): Tone {
  switch (state) {
    case "burst":
      return "burst";
    case "mitigated":
      return "mitigated";
    case "normal":
      return "normal";
    default:
      return "idle";
  }
}

export function trafficStateLabel(state: TrafficState): string {
  switch (state) {
    case "burst":
      return "Burst";
    case "mitigated":
      return "Rate limited";
    case "normal":
      return "Normal";
    default:
      return "Idle";
  }
}

export function severityTone(severity: EventSeverity): Tone {
  return severity;
}
