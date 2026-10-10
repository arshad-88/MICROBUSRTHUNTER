/**
 * Time-series metric types for MicroburstHunter.
 *
 * A "window" is the sampling interval of the detector (default 10 ms). Every
 * rate in the app is derived from the bytes observed in a window using the
 * documented formula:
 *
 *   rateMbps = bytes * 8 / (windowMs / 1000) / 1_000_000
 *
 * Two clocks are tracked:
 *  - logical simulation time (`t`), which advances `windowMs` per window and is
 *    used for detection, durations and experiment timing;
 *  - wall-clock time, used only for event log timestamps.
 */

export interface TrafficSample {
  /** Logical simulation time in ms. */
  t: number;
  /** Observed aggregate rate in Mbps. */
  rateMbps: number;
  /** Rolling baseline in Mbps. */
  baselineMbps: number;
  /** Detection threshold actually applied this window (Mbps). */
  thresholdMbps: number;
  /** Bytes observed in this window. */
  bytes: number;
  /** Packets observed in this window. */
  packets: number;
  /** Simulated dropped bytes (queue overflow model). */
  dropBytes: number;
  /** Simulated one-way latency in ms. */
  latencyMs: number;
  /** Per-source rate in Mbps keyed by host id. */
  perSource: Record<string, number>;
}

export interface TrafficSummary {
  peakMbps: number;
  avgMbps: number;
  totalBytes: number;
  totalPackets: number;
  totalDropBytes: number;
  burstCount: number;
}

export type BurstSeverity = "moderate" | "severe";

export interface BurstEvent {
  id: string;
  /** Logical sim time the burst was detected. */
  detectedAtSim: number;
  /** Logical sim time the burst ended, if it has. */
  endedAtSim: number | null;
  peakMbps: number;
  baselineMbps: number;
  thresholdMbps: number;
  hostId: string;
  sourceIp: string;
  hostName: string;
  /** Contribution of the offending source at detection time (0-100). */
  contributionPct: number;
  severity: BurstSeverity;
  /** Detection latency from the scheduled burst onset, when known. */
  detectionDelayMs: number | null;
  mitigationCount: number;
}

/** Before/after metrics captured around a mitigation action. */
export interface MitigationComparison {
  peakMbps: number;
  throughputMbps: number;
  dropMb: number;
  latencyMs: number;
  samples: number;
}

export type MitigationStateName =
  | "idle"
  | "applied"
  | "recovering"
  | "failed";

export interface MitigationState {
  /** Global auto-mitigation toggle (user setting). */
  autoEnabled: boolean;
  /** Whether a cap is currently enforced in the model. */
  active: boolean;
  targetHostId: string | null;
  targetIp: string | null;
  targetName: string | null;
  rateLimitMbps: number;
  severity: "none" | "moderate" | "severe";
  startedAtSim: number | null;
  /** Enforced duration so far, in logical ms. */
  durationMs: number;
  state: MitigationStateName;
  recovery: "pending" | "recovered" | "n/a";
  before: MitigationComparison;
  after: MitigationComparison;
  /** Reason for the last policy failure, if any. */
  failureReason: string | null;
}

export type ExperimentScenarioId = 1 | 2 | 3;

export interface ExperimentRuntime {
  active: boolean;
  scenario: ExperimentScenarioId;
  startedAtSim: number | null;
  durationMs: number;
  progress: number;
}

export interface ExperimentResult {
  id: string;
  scenario: ExperimentScenarioId;
  scenarioName: string;
  /** Wall-clock ms when the experiment completed. */
  timestamp: number;
  seed: number;
  durationMs: number;
  burstPeakMbps: number | null;
  avgRateMbps: number;
  throughputMbps: number;
  detectionDelayMs: number | null;
  burstCount: number;
  dropMb: number;
  latencyMs: number;
  mitigationDurationMs: number;
  dataSource: "simulated" | "live";
}

export type DataSource = "simulated" | "live";
