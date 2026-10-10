import { useMemo, useState } from "react";
import { StatusPill, severityTone } from "@/components/StatusPill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatClock, formatMbpsValue } from "@/lib/format";
import { EVENT_TYPE_LABELS, type AppEvent, type EventSeverity, type EventType } from "@/types";

export function EventLogTable({ events }: { events: AppEvent[] }) {
  const [typeFilter, setTypeFilter] = useState<EventType | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<EventSeverity | "all">("all");

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
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as EventType | "all")}>
          <SelectTrigger size="sm" className="w-[12rem]">
            <SelectValue placeholder="Event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((type) => (
              <SelectItem key={type} value={type}>
                {EVENT_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={severityFilter}
          onValueChange={(v) => setSeverityFilter(v as EventSeverity | "all")}
        >
          <SelectTrigger size="sm" className="w-[10rem]">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>

        <span className="ml-auto text-[11px] text-muted-foreground">
          {filtered.length} of {events.length} records
        </span>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No events match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {formatClock(event.timestamp)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {EVENT_TYPE_LABELS[event.type]}
                  </TableCell>
                  <TableCell>
                    <StatusPill tone={severityTone(event.severity)}>{event.severity}</StatusPill>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    {event.sourceIp ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {event.rateMbps !== undefined ? `${formatMbpsValue(event.rateMbps)} Mbps` : "—"}
                  </TableCell>
                  <TableCell className="max-w-[16rem] text-xs">{event.action}</TableCell>
                  <TableCell className="max-w-[22rem] whitespace-normal text-xs text-muted-foreground">
                    {event.outcome}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {event.dataSource}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
