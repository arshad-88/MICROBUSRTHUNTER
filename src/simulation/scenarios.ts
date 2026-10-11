/**
 * Traffic Simulation Scenarios & Short-Window Telemetry Definitions.
 *
 * Scenarios:
 * 1. normal: Steady multi-source background traffic.
 * 2. ramp: Gradually increasing aggregate load towards link capacity.
 * 3. microburst: Short, intense traffic spike from a single offending host.
 * 4. incast: Synchronized multi-sender burst hitting a bottleneck switch.
 * 5. recovery: Burst followed by monitored post-burst recovery & settling period.
 */

export type TrafficScenarioType =
  | "normal"
  | "ramp"
  | "microburst"
  | "incast"
  | "recovery";

export interface ScenarioSourceConfig {
  hostId: string;
  name: string;
  ip: string;
  baseRateMbps: number;
}

export interface ScenarioDefinition {
  type: TrafficScenarioType;
  name: string;
  description: string;
  /** Logical duration in milliseconds */
  defaultDurationMs: number;
  /** Configurable parameter defaults */
  defaultIntensityMbps: number;
  defaultSenderCount: number;
}

export const TRAFFIC_SCENARIOS: Record<TrafficScenarioType, ScenarioDefinition> = {
  normal: {
    type: "normal",
    name: "Normal Steady Traffic",
    description: "Stable multi-source background traffic with baseline variations.",
    defaultDurationMs: 6000,
    defaultIntensityMbps: 55,
    defaultSenderCount: 4,
  },
  ramp: {
    type: "ramp",
    name: "Gradual Load Ramp",
    description: "Linearly increasing traffic towards link saturation over time.",
    defaultDurationMs: 8000,
    defaultIntensityMbps: 180,
    defaultSenderCount: 4,
  },
  microburst: {
    type: "microburst",
    name: "Short Intense Microburst",
    description: "A sudden, sub-second traffic spike concentrated from a single sender.",
    defaultDurationMs: 6000,
    defaultIntensityMbps: 200,
    defaultSenderCount: 1,
  },
  incast: {
    type: "incast",
    name: "Synchronized Incast Traffic",
    description: "Multiple senders simultaneously burst toward one receiver, creating switch buffer bloat.",
    defaultDurationMs: 6000,
    defaultIntensityMbps: 240,
    defaultSenderCount: 4,
  },
  recovery: {
    type: "recovery",
    name: "Post-Burst Recovery",
    description: "Injected burst followed by an observed recovery phase returning to baseline.",
    defaultDurationMs: 8000,
    defaultIntensityMbps: 190,
    defaultSenderCount: 2,
  },
};

/**
 * Options for configuring a traffic scenario simulation run.
 */
export interface ScenarioRunOptions {
  scenario: TrafficScenarioType;
  durationMs?: number;
  intensityMbps?: number;
  senderCount?: number;
  seed?: number;
  windowMs?: number;
  burstHostId?: string;
}

/**
 * Metadata for Telemetry collection window.
 */
export interface WindowTelemetry {
  /** Sampling window length in milliseconds (e.g. 100 ms). */
  windowMs: number;
  /** Logical timestamp of window end (ms). */
  t: number;
  /** Scenario ID or type actively running. */
  scenarioId: TrafficScenarioType;
  /** Aggregate traffic rate observed (Mbps). */
  rateMbps: number;
  /** Total bytes observed in window. */
  bytes: number;
  /** Total packets observed in window. */
  packets: number;
  /**
   * Estimated queue occupancy in bytes.
   * Clearly marked as estimated; derived from simulated buffer fill model.
   */
  estimatedQueueBytes: number;
  /** Estimated queue occupancy percentage (0 - 100%). */
  estimatedQueuePct: number;
  /** Indicator that this queue measurement is simulated/estimated, not hardware register. */
  isEstimatedQueue: true;
  /** Dropped bytes during this window due to queue overflow. */
  dropBytes: number;
  /** Dropped packets during this window. */
  dropPackets: number;
  /** Per-source traffic details keyed by host ID. */
  perSource: Record<
    string,
    {
      rateMbps: number;
      bytes: number;
      packets: number;
      contributionPct: number;
    }
  >;
  /** Burst identifier details if a burst is active during this window. */
  burstInfo: {
    active: boolean;
    burstStartSim: number | null;
    burstPeakMbps: number | null;
    burstDurationMs: number | null;
  };
  /** Explicitly labelled data source: simulated vs live capture. */
  dataSource: "simulated" | "live";
}
