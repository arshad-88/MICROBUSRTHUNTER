import { useMemo } from "react";
import { EventLogTable } from "@/components/EventLogTable";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader, Stat, Tag, type Tone } from "@/components/kit";
import { useMonitoring } from "@/state/monitoring";
import { downloadCsv, timestampSlug, toCsv } from "@/simulation";
import { EVENT_TYPE_LABELS } from "@/types";
import { cn } from "@/lib/utils";
import {
  Download,
  OctagonAlert,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

export default function EventLogs() {
  const { snapshot, clearEvents } = useMonitoring();

  const counts = useMemo(() => {
    const events = snapshot.events;
    return {
      detections: events.filter(
        (e) => e.type === "burst_detected" || e.type === "burst_ended",
      ).length,
      policy: events.filter(
        (e) =>
          e.type === "mitigation_activated" ||
          e.type === "mitigation_adjusted" ||
          e.type === "mitigation_removed",
      ).length,
      recovery: events.filter((e) => e.type === "traffic_recovered").length,
      problems: events.filter(
        (e) => e.type === "error" || e.type === "policy_failed",
      ).length,
    };
  }, [snapshot.events]);

  const tiles: {
    label: string;
    value: string;
    tone: Tone;
    icon: typeof ScrollText;
    hint: string;
  }[] = [
    {
      label: "Records retained",
      value: String(snapshot.events.length),
      tone: "neutral",
      icon: ScrollText,
      hint: "stored in this browser, newest first",
    },
    {
      label: "Burst events",
      value: String(counts.detections),
      tone: counts.detections > 0 ? "burst" : "neutral",
      icon: OctagonAlert,
      hint: "detections and end-of-burst records",
    },
    {
      label: "Policy changes",
      value: String(counts.policy),
      tone: counts.policy > 0 ? "mitigated" : "neutral",
      icon: ShieldCheck,
      hint: "activations, adjustments and removals",
    },
    {
      label: "Recoveries / problems",
      value: `${counts.recovery} / ${counts.problems}`,
      tone: counts.problems > 0 ? "burst" : "recovered",
      icon: TriangleAlert,
      hint: counts.problems > 0 ? "policy failures or engine errors logged" : "no failures logged",
    },
  ];

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
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile, i) => (
            <div
              key={tile.label}
              className={cn("border-border/60", i % 2 === 1 && "border-l", i >= 2 && "border-t lg:border-t-0", i !== 0 && "lg:border-l")}
            >
              <Stat {...tile} size="sm" />
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Event timeline"
          icon={ScrollText}
          note="Audit trail of the monitoring session: lifecycle, detection, attribution, policy and recovery — recorded verbatim."
          actions={
            <>
              <Tag tone="neutral">local storage</Tag>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 rounded-sm"
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
                className="gap-1.5 rounded-sm text-muted-foreground"
                onClick={() => {
                  clearEvents();
                  toast("Event log cleared", {
                    description: "The retained audit trail has been removed from this browser.",
                  });
                }}
                disabled={snapshot.events.length === 0}
              >
                <Trash2 className="size-3.5" />
                Clear
              </Button>
            </>
          }
        />
        <div className="px-4 py-3.5">
          <EventLogTable events={snapshot.events} />
        </div>
      </Panel>
    </div>
  );
}
