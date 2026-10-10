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
import { useMonitoring } from "@/state/monitoring";
import { DEFAULT_CONFIG, cloneConfig, validateConfig } from "@/simulation";
import type { AppConfig } from "@/simulation/config";
import { RotateCcw, Save, TriangleAlert } from "lucide-react";
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">Configuration</p>
          <p className="text-[11px] text-muted-foreground">
            Invalid values are rejected and the previous safe configuration is kept.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={handleReset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
          <Button type="button" size="sm" className="gap-1.5" onClick={handleApply} disabled={!dirty}>
            <Save className="size-3.5" />
            Apply settings
          </Button>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="rounded-lg border border-burst/40 bg-burst/10 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-burst">
            <TriangleAlert className="size-4" />
            {issues.length} validation issue{issues.length > 1 ? "s" : ""}
          </p>
          <ul className="mt-1.5 list-disc pl-6 text-xs text-muted-foreground">
            {issues.map((issue) => (
              <li key={issue.field}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Detection engine" subtitle="Microburst detector parameters">
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
          <NumberField
            label="Burst persistence (windows)"
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
          <NumberField
            label="Burst cooldown (ms)"
            value={draft.detection.cooldownMs}
            error={issueFor("detection.cooldownMs")?.message}
            onChange={(v) => patchDetection({ cooldownMs: v })}
          />
          <NumberField
            label="Severe ratio (× baseline)"
            value={draft.detection.severeRatio}
            step="0.5"
            error={issueFor("detection.severeRatio")?.message}
            onChange={(v) => patchDetection({ severeRatio: v })}
          />
        </Section>

        <Section title="Adaptive mitigation" subtitle="Rate cap policy">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <Label className="text-sm">Automatic mitigation</Label>
            <Switch
              checked={draft.mitigation.autoEnabled}
              onCheckedChange={(checked) => {
                patchMitigation({ autoEnabled: checked });
                setMitigationEnabled(checked);
              }}
            />
          </div>
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
          <NumberField
            label="Maximum duration (ms)"
            value={draft.mitigation.maxDurationMs}
            error={issueFor("mitigation.maxDurationMs")?.message}
            onChange={(v) => patchMitigation({ maxDurationMs: v })}
          />
          <NumberField
            label="Mitigation cooldown (ms)"
            value={draft.mitigation.cooldownMs}
            error={issueFor("mitigation.cooldownMs")?.message}
            onChange={(v) => patchMitigation({ cooldownMs: v })}
          />
          <NumberField
            label="Recovery fraction (0-1)"
            value={draft.mitigation.recoveryFraction}
            step="0.05"
            error={issueFor("mitigation.recoveryFraction")?.message}
            onChange={(v) => patchMitigation({ recoveryFraction: v })}
          />
        </Section>

        <Section title="Simulation & source" subtitle="Traffic generator and data source">
          <div>
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Data source
            </Label>
            <Select
              value={draft.simulation.dataSource}
              onValueChange={(v) => patchSimulation({ dataSource: v as "simulated" | "live" })}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="simulated">Simulation (deterministic model)</SelectItem>
                <SelectItem value="live" disabled>
                  Live capture (requires Python backend)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The browser build always reports simulated data. Live capture is provided by the
              separate Python/Scapy backend and must be started explicitly.
            </p>
          </div>
          <NumberField
            label="Bottleneck capacity (Mbps)"
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
          <NumberField
            label="PRNG seed"
            value={draft.simulation.seed}
            error={issueFor("simulation.seed")?.message}
            onChange={(v) => patchSimulation({ seed: v })}
          />
          <div>
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Burst source host
            </Label>
            <Select
              value={draft.simulation.burstHostId}
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
            {issueFor("simulation.burstHostId") && (
              <p className="mt-1 text-[11px] text-burst">
                {issueFor("simulation.burstHostId")?.message}
              </p>
            )}
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Interface (live capture, optional)
            </Label>
            <Input
              value={draft.simulation.interfaceName ?? ""}
              placeholder="e.g. eth0 (unused in simulation)"
              className="mt-1"
              onChange={(e) =>
                patchSimulation({ interfaceName: e.target.value || null })
              }
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <p className="text-sm font-semibold tracking-tight">{title}</p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="space-y-3">{children}</div>
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
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        value={Number.isFinite(value) ? String(value) : ""}
        className="mt-1"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {error && <p className="mt-1 text-[11px] text-burst">{error}</p>}
    </div>
  );
}
