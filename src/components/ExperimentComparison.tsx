import { Panel, PanelHeader, Tag } from "@/components/kit";
import { StatusPill } from "@/components/StatusPill";
import { formatDateTime, formatMbpsValue, formatMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExperimentResult } from "@/types";
import { FlaskConical } from "lucide-react";

const SCENARIO_LABEL: Record<number, string> = {
  1: "Normal traffic",
  2: "Burst, no mitigation",
  3: "Burst + mitigation",
};

function latestPerScenario(experiments: ExperimentResult[]) {
  const map = new Map<number, ExperimentResult>();
  for (const exp of experiments) {
    if (!map.has(exp.scenario)) map.set(exp.scenario, exp);
  }
  return [1, 2, 3]
    .map((id) => map.get(id))
    .filter((x): x is ExperimentResult => Boolean(x));
}

interface MetricRow {
  label: string;
  unit: string;
  digits: number;
  value: (e: ExperimentResult) => number | null;
}

const METRICS: MetricRow[] = [
  {
    label: "Peak rate",
    unit: "Mbps",
    digits: 1,
    value: (e) => e.burstPeakMbps ?? e.avgRateMbps,
  },
  { label: "Mean rate", unit: "Mbps", digits: 1, value: (e) => e.avgRateMbps },
  { label: "Dropped traffic (modelled)", unit: "Mb", digits: 3, value: (e) => e.dropMb },
  { label: "Latency (modelled)", unit: "ms", digits: 2, value: (e) => e.latencyMs },
];

export function ExperimentComparison({ experiments }: { experiments: ExperimentResult[] }) {
  const latest = latestPerScenario(experiments);

  if (experiments.length === 0) {
    return (
      <Panel>
        <PanelHeader
          title="Comparison"
          index="06"
          icon={FlaskConical}
          note="Run at least one scenario to populate the comparison matrix."
        />
        <div className="px-4 py-8 text-center">
          <p className="text-[12px] text-foreground">No experiment runs recorded yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[11px] leading-4 text-muted-foreground">
            Each completed run is stored locally with its seed and settings so results stay
            comparable and exportable.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <PanelHeader
          title="Latest run per scenario"
          index="06"
          icon={FlaskConical}
          note="Each metric is scaled on its own row so scenarios remain comparable without mixing units."
          actions={<Tag tone="neutral">simulated results</Tag>}
        />
        <div className="divide-y divide-border/60">
          {METRICS.map((metric) => {
            const values = latest.map((e) => metric.value(e) ?? 0);
            const max = Math.max(...values, 0.0001);
            return (
              <div key={metric.label} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="label-caps text-muted-foreground">{metric.label}</span>
                  <span className="data-mono text-[10px] text-muted-foreground/70">
                    {metric.unit}
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  {latest.map((exp) => {
                    const value = metric.value(exp) ?? 0;
                    const pct = (value / max) * 100;
                    const tone =
                      exp.scenario === 1
                        ? "bg-primary/70"
                        : exp.scenario === 2
                          ? "bg-burst/80"
                          : "bg-warning/80";
                    return (
                      <div key={exp.id} className="flex items-center gap-3">
                        <span className="w-[9.5rem] shrink-0 truncate text-[11px] text-muted-foreground">
                          {SCENARIO_LABEL[exp.scenario] ?? `Scenario ${exp.scenario}`}
                        </span>
                        <span className="h-2.5 flex-1 overflow-hidden rounded-sm bg-muted/70">
                          <span
                            className={cn("block h-full rounded-sm transition-[width]", tone)}
                            style={{ width: `${Math.max(1.5, pct)}%` }}
                          />
                        </span>
                        <span className="data-mono w-20 shrink-0 text-right text-[11px] text-foreground">
                          {value.toFixed(metric.digits)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="grid grid-cols-1 gap-x-6 px-4 py-3 sm:grid-cols-3">
            {latest.map((exp) => (
              <div key={`extra-${exp.id}`} className="py-1">
                <p className="text-[11px] font-medium text-foreground">
                  Exp {exp.scenario} · {SCENARIO_LABEL[exp.scenario]}
                </p>
                <p className="data-mono mt-1 text-[10.5px] text-muted-foreground">
                  detection delay{" "}
                  {exp.detectionDelayMs !== null ? formatMs(exp.detectionDelayMs, 0) : "n/a"} ·
                  mitigation {exp.mitigationDurationMs > 0 ? formatMs(exp.mitigationDurationMs, 0) : "none"}
                </p>
                <p className="data-mono mt-0.5 text-[10.5px] text-muted-foreground/70">
                  seed {exp.seed} · {formatMs(exp.durationMs, 0)} logical time
                </p>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Recorded runs"
          note="Stored verbatim with the generator seed used, so any run can be reproduced."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-border">
                {[
                  "Run",
                  "Scenario",
                  "Duration",
                  "Burst peak",
                  "Average",
                  "Detection delay",
                  "Bursts",
                  "Drops (sim)",
                  "Latency (sim)",
                  "Mitigation",
                  "Seed",
                ].map((head) => (
                  <th
                    key={head}
                    className={cn(
                      "label-caps px-3 py-2 font-medium text-muted-foreground/70",
                      head !== "Run" && head !== "Scenario" && head !== "Seed" && "text-right",
                    )}
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {experiments.slice(0, 20).map((exp) => (
                <tr key={exp.id} className="border-b border-border/60 last:border-0">
                  <td className="data-mono whitespace-nowrap px-3 py-2.5 text-[10.5px] text-muted-foreground">
                    {formatDateTime(exp.timestamp)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <StatusPill
                        tone={exp.scenario === 1 ? "normal" : exp.scenario === 2 ? "burst" : "mitigated"}
                      >
                        exp {exp.scenario}
                      </StatusPill>
                      <span className="hidden text-[11px] text-muted-foreground lg:inline">
                        {SCENARIO_LABEL[exp.scenario]}
                      </span>
                    </span>
                  </td>
                  <td className="data-mono px-3 py-2.5 text-right text-[11px]">
                    {formatMs(exp.durationMs, 0)}
                  </td>
                  <td className="data-mono px-3 py-2.5 text-right text-[11px]">
                    {exp.burstPeakMbps !== null ? formatMbpsValue(exp.burstPeakMbps) : "—"}
                  </td>
                  <td className="data-mono px-3 py-2.5 text-right text-[11px]">
                    {formatMbpsValue(exp.avgRateMbps)}
                  </td>
                  <td className="data-mono px-3 py-2.5 text-right text-[11px]">
                    {exp.detectionDelayMs !== null ? formatMs(exp.detectionDelayMs, 0) : "—"}
                  </td>
                  <td className="data-mono px-3 py-2.5 text-right text-[11px]">{exp.burstCount}</td>
                  <td className="data-mono px-3 py-2.5 text-right text-[11px]">
                    {exp.dropMb.toFixed(3)}
                  </td>
                  <td className="data-mono px-3 py-2.5 text-right text-[11px]">
                    {exp.latencyMs.toFixed(2)}
                  </td>
                  <td className="data-mono px-3 py-2.5 text-right text-[11px]">
                    {exp.mitigationDurationMs > 0 ? formatMs(exp.mitigationDurationMs, 0) : "—"}
                  </td>
                  <td className="data-mono px-3 py-2.5 text-[10.5px] text-muted-foreground">
                    {exp.seed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2.5 text-[10.5px] leading-4 text-muted-foreground">
          Identical generator settings and PRNG seed per scenario keep runs comparable. Values are
          simulated by the deterministic model; mitigation does not guarantee an improvement in
          every metric.
        </p>
      </Panel>
    </div>
  );
}
