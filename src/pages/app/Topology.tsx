import { useEffect, useState } from "react";
import { ControlBar } from "@/components/ControlBar";
import { HostDetailsPanel, LinkDetailsPanel } from "@/components/DetailsPanel";
import { NetworkTopology } from "@/components/NetworkTopology";
import { StatusPill } from "@/components/StatusPill";
import { useMonitoring } from "@/state/monitoring";
import { formatMbpsValue } from "@/lib/format";

export default function TopologyPage() {
  const { snapshot } = useMonitoring();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("h3");
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  // Keep a valid selection if the selected node disappears (it never does here,
  // but this guards against future topology changes).
  useEffect(() => {
    if (selectedNodeId && !snapshot.hosts.some((h) => h.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [snapshot.hosts, selectedNodeId]);

  const selectedHost = snapshot.hosts.find((h) => h.id === selectedNodeId) ?? null;
  const selectedLink = snapshot.links.find((l) => l.id === selectedLinkId) ?? null;

  return (
    <div className="space-y-5">
      <ControlBar />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <NetworkTopology
            hosts={snapshot.hosts}
            links={snapshot.links}
            running={snapshot.running}
            selectedNodeId={selectedNodeId}
            selectedLinkId={selectedLinkId}
            onSelectNode={(id) => {
              setSelectedNodeId(id);
              setSelectedLinkId(null);
            }}
            onSelectLink={(id) => {
              setSelectedLinkId(id);
              setSelectedNodeId(null);
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            Click any host to inspect its counters and burst contribution, or a link to see its
            utilization. Everything here is driven by the same simulated window data as the charts.
          </p>
        </div>

        <div className="space-y-3">
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
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Select a host or link in the diagram to inspect it.
            </div>
          )}

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-3 text-sm font-semibold tracking-tight">Fabric snapshot</p>
            <div className="space-y-2 text-sm">
              {snapshot.hosts
                .filter((h) => h.transmits)
                .map((host) => (
                  <button
                    key={host.id}
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(host.id);
                      setSelectedLinkId(null);
                    }}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
                  >
                    <span className="text-muted-foreground">
                      {host.name}
                      <span className="ml-2 font-mono text-[11px]">{host.ip}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-xs">
                        {formatMbpsValue(host.rateMbps)} Mbps
                      </span>
                      <StatusPill
                        tone={
                          host.state === "burst"
                            ? "burst"
                            : host.state === "mitigated"
                              ? "mitigated"
                              : "normal"
                        }
                        pulse={host.state === "burst"}
                      >
                        {host.state}
                      </StatusPill>
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
