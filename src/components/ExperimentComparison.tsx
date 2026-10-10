import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatMbpsValue, formatMs } from "@/lib/format";
import type { ExperimentResult } from "@/types";

function latestPerScenario(experiments: ExperimentResult[]) {
  const map = new Map<number, ExperimentResult>();
  for (const exp of experiments) {
    if (!map.has(exp.scenario)) map.set(exp.scenario, exp);
  }
  return [1, 2, 3]
    .map((id) => map.get(id))
    .filter((x): x is ExperimentResult => Boolean(x))
    .map((exp) => ({
      name: `Exp ${exp.scenario}`,
      "Peak rate": Number((exp.burstPeakMbps ?? exp.avgRateMbps).toFixed(1)),
      "Average rate": Number(exp.avgRateMbps.toFixed(1)),
      "Simulated drops (Mb)": Number(exp.dropMb.toFixed(2)),
      "Latency (ms)": Number(exp.latencyMs.toFixed(1)),
    }));
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} className="flex items-center justify-between gap-4">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="tabular-nums">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export function ExperimentComparison({ experiments }: { experiments: ExperimentResult[] }) {
  const comparison = latestPerScenario(experiments);

  if (experiments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No experiment runs recorded yet. Run a scenario to populate the comparison.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="mb-3 text-sm font-semibold tracking-tight">
          Latest run per scenario
        </p>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={comparison} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                stroke="var(--color-border)"
              />
              <YAxis
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                stroke="var(--color-border)"
                width={44}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-muted)", opacity: 0.3 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Peak rate" fill="var(--color-chart-5)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Average rate" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Simulated drops (Mb)" fill="var(--color-chart-3)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Latency (ms)" fill="var(--color-chart-2)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Scenario</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Burst peak</TableHead>
              <TableHead className="text-right">Average</TableHead>
              <TableHead className="text-right">Detection delay</TableHead>
              <TableHead className="text-right">Bursts</TableHead>
              <TableHead className="text-right">Drops (sim)</TableHead>
              <TableHead className="text-right">Latency (sim)</TableHead>
              <TableHead className="text-right">Mitigation</TableHead>
              <TableHead>Seed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {experiments.map((exp) => (
              <TableRow key={exp.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDateTime(exp.timestamp)}
                </TableCell>
                <TableCell className="text-xs">Exp {exp.scenario}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {formatMs(exp.durationMs, 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {exp.burstPeakMbps !== null ? `${formatMbpsValue(exp.burstPeakMbps)}` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {formatMbpsValue(exp.avgRateMbps)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {exp.detectionDelayMs !== null ? formatMs(exp.detectionDelayMs, 0) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">{exp.burstCount}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {exp.dropMb.toFixed(2)} Mb
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {formatMs(exp.latencyMs)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {exp.mitigationDurationMs > 0 ? formatMs(exp.mitigationDurationMs, 0) : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{exp.seed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          Identical generator settings and PRNG seed are used per scenario for comparability. Values
          are simulated; mitigation does not guarantee an improvement in every metric — read the
          actual numbers.
        </p>
      </div>
    </div>
  );
}
