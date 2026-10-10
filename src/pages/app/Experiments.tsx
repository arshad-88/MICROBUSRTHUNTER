import { useState } from "react";
import { ExperimentComparison } from "@/components/ExperimentComparison";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { Download, FlaskConical, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-primary" />
            <p className="text-sm font-semibold tracking-tight">Scenario</p>
          </div>

          <Select
            value={String(scenario)}
            onValueChange={(v) => setScenario(Number(v) as ExperimentScenarioId)}
            disabled={runtime.active}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scenarios.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="text-sm text-muted-foreground">{selected.summary}</p>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={selected.usesBurst ? "burst" : "normal"}>
              {selected.usesBurst ? "Injects burst" : "No burst"}
            </StatusPill>
            <StatusPill tone={selected.usesMitigation ? "mitigated" : "idle"}>
              {selected.usesMitigation ? "Adaptive mitigation" : "Mitigation disabled"}
            </StatusPill>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              type="button"
              className="gap-1.5"
              onClick={() => {
                startExperiment(scenario);
                toast.success(`Experiment ${scenario} started`, {
                  description: "Identical generator settings and seed are used for comparability.",
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
              className="gap-1.5"
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
              className="gap-1.5"
              onClick={() => {
                reset();
                toast("Experiment reset");
              }}
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={handleExport}
              disabled={snapshot.experiments.length === 0}
            >
              <Download className="size-3.5" />
              Export CSV
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              onClick={() => {
                clearExperiments();
                toast("Stored experiment results cleared");
              }}
              disabled={snapshot.experiments.length === 0}
            >
              <Trash2 className="size-3.5" />
              Clear
            </Button>
          </div>

          {runtime.active && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Running scenario {runtime.scenario}</span>
                <span>{(runtime.progress * 100).toFixed(0)}%</span>
              </div>
              <Progress value={runtime.progress * 100} />
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-semibold tracking-tight">Generator parameters</p>
          <p className="text-[11px] text-muted-foreground">
            Identical settings are reused across scenarios so results stay comparable.
          </p>

          <ParamInput
            label="Experiment duration (ms)"
            value={config.simulation.experimentDurationMs}
            onChange={(v) => patchSimulation({ experimentDurationMs: v })}
          />
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
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Burst source
            </Label>
            <Select
              value={config.simulation.burstHostId}
              onValueChange={(v) => patchSimulation({ burstHostId: v })}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {snapshot.hosts
                  .filter((h) => h.transmits)
                  .map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name} · {h.ip}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
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
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        value={draft}
        inputMode="numeric"
        className="mt-1"
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed) && parsed > 0) onChange(parsed);
        }}
      />
    </div>
  );
}
