import { StatusPill, trafficStateLabel, trafficStateTone } from "@/components/StatusPill";
import { formatBytes, formatCount, formatMbpsValue, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HostState, LinkState, TrafficSample } from "@/types";
import { Cpu, Network, Share2, X } from "lucide-react";

function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  if (values.length < 2) {
    return (
      <div className="flex h-12 items-center justify-center rounded border border-border text-[10px] text-muted-foreground">
        Not enough samples yet
      </div>
    );
  }
  const max = Math.max(...values, 1);
  const width = 260;
  const height = 44;
  const step = width / (values.length - 1);
  const path = values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(height - (v / max) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-12 w-full", className)} preserveAspectRatio="none">
      <path d={path} fill="none" strokeWidth={1.6} className="stroke-primary" />
    </svg>
  );
}

export function HostDetailsPanel({
  host,
  history,
  onClose,
}: {
  host: HostState;
  history: TrafficSample[];
  onClose: () => void;
}) {
  const series = history.slice(-60).map((s) => s.perSource[host.id] ?? 0);
  const nodeIcon =
    host.role === "switch" ? Network : host.role === "source" ? Share2 : Cpu;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            {(() => {
              const Icon = nodeIcon;
              return <Icon className="size-4" />;
            })()}
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight">{host.name}</p>
            <p className="text-[11px] text-muted-foreground">{host.label}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          aria-label="Close details"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="space-y-3 px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Status</span>
          <StatusPill tone={trafficStateTone(host.state)} pulse={host.state === "burst"}>
            {trafficStateLabel(host.state)}
          </StatusPill>
        </div>
        <Row label="IP address">
          <span className="font-mono text-xs">{host.ip}</span>
        </Row>
        <Row label="Traffic rate">{formatMbpsValue(host.rateMbps)} Mbps</Row>
        <Row label="Packets observed">{formatCount(host.packets)}</Row>
        <Row label="Bytes observed">{formatBytes(host.bytes)}</Row>
        <Row label="Contribution to burst">
          {formatPercent(host.contributionPct)}
        </Row>
        <Row label="Active policy">
          {host.rateCapMbps !== null ? (
            <span className="text-warning">{host.rateCapMbps.toFixed(0)} Mbps cap</span>
          ) : (
            <span className="text-muted-foreground">Unrestricted</span>
          )}
        </Row>

        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Last 60 windows
          </p>
          <Sparkline values={series} />
        </div>
      </div>
    </div>
  );
}

export function LinkDetailsPanel({
  link,
  hosts,
  onClose,
}: {
  link: LinkState;
  hosts: HostState[];
  onClose: () => void;
}) {
  const from = hosts.find((h) => h.id === link.from);
  const to = hosts.find((h) => h.id === link.to);
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">
            Link {from?.name ?? link.from} → {to?.name ?? link.to}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {link.control ? "Monitoring / control path" : "Traffic path"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          aria-label="Close details"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="space-y-3 px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Traffic state</span>
          <StatusPill tone={trafficStateTone(link.state)} pulse={link.state === "burst"}>
            {trafficStateLabel(link.state)}
          </StatusPill>
        </div>
        <Row label="Direction">
          {from?.name} → {to?.name}
        </Row>
        <Row label="Measured rate">{formatMbpsValue(link.rateMbps)} Mbps</Row>
        <Row label="Utilization">{formatPercent(link.utilization * 100)}</Row>
        <Row label="Nominal capacity">
          {link.control ? "control" : `${link.capacityMbps} Mbps`}
        </Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
