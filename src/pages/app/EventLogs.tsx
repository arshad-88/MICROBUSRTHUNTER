import { EventLogTable } from "@/components/EventLogTable";
import { Button } from "@/components/ui/button";
import { useMonitoring } from "@/state/monitoring";
import { downloadCsv, timestampSlug, toCsv } from "@/simulation";
import { EVENT_TYPE_LABELS } from "@/types";
import { Download, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function EventLogs() {
  const { snapshot, clearEvents } = useMonitoring();

  const handleExport = () => {
    const csv = toCsv(snapshot.events, [
      { key: "timestamp", header: "Timestamp", value: (r) => new Date(r.timestamp).toISOString() },
      { key: "type", header: "Event type", value: (r) => EVENT_TYPE_LABELS[r.type] },
      { key: "severity", header: "Severity", value: (r) => r.severity },
      { key: "sourceIp", header: "Source IP", value: (r) => r.sourceIp ?? "" },
      { key: "hostName", header: "Host", value: (r) => r.hostName ?? "" },
      {
        key: "rate",
        header: "Rate (Mbps)",
        value: (r) => (r.rateMbps !== undefined ? r.rateMbps.toFixed(3) : ""),
      },
      { key: "action", header: "Action taken", value: (r) => r.action },
      { key: "outcome", header: "Outcome", value: (r) => r.outcome },
      { key: "dataSource", header: "Data source", value: (r) => r.dataSource },
    ]);
    downloadCsv(`microbursthunter-events-${timestampSlug()}.csv`, csv);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">Event history</p>
          <p className="text-[11px] text-muted-foreground">
            {snapshot.events.length} records retained in this browser · exported CSV contains the
            actual recorded rows
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={handleExport}
            disabled={snapshot.events.length === 0}
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            onClick={() => {
              clearEvents();
              toast("Event log cleared");
            }}
            disabled={snapshot.events.length === 0}
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </div>
      </div>

      <EventLogTable events={snapshot.events} />
    </div>
  );
}
