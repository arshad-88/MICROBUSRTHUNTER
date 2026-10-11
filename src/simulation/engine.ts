import type {
  AppEvent,
  BurstEvent,
  EventSeverity,
  EventType,
  ExperimentResult,
  ExperimentScenarioId,
  HostState,
  LinkState,
  MitigationState,
  TrafficSample,
  TrafficState,
  TrafficSummary,
} from "@/types";
import {
  DEFAULT_CONFIG,
  HOST_BASE_RATES,
  SOURCE_HOST_IDS,
  TOPOLOGY_LINKS,
  TOPOLOGY_NODES,
  type AppConfig,
} from "./config";
import {
  TRAFFIC_SCENARIOS,
  type TrafficScenarioType,
  type ScenarioRunOptions,
  type WindowTelemetry,
} from "./scenarios";
import {
  MicroburstDetector,
  type StructuredDetectionEvent,
} from "./detector";


import {
  applyRateCap,
  bytesToMbps,
  bytesToPackets,
  classifySeverity,
  clamp,
  contributionPct,
  detectionThreshold,
  mbpsToBytes,
  mulberry32,
  rollingBaseline,
  simulateQueue,
} from "./detection";

const MAX_HISTORY = 600;

export interface ScheduledBurst {
  hostId: string;
  startSim: number;
  endSim: number;
  peakMbps: number;
  origin: "manual" | "experiment";
}

export interface BurstInterval {
  start: number;
  end: number | null;
}

export interface SourceRow {
  id: string;
  name: string;
  ip: string;
  packets: number;
  bytes: number;
  rateMbps: number;
  contributionPct: number;
  policy: string;
  rateCapMbps: number | null;
  state: TrafficState;
}

export interface ExperimentScenarioDef {
  id: ExperimentScenarioId;
  name: string;
  summary: string;
  usesBurst: boolean;
  usesMitigation: boolean;
}

export const EXPERIMENT_SCENARIOS: ExperimentScenarioDef[] = [
  {
    id: 1,
    name: "Experiment 1 — Normal traffic (no mitigation)",
    summary:
      "Steady multi-source load with no burst. Establishes the baseline rate, latency and (near-zero) drop behaviour.",
    usesBurst: false,
    usesMitigation: false,
  },
  {
    id: 2,
    name: "Experiment 2 — Burst traffic (no mitigation)",
    summary:
      "A reproducible microburst is injected from the burst host. The detector fires but no rate cap is applied.",
    usesBurst: true,
    usesMitigation: false,
  },
  {
    id: 3,
    name: "Experiment 3 — Burst traffic with adaptive mitigation",
    summary:
      "The identical burst as Experiment 2, but the adaptive policy caps the offending flow once detected.",
    usesBurst: true,
    usesMitigation: true,
  },
];

export interface MonitoringSnapshot {
  running: boolean;
  dataSource: "simulated" | "live";
  interfaceName: string | null;
  simTime: number;
  config: AppConfig;
  hosts: HostState[];
  links: LinkState[];
  history: TrafficSample[];
  latest: TrafficSample | null;
  summary: TrafficSummary;
  burstActive: boolean;
  currentBurst: BurstEvent | null;
  burstCount: number;
  burstIntervals: BurstInterval[];
  burstTotalBytes: number;
  activeSourceIps: number;
  mitigation: MitigationState;
  events: AppEvent[];
  sources: SourceRow[];
  experiment: ExperimentRuntimeSnapshot;
  experiments: ExperimentResult[];
  selectedBurstHostId: string;
  activeScenario: TrafficScenarioType;
  latestTelemetry: WindowTelemetry | null;
  structuredDetections: import("./detector").StructuredDetectionEvent[];
  latestDetectorEvent: import("./detector").StructuredDetectionEvent | null;
}



export interface ExperimentRuntimeSnapshot {
  active: boolean;
  scenario: ExperimentScenarioId;
  startedAtSim: number | null;
  durationMs: number;
  progress: number;
}

interface StatsAccumulator {
  sampleCount: number;
  sumRate: number;
  peakRate: number;
  totalBytes: number;
  totalPackets: number;
  totalDropBytes: number;
  sumLatency: number;
  burstCount: number;
  burstPeak: number;
}

function emptyStats(): StatsAccumulator {
  return {
    sampleCount: 0,
    sumRate: 0,
    peakRate: 0,
    totalBytes: 0,
    totalPackets: 0,
    totalDropBytes: 0,
    sumLatency: 0,
    burstCount: 0,
    burstPeak: 0,
  };
}

function emptyComparison() {
  return { peakMbps: 0, throughputMbps: 0, dropMb: 0, latencyMs: 0, samples: 0 };
}

const WARMUP_FRACTION = 0.1;

export class SimulationEngine {
  config: AppConfig;
  private rng: () => number;
  private simTime = 0;
  private running = false;

  private samples: TrafficSample[] = [];
  private hostWander: Record<string, number> = {};
  private perSourceBytes: Record<string, number> = {};
  private perSourcePackets: Record<string, number> = {};
  private perSourceRate: Record<string, number> = {};
  private burstSourceBytes: Record<string, number> = {};
  private burstTotalBytes = 0;

  private caps: Record<string, number> = {};
  private scheduledBursts: ScheduledBurst[] = [];
  private burstIntervals: BurstInterval[] = [];

  private currentBurst: BurstEvent | null = null;
  private burstCount = 0;
  private qualifyingWindows = 0;
  private quietWindows = 0;
  private armedWindows = 0;
  private lastBurstEndSim = -Infinity;
  private lastMitigationEndSim = -Infinity;

