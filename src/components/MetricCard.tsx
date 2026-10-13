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
        "group relative rounded-2xl border border-white/10 bg-[#0c0d15] p-4 transition-all duration-300 hover:border-violet-500/35 hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.6),0_0_20px_-4px_rgba(141,84,255,0.2)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-400 truncate tracking-wide">{label}</span>
        {Icon && (
          <span className="flex size-6 items-center justify-center rounded-lg border border-white/10 bg-white/5">
            <Icon className={cn("size-3.5 shrink-0", toneText[t])} aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className={cn("readout text-[22px] font-bold tracking-tight text-white", toneText[t])}>
          {value}
        </span>
        {unit && (
          <span className="data-mono text-[11px] text-slate-400 font-medium">{unit}</span>
        )}
      </div>
      {hint && (
        <div className="mt-2.5 line-clamp-2 border-t border-white/5 pt-2 text-[11px] leading-4 text-slate-400">
          {hint}
        </div>
      )}
    </div>
  );
}
