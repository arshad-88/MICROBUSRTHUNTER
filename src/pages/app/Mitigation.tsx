import { useMemo } from "react";
import { ControlBar } from "@/components/ControlBar";
import { MitigationPanel } from "@/components/MitigationPanel";
import { Panel, PanelHeader, Tag } from "@/components/kit";
import { useMonitoring } from "@/state/monitoring";
import { formatMbpsValue, formatMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Gauge, ShieldCheck } from "lucide-react";

type StageState = "done" | "active" | "pending";

const STAGE_DOT: Record<StageState, string> = {
  done: "bg-success",
  active: "bg-warning mbh-pulse",
  pending: "bg-muted-foreground/40",
};

const STAGE_TEXT: Record<StageState, string> = {
  done: "text-success",
  active: "text-warning",
  pending: "text-muted-foreground",
};

const STAGE_LABEL: Record<StageState, string> = {
  done: "complete",
  active: "in progress",
  pending: "pending",
};

export default function Mitigation() {
  const { snapshot } = useMonitoring();
  const { mitigation, currentBurst, config } = snapshot;

  const appliedEver = useMemo(
    () =>
      snapshot.events.some(
        (e) => e.type === "mitigation_activated" || e.type === "mitigation_adjusted",
      ),
    [snapshot.events],
  );
  const recoveredEver = useMemo(
    () => snapshot.events.some((e) => e.type === "traffic_recovered"),
    [snapshot.events],
  );

  const stages: { key: string; label: string; detail: string; state: StageState }[] = [
    {
      key: "01",
      label: "Detection",
      detail:
        snapshot.burstActive && currentBurst
          ? `${formatMbpsValue(currentBurst.peakMbps)} Mbps above threshold`
          : snapshot.burstCount > 0
            ? `${snapshot.burstCount} burst(s) declared this session`
            : "no qualifying window yet",
      state: snapshot.burstActive ? "active" : snapshot.burstCount > 0 ? "done" : "pending",
    },
    {
      key: "02",
      label: "Source identification",
      detail: currentBurst
        ? `${currentBurst.hostName} · ${currentBurst.sourceIp}`
        : snapshot.burstCount > 0
          ? "last burst attributed to its leading contributor"
          : "awaiting a burst to attribute",
      state: snapshot.burstActive
        ? "active"
        : snapshot.burstCount > 0 || appliedEver
          ? "done"
          : "pending",
    },
    {
      key: "03",
      label: "Policy decision",
      detail:
        mitigation.severity !== "none"
          ? `${mitigation.severity} → ${formatMbpsValue(mitigation.rateLimitMbps, 0)} Mbps${
              config.mitigation.autoEnabled ? "" : " (auto disabled)"
            }`
          : config.mitigation.autoEnabled
            ? "armed · severity decides the cap"
            : "automatic policy disabled",
      state: appliedEver || mitigation.active ? "done" : config.mitigation.autoEnabled ? "pending" : "pending",
    },
    {
      key: "04",
      label: "Mitigation",
      detail: mitigation.active
        ? `cap enforced on ${mitigation.targetName}`
        : appliedEver
          ? "cap released — flow unrestricted"
          : "no cap has been applied",
      state: mitigation.active ? "active" : appliedEver ? "done" : "pending",
    },
    {
      key: "05",
      label: "Verification",
      detail: mitigation.after.samples > 0
        ? `${mitigation.after.samples} windows sampled under the cap`
        : "no post-action samples yet",
      state: mitigation.active
        ? "active"
        : mitigation.after.samples > 0
          ? "done"
          : "pending",
    },
    {
      key: "06",
      label: "Recovery",
      detail:
        mitigation.recovery === "recovered"
          ? `released after ${formatMs(mitigation.durationMs, 0)}`
          : recoveredEver
            ? "previous flow recovered"
            : mitigation.active
              ? "waiting for quiet windows"
              : "not applicable yet",
      state: mitigation.recovery === "recovered" || (recoveredEver && !mitigation.active) ? "done" : mitigation.active ? "active" : "pending",
    },
  ];

  return (
    <div className="space-y-4">
      <ControlBar />

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Operational sequence"
          icon={Gauge}
          note="Detection → source identification → policy decision → mitigation → verification → recovery. Each stage reflects recorded engine events."
          actions={<Tag tone="neutral">Cause and effect</Tag>}
        />
        <ol className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-6">
          {stages.map((stage) => (
            <li
              key={stage.key}
              className="flex flex-col gap-1.5 border-b border-border/60 px-4 py-3 last:border-b-0 lg:border-b-0 lg:border-l lg:first:border-l-0"
            >
              <span className="flex items-center gap-2">
                <span className={cn("size-1.5 rounded-full", STAGE_DOT[stage.state])} />
                <span className="data-mono text-[10px] text-muted-foreground/60">
                  {stage.key}
                </span>
                <span
                  className={cn(
                    "label-caps ml-auto text-[8.5px]",
                    STAGE_TEXT[stage.state],
                  )}
                >
                  {STAGE_LABEL[stage.state]}
                </span>
              </span>
              <span className="text-[12px] font-medium text-foreground">{stage.label}</span>
              <span className="text-[10.5px] leading-4 text-muted-foreground">
                {stage.detail}
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      <MitigationPanel />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="overflow-hidden">
          <PanelHeader title="Policy rules" icon={ShieldCheck} />
          <ol className="divide-y divide-border/60">
            {[
              ["Normal traffic", "no restriction is applied to any flow."],
              ["Moderate burst", "a mild temporary cap is enforced on the offending flow."],
              ["Severe burst", "a stricter cap is applied and the event is raised as critical."],
              ["Recovered traffic", "the cap is released and the recovery is logged."],
              [
                "Invalid parameters",
                "the policy fails safe, keeps the previous state and records the failure.",
              ],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3 px-4 py-2.5">
                <span className="data-mono shrink-0 pt-0.5 text-[10px] text-muted-foreground/60">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <span className="block text-[11.5px] font-medium text-foreground">
                    {title}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-4 text-muted-foreground">
                    {body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Scope and honesty" icon={Gauge} />
          <div className="space-y-2.5 px-4 py-3.5 text-[11px] leading-5 text-muted-foreground">
            <p>
              The cap is applied{" "}
              <span className="text-foreground">inside the traffic model</span>: the offending
              source is clamped before aggregate rate, queue overflow and latency are computed, so
              the chart, fabric plane and source table change together.
            </p>
            <p>
              Current limits: max duration {config.mitigation.maxDurationMs} ms, cooldown{" "}
              {config.mitigation.cooldownMs} ms, recovery fraction{" "}
              {config.mitigation.recoveryFraction}. These are educational defaults, editable in
              Settings.
            </p>
            <p className="border-t border-border pt-2.5">
              The browser never executes privileged Linux{" "}
              <code className="text-muted-foreground">tc</code> commands. Real per-source shaping is
              performed by the separate Python/Scapy backend, which validates every parameter, runs
              dry by default and supports rollback.
            </p>
            <p className="text-muted-foreground/70">
              Mitigation is not guaranteed to improve every metric — compare the numbers before and
              after rather than assuming an outcome.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