  private mitigation: MitigationState;
  private session = emptyStats();
  private experimentStats: StatsAccumulator | null = null;
  private experimentMitigationMs = 0;
  private experimentFirstDetectionDelay: number | null = null;
  private experiment: ExperimentRuntimeSnapshot;
  private experiments: ExperimentResult[] = [];
  private experimentScenario: ExperimentScenarioDef | null = null;

  private events: AppEvent[] = [];
  private idCounter = 0;
  private dataSource: "simulated" | "live";
  private activeScenario: TrafficScenarioType = "normal";
  private activeScenarioParams: ScenarioRunOptions | null = null;
  private latestTelemetry: WindowTelemetry | null = null;
  private detector: MicroburstDetector;
  private latestDetectorEvent: StructuredDetectionEvent | null = null;

  constructor(options?: {
    config?: AppConfig;
    events?: AppEvent[];
    experiments?: ExperimentResult[];
  }) {
    this.config = options?.config ? cloneConfig(options.config) : cloneConfig(DEFAULT_CONFIG);
    this.rng = mulberry32(this.config.simulation.seed);
    this.dataSource = this.config.simulation.dataSource;
    this.events = options?.events ? [...options.events] : [];
    this.experiments = options?.experiments ? [...options.experiments] : [];
    this.mitigation = this.freshMitigation();
    this.experiment = {
      active: false,
      scenario: 1,
      startedAtSim: null,
      durationMs: this.config.simulation.experimentDurationMs,
      progress: 0,
    };
    this.detector = new MicroburstDetector({
      windowMs: this.config.detection.windowMs,
      minRateMbps: this.config.detection.minRateMbps,
      baselineMultiplier: this.config.detection.baselineMultiplier,
      persistenceWindows: this.config.detection.persistenceWindows,
      recoveryWindows: this.config.detection.recoveryWindows,
      cooldownMs: this.config.detection.cooldownMs,
    });
    this.resetCounters();
  }



  private freshMitigation(): MitigationState {
    return {
      autoEnabled: this.config.mitigation.autoEnabled,
      active: false,
      targetHostId: null,
      targetIp: null,
      targetName: null,
      rateLimitMbps: this.config.mitigation.rateLimitMbps,
      severity: "none",
      startedAtSim: null,
      durationMs: 0,
      state: "idle",
      recovery: "n/a",
      before: emptyComparison(),
      after: emptyComparison(),
      failureReason: null,
    };
  }

  private resetCounters() {
    for (const id of SOURCE_HOST_IDS) {
      this.hostWander[id] = 1;
      this.perSourceBytes[id] = 0;
      this.perSourcePackets[id] = 0;
      this.perSourceRate[id] = 0;
      this.burstSourceBytes[id] = 0;
    }
    this.burstTotalBytes = 0;
  }

