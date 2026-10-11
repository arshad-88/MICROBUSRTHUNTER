/**
 * Microburst Detection Engine (Phase 3).
 *
 * Implements an independent, deterministic detection engine that consumes
 * successive telemetry windows (WindowTelemetry).
 *
 * Key principles:
 * 1. Independent evaluation: Does not rely on scenario labels as ground truth.
 * 2. Multi-metric evaluation:
 *    - Rate spikes exceeding baseline multiplier & absolute threshold
 *    - Rate of change (derivative / steepness)
 *    - Modelled queue buffer occupancy & packet drop rates when available
 *    - Persistence / duration window filtering
 * 3. Cooldown & Deduplication: Prevents alert storming for a sustained single event.
 * 4. Attribution: Identifies largest contributing flow without falsely asserting
 *    that high transmission volume alone implies intentional malicious congestion.
 * 5. Structured event emission: Clear classification, reasons, and metrics.
 */

import type { WindowTelemetry } from "./scenarios";

export interface DetectionEngineConfig {
  /** Sampling window length in ms. */
  windowMs: number;
  /** Minimum absolute aggregate rate required to trigger burst alert (Mbps). */
  minRateMbps: number;
  /** Baseline multiplier factor (e.g. 3.0x rolling baseline). */
  baselineMultiplier: number;
  /** Rolling baseline window size (ms) over which history is averaged. */
  baselineWindowMs: number;
  /** Number of consecutive qualifying windows required to declare a burst. */
  persistenceWindows: number;
  /** Number of consecutive quiet windows required to clear an active burst. */
  recoveryWindows: number;
  /** Cooldown time in ms after burst conclusion before a new alert can fire. */
  cooldownMs: number;
  /** Peak-to-baseline ratio threshold for severe burst classification. */
  severeRatio: number;
  /** Modelled queue occupancy threshold (%) that triggers congestion alerts. */
  queueCongestionThresholdPct: number;
  /** Minimum rate surge in Mbps within a single window to trigger spike detection. */
  rateOfChangeThresholdMbps: number;
}

export const DEFAULT_DETECTOR_CONFIG: DetectionEngineConfig = {
  windowMs: 100,
  minRateMbps: 80,
  baselineMultiplier: 2.8,
  baselineWindowMs: 1000,
  persistenceWindows: 2,
  recoveryWindows: 5,
  cooldownMs: 1500,
  severeRatio: 4.5,
  queueCongestionThresholdPct: 50,
  rateOfChangeThresholdMbps: 45,
};

export type DetectionSeverity = "info" | "moderate" | "severe";

export interface SourceAttribution {
  hostId: string;
  rateMbps: number;
  bytes: number;
  packets: number;
  contributionPct: number;
  /** Explicit caveat that high traffic share does not solely prove malicious congestion */
  attributionNote: string;
}

export interface StructuredDetectionEvent {
  eventId: string;
  timestamp: number;
  scenarioId: string;
  severity: DetectionSeverity;
  detectionReason: string;
  observedRateMbps: number;
  baselineRateMbps: number;
  peakRateMbps: number;
  thresholdMbps: number;
  durationMs: number;
  estimatedQueuePct: number;
  estimatedQueueBytes: number;
  isEstimatedQueue: boolean;
  dropBytes: number;
  topContributor: SourceAttribution | null;
  contributingSourcesCount: number;
  dataSource: "simulated" | "live";
}

export interface DetectorMetricsSnapshot {
  activeBurst: boolean;
  currentBurstEvent: StructuredDetectionEvent | null;
  totalDetections: number;
  lastDetectionTime: number | null;
  lastCooldownTime: number | null;
  rollingBaselineMbps: number;
  currentThresholdMbps: number;
}

export class MicroburstDetector {
  private config: DetectionEngineConfig;
  private history: { t: number; rateMbps: number }[] = [];
  private qualifyingWindows = 0;
  private quietWindows = 0;
  private lastBurstEndTime = -Infinity;
  private eventCounter = 0;
  private activeBurst: StructuredDetectionEvent | null = null;
  private detections: StructuredDetectionEvent[] = [];
  private previousRateMbps = 0;

