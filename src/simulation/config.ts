import type { TopologyLink, TopologyNode } from "@/types";

/**
 * Detection engine parameters.
 *
 * These are educational defaults chosen to make a 10 ms microburst visible in a
 * demo — they are NOT a universal definition of a microburst. Real switches
 * define bursts in terms of queue occupancy and buffer depth; a traffic rate
 * spike alone does not prove buffer overflow. See the README "Limitations".
 */
export interface DetectionConfig {
  /** Sampling window length in ms. */
  windowMs: number;
  /** Minimum absolute rate that must be exceeded (Mbps). */
  minRateMbps: number;
  /** Baseline multiple that must be exceeded. */
  baselineMultiplier: number;
  /** Consecutive qualifying windows required to declare a burst. */
  persistenceWindows: number;
  /** Consecutive quiet windows required to end a burst. */
  recoveryWindows: number;
  /** Minimum quiet sim-time between two bursts (ms). */
  cooldownMs: number;
  /** Length of the rolling baseline window (ms). */
  baselineWindowMs: number;
  /** Peak/baseline ratio at or above which a burst is "severe". */
  severeRatio: number;
}

/** Adaptive mitigation policy parameters. */
export interface MitigationConfig {
  /** Automatically apply the policy when a burst is detected. */
  autoEnabled: boolean;
  /** Mild cap applied to a moderate burst (Mbps). */
  rateLimitMbps: number;
  /** Stricter cap applied to a severe burst (Mbps). */
  severeRateLimitMbps: number;
  /** Hard ceiling on how long a cap may stay enforced (ms). */
  maxDurationMs: number;
  /** Quiet sim-time before another automatic mitigation may start (ms). */
  cooldownMs: number;
  /** Fraction of the threshold below which the flow counts as recovered. */
  recoveryFraction: number;
}

/** Deterministic traffic generator + runtime parameters. */
export interface SimulationConfig {
  /** PRNG seed. Identical seed + settings => identical experiment. */
  seed: number;
  /** Detector windows simulated per UI tick. */
  windowsPerTick: number;
  /** Real-world interval between UI ticks (ms). */
  tickIntervalMs: number;
  /** Bottleneck link capacity used for the queue/overflow model (Mbps). */
  linkCapacityMbps: number;
  /** Baseline one-way latency at zero load (ms). */
  baseLatencyMs: number;
  /** Default burst duration (ms of logical time). */
  burstDurationMs: number;
  /** Default burst peak added on top of the host baseline (Mbps). */
  burstPeakMbps: number;
  /** Default host used for the manual "Simulate Burst" control. */
  burstHostId: string;
  /** Length of an experiment run (ms of logical time). */
  experimentDurationMs: number;
  /** Live capture is not available in the browser; kept for the API shape. */
  dataSource: "simulated" | "live";
  /** Network interface name for live capture (null in the browser). */
  interfaceName: string | null;
}

export interface AppConfig {
  detection: DetectionConfig;
  mitigation: MitigationConfig;
  simulation: SimulationConfig;
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  windowMs: 10,
  minRateMbps: 80,
  baselineMultiplier: 3,
  persistenceWindows: 3,
  recoveryWindows: 10,
  cooldownMs: 2000,
  baselineWindowMs: 1000,
  severeRatio: 5,
};

export const DEFAULT_MITIGATION_CONFIG: MitigationConfig = {
  autoEnabled: true,
  rateLimitMbps: 60,
  severeRateLimitMbps: 35,
  maxDurationMs: 8000,
  cooldownMs: 3000,
  recoveryFraction: 0.8,
};

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  seed: 1337,
  windowsPerTick: 5,
  tickIntervalMs: 150,
  linkCapacityMbps: 220,
  baseLatencyMs: 0.4,
  burstDurationMs: 500,
  burstPeakMbps: 200,
  burstHostId: "h3",
  experimentDurationMs: 8000,
  dataSource: "simulated",
  interfaceName: null,
};

export const DEFAULT_CONFIG: AppConfig = {
  detection: { ...DEFAULT_DETECTION_CONFIG },
  mitigation: { ...DEFAULT_MITIGATION_CONFIG },
  simulation: { ...DEFAULT_SIMULATION_CONFIG },
};

/** Per-host baseline generators for "normal" traffic (Mbps). */
export const HOST_BASE_RATES: Record<string, number> = {
  h1: 18,
  h2: 14,
  h3: 9,
  h4: 12,
};

/** Average packet size used to convert bytes <-> packets (bytes). */
export const AVG_PACKET_BYTES = 1400;

export const TOPOLOGY_NODES: TopologyNode[] = [
  {
    id: "h1",
    name: "H1",
    label: "Normal source",
    ip: "10.0.1.11",
    role: "source",
    x: 120,
    y: 80,
    transmits: true,
  },
  {
    id: "h2",
    name: "H2",
    label: "Normal source",
    ip: "10.0.1.12",
    role: "source",
    x: 120,
    y: 200,
    transmits: true,
  },
  {
    id: "h3",
    name: "H3",
    label: "Burst source",
    ip: "10.0.1.13",
    role: "source",
    x: 120,
    y: 320,
    transmits: true,
  },
  {
    id: "h4",
    name: "H4",
    label: "Traffic source",
    ip: "10.0.1.14",
    role: "source",
    x: 120,
    y: 440,
    transmits: true,
  },
  {
    id: "s1",
    name: "S1",
    label: "Aggregation switch",
    ip: "10.0.0.1",
    role: "switch",
    x: 450,
    y: 260,
    transmits: false,
  },
  {
    id: "r1",
    name: "R1",
    label: "Destination server",
    ip: "10.0.0.10",
    role: "receiver",
    x: 780,
    y: 260,
    transmits: false,
  },
  {
    id: "mh",
    name: "MBH",
    label: "Monitor / controller",
    ip: "10.0.0.200",
    role: "controller",
    x: 450,
    y: 450,
    transmits: false,
  },
];