  // ---------------------------------------------------------------- lifecycle

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.pushEvent("monitoring_started", "info", {
      action: "Monitoring started",
      outcome: `Simulated capture active on the ${SOURCE_HOST_IDS.length}-host test fabric.`,
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.pushEvent("monitoring_stopped", "info", {
      action: "Monitoring stopped",
      outcome: "Sampling halted. Retained history and event log remain available.",
    });
  }

  /** Full experiment reset: clears traffic history, bursts and policy state. */
  reset(seed?: number): void {
    if (seed !== undefined) this.config.simulation.seed = seed;
    this.rng = mulberry32(this.config.simulation.seed);
    this.simTime = 0;
    this.samples = [];
    this.caps = {};
    this.scheduledBursts = [];
    this.burstIntervals = [];
    this.currentBurst = null;
    this.burstCount = 0;
    this.qualifyingWindows = 0;
    this.quietWindows = 0;
    this.armedWindows = 0;
    this.lastBurstEndSim = -Infinity;
    this.lastMitigationEndSim = -Infinity;
    this.mitigation = this.freshMitigation();
    this.session = emptyStats();
    this.experimentStats = null;
    this.experimentMitigationMs = 0;
    this.experimentFirstDetectionDelay = null;
    this.experimentScenario = null;
    this.experiment = {
      active: false,
      scenario: this.experiment.scenario,
      startedAtSim: null,
      durationMs: this.config.simulation.experimentDurationMs,
      progress: 0,
    };
    this.detector.reset();
    this.latestDetectorEvent = null;
    this.resetCounters();
  }

  setConfig(config: AppConfig): void {
    const seedChanged = config.simulation.seed !== this.config.simulation.seed;
    this.config = cloneConfig(config);
    this.detector.updateConfig({
      windowMs: config.detection.windowMs,
      minRateMbps: config.detection.minRateMbps,
      baselineMultiplier: config.detection.baselineMultiplier,
      persistenceWindows: config.detection.persistenceWindows,
      recoveryWindows: config.detection.recoveryWindows,
      cooldownMs: config.detection.cooldownMs,
    });

    this.mitigation.autoEnabled = config.mitigation.autoEnabled;
    if (seedChanged) {
      this.rng = mulberry32(config.simulation.seed);
    }
    if (!this.mitigation.active) {
      this.mitigation.rateLimitMbps = config.mitigation.rateLimitMbps;
    }
    this.dataSource = config.simulation.dataSource;
  }

  // -------------------------------------------------------------- simulation

  /** Advance exactly one detector window. */
  private advanceWindow(): void {
    const { detection, simulation } = this.config;
    const w = detection.windowMs;

    this.simTime += w;

    // 1. Generate per-source rates (deterministic given the rng sequence).
    const perSource: Record<string, number> = {};
    let totalRate = 0;
    for (const id of SOURCE_HOST_IDS) {
      const base = HOST_BASE_RATES[id] ?? 10;
      this.hostWander[id] = clamp(
        this.hostWander[id] + (this.rng() - 0.5) * 0.05,
        0.7,
        1.4,
      );
      const noise = 0.85 + this.rng() * 0.3;
      let rate = base * this.hostWander[id] * noise;

      // Scheduled burst contribution.
      for (const burst of this.scheduledBursts) {
        if (burst.hostId !== id) continue;
        if (this.simTime < burst.startSim || this.simTime > burst.endSim) continue;
        const span = Math.max(1, burst.endSim - burst.startSim);
        const p = clamp((this.simTime - burst.startSim) / span, 0, 1);
        const shape =
          p < 0.12 ? p / 0.12 : p > 0.85 ? (1 - p) / 0.15 : 1;
        rate += burst.peakMbps * Math.max(0, shape);
      }

      // Enforced rate cap (the mitigation policy acts on the model here).
      rate = applyRateCap(rate, this.caps[id] ?? null);
      perSource[id] = rate;
      totalRate += rate;
    }

    // Apply active scenario dynamic traffic modulation (e.g. ramp or incast)
    if (this.activeScenario === "ramp") {
      const p = clamp(this.simTime / 8000, 0, 1);
      const rampScale = 1 + p * 3.2; // Increases traffic smoothly towards link saturation
      totalRate = 0;
      for (const id of SOURCE_HOST_IDS) {
        perSource[id] = applyRateCap(perSource[id] * rampScale, this.caps[id] ?? null);
        totalRate += perSource[id];
      }
    }

    // Drop finished bursts from the schedule.
    this.scheduledBursts = this.scheduledBursts.filter(
      (b) => this.simTime <= b.endSim,
    );

    // 2. Queue / drop / latency model.
    const queue = simulateQueue(
      totalRate,
      simulation.linkCapacityMbps,
      simulation.baseLatencyMs,
      w,
    );

    // 3. Baseline + threshold.
    const rawBaseline = rollingBaseline(this.samples, detection.baselineWindowMs);
    const baseline = rawBaseline ?? Math.max(1, detection.minRateMbps / 2);
    const threshold = detectionThreshold(
      baseline,
      detection.minRateMbps,
      detection.baselineMultiplier,
    );

    const warmupRequired = Math.max(
      5,
      Math.ceil((detection.baselineWindowMs / w) * WARMUP_FRACTION),
    );

    const totalBytes = mbpsToBytes(totalRate, w);
    const packets = bytesToPackets(totalBytes);
    const dropPackets = bytesToPackets(queue.dropBytes);

    const sample: TrafficSample = {
      t: this.simTime,
      rateMbps: totalRate,
      baselineMbps: baseline,
      thresholdMbps: threshold,
      bytes: totalBytes,
      packets,
      dropBytes: queue.dropBytes,
      dropPackets,
      latencyMs: queue.latencyMs,
      estimatedQueueBytes: queue.estimatedQueueBytes,
      estimatedQueuePct: queue.estimatedQueuePct,
      isEstimatedQueue: true,
      scenarioType: this.activeScenario,
      perSource: perSource,
    };

    // Build rich WindowTelemetry record
    const perSourceTelemetry: WindowTelemetry["perSource"] = {};
    for (const id of SOURCE_HOST_IDS) {
      const sRate = perSource[id] ?? 0;
      const sBytes = mbpsToBytes(sRate, w);
      perSourceTelemetry[id] = {
        rateMbps: sRate,
        bytes: sBytes,
        packets: bytesToPackets(sBytes),
        contributionPct: totalRate > 0 ? (sRate / totalRate) * 100 : 0,
      };
    }

    const scheduledActiveBurst = this.scheduledBursts.find(
      (b) => this.simTime >= b.startSim && this.simTime <= b.endSim,
    );

    this.latestTelemetry = {
      windowMs: w,
      t: this.simTime,
      scenarioId: this.activeScenario,
      rateMbps: totalRate,
      bytes: totalBytes,
      packets,
      estimatedQueueBytes: queue.estimatedQueueBytes,
      estimatedQueuePct: queue.estimatedQueuePct,
      isEstimatedQueue: true,
      dropBytes: queue.dropBytes,
      dropPackets,
      perSource: perSourceTelemetry,
      burstInfo: {
        active: this.currentBurst !== null || Boolean(scheduledActiveBurst),
        burstStartSim: this.currentBurst?.detectedAtSim ?? scheduledActiveBurst?.startSim ?? null,
        burstPeakMbps: this.currentBurst?.peakMbps ?? scheduledActiveBurst?.peakMbps ?? null,
        burstDurationMs: scheduledActiveBurst
          ? scheduledActiveBurst.endSim - scheduledActiveBurst.startSim
          : null,
      },
      dataSource: this.dataSource,
    };

    // Feed telemetry to Phase 3 independent detector engine
    const detectorEvent = this.detector.processWindow(this.latestTelemetry);
    if (detectorEvent) {
      this.latestDetectorEvent = detectorEvent;
    }

    // 4. Accumulate session / experiment statistics.

    this.accumulate(this.session, sample);
    if (this.experimentStats) this.accumulate(this.experimentStats, sample);

    // 5. Record per-source counters.
    for (const id of SOURCE_HOST_IDS) {
      const bytes = mbpsToBytes(perSource[id], w);
      this.perSourceBytes[id] += bytes;
      this.perSourcePackets[id] += bytesToPackets(bytes);
      this.perSourceRate[id] = perSource[id];
    }
    if (this.currentBurst) {
      for (const id of SOURCE_HOST_IDS) {
        this.burstSourceBytes[id] += mbpsToBytes(perSource[id], w);
      }
      this.burstTotalBytes += totalBytes;
    }

    // 6. Accumulate before/after comparison for an active mitigation.
    if (this.mitigation.active) {
      this.accumulateComparison(this.mitigation.after, sample);
    } else if (this.currentBurst) {
      this.accumulateComparison(this.mitigation.before, sample);
    }

    // 7. Detection state machine.
    const scheduledActive = this.hasScheduledBurst();
    const qualifying = totalRate > threshold;
    const armed = this.armedWindows >= warmupRequired;
    if (!armed) this.armedWindows += 1;

    if (!this.currentBurst) {
      if (armed && qualifying) {
        this.qualifyingWindows += 1;
        if (
          this.qualifyingWindows >= detection.persistenceWindows &&
          this.simTime - this.lastBurstEndSim >= detection.cooldownMs
        ) {
          this.startBurst(sample, perSource);
        }
      } else {
        this.qualifyingWindows = 0;
      }
    } else {
      if (totalRate > this.currentBurst.peakMbps) {
        this.currentBurst.peakMbps = totalRate;
      }
      if (this.experimentStats && totalRate > this.experimentStats.burstPeak) {
        this.experimentStats.burstPeak = totalRate;
      }
      const recovered = !qualifying && !scheduledActive;
      if (recovered) {
        this.quietWindows += 1;
        if (this.quietWindows >= detection.recoveryWindows) {
          this.endBurst();
        }
      } else {
        this.quietWindows = 0;
      }
    }

    // 8. Mitigation policy.
    this.updateMitigation(sample);

    // 9. Store history (capped).
    this.samples.push(sample);
    if (this.samples.length > MAX_HISTORY) {
      this.samples.splice(0, this.samples.length - MAX_HISTORY);
    }
  }

  private accumulate(stats: StatsAccumulator, sample: TrafficSample) {
    stats.sampleCount += 1;
    stats.sumRate += sample.rateMbps;
    stats.peakRate = Math.max(stats.peakRate, sample.rateMbps);
    stats.totalBytes += sample.bytes;
    stats.totalPackets += sample.packets;
    stats.totalDropBytes += sample.dropBytes;
    stats.sumLatency += sample.latencyMs;
  }

  private accumulateComparison(
    target: MitigationState["before"],
    sample: TrafficSample,
  ) {
    target.samples += 1;
    target.peakMbps = Math.max(target.peakMbps, sample.rateMbps);
    target.throughputMbps += sample.rateMbps;
    target.dropMb += sample.dropBytes * 8 / 1_000_000;
    target.latencyMs += sample.latencyMs;
  }

  private hasScheduledBurst(): boolean {
    return this.scheduledBursts.some(
      (b) => this.simTime >= b.startSim && this.simTime <= b.endSim,
    );
  }

  private topContributor(perSource: Record<string, number>): string {
    let best = SOURCE_HOST_IDS[0];
    for (const id of SOURCE_HOST_IDS) {
      if ((perSource[id] ?? 0) > (perSource[best] ?? 0)) best = id;
    }
    return best;
  }

  private startBurst(sample: TrafficSample, perSource: Record<string, number>) {
    const hostId = this.topContributor(perSource);
    const node = TOPOLOGY_NODES.find((n) => n.id === hostId);
    const windowTotal = Object.values(perSource).reduce((a, b) => a + b, 0);
    const severity = classifySeverity(
      sample.rateMbps,
      sample.baselineMbps,
      this.config.detection.severeRatio,
    );
    const schedule = this.scheduledBursts.find(
      (b) => this.simTime >= b.startSim && this.simTime <= b.endSim,
    );
    const detectionDelayMs = schedule ? this.simTime - schedule.startSim : null;

    // Reset burst contribution counters with the detection window.
    for (const id of SOURCE_HOST_IDS) this.burstSourceBytes[id] = 0;
    this.burstTotalBytes = 0;

    this.currentBurst = {
      id: this.nextId("burst"),
      detectedAtSim: this.simTime,
      endedAtSim: null,
      peakMbps: sample.rateMbps,
      baselineMbps: sample.baselineMbps,
      thresholdMbps: sample.thresholdMbps,
      hostId,
      sourceIp: node?.ip ?? "unknown",
      hostName: node?.name ?? hostId,
      contributionPct: contributionPct(perSource[hostId] ?? 0, windowTotal),
      severity,
      detectionDelayMs,
      mitigationCount: 0,
    };
    this.burstCount += 1;
    this.qualifyingWindows = 0;
    this.quietWindows = 0;
    this.burstIntervals.push({ start: this.simTime, end: null });
    if (this.experimentStats) {
      this.experimentStats.burstCount += 1;
      this.experimentStats.burstPeak = Math.max(
        this.experimentStats.burstPeak,
        sample.rateMbps,
      );
      if (
        this.experimentFirstDetectionDelay === null &&
        detectionDelayMs !== null
      ) {
        this.experimentFirstDetectionDelay = detectionDelayMs;
      }
    }

    this.pushEvent("burst_detected", severity === "severe" ? "critical" : "warning", {
      action: `Microburst detected on ${this.currentBurst.hostName} (${this.currentBurst.sourceIp})`,
      outcome: `${sample.rateMbps.toFixed(1)} Mbps measured vs ${sample.thresholdMbps.toFixed(1)} Mbps threshold (baseline ${sample.baselineMbps.toFixed(1)} Mbps).`,
      rateMbps: sample.rateMbps,
      sourceIp: this.currentBurst.sourceIp,
      hostName: this.currentBurst.hostName,
    });
    this.pushEvent("source_ranked", "info", {
      action: `Top contributor: ${this.currentBurst.hostName} (${this.currentBurst.sourceIp})`,
      outcome: `${this.currentBurst.contributionPct.toFixed(1)}% of burst bytes. High volume alone is not proof of malicious intent.`,
      rateMbps: perSource[hostId] ?? 0,
      sourceIp: this.currentBurst.sourceIp,
      hostName: this.currentBurst.hostName,
    });
  }

  private endBurst() {
    if (!this.currentBurst) return;
    this.currentBurst.endedAtSim = this.simTime;
    const interval = this.burstIntervals[this.burstIntervals.length - 1];
    if (interval && interval.end === null) interval.end = this.simTime;
    this.lastBurstEndSim = this.simTime;
    this.pushEvent("burst_ended", "success", {
      action: `Burst on ${this.currentBurst.hostName} ended`,
      outcome: `Peak ${this.currentBurst.peakMbps.toFixed(1)} Mbps; traffic back below threshold.`,
      rateMbps: this.currentBurst.peakMbps,
      sourceIp: this.currentBurst.sourceIp,
      hostName: this.currentBurst.hostName,
    });
    if (this.mitigation.active) {
      this.removeMitigation("recovery");
    }
    this.currentBurst = null;
    this.qualifyingWindows = 0;
  }

  private updateMitigation(sample: TrafficSample) {
    const { mitigation: cfg, detection } = this.config;

    if (this.mitigation.active) {
      this.mitigation.durationMs = this.simTime - (this.mitigation.startedAtSim ?? this.simTime);
      if (this.experimentStats) {
        this.experimentMitigationMs += detection.windowMs;
      }
      // Recovery check independent of burst bookkeeping (max-duration safety).
      if (this.mitigation.durationMs >= cfg.maxDurationMs) {
        this.pushEvent("mitigation_removed", "warning", {
          action: "Mitigation cap reached maximum duration",
          outcome: `Cap removed after ${this.mitigation.durationMs} ms (max ${cfg.maxDurationMs} ms).`,
          rateMbps: sample.rateMbps,
          sourceIp: this.mitigation.targetIp ?? undefined,
        });
        this.removeMitigation("max-duration");
      }
      return;
    }

    if (!this.currentBurst || !cfg.autoEnabled) return;
    if (this.simTime - this.lastMitigationEndSim < cfg.cooldownMs) return;

    const severity = this.currentBurst.severity;
    const limit =
      severity === "severe" ? cfg.severeRateLimitMbps : cfg.rateLimitMbps;
    this.applyMitigation(this.currentBurst.hostId, limit, severity, sample);
  }

  private applyMitigation(
    hostId: string,
    limitMbps: number,
    severity: "moderate" | "severe",
    sample: TrafficSample,
  ) {
    if (!Number.isFinite(limitMbps) || limitMbps <= 0) {
      this.mitigation = {
        ...this.mitigation,
        state: "failed",
        failureReason: `Invalid rate limit "${limitMbps}". Previous safe state retained.`,
      };
      this.pushEvent("policy_failed", "critical", {
        action: "Mitigation policy rejected",
        outcome: `Rate limit ${limitMbps} Mbps is invalid; no cap applied.`,
      });
      return;
    }

    const node = TOPOLOGY_NODES.find((n) => n.id === hostId);
    this.caps[hostId] = limitMbps;
    const isFirst = !this.mitigation.active;
    this.mitigation = {
      ...this.mitigation,
      active: true,
      targetHostId: hostId,
      targetIp: node?.ip ?? null,
      targetName: node?.name ?? hostId,
      rateLimitMbps: limitMbps,
      severity,
      startedAtSim: this.simTime,
      durationMs: 0,
      state: "applied",
      recovery: "pending",
      failureReason: null,
      before: isFirst ? { ...emptyComparison(), samples: 1, peakMbps: sample.rateMbps, throughputMbps: sample.rateMbps, dropMb: (sample.dropBytes * 8) / 1_000_000, latencyMs: sample.latencyMs } : this.mitigation.before,
      after: emptyComparison(),
    };
    if (this.currentBurst) this.currentBurst.mitigationCount += 1;

    const limitLabel = `${limitMbps.toFixed(0)} Mbps cap on ${node?.name ?? hostId}`;
    this.pushEvent(
      isFirst ? "mitigation_activated" : "mitigation_adjusted",
      severity === "severe" ? "critical" : "warning",
      {
        action: `${isFirst ? "Mitigation activated" : "Mitigation adjusted"} — ${severity} burst`,
        outcome: `Applied ${limitLabel}. Simulated flow is capped in the traffic model.`,
        rateMbps: sample.rateMbps,
        sourceIp: node?.ip,
        hostName: node?.name,
      },
    );
  }

  private removeMitigation(reason: "recovery" | "max-duration" | "manual") {
    if (!this.mitigation.active) return;
    const target = this.mitigation.targetHostId;
    if (target) delete this.caps[target];
    const duration = this.simTime - (this.mitigation.startedAtSim ?? this.simTime);
    this.lastMitigationEndSim = this.simTime;
    this.mitigation = {
      ...this.mitigation,
      active: false,
      durationMs: duration,
      state: "idle",
      recovery: reason === "recovery" ? "recovered" : this.mitigation.recovery,
    };
    if (reason === "recovery") {
      this.pushEvent("traffic_recovered", "success", {
        action: "Traffic recovered",
        outcome: `Cap on ${this.mitigation.targetName ?? target} released after ${duration.toFixed(0)} ms.`,
        sourceIp: this.mitigation.targetIp ?? undefined,
      });
    }
    this.pushEvent("mitigation_removed", "success", {
      action: "Mitigation removed",
      outcome:
        reason === "manual"
          ? "Manual override cleared the cap."
          : reason === "max-duration"
            ? "Cap cleared at maximum duration."
            : "Flow restored to unrestricted traffic.",
      sourceIp: this.mitigation.targetIp ?? undefined,
    });
  }

  // ------------------------------------------------------------------ actions

  setMitigationEnabled(enabled: boolean): void {
    if (this.config.mitigation.autoEnabled === enabled) return;
    this.config.mitigation.autoEnabled = enabled;
    this.mitigation.autoEnabled = enabled;
    this.pushEvent("mode_changed", "info", {
      action: `Automatic mitigation ${enabled ? "enabled" : "disabled"}`,
      outcome: enabled
        ? "Policy will apply a rate cap when a burst is detected."
        : "Detected bursts will be recorded but no cap applied.",
    });
    if (!enabled && this.mitigation.active) {
      this.removeMitigation("manual");
    }
  }

  applyManualMitigation(hostId: string, limitMbps: number): void {
    const severity = this.currentBurst?.severity ?? "moderate";
    this.mitigation.before = emptyComparison();
    this.applyMitigation(hostId, limitMbps, severity, this.samples[this.samples.length - 1] ?? {
      t: this.simTime,
      rateMbps: 0,
      baselineMbps: 0,
      thresholdMbps: 0,
      bytes: 0,
      packets: 0,
      dropBytes: 0,
      latencyMs: this.config.simulation.baseLatencyMs,
      perSource: { ...this.perSourceRate },
    });
  }

  removeMitigationManual(): void {
    this.removeMitigation("manual");
  }

  /**
   * Schedule a reproducible burst on the traffic model.
   *
   * `startDelayMs` postpones the onset (in logical ms). The default is one
   * sampling window; the caller can push it further out so the detector has
   * undisturbed history to compare against. This only changes *when* the burst
   * starts — the detection rule and threshold are untouched.
   */
  simulateBurst(
    hostId?: string,
    opts?: { peakMbps?: number; durationMs?: number; startDelayMs?: number },
  ): void {
    const target = hostId ?? this.config.simulation.burstHostId;
    const duration = opts?.durationMs ?? this.config.simulation.burstDurationMs;
    const peak = opts?.peakMbps ?? this.config.simulation.burstPeakMbps;
    const startDelay = Math.max(
      this.config.detection.windowMs,
      opts?.startDelayMs ?? this.config.detection.windowMs,
    );
    this.scheduledBursts.push({
      hostId: target,
      startSim: this.simTime + startDelay,
      endSim: this.simTime + startDelay + duration,
      peakMbps: peak,
      origin: "manual",
    });
  }

  /**
   * Set and configure an active traffic simulation scenario.
   */
  setScenario(options: ScenarioRunOptions): void {
    const def = TRAFFIC_SCENARIOS[options.scenario];
    if (!def) return;
    this.activeScenario = options.scenario;
    this.activeScenarioParams = { ...options };

    if (options.seed !== undefined) {
      this.config.simulation.seed = options.seed;
      this.rng = mulberry32(options.seed);
    }

    if (options.windowMs !== undefined && options.windowMs > 0) {
      this.config.detection.windowMs = options.windowMs;
    }

    // Clear previously scheduled manual bursts
    this.scheduledBursts = this.scheduledBursts.filter((b) => b.origin === "experiment");

    const duration = options.durationMs ?? def.defaultDurationMs;
    const intensity = options.intensityMbps ?? def.defaultIntensityMbps;
    const senders = options.senderCount ?? def.defaultSenderCount;

    if (options.scenario === "normal") {
      if (this.mitigation.active) this.removeMitigation("manual");
      this.pushEvent("scenario_started", "info", {
        action: `Scenario started: ${def.name}`,
        outcome: `${def.description} Multi-source load: ${senders} senders.`,
      });
    } else if (options.scenario === "microburst") {
      const host = options.burstHostId ?? this.config.simulation.burstHostId;
      this.simulateBurst(host, {
        peakMbps: intensity,
        durationMs: Math.min(duration, 500),
        startDelayMs: 200,
      });
      this.pushEvent("scenario_started", "warning", {
        action: `Scenario started: ${def.name}`,
        outcome: `Injecting ${intensity} Mbps microburst on ${host.toUpperCase()}.`,
      });
    } else if (options.scenario === "incast") {
      const sourceCount = Math.min(SOURCE_HOST_IDS.length, Math.max(2, senders));
      const perHostBurst = intensity / sourceCount;
      const startDelay = 250;
      for (let i = 0; i < sourceCount; i++) {
        const host = SOURCE_HOST_IDS[i];
        this.scheduledBursts.push({
          hostId: host,
          startSim: this.simTime + startDelay,
          endSim: this.simTime + startDelay + 600,
          peakMbps: perHostBurst,
          origin: "manual",
        });
      }
      this.pushEvent("scenario_started", "critical", {
        action: `Scenario started: ${def.name}`,
        outcome: `Synchronized burst from ${sourceCount} sources totalling ~${intensity} Mbps towards receiver.`,
      });
    } else if (options.scenario === "recovery") {
      const host = options.burstHostId ?? this.config.simulation.burstHostId;
      this.simulateBurst(host, {
        peakMbps: intensity,
        durationMs: 400,
        startDelayMs: 150,
      });
      this.pushEvent("scenario_started", "info", {
        action: `Scenario started: ${def.name}`,
        outcome: `Microburst triggered with monitored post-burst recovery phase.`,
      });
    } else if (options.scenario === "ramp") {
      this.pushEvent("scenario_started", "info", {
        action: `Scenario started: ${def.name}`,
        outcome: `Gradually increasing traffic load towards link saturation.`,
      });
    }
  }

  getLatestTelemetry(): WindowTelemetry | null {
    return this.latestTelemetry;
  }

  restoreNormal(): void {
    this.activeScenario = "normal";

    this.scheduledBursts = this.scheduledBursts.filter((b) => b.origin === "experiment");
    if (this.mitigation.active) this.removeMitigation("manual");
  }

  setBurstHost(hostId: string): void {
    this.config.simulation.burstHostId = hostId;
  }

  // -------------------------------------------------------------- experiments

  startExperiment(scenarioId: ExperimentScenarioId, seed?: number): void {
    const scenario = EXPERIMENT_SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) return;
    const baseSeed = seed ?? this.config.simulation.seed;
    this.reset(baseSeed);

    const duration = this.config.simulation.experimentDurationMs;
    this.config.mitigation.autoEnabled = scenario.usesMitigation;
    this.mitigation.autoEnabled = scenario.usesMitigation;

    if (scenario.usesBurst) {
      const startAt = Math.round(duration * 0.15);
      this.scheduledBursts.push({
        hostId: this.config.simulation.burstHostId,
        startSim: startAt,
        endSim: startAt + this.config.simulation.burstDurationMs,
        peakMbps: this.config.simulation.burstPeakMbps,
        origin: "experiment",
      });
    }

    this.experimentScenario = scenario;
    this.experiment = {
      active: true,
      scenario: scenarioId,
      startedAtSim: this.simTime,
      durationMs: duration,
      progress: 0,
    };
    this.experimentStats = emptyStats();
    this.experimentMitigationMs = 0;
    this.experimentFirstDetectionDelay = null;

    this.pushEvent("experiment_started", "info", {
      action: `Experiment ${scenarioId} started with seed ${baseSeed}`,
      outcome: `${scenario.name}. Logical duration ${duration} ms.`,
    });
    this.running = true;
  }

