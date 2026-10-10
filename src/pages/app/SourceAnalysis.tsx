import { useState } from "react";
import { ControlBar } from "@/components/ControlBar";
import { SourceTable, SourceTableHint } from "@/components/SourceTable";
import { StatusPill } from "@/components/StatusPill";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { useMonitoring } from "@/state/monitoring";
import { downloadCsv, timestampSlug, toCsv } from "@/simulation";
import { formatMbpsValue, formatPercent } from "@/lib/format";
import { Download, Share2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function SourceAnalysis() {
  const { snapshot } = useMonitoring();
  const [selectedId, setSelectedId] = useState<string | null>("h3");

  const selected = snapshot.sources.find((s) => s.id === selectedId) ?? snapshot.sources[0];

  const series = snapshot.history.slice(-160).map((s) => ({
    seconds: s.t / 1000,
    rate: Number((s.perSource[selected?.id ?? ""] ?? 0).toFixed(2)),
  }));

  const topSource = [...snapshot.sources].sort(
    (a, b) => b.contributionPct - a.contributionPct,
  )[0];

  const handleExport = () => {
    const csv = toCsv(snapshot.sources, [
      { key: "name", header: "Host", value: (r) => r.name },
      { key: "ip", header: "IP address", value: (r) => r.ip },
      { key: "packets", header: "Packets observed", value: (r) => r.packets },
      { key: "bytes", header: "Bytes observed", value: (r) => Math.round(r.bytes) },
      { key: "rate", header: "Rate (Mbps)", value: (r) => r.rateMbps.toFixed(3) },
      {
        key: "contribution",
        header: "Burst contribution (%)",
        value: (r) => r.contributionPct.toFixed(2),
      },
      { key: "policy", header: "Policy", value: (r) => r.policy },
      { key: "state", header: "Status", value: (r) => r.state },
    ]);
    downloadCsv(`microbursthunter-sources-${timestampSlug()}.csv`, csv);
  };

  return (
    <div className="space-y-5">
      <ControlBar />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Top contributor (burst)"
          value={snapshot.burstActive && topSource ? topSource.name : "—"}
          unit={snapshot.burstActive && topSource ? formatPercent(topSource.contributionPct) : ""}
          icon={Share2}
          tone={snapshot.burstActive ? "burst" : "default"}
          hint={snapshot.burstActive ? topSource?.ip : "No burst in progress"}
        />
        <MetricCard
          label="Active sources"
          value={String(snapshot.activeSourceIps)}
          icon={Share2}
          hint={`${snapshot.sources.length} transmitting hosts`}
        />
        <MetricCard
          label="Burst bytes accounted"
          value={
            snapshot.burstTotalBytes !== undefined
              ? `${(snapshot.burstTotalBytes / 1_000_000).toFixed(1)}`
              : "0"
          }
          unit="MB"
          icon={Share2}
          hint="Bytes attributed to the current/none burst window"
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold tracking-tight">Source ranking</p>
            <SourceTableHint />
          </div>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={handleExport}>
            <Download className="size-3.5" />
            Export CSV
          </Button>
        </div>
        <SourceTable sources={snapshot.sources} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold tracking-tight">
              {selected ? `${selected.name} traffic history` : "Source history"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Per-window rate for the selected source · current{" "}
              {selected ? formatMbpsValue(selected.rateMbps) : "0"} Mbps
            </p>
          </div>
          {selected && (
            <StatusPill
              tone={
                selected.state === "burst"
                  ? "burst"
                  : selected.state === "mitigated"
                    ? "mitigated"
                    : "normal"
              }
            >
              {selected.policy}
            </StatusPill>
          )}
        </div>
        {series.length < 2 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Start monitoring to build per-source history.
          </div>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="seconds"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) => `${Number(v).toFixed(1)}s`}
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                  stroke="var(--color-border)"
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                  stroke="var(--color-border)"
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(v) => `t = ${Number(v).toFixed(2)} s`}
                />
                <Line
                  type="monotone"
                  dataKey="rate"
                  name="Rate (Mbps)"
                  stroke="var(--color-primary)"
                  strokeWidth={1.8}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
