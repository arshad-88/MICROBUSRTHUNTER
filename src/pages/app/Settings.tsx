import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { KeyValue, Panel, PanelHeader, Tag } from "@/components/kit";
import { useMonitoring } from "@/state/monitoring";
import { DEFAULT_CONFIG, cloneConfig, validateConfig } from "@/simulation";
import type { AppConfig } from "@/simulation/config";
import { RotateCcw, Save, Settings as SettingsIcon, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const { config, snapshot, updateConfig, setMitigationEnabled } = useMonitoring();
  const [draft, setDraft] = useState<AppConfig>(() => cloneConfig(config));
  const [issues, setIssues] = useState(() => validateConfig(config));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(cloneConfig(config));
  }, [config, dirty]);

  const patchDetection = (patch: Partial<AppConfig["detection"]>) => {
    setDraft((d) => ({ ...d, detection: { ...d.detection, ...patch } }));
    setDirty(true);
  };
  const patchMitigation = (patch: Partial<AppConfig["mitigation"]>) => {
    setDraft((d) => ({ ...d, mitigation: { ...d.mitigation, ...patch } }));
    setDirty(true);
  };
  const patchSimulation = (patch: Partial<AppConfig["simulation"]>) => {
    setDraft((d) => ({ ...d, simulation: { ...d.simulation, ...patch } }));
    setDirty(true);
  };

  const handleApply = () => {
    const found = updateConfig(draft);
    setIssues(found);
    if (found.length > 0) {
      toast.error("Settings not applied", { description: found[0].message });
      return;
    }
    setDirty(false);
    toast.success("Settings applied", {
      description: "Detection, mitigation and simulation parameters updated.",
    });
  };

  const handleReset = () => {
    const defaults = cloneConfig(DEFAULT_CONFIG);
    setDraft(defaults);
    updateConfig(defaults);
    setIssues([]);
    setDirty(false);
    toast("Settings reset to educational defaults");
  };

  const issueFor = (field: string) => issues.find((i) => i.field === field);

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <PanelHeader
          title="Configuration"
          index="08"
          icon={SettingsIcon}
          note="Invalid values are rejected on apply and the previous safe configuration is retained."
          actions={
            <>
              {dirty ? (
                <Tag tone="mitigated">unsaved changes</Tag>
              ) : (
                <Tag tone="neutral">in sync</Tag>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 rounded-sm"
                onClick={handleReset}
              >
                <RotateCcw className="size-3.5" />
                Reset defaults
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-1.5 rounded-sm"
                onClick={handleApply}
                disabled={!dirty}
              >
                <Save className="size-3.5" />
                Apply settings
              </Button>
            </>
          }
        />
        <div className="grid grid-cols-1 px-4 py-3 sm:grid-cols-3">
          <KeyValue label="Active window" mono>
            {snapshot.config.detection.windowMs} ms
          </KeyValue>
          <KeyValue label="Active threshold" mono>
            {snapshot.config.detection.minRateMbps} Mbps · ×
            {snapshot.config.detection.baselineMultiplier}
          </KeyValue>
          <KeyValue label="Data source" mono>
            {snapshot.dataSource}
          </KeyValue>
        </div>
      </Panel>

      {issues.length > 0 && (
        <div className="rounded-md border border-burst/45 bg-burst/[0.07] px-4 py-3">
          <p className="flex items-center gap-2 label-caps text-burst">
            <TriangleAlert className="size-3.5" />
            {issues.length} validation issue{issues.length > 1 ? "s" : ""}
          </p>
          <ul className="mt-2 space-y-1">
            {issues.map((issue) => (
              <li key={issue.field} className="text-[11px] text-muted-foreground">
                <span className="data-mono mr-2 text-muted-foreground/70">{issue.field}</span>
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Detection engine"
            note="Educational defaults that make a 10 ms microburst visible in a review."
          />
          <div className="space-y-3 px-4 py-3.5">
            <NumberField
              label="Minimum rate (Mbps)"
              value={draft.detection.minRateMbps}
              error={issueFor("detection.minRateMbps")?.message}
              onChange={(v) => patchDetection({ minRateMbps: v })}
            />
            <NumberField
              label="Baseline multiplier"
              value={draft.detection.baselineMultiplier}
              step="0.5"
              error={issueFor("detection.baselineMultiplier")?.message}
              onChange={(v) => patchDetection({ baselineMultiplier: v })}
            />
            <NumberField
              label="Sampling window (ms)"
              value={draft.detection.windowMs}
              error={issueFor("detection.windowMs")?.message}
              onChange={(v) => patchDetection({ windowMs: v })}
            />
            <NumberField
              label="Baseline window (ms)"
              value={draft.detection.baselineWindowMs}
              error={issueFor("detection.baselineWindowMs")?.message}
              onChange={(v) => patchDetection({ baselineWindowMs: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Persistence (windows)"
                value={draft.detection.persistenceWindows}
                error={issueFor("detection.persistenceWindows")?.message}
                onChange={(v) => patchDetection({ persistenceWindows: v })}
              />
              <NumberField
                label="Recovery windows"
                value={draft.detection.recoveryWindows}
                error={issueFor("detection.recoveryWindows")?.message}
                onChange={(v) => patchDetection({ recoveryWindows: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Burst cooldown (ms)"
                value={draft.detection.cooldownMs}
                error={issueFor("detection.cooldownMs")?.message}
                onChange={(v) => patchDetection({ cooldownMs: v })}
              />
              <NumberField
                label="Severe ratio (×)"
                value={draft.detection.severeRatio}
                step="0.5"
                error={issueFor("detection.severeRatio")?.message}
                onChange={(v) => patchDetection({ severeRatio: v })}
              />
            </div>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Adaptive mitigation" note="Rate-cap policy thresholds and safety limits." />
          <div className="space-y-3 px-4 py-3.5">
            <label
              htmlFor="settings-auto-mitigation"
              className="flex cursor-pointer items-center justify-between gap-3 rounded-sm border border-border bg-surface-2/60 px-3 py-2.5"
            >
              <span className="text-[12px] text-foreground">Automatic mitigation</span>
              <Switch
                id="settings-auto-mitigation"
                checked={draft.mitigation.autoEnabled}
                onCheckedChange={(checked) => {
                  patchMitigation({ autoEnabled: checked });
                  setMitigationEnabled(checked);
                }}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Mild cap (Mbps)"
                value={draft.mitigation.rateLimitMbps}
                error={issueFor("mitigation.rateLimitMbps")?.message}
                onChange={(v) => patchMitigation({ rateLimitMbps: v })}
              />
              <NumberField
                label="Severe cap (Mbps)"
                value={draft.mitigation.severeRateLimitMbps}
                error={issueFor("mitigation.severeRateLimitMbps")?.message}
                onChange={(v) => patchMitigation({ severeRateLimitMbps: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Maximum duration (ms)"
                value={draft.mitigation.maxDurationMs}
                error={issueFor("mitigation.maxDurationMs")?.message}
                onChange={(v) => patchMitigation({ maxDurationMs: v })}
              />
              <NumberField
                label="Cooldown (ms)"
                value={draft.mitigation.cooldownMs}
                error={issueFor("mitigation.cooldownMs")?.message}
                onChange={(v) => patchMitigation({ cooldownMs: v })}
              />
            </div>
            <NumberField
              label="Recovery fraction (0–1)"
              value={draft.mitigation.recoveryFraction}
              step="0.05"
              error={issueFor("mitigation.recoveryFraction")?.message}
              onChange={(v) => patchMitigation({ recoveryFraction: v })}
            />
            <p className="border-t border-border pt-2.5 text-[10.5px] leading-4 text-muted-foreground">
              The cap is applied inside the traffic model. Real interface shaping is performed by
              the separate Python backend, never from the browser.
            </p>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Simulation & source" note="Deterministic generator and data-source configuration." />
          <div className="space-y-3 px-4 py-3.5">
            <div>
              <Label htmlFor="data-source" className="label-caps text-muted-foreground">
                Data source
              </Label>
              <Select
                value={draft.simulation.dataSource}
                onValueChange={(v) => patchSimulation({ dataSource: v as "simulated" | "live" })}
              >
                <SelectTrigger id="data-source" className="mt-1 w-full rounded-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simulated">Simulation (deterministic model)</SelectItem>
                  <SelectItem value="live" disabled>
                    Live capture (requires Python backend)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
                The browser build always reports simulated data. Live capture is provided by the
                separate Python/Scapy backend and must be started explicitly.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Capacity (Mbps)"
                value={draft.simulation.linkCapacityMbps}
                error={issueFor("simulation.linkCapacityMbps")?.message}
                onChange={(v) => patchSimulation({ linkCapacityMbps: v })}
              />
              <NumberField
                label="Base latency (ms)"
                value={draft.simulation.baseLatencyMs}
                step="0.1"
                error={issueFor("simulation.baseLatencyMs")?.message}
                onChange={(v) => patchSimulation({ baseLatencyMs: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Tick interval (ms)"
                value={draft.simulation.tickIntervalMs}
                error={issueFor("simulation.tickIntervalMs")?.message}
                onChange={(v) => patchSimulation({ tickIntervalMs: v })}
              />
              <NumberField
                label="Windows per tick"
                value={draft.simulation.windowsPerTick}
                error={issueFor("simulation.windowsPerTick")?.message}
                onChange={(v) => patchSimulation({ windowsPerTick: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Burst peak (Mbps)"
                value={draft.simulation.burstPeakMbps}
                error={issueFor("simulation.burstPeakMbps")?.message}
                onChange={(v) => patchSimulation({ burstPeakMbps: v })}
              />
              <NumberField
                label="Burst duration (ms)"
                value={draft.simulation.burstDurationMs}
                error={issueFor("simulation.burstDurationMs")?.message}
                onChange={(v) => patchSimulation({ burstDurationMs: v })}
              />
            </div>
            <div>
              <Label htmlFor="settings-seed" className="label-caps text-muted-foreground">
                PRNG seed
              </Label>
              <Input
                id="settings-seed"
                type="number"
                value={Number.isFinite(draft.simulation.seed) ? String(draft.simulation.seed) : ""}
                className="data-mono mt-1 rounded-sm"
                onChange={(e) => patchSimulation({ seed: Number(e.target.value) })}
              />
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                Identical seed and settings reproduce a run exactly.
              </p>
            </div>
            <div>
              <Label htmlFor="settings-burst-host" className="label-caps text-muted-foreground">
                Burst source host
              </Label>
              <Select
                value={draft.simulation.burstHostId}
                onValueChange={(v) => patchSimulation({ burstHostId: v })}
              >
                <SelectTrigger id="settings-burst-host" className="mt-1 w-full rounded-sm">
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
              {issueFor("simulation.burstHostId") && (
                <p className="mt-1 text-[10.5px] text-burst">
                  {issueFor("simulation.burstHostId")?.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="settings-interface" className="label-caps text-muted-foreground">
                Interface (live capture, optional)
              </Label>
              <Input
                id="settings-interface"
                value={draft.simulation.interfaceName ?? ""}
                placeholder="e.g. eth0 — unused in simulation"
                className="data-mono mt-1 rounded-sm"
                onChange={(e) => patchSimulation({ interfaceName: e.target.value || null })}
              />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = "1",
  error,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
  error?: string;
}) {
  const id = `field-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <div>
      <Label htmlFor={id} className="label-caps text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        step={step}
        value={Number.isFinite(value) ? String(value) : ""}
        className="data-mono mt-1 rounded-sm"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {error && <p className="mt-1 text-[10.5px] text-burst">{error}</p>}
    </div>
  );
}
