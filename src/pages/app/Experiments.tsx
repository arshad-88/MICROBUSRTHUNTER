import { useState } from "react";
import { ExperimentComparison } from "@/components/ExperimentComparison";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyValue, Meter, Panel, PanelHeader, Tag } from "@/components/kit";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMonitoring } from "@/state/monitoring";
import { cloneConfig, downloadCsv, timestampSlug, toCsv } from "@/simulation";
import type { ExperimentScenarioId } from "@/types";
import { cn } from "@/lib/utils";
import {
  Download,
  FlaskConical,
  Play,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

const SHORT_NAME: Record<ExperimentScenarioId, string> = {
  1: "Normal traffic",
  2: "Burst, no mitigation",
  3: "Burst with adaptive mitigation",
};

export default function Experiments() {
  const {
    snapshot,
    config,
    scenarios,
    startExperiment,
    stopExperiment,
    reset,
    updateConfig,
    clearExperiments,
  } = useMonitoring();

  const [scenario, setScenario] = useState<ExperimentScenarioId>(1);
  const selected = scenarios.find((s) => s.id === scenario)!;
  const runtime = snapshot.experiment;

  const patchSimulation = (patch: Partial<typeof config.simulation>) => {
    const next = cloneConfig(config);
    next.simulation = { ...next.simulation, ...patch };
    const issues = updateConfig(next);
    if (issues.length > 0) toast.error(issues[0].message);
  };

  const handleExport = () => {
    const csv = toCsv(snapshot.experiments, [
      { key: "timestamp", header: "Timestamp", value: (r) => new Date(r.timestamp).toISOString() },
      { key: "scenario", header: "Scenario", value: (r) => r.scenario },
      { key: "name", header: "Scenario name", value: (r) => r.scenarioName },
      { key: "seed", header: "Seed", value: (r) => r.seed },
      { key: "duration", header: "Duration (ms)", value: (r) => Math.round(r.durationMs) },
      { key: "peak", header: "Burst peak (Mbps)", value: (r) => (r.burstPeakMbps ?? "").toString() },
      { key: "avg", header: "Average rate (Mbps)", value: (r) => r.avgRateMbps.toFixed(3) },
      { key: "throughput", header: "Throughput (Mbps)", value: (r) => r.throughputMbps.toFixed(3) },
      {
        key: "delay",
        header: "Detection delay (ms)",
        value: (r) => (r.detectionDelayMs ?? "").toString(),
      },
      { key: "bursts", header: "Burst events", value: (r) => r.burstCount },
      { key: "drops", header: "Simulated drops (Mb)", value: (r) => r.dropMb.toFixed(4) },
      { key: "latency", header: "Simulated latency (ms)", value: (r) => r.latencyMs.toFixed(3) },
      {
        key: "mitigation",
        header: "Mitigation duration (ms)",
        value: (r) => Math.round(r.mitigationDurationMs),
      },
      { key: "source", header: "Data source", value: (r) => r.dataSource },
    ]);
    downloadCsv(`microbursthunter-experiments-${timestampSlug()}.csv`, csv);
  };

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <PanelHeader
          title="Scenario"
          index="06"
          icon={FlaskConical}
          note="Three reproducible scenarios share one generator. Identical settings and seed keep the results comparable."
          actions={
            <Tag tone="live">seed {config.simulation.seed}</Tag>
          }
        />
        <div
          role="radiogroup"
          aria-label="Experiment scenario"
          className="grid gap-0 sm:grid-cols-3"
        >
          {scenarios.map((s) => {
            const active = s.id === scenario;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={runtime.active}
                onClick={() => setScenario(s.id)}
                className={cn(
                  "border-b border-border/60 px-4 py-3.5 text-left transition-colors sm:border-b-0 sm:border-l sm:first:border-l-0 disabled:opacity-60",
                  active ? "bg-surface-2" : "hover:bg-surface-2/50",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "data-mono text-[10px]",
                      active ? "text-primary" : "text-muted-foreground/60",
                    )}
                  >
                    {String(s.id).padStart(2, "0")}
                  </span>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      active ? "bg-primary" : "bg-muted-foreground/30",
                    )}
                  />
                  <span className="ml-auto label-caps text-[8.5px] text-muted-foreground/60">
                    {active ? "selected" : "available"}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-2 text-[13px] font-medium",
                    active ? "text-foreground" : "text-foreground/80",
                  )}
                >
                  {SHORT_NAME[s.id]}
                </p>
                <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">{s.summary}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Tag tone={s.usesBurst ? "burst" : "recovered"}>
                    {s.usesBurst ? "injects burst" : "no burst"}
                  </Tag>
                  <Tag tone={s.usesMitigation ? "mitigated" : "neutral"}>
                    {s.usesMitigation ? "auto mitigation" : "mitigation off"}
                  </Tag>
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-12">
        <Panel className="overflow-hidden xl:col-span-7">
          <PanelHeader
            title={`Run · ${selected.name}`}
            icon={Play}
            actions={
              <StatusPill tone={runtime.active ? "mitigated" : "idle"} pulse={runtime.active}>
                {runtime.active ? "running" : "idle"}
              </StatusPill>
            }
          />
          <div className="px-4 py-3.5">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="gap-1.5 rounded-sm"
                onClick={() => {
                  startExperiment(scenario);
                  toast.success(`Experiment ${scenario} started`, {
                    description:
                      "Identical generator settings and seed are used for comparability.",
                  });
                }}
                disabled={runtime.active}
              >
                <Play className="size-3.5" />
                Start experiment
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-1.5 rounded-sm"
                onClick={() => {
                  stopExperiment();
                  toast("Experiment stopped");
                }}
                disabled={!runtime.active}
              >
                <Square className="size-3.5" />
                Stop
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-1.5 rounded-sm"
                onClick={() => {
                  reset();
                  toast("Session reset", {
                    description: "History, counters and policy state cleared.",
                  });
                }}
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-1.5 rounded-sm"
                onClick={handleExport}
                disabled={snapshot.experiments.length === 0}
              >
                <Download className="size-3.5" />
                Export CSV
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="gap-1.5 rounded-sm text-muted-foreground"
                onClick={() => {
                  clearExperiments();
                  toast("Stored experiment results cleared");
                }}
                disabled={snapshot.experiments.length === 0}
              >
                <Trash2 className="size-3.5" />
                Clear results
              </Button>
            </div>

            {runtime.active ? (
              <div className="mt-4">
                <div className="flex items-baseline justify-between">
                  <span className="label-caps text-muted-foreground">
                    running scenario {runtime.scenario}
                  </span>
                  <span className="data-mono text-[11px] text-primary">
                    {(runtime.progress * 100).toFixed(0)}%
                  </span>
                </div>
                <Meter
                  className="mt-1.5"
                  value={runtime.progress * 100}
                  tone="live"
                  ariaLabel="Experiment progress"
                />
                <p className="mt-2 text-[10.5px] text-muted-foreground">
                  Logical duration {config.simulation.experimentDurationMs} ms · the run finalises
                  itself when the duration elapses.
                </p>
              </div>
            ) : (
              <p className="mt-4 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
                Starting a scenario resets traffic history and policy state, then replays the
                generator with the configured seed. Experiment 2 and 3 differ only in whether the
                adaptive mitigation policy is armed.
              </p>
            )}
          </div>
        </Panel>

        <Panel className="overflow-hidden xl:col-span-5">
          <PanelHeader
            title="Generator parameters"
            note="Shared across scenarios so a run can be reproduced from its seed."
          />
          <div className="space-y-3 px-4 py-3.5">
            <ParamInput
              label="Experiment duration (ms)"
              value={config.simulation.experimentDurationMs}
              onChange={(v) => patchSimulation({ experimentDurationMs: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <ParamInput
                label="Burst peak (Mbps)"
                value={config.simulation.burstPeakMbps}
                onChange={(v) => patchSimulation({ burstPeakMbps: v })}
              />
              <ParamInput
                label="Burst duration (ms)"
                value={config.simulation.burstDurationMs}
                onChange={(v) => patchSimulation({ burstDurationMs: v })}
              />
            </div>
            <ParamInput
              label="PRNG seed"
              value={config.simulation.seed}
              onChange={(v) => {
                const next = cloneConfig(config);
                next.simulation = { ...next.simulation, seed: v };
                updateConfig(next);
              }}
            />
            <div>
              <Label
                htmlFor="burst-source"
                className="label-caps text-muted-foreground"
              >
                Burst source host
              </Label>
              <Select
                value={config.simulation.burstHostId}
                onValueChange={(v) => patchSimulation({ burstHostId: v })}
              >
                <SelectTrigger id="burst-source" className="mt-1 w-full rounded-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {snapshot.hosts
                    .filter((h) => h.transmits)
                    .map((h) => (
                      <SelectItem key={h.id} value={h.id} className="data-mono text-[11px]">
                        {h.name} · {h.ip}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="divide-y divide-border/60 border-t border-border pt-2">
              <KeyValue label="Link capacity" mono>
                {config.simulation.linkCapacityMbps} Mbps
              </KeyValue>
              <KeyValue label="Base latency" mono>
                {config.simulation.baseLatencyMs} ms
              </KeyValue>
              <KeyValue label="Stored runs" mono>
                {snapshot.experiments.length}
              </KeyValue>
            </div>
          </div>
        </Panel>
      </div>

      <ExperimentComparison experiments={snapshot.experiments} />
    </div>
  );
}

function ParamInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  return (
    <div>
      <Label className="label-caps text-muted-foreground">{label}</Label>
      <Input
        value={draft}
        inputMode="numeric"
        className="data-mono mt-1 rounded-sm"
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed) && parsed > 0) onChange(parsed);
        }}
      />
    </div>
  );
}
