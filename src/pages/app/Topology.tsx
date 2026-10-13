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
              <div className="px-4 py-4 space-y-3">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="size-2 rounded-full bg-cyan-400/80 animate-pulse" />
                  <span>Select any endpoint, switch, or path in the topology map</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1 border-t border-white/5">
                  {sources.map((host) => (
                    <button
                      key={host.id}
                      type="button"
                      onClick={() => {
                        setSelectedNodeId(host.id);
                        setSelectedLinkId(null);
                      }}
                      className="data-mono rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 transition-all hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-cyan-300 hover:shadow-[0_0_10px_rgba(0,229,255,0.2)]"
                    >
                      {host.name}
                    </button>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          <Panel className="overflow-hidden">
            <PanelHeader title="Source bank" />
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
                        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-all duration-200 hover:bg-white/[0.04]",
                        selected ? "bg-white/[0.07] border-l-2 border-cyan-400" : "border-l-2 border-transparent",
                      )}
                    >
                      <span
                        className={cn(
                          "h-7 w-[3px] shrink-0 rounded-full",
                          host.state === "burst"
                            ? "bg-burst shadow-[0_0_8px_#ff2357]"
                            : host.state === "mitigated"
                              ? "bg-warning shadow-[0_0_8px_#fcbb00]"
                              : host.state === "normal"
                                ? "bg-primary shadow-[0_0_8px_#8d54ff]"
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
            <PanelHeader title="Fabric summary" />
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
              <div className="mt-3 border-t border-white/10 pt-2.5 flex items-center justify-between text-xs text-slate-400">
                <span>Sampling Resolution</span>
                <span className="font-mono text-[11px] text-emerald-400 font-semibold">10ms High-Rate Precision</span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