  stopExperiment(): void {
    if (!this.experiment.active) return;
    this.finalizeExperiment("stopped early");
  }

  private finalizeExperiment(reason: string) {
    if (!this.experimentStats || !this.experimentScenario) {
      this.experiment.active = false;
      return;
    }
    const stats = this.experimentStats;
    const duration = this.simTime - (this.experiment.startedAtSim ?? 0);
    const avgRate = stats.sampleCount ? stats.sumRate / stats.sampleCount : 0;
    const result: ExperimentResult = {
      id: this.nextId("exp"),
      scenario: this.experiment.scenario,
      scenarioName: this.experimentScenario.name,
      timestamp: Date.now(),
      seed: this.config.simulation.seed,
      durationMs: duration,
      burstPeakMbps: stats.burstCount > 0 ? stats.burstPeak : null,
      avgRateMbps: avgRate,
      throughputMbps: avgRate,
      detectionDelayMs: this.experimentFirstDetectionDelay,
      burstCount: stats.burstCount,
      dropMb: stats.totalDropBytes * 8 / 1_000_000,
      latencyMs: stats.sampleCount ? stats.sumLatency / stats.sampleCount : 0,
      mitigationDurationMs: this.experimentMitigationMs,
      dataSource: this.dataSource,
    };
    this.experiments = [result, ...this.experiments].slice(0, 60);
    this.experiment = {
      ...this.experiment,
      active: false,
      progress: 1,
    };
    this.pushEvent("experiment_completed", "success", {
      action: `Experiment ${result.scenario} ${reason === "completed" ? "completed" : "stopped"}`,
      outcome: `Duration ${duration.toFixed(0)} ms; avg ${avgRate.toFixed(1)} Mbps; ${stats.burstCount} burst(s); ${stats.totalDropBytes > 0 ? `${result.dropMb.toFixed(2)} Mb dropped (simulated)` : "no simulated drops"}.`,
      rateMbps: result.burstPeakMbps ?? avgRate,
    });
  }