export const TOPOLOGY_LINKS: TopologyLink[] = [
  { id: "h1-s1", from: "h1", to: "s1", capacityMbps: 220 },
  { id: "h2-s1", from: "h2", to: "s1", capacityMbps: 220 },
  { id: "h3-s1", from: "h3", to: "s1", capacityMbps: 220 },
  { id: "h4-s1", from: "h4", to: "s1", capacityMbps: 220 },
  { id: "s1-r1", from: "s1", to: "r1", capacityMbps: 220 },
  { id: "mh-s1", from: "mh", to: "s1", capacityMbps: 0, control: true },
];

export const SOURCE_HOST_IDS = ["h1", "h2", "h3", "h4"];

/** Field-level validation used by the Settings page and the engine. */
export interface ValidationIssue {
  field: string;
  message: string;
}

export function validateConfig(config: AppConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { detection: d, mitigation: m, simulation: s } = config;

  const positive = (
    value: number,
    field: string,
    label: string,
    min = 0,
    allowZero = false,
  ) => {
    if (!Number.isFinite(value) || (allowZero ? value < min : value <= min)) {
      issues.push({
        field,
        message: `${label} must be ${allowZero ? "at least" : "greater than"} ${min}.`,
      });
    }
  };

  positive(d.windowMs, "detection.windowMs", "Sampling window", 0);
  positive(d.minRateMbps, "detection.minRateMbps", "Minimum rate", 0);
  positive(
    d.baselineMultiplier,
    "detection.baselineMultiplier",
    "Baseline multiplier",
    0,
  );
  if (!Number.isInteger(d.persistenceWindows) || d.persistenceWindows < 1) {
    issues.push({
      field: "detection.persistenceWindows",
      message: "Burst persistence must be a whole number of at least 1 window.",
    });
  }
  if (!Number.isInteger(d.recoveryWindows) || d.recoveryWindows < 1) {
    issues.push({
      field: "detection.recoveryWindows",
      message: "Recovery windows must be a whole number of at least 1.",
    });
  }
  positive(d.cooldownMs, "detection.cooldownMs", "Burst cooldown", 0, true);
  positive(
    d.baselineWindowMs,
    "detection.baselineWindowMs",
    "Baseline window",
    0,
  );
  if (d.baselineWindowMs < d.windowMs) {
    issues.push({
      field: "detection.baselineWindowMs",
      message: "Baseline window should cover at least one sampling window.",
    });
  }
  positive(d.severeRatio, "detection.severeRatio", "Severe ratio", 1);

  positive(m.rateLimitMbps, "mitigation.rateLimitMbps", "Rate limit", 0);
  positive(
    m.severeRateLimitMbps,
    "mitigation.severeRateLimitMbps",
    "Severe rate limit",
    0,
  );
  if (m.severeRateLimitMbps > m.rateLimitMbps) {
    issues.push({
      field: "mitigation.severeRateLimitMbps",
      message: "Severe cap should not exceed the moderate cap.",
    });
  }
  positive(m.maxDurationMs, "mitigation.maxDurationMs", "Max duration", 0);
  positive(m.cooldownMs, "mitigation.cooldownMs", "Mitigation cooldown", 0, true);
  if (m.recoveryFraction <= 0 || m.recoveryFraction > 1) {
    issues.push({
      field: "mitigation.recoveryFraction",
      message: "Recovery fraction must be between 0 and 1 (exclusive of 0).",
    });
  }

  positive(s.linkCapacityMbps, "simulation.linkCapacityMbps", "Link capacity", 0);
  positive(s.baseLatencyMs, "simulation.baseLatencyMs", "Base latency", 0, true);
  positive(s.burstDurationMs, "simulation.burstDurationMs", "Burst duration", 0);
  positive(s.burstPeakMbps, "simulation.burstPeakMbps", "Burst peak", 0);
  if (!Number.isInteger(s.windowsPerTick) || s.windowsPerTick < 1) {
    issues.push({
      field: "simulation.windowsPerTick",
      message: "Windows per tick must be a whole number of at least 1.",
    });
  }
  positive(s.tickIntervalMs, "simulation.tickIntervalMs", "Tick interval", 20);
  positive(
    s.experimentDurationMs,
    "simulation.experimentDurationMs",
    "Experiment duration",
    500,
  );
  if (!SOURCE_HOST_IDS.includes(s.burstHostId)) {
    issues.push({
      field: "simulation.burstHostId",
      message: "Burst host must be one of the transmitting hosts.",
    });
  }

  return issues;
}

export function isConfigValid(config: AppConfig): boolean {
  return validateConfig(config).length === 0;
}
