import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, Tag, eventTone, toneFill, toneText } from "@/components/kit";
import { formatClock, formatMbpsValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_LABELS, type AppEvent, type EventSeverity, type EventType } from "@/types";
import { ScrollText } from "lucide-react";

const SEVERITIES: EventSeverity[] = ["info", "success", "warning", "critical"];

export function EventLogTable({ events }: { events: AppEvent[] }) {
  const [typeFilter, setTypeFilter] = useState<EventType | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<EventSeverity | "all">("all");

  const counts = useMemo(() => {
    const map: Record<EventSeverity, number> = {
      info: 0,
      success: 0,
      warning: 0,
      critical: 0,
    };
    for (const event of events) map[event.severity] += 1;
    return map;
  }, [events]);

  const filtered = useMemo(
    () =>
      events
        .filter((e) => (typeFilter === "all" ? true : e.type === typeFilter))
        .filter((e) => (severityFilter === "all" ? true : e.severity === severityFilter))
        .slice()
        .reverse(),
    [events, typeFilter, severityFilter],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          role="group"
          aria-label="Filter by severity"
          className="flex overflow-hidden rounded-sm border border-border"
        >
          <button
            type="button"
            aria-pressed={severityFilter === "all"}
            onClick={() => setSeverityFilter("all")}
            className={cn(
              "label-caps px-2.5 py-1.5 text-[9px] transition-colors",
              severityFilter === "all"
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:bg-surface-2/60",
            )}
          >
            all {events.length}
          </button>
          {SEVERITIES.map((severity) => (
            <button
              key={severity}
              type="button"
              aria-pressed={severityFilter === severity}
              onClick={() => setSeverityFilter(severity)}
              className={cn(
                "label-caps flex items-center gap-1.5 border-l border-border px-2.5 py-1.5 text-[9px] transition-colors",
                severityFilter === severity
                  ? cn("bg-surface-2", toneText[eventTone(severity)])
                  : "text-muted-foreground hover:bg-surface-2/60",
              )}
            >
              <span className={cn("size-1.5 rounded-full", toneFill[eventTone(severity)])} />
              {severity} {counts[severity]}
            </button>
          ))}
        </span>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as EventType | "all")}>
          <SelectTrigger
            size="sm"
            className="h-8 w-[13.5rem] rounded-sm text-[11px]"
            aria-label="Filter by event type"
          >
            <SelectValue placeholder="Event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[11px]">
              All event types
            </SelectItem>
            {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((type) => (
              <SelectItem key={type} value={type} className="text-[11px]">
                {EVENT_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="ml-auto flex items-center gap-2">
          <Tag tone="neutral">
            {filtered.length} of {events.length} records
          </Tag>
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-surface">
          <EmptyState
            icon={ScrollText}
            title={events.length === 0 ? "No events recorded" : "No events match the filters"}
            description={
              events.length === 0
                ? "Start monitoring, inject a burst or run an experiment — every detection and policy change is logged here."
                : "Widen the severity or type filter to see more of the retained audit trail."
            }
          />
        </div>
      ) : (
        <ol className="relative ml-4 border-l border-border">
          {filtered.slice(0, 120).map((event) => {
            const tone = eventTone(event.severity);
            return (
              <li key={event.id} className="relative pl-5">
                <span
                  className={cn(
                    "absolute -left-[4.5px] top-[13px] size-2 rounded-full ring-2 ring-surface",
                    toneFill[tone],
                    event.severity === "critical" && "mbh-pulse",
                  )}
                />
                <div className="border-b border-border/60 py-2.5 pr-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="data-mono text-[10.5px] text-muted-foreground">
                      {formatClock(event.timestamp)}
                    </span>
                    <span className={cn("label-caps text-[9px]", toneText[tone])}>
                      {EVENT_TYPE_LABELS[event.type]}
                    </span>
                    <span className="label-caps text-[9px] text-muted-foreground/60">
                      {event.severity}
                    </span>
                    {event.sourceIp && (
                      <span className="data-mono text-[10.5px] text-muted-foreground">
                        {event.sourceIp}
                      </span>
                    )}
                    {event.rateMbps !== undefined && (
                      <span className={cn("data-mono text-[10.5px]", toneText[tone])}>
                        {formatMbpsValue(event.rateMbps)} Mbps
                      </span>
                    )}
                    <span className="data-mono ml-auto text-[9.5px] text-muted-foreground/50">
                      {event.dataSource}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-foreground">{event.action}</p>
                  <p className="mt-0.5 text-[10.5px] leading-4 text-muted-foreground">
                    {event.outcome}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {filtered.length > 120 && (
        <p className="text-[10.5px] text-muted-foreground">
          Showing the 120 most recent matches. Export the CSV for the full audit trail.
        </p>
      )}
    </div>
  );
}
