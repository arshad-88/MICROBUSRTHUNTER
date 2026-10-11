import { cn } from "@/lib/utils";
import { toneText, type Tone } from "@/components/kit";
import type { LucideIcon } from "lucide-react";

const TONE_MAP: Record<string, Tone> = {
  default: "neutral",
  success: "recovered",
  warning: "mitigated",
  burst: "burst",
  info: "live",
  mitigated: "mitigated",
};

/**
 * Compact instrument tile. Deliberately small: the console shows many readouts
 * and an oversized empty card wastes the vertical space the charts need.
 */
export function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: LucideIcon;
  hint?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "burst" | "info" | "mitigated";
  className?: string;
}) {
  const t = TONE_MAP[tone] ?? "neutral";

  return (
    <div
      className={cn(
        "panel-edge group relative rounded-md border border-border bg-surface px-3.5 py-3",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps truncate text-muted-foreground">{label}</span>
        {Icon && (
          <Icon className={cn("size-3.5 shrink-0", toneText[t])} aria-hidden="true" />
        )}
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className={cn("readout text-[21px] font-semibold", toneText[t])}>
          {value}
        </span>
        {unit && (
          <span className="data-mono text-[10.5px] text-muted-foreground">{unit}</span>
        )}
      </div>
      {hint && (
        <div className="mt-2 line-clamp-2 border-t border-border/70 pt-2 text-[10.5px] leading-4 text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}