  // -------------------------------------------------------------------- tick

  tick(): void {
    if (!this.running) return;
    const perTick = Math.max(1, this.config.simulation.windowsPerTick);
    for (let i = 0; i < perTick; i++) {
      if (!this.running) break;
      this.advanceWindow();
      if (this.experiment.active) {
        const elapsed = this.simTime - (this.experiment.startedAtSim ?? 0);
        this.experiment.progress = clamp(
          elapsed / Math.max(1, this.experiment.durationMs),
          0,
          1,
        );
        if (elapsed >= this.experiment.durationMs) {
          this.finalizeExperiment("completed");
          this.running = false;
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- snapshot

  getSnapshot(): MonitoringSnapshot {
    const latest = this.samples[this.samples.length - 1] ?? null;

    const hosts: HostState[] = TOPOLOGY_NODES.map((node) => {
      const burstTarget =
        this.currentBurst && this.currentBurst.hostId === node.id;
      const mitigated =
        this.mitigation.active && this.mitigation.targetHostId === node.id;
      let state: TrafficState;
      if (mitigated) state = "mitigated";
      else if (burstTarget) state = "burst";
      else if (node.role === "controller") state = this.running ? "normal" : "idle";
      else if (node.role === "source")
        state = (this.perSourceRate[node.id] ?? 0) > 0.5 ? "normal" : "idle";
      else state = this.running ? "normal" : "idle";

      return {
        ...node,
        rateMbps: node.transmits ? this.perSourceRate[node.id] ?? 0 : 0,
        packets: this.perSourcePackets[node.id] ?? 0,
        bytes: this.perSourceBytes[node.id] ?? 0,
        contributionPct: node.transmits
          ? contributionPct(
              this.burstSourceBytes[node.id] ?? 0,
              this.burstTotalBytes,
            )
          : 0,
        state,
        rateCapMbps: this.caps[node.id] ?? null,
      };
    });

    const total = SOURCE_HOST_IDS.reduce(
      (sum, id) => sum + (this.perSourceRate[id] ?? 0),
      0,
    );

    const links: LinkState[] = TOPOLOGY_LINKS.map((link) => {
      if (link.control) {
        return {
          ...link,
          rateMbps: 0,
          utilization: 0,
          state: this.running ? "normal" : "idle",
        };
      }
      const isUplink = link.id === "s1-r1";
      const rateMbps = isUplink ? total : this.perSourceRate[link.from] ?? 0;
      const utilization =
        link.capacityMbps > 0 ? clamp(rateMbps / link.capacityMbps, 0, 1.5) : 0;
      const affectedHost = isUplink ? this.currentBurst !== null : link.from === this.currentBurst?.hostId;
      const mitigated =
        this.mitigation.active &&
        (isUplink || link.from === this.mitigation.targetHostId);
      let state: TrafficState;
      if (mitigated) state = "mitigated";
      else if (affectedHost) state = "burst";
      else state = rateMbps > 0.5 ? "normal" : "idle";
      return { ...link, rateMbps, utilization, state };
    });

    const activeSourceIps = SOURCE_HOST_IDS.filter(
      (id) => (this.perSourceRate[id] ?? 0) > 0.5,
    ).length;

    const sources: SourceRow[] = SOURCE_HOST_IDS.map((id) => {
      const node = TOPOLOGY_NODES.find((n) => n.id === id)!;
      const cap = this.caps[id] ?? null;
      const mitigated = this.mitigation.active && this.mitigation.targetHostId === id;
      const burstTarget = this.currentBurst?.hostId === id;
      const contribution = contributionPct(
        this.burstSourceBytes[id] ?? 0,
        this.burstTotalBytes,
      );
      return {
        id,
        name: node.name,
        ip: node.ip,
        packets: this.perSourcePackets[id] ?? 0,
        bytes: this.perSourceBytes[id] ?? 0,
        rateMbps: this.perSourceRate[id] ?? 0,
        contributionPct: contribution,
        policy:
          cap !== null
            ? `Rate cap ${cap.toFixed(0)} Mbps`
            : mitigated
              ? "Mitigation pending"
              : "Unrestricted",
        rateCapMbps: cap,
        state: mitigated ? "mitigated" : burstTarget ? "burst" : "normal",
      };
    });

    const summary: TrafficSummary = {
      peakMbps: this.session.peakRate,
      avgMbps: this.session.sampleCount
        ? this.session.sumRate / this.session.sampleCount
        : 0,
      totalBytes: this.session.totalBytes,
      totalPackets: this.session.totalPackets,
      totalDropBytes: this.session.totalDropBytes,
      burstCount: this.session.burstCount || this.burstCount,
    };

    return {
      running: this.running,
      dataSource: this.dataSource,
      interfaceName: this.config.simulation.interfaceName,
      simTime: this.simTime,
      config: cloneConfig(this.config),
      hosts,
      links,
      history: this.samples.slice(),
      latest,
      summary,
      burstActive: this.currentBurst !== null,
      currentBurst: this.currentBurst ? { ...this.currentBurst } : null,
      burstCount: this.burstCount,
      burstIntervals: this.burstIntervals.map((i) => ({ ...i })),
      burstTotalBytes: this.burstTotalBytes,
      activeSourceIps,
      mitigation: { ...this.mitigation },
      events: this.events.slice(),
      sources,
      experiment: { ...this.experiment },
      experiments: this.experiments.slice(),
      selectedBurstHostId: this.config.simulation.burstHostId,
      activeScenario: this.activeScenario,
      latestTelemetry: this.latestTelemetry ? { ...this.latestTelemetry } : null,
      structuredDetections: this.detector.getDetections(),
      latestDetectorEvent: this.latestDetectorEvent ? { ...this.latestDetectorEvent } : null,
    };
  }



  getEvents(): AppEvent[] {
    return this.events.slice();
  }

  getExperiments(): ExperimentResult[] {
    return this.experiments.slice();
  }

  clearEvents(): void {
    this.events = [];
  }

  clearExperiments(): void {
    this.experiments = [];
  }

  /** Record a free-form error so the event log stays truthful. */
  pushError(action: string, outcome: string): void {
    this.pushEvent("error", "critical", { action, outcome });
  }

  // ------------------------------------------------------------------ events

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.idCounter}`;
  }

  private pushEvent(
    type: EventType,
    severity: EventSeverity,
    data: {
      action: string;
      outcome: string;
      sourceIp?: string;
      hostName?: string;
      rateMbps?: number;
    },
  ): void {
    const event: AppEvent = {
      id: this.nextId("evt"),
      timestamp: Date.now(),
      type,
      severity,
      sourceIp: data.sourceIp,
      hostName: data.hostName,
      rateMbps: data.rateMbps,
      action: data.action,
      outcome: data.outcome,
      dataSource: this.dataSource,
    };
    this.events = [...this.events, event].slice(-500);
  }
}

export function cloneConfig(config: AppConfig): AppConfig {
  return {
    detection: { ...config.detection },
    mitigation: { ...config.mitigation },
    simulation: { ...config.simulation },
  };
}
