import {
  Panel,
  PanelHeader,
  Sparkline,
  KeyValue,
  Tag,
  toneFill,
  trafficTone,
} from "@/components/kit";
import { StatusPill, trafficStateLabel, trafficStateTone } from "@/components/StatusPill";
import { formatBytes, formatCount, formatMbpsValue, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HostState, LinkState, TrafficSample, TrafficState } from "@/types";
import { Cpu, Network, Share2, X } from "lucide-react";

const ROLE_ICON = {
  source: Share2,
  switch: Network,
  receiver: Cpu,
  controller: Network,
} as const;

function roleLabel(state: TrafficState): string {
  switch (state) {
    case "burst":
      return "contributing to a detected burst";
    case "mitigated":
      return "rate limited by policy";
    case "normal":
      return "normal — below threshold";
    default:
      return "no signal";
  }
}

function InspectorCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="label-caps text-muted-foreground/60">{label}</span>
      <span className={cn("data-mono text-[11px]", tone ?? "text-foreground")}>{value}</span>
    </span>
  );
}

/**
 * Horizontal inspector shown directly under the fabric map so selecting a port
 * does not push the visualisation out of view.
 */
export function HostInspector({
  host,
  history,
  onClose,
}: {
  host: HostState;
  history: TrafficSample[];
  onClose: () => void;
}) {
  const series = history.slice(-48).map((s) => s.perSource[host.id] ?? 0);
  const tone = trafficTone(host.state);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border bg-surface-2/60 px-4 py-2.5">
      <span className="flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full", toneFill[tone])} />
        <span className="label-caps text-muted-foreground/70">selected</span>
        <span className="text-[12px] font-semibold text-foreground">{host.name}</span>
        <span className="data-mono text-[11px] text-muted-foreground">{host.ip}</span>
      </span>

      <InspectorCell label="rate" value={`${formatMbpsValue(host.rateMbps)} Mbps`} />
      <InspectorCell label="packets" value={formatCount(host.packets)} />
      <InspectorCell label="bytes" value={formatBytes(host.bytes)} />
      <InspectorCell
        label="burst share"
        value={formatPercent(host.contributionPct)}
        tone={host.contributionPct > 0 ? "text-burst" : undefined}
      />
      <InspectorCell
        label="policy"
        value={host.rateCapMbps !== null ? `cap ${host.rateCapMbps.toFixed(0)} Mbps` : "unrestricted"}
        tone={host.rateCapMbps !== null ? "text-warning" : "text-muted-foreground"}
      />

      <span className="hidden w-32 xl:block">
        <Sparkline values={series} tone={tone} height={22} ariaLabel={`${host.name} recent rate`} />
      </span>

      <button
        type="button"
        onClick={onClose}
        aria-label="Clear selection"
        className="ml-auto rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
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
  const series = history.slice(-80).map((s) => s.perSource[host.id] ?? 0);
  const Icon = ROLE_ICON[host.role];

  return (
    <Panel>
      <PanelHeader
        title={`${host.name} · ${host.label}`}
        note={roleLabel(host.state)}
        icon={Icon}
        actions={
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        }
      />
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="label-caps text-muted-foreground">state</span>
          <StatusPill tone={trafficStateTone(host.state)} pulse={host.state === "burst"}>
            {trafficStateLabel(host.state)}
          </StatusPill>
        </div>

        <div className="mt-3 divide-y divide-border/60">
          <KeyValue label="IP address" mono>
            {host.ip}
          </KeyValue>
          <KeyValue label="Traffic rate" mono>
            {host.transmits ? `${formatMbpsValue(host.rateMbps)} Mbps` : "—"}
          </KeyValue>
          <KeyValue label="Packets observed" mono>
            {formatCount(host.packets)}
          </KeyValue>
          <KeyValue label="Bytes observed" mono>
            {formatBytes(host.bytes)}
          </KeyValue>
          <KeyValue label="Contribution to burst" mono>
            {host.contributionPct > 0 ? formatPercent(host.contributionPct) : "—"}
          </KeyValue>
          <KeyValue label="Active policy">
            {host.rateCapMbps !== null ? (
              <Tag tone="mitigated">{host.rateCapMbps.toFixed(0)} Mbps cap</Tag>
            ) : (
              <span className="text-muted-foreground">unrestricted</span>
            )}
          </KeyValue>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="label-caps text-muted-foreground">last 80 windows</span>
            <span className="data-mono text-[10px] text-muted-foreground">
              {series.length ? `${Math.max(...series).toFixed(1)} peak Mbps` : "no samples"}
            </span>
          </div>
          <div className="mt-2">
            <Sparkline
              values={series}
              tone={trafficTone(host.state)}
              height={46}
              ariaLabel={`${host.name} rate history`}
            />
          </div>
        </div>
      </div>
    </Panel>
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
  const direction = `${from?.name ?? link.from} → ${to?.name ?? link.to}`;

  return (
    <Panel>
      <PanelHeader
        title={`Path ${direction}`}
        note={link.control ? "Monitoring / control path — carries no user traffic" : "User traffic path"}
        icon={Network}
        actions={
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        }
      />
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="label-caps text-muted-foreground">state</span>
          <StatusPill tone={trafficStateTone(link.state)} pulse={link.state === "burst"}>
            {trafficStateLabel(link.state)}
          </StatusPill>
        </div>
        <div className="mt-3 divide-y divide-border/60">
          <KeyValue label="Direction" mono>
            {direction}
          </KeyValue>
          <KeyValue label="Observed rate" mono>
            {link.control ? "control only" : `${formatMbpsValue(link.rateMbps)} Mbps`}
          </KeyValue>
          <KeyValue label="Utilisation" mono>
            {link.control ? "—" : formatPercent(link.utilization * 100)}
          </KeyValue>
          <KeyValue label="Nominal capacity" mono>
            {link.control ? "—" : `${link.capacityMbps} Mbps`}
          </KeyValue>
          <KeyValue label="Headroom" mono>
            {link.control || link.capacityMbps <= 0
              ? "—"
              : `${formatMbpsValue(Math.max(0, link.capacityMbps - link.rateMbps))} Mbps`}
          </KeyValue>
        </div>
        <p className="mt-3 border-t border-border pt-2.5 text-[10.5px] leading-4 text-muted-foreground">
          Utilisation is derived from the modelled aggregate rate against the link's nominal
          capacity. A rate spike is not a measurement of switch-buffer occupancy.
        </p>
      </div>
    </Panel>
  );
}
