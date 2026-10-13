import { useEffect, useState } from "react";
import { ControlBar } from "@/components/ControlBar";
import { HostDetailsPanel, LinkDetailsPanel } from "@/components/DetailsPanel";
import { NetworkTopology } from "@/components/NetworkTopology";
import { StatusPill } from "@/components/StatusPill";
import { KeyValue, Panel, PanelHeader, SegmentBar, Tag } from "@/components/kit";
import { useMonitoring } from "@/state/monitoring";
import { formatMbpsValue, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Network, MousePointerClick } from "lucide-react";

export default function TopologyPage() {
  const { snapshot } = useMonitoring();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  // Guard against a selection that no longer exists in the topology.
  useEffect(() => {
    if (selectedNodeId && !snapshot.hosts.some((h) => h.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [snapshot.hosts, selectedNodeId]);

  const selectedHost = snapshot.hosts.find((h) => h.id === selectedNodeId) ?? null;
  const selectedLink = snapshot.links.find((l) => l.id === selectedLinkId) ?? null;
  const sources = snapshot.hosts.filter((h) => h.transmits);
  const uplink = snapshot.links.find((l) => l.id === "s1-r1");

  return (
    <div className="space-y-4">
      <ControlBar />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_356px]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Fabric plane"
            icon={Network}
            note="Directional map of the monitored fabric. Selecting an endpoint or path inspects real-time counters and policy state."
            actions={
              <div className="flex items-center gap-1.5">
                <Tag tone="neutral">4 sources</Tag>
                <Tag tone="neutral">1 switch</Tag>
                <Tag tone="neutral">1 sink</Tag>
              </div>
            }
          />
          <NetworkTopology
            hosts={snapshot.hosts}
            links={snapshot.links}
            running={snapshot.running}
            selectedNodeId={selectedNodeId}
            selectedLinkId={selectedLinkId}
            onSelectNode={(id) => {
              setSelectedNodeId((prev) => (prev === id ? null : id));
              setSelectedLinkId(null);
            }}
            onSelectLink={(id) => {
              setSelectedLinkId((prev) => (prev === id ? null : id));
              setSelectedNodeId(null);
            }}
          />
        </Panel>

        <div className="space-y-4">
          {selectedHost ? (
            <HostDetailsPanel
              host={selectedHost}
              history={snapshot.history}
              onClose={() => setSelectedNodeId(null)}
            />
          ) : selectedLink ? (
            <LinkDetailsPanel
              link={selectedLink}
              hosts={snapshot.hosts}
              onClose={() => setSelectedLinkId(null)}
            />
          ) : (
            <Panel>
              <PanelHeader title="Inspector" icon={MousePointerClick} />
              <div className="px-4 py-5">
                <p className="text-[11.5px] leading-5 text-muted-foreground">
                  Nothing is selected. Choose any port or traffic path in the map to read its
                  address, counters, burst contribution and enforced policy.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {sources.map((host) => (
                    <button
                      key={host.id}
                      type="button"
                      onClick={() => {
                        setSelectedNodeId(host.id);
                        setSelectedLinkId(null);
                      }}
                      className="data-mono rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      {host.name}
                    </button>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Source bank"
              note="Live per-host readout. Select a row to load it in the inspector."
            />
            <ul className="divide-y divide-border/60">
              {sources.map((host) => {
                const selected = selectedNodeId === host.id;
                return (
                  <li key={host.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedNodeId(host.id);
                        setSelectedLinkId(null);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                        selected ? "bg-surface-2" : "hover:bg-surface-2/60",
                      )}
                    >
                      <span
                        className={cn(
                          "h-7 w-[3px] shrink-0 rounded-full",
                          host.state === "burst"
                            ? "bg-burst"
                            : host.state === "mitigated"
                              ? "bg-warning"
                              : host.state === "normal"
                                ? "bg-primary"
                                : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="text-[12px] font-medium text-foreground">
                            {host.name}
                          </span>
                          <span className="data-mono text-[10.5px] text-muted-foreground">
                            {host.ip}
                          </span>
                        </span>
                        <SegmentBar
                          value={host.contributionPct}
                          tone={host.state === "burst" ? "burst" : "live"}
                          className="mt-1.5"
                        />
                      </span>
                      <span className="data-mono shrink-0 text-[11px] text-foreground">
                        {formatMbpsValue(host.rateMbps)}
                        <span className="ml-1 text-muted-foreground">Mbps</span>
                      </span>
                      <StatusPill
                        tone={
                          host.state === "burst"
                            ? "burst"
                            : host.state === "mitigated"
                              ? "mitigated"
                              : host.state === "normal"
                                ? "normal"
                                : "idle"
                        }
                        pulse={host.state === "burst"}
                      >
                        {host.state}
                      </StatusPill>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Fabric summary" note="Aggregate state of the monitored plane." />
            <div className="px-4 py-3">
              <div className="divide-y divide-border/60">
                <KeyValue label="Aggregate rate" mono>
                  {formatMbpsValue(snapshot.latest?.rateMbps ?? 0)} Mbps
                </KeyValue>
                <KeyValue label="Uplink utilisation" mono>
                  {uplink ? formatPercent(uplink.utilization * 100) : "—"}
                </KeyValue>
                <KeyValue label="Uplink capacity" mono>
                  {uplink ? `${uplink.capacityMbps} Mbps` : "—"}
                </KeyValue>
                <KeyValue label="Active source IPs" mono>
                  {snapshot.activeSourceIps} / {sources.length}
                </KeyValue>
                <KeyValue label="Detected bursts" mono>
                  {snapshot.burstCount}
                </KeyValue>
              </div>
              <p className="mt-3 border-t border-border pt-2.5 text-[10.5px] leading-4 text-muted-foreground">
                The plane is a fixed four-source fabric driven by the deterministic traffic model.
                "No signal" means monitoring is halted or the host is below the reporting floor —
                it is never displayed as a fabricated measurement.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
