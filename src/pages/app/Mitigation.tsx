import { ControlBar } from "@/components/ControlBar";
import { MitigationPanel } from "@/components/MitigationPanel";
import { useMonitoring } from "@/state/monitoring";

export default function Mitigation() {
  const { snapshot } = useMonitoring();

  return (
    <div className="space-y-5">
      <ControlBar />
      <MitigationPanel />

      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        <p className="font-semibold tracking-tight">Policy sequence</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
          <li>Normal traffic — no restriction is applied.</li>
          <li>Moderate burst — a mild temporary rate cap is enforced on the offending flow.</li>
          <li>Severe burst — a stricter cap is applied and an alert is raised.</li>
          <li>Recovered traffic — the cap is relaxed or removed and recovery is logged.</li>
          <li>
            Invalid parameters — the policy fails safely, keeps the previous state and records the
            failure.
          </li>
        </ol>
        <p className="mt-3 text-[11px] text-muted-foreground">
          The cap is applied inside the simulation model (the source is clamped to the cap before
          rates and queue effects are computed), so the chart, topology and source table all reflect
          the change. Current max duration{" "}
          {snapshot.config.mitigation.maxDurationMs} ms · cooldown{" "}
          {snapshot.config.mitigation.cooldownMs} ms.
        </p>
      </div>
    </div>
  );
}