  constructor(config?: Partial<DetectionEngineConfig>) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };
  }

  public getConfig(): DetectionEngineConfig {
    return { ...this.config };
  }

  public updateConfig(patch: Partial<DetectionEngineConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  public reset(): void {
    this.history = [];
    this.qualifyingWindows = 0;
    this.quietWindows = 0;
    this.lastBurstEndTime = -Infinity;
    this.eventCounter = 0;
    this.activeBurst = null;
    this.detections = [];
    this.previousRateMbps = 0;
  }

  /**
   * Calculate rolling mean baseline over the configured baselineWindowMs.
   */
  public calculateBaseline(currentTime: number): number {
    const cutoff = currentTime - this.config.baselineWindowMs;
    // Clean old history
    while (this.history.length > 0 && this.history[0].t < cutoff) {
      this.history.shift();
    }
    if (this.history.length === 0) {
      return this.config.minRateMbps / 2;
    }
    const sum = this.history.reduce((acc, h) => acc + h.rateMbps, 0);
    return sum / this.history.length;
  }

  /**
   * Process a single incoming telemetry window.
   * Returns a StructuredDetectionEvent if a new burst or state transition occurred.
   */
  public processWindow(telemetry: WindowTelemetry | null | undefined): StructuredDetectionEvent | null {
    if (!telemetry || typeof telemetry.t !== "number" || typeof telemetry.rateMbps !== "number") {
      return null;
    }

    const { t, rateMbps } = telemetry;
    const baseline = this.calculateBaseline(t);
    const threshold = Math.max(
      this.config.minRateMbps,
      baseline * this.config.baselineMultiplier,
    );

    const rateOfChange = rateMbps - this.previousRateMbps;
    this.previousRateMbps = rateMbps;

    // Detection qualifying condition:
    // 1. Rate exceeds computed threshold OR
    // 2. High surge in single window AND queue shows acute buffer accumulation
    const exceedsThreshold = rateMbps > threshold;
    const acuteSurge =
      rateOfChange >= this.config.rateOfChangeThresholdMbps &&
      (telemetry.estimatedQueuePct ?? 0) >= this.config.queueCongestionThresholdPct;

    const isQualifying = exceedsThreshold || acuteSurge;
    const cooldownActive = t - this.lastBurstEndTime < this.config.cooldownMs;


    this.history.push({ t, rateMbps });

    if (!this.activeBurst) {
      if (isQualifying && !cooldownActive) {
        this.qualifyingWindows += 1;
        if (this.qualifyingWindows >= this.config.persistenceWindows) {
          return this.startBurst(telemetry, baseline, threshold, acuteSurge ? "acute_surge" : "rate_threshold");
        }
      } else {
        this.qualifyingWindows = 0;
      }
      return null;
    } else {
      // Currently in an active burst event
      this.activeBurst.peakRateMbps = Math.max(this.activeBurst.peakRateMbps, rateMbps);
      this.activeBurst.durationMs = t - this.activeBurst.timestamp;
      this.activeBurst.estimatedQueuePct = Math.max(
        this.activeBurst.estimatedQueuePct,
        telemetry.estimatedQueuePct ?? 0,
      );

      if (!isQualifying) {
        this.quietWindows += 1;
        if (this.quietWindows >= this.config.recoveryWindows) {
          return this.endBurst(telemetry);
        }
      } else {
        this.quietWindows = 0;
      }
      return null;
    }


  }

  private startBurst(
    telemetry: WindowTelemetry,
    baseline: number,
    threshold: number,
    reasonCode: "rate_threshold" | "acute_surge",
  ): StructuredDetectionEvent {
    this.eventCounter += 1;
    this.qualifyingWindows = 0;
    this.quietWindows = 0;

    const topContributor = this.findTopContributor(telemetry.perSource, telemetry.rateMbps);
    const contributingCount = Object.keys(telemetry.perSource).filter(
      (k) => (telemetry.perSource[k]?.rateMbps ?? 0) > 5,
    ).length;

    const ratio = baseline > 0 ? telemetry.rateMbps / baseline : this.config.severeRatio;
    const severity: DetectionSeverity =
      ratio >= this.config.severeRatio || (telemetry.estimatedQueuePct ?? 0) > 80
        ? "severe"
        : "moderate";

    const reasonText =
      reasonCode === "acute_surge"
        ? `Acute surge (+${(telemetry.rateMbps - baseline).toFixed(1)} Mbps) accompanied by buffer accumulation (${(telemetry.estimatedQueuePct ?? 0).toFixed(0)}%)`
        : `Observed rate ${telemetry.rateMbps.toFixed(1)} Mbps exceeded threshold ${threshold.toFixed(1)} Mbps (${ratio.toFixed(1)}x baseline)`;

    const event: StructuredDetectionEvent = {
      eventId: `mb-evt-${this.eventCounter}-${telemetry.t}`,
      timestamp: telemetry.t,
      scenarioId: telemetry.scenarioId || "unspecified",
      severity,
      detectionReason: reasonText,
      observedRateMbps: telemetry.rateMbps,
      baselineRateMbps: baseline,
      peakRateMbps: telemetry.rateMbps,
      thresholdMbps: threshold,
      durationMs: 0,
      estimatedQueuePct: telemetry.estimatedQueuePct ?? 0,
      estimatedQueueBytes: telemetry.estimatedQueueBytes ?? 0,
      isEstimatedQueue: true,
      dropBytes: telemetry.dropBytes ?? 0,
      topContributor,
      contributingSourcesCount: contributingCount,
      dataSource: telemetry.dataSource ?? "simulated",
    };

    this.activeBurst = event;
    this.detections.push(event);
    return event;
  }

  private endBurst(telemetry: WindowTelemetry): StructuredDetectionEvent {
    const concluded = { ...this.activeBurst! };
    concluded.durationMs = telemetry.t - concluded.timestamp;
    this.lastBurstEndTime = telemetry.t;
    this.activeBurst = null;
    this.quietWindows = 0;
    return concluded;
  }

  private findTopContributor(
    perSource: WindowTelemetry["perSource"],
    totalRate: number,
  ): SourceAttribution | null {
    if (!perSource || Object.keys(perSource).length === 0) return null;

    let bestId: string | null = null;
    let maxRate = -1;

    for (const [id, stats] of Object.entries(perSource)) {
      if (stats.rateMbps > maxRate) {
        maxRate = stats.rateMbps;
        bestId = id;
      }
    }

    if (!bestId || maxRate <= 0) return null;
    const stats = perSource[bestId];
    const share = totalRate > 0 ? (stats.rateMbps / totalRate) * 100 : 0;

    return {
      hostId: bestId,
      rateMbps: stats.rateMbps,
      bytes: stats.bytes,
      packets: stats.packets,
      contributionPct: share,
      attributionNote:
        "Source represents top instantaneous volume; volume alone does not establish malicious congestion intent.",
    };
  }

  public getDetections(): StructuredDetectionEvent[] {
    return [...this.detections];
  }

  public getSnapshot(currentTime?: number): DetectorMetricsSnapshot {
    const now = currentTime ?? (this.history.length > 0 ? this.history[this.history.length - 1].t : 0);
    const baseline = this.calculateBaseline(now);
    const threshold = Math.max(
      this.config.minRateMbps,
      baseline * this.config.baselineMultiplier,
    );

    return {
      activeBurst: this.activeBurst !== null,
      currentBurstEvent: this.activeBurst ? { ...this.activeBurst } : null,
      totalDetections: this.detections.length,
      lastDetectionTime: this.detections.length > 0 ? this.detections[this.detections.length - 1].timestamp : null,
      lastCooldownTime: this.lastBurstEndTime > -Infinity ? this.lastBurstEndTime : null,
      rollingBaselineMbps: baseline,
      currentThresholdMbps: threshold,
    };
  }
}
