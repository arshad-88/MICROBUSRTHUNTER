import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  unit?: string;
  icon: LucideIcon;
  hint?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "burst" | "info" | "mitigated";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    burst: "text-burst",
    info: "text-info",
    mitigated: "text-warning",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <Icon className={cn("size-4 shrink-0", toneClass)} />
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={cn("text-2xl font-bold tracking-tight tabular-nums", toneClass)}>
          {value}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
