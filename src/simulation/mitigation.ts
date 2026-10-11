/**
 * Adaptive Mitigation Policy Engine (Phase 4).
 *
 * Implements a standalone, stateful mitigation policy engine that consumes
 * structured detector events and short-window telemetry.
 *
 * Requirements:
 * 1. No action when traffic is nominal.
 * 2. Cautious flow attribution: Leading traffic volume is not assumed to be
 *    deliberate malicious congestion.
 * 3. Applies configurable rate cap to target simulated source.
 * 4. Step-down escalation: increases mitigation gradually if congestion persists.
 * 5. Step-up relaxation & complete release after sustained recovery.
 * 6. Hard safety bounds (min limit, max limit, max policy changes per event, cooldown).
 * 7. Hysteresis to prevent high-frequency limit oscillation.
 */

import type { MitigationStateName } from "@/types";
import type { StructuredDetectionEvent } from "./detector";
import type { WindowTelemetry } from "./scenarios";

export interface MitigationPolicyConfig {
  /** Global auto-mitigation enable toggle. */
  autoEnabled: boolean;
  /** Initial rate cap applied to moderate bursts (Mbps). */
  initialLimitMbps: number;
  /** Stricter rate cap applied to severe bursts (Mbps). */
  severeLimitMbps: number;
  /** Minimum allowable rate cap floor (Mbps) — prevents total starvation. */
  minRateLimitMbps: number;
  /** Maximum allowable rate cap ceiling (Mbps). */
  maxRateLimitMbps: number;
  /** Rate decrement in Mbps applied when persistent congestion is observed. */
  escalationStepMbps: number;
  /** Rate increment in Mbps when link traffic begins settling. */
  relaxationStepMbps: number;
  /** Minimum window intervals before another rate limit adjustment can occur (hysteresis). */
  hysteresisWindows: number;
  /** Consecutive quiet windows required to trigger recovery relaxation. */
  recoveryWindowsRequired: number;
  /** Maximum total limit adjustments permitted per burst event. */
  maxAdjustmentsPerBurst: number;
  /** Hard safety ceiling on how long a cap may stay enforced (ms). */
  maxDurationMs: number;
  /** Cooldown time in ms after mitigation concludes before next auto-action. */
  cooldownMs: number;
}

export const DEFAULT_MITIGATION_POLICY_CONFIG: MitigationPolicyConfig = {
  autoEnabled: true,
  initialLimitMbps: 60,
  severeLimitMbps: 35,
  minRateLimitMbps: 15,
  maxRateLimitMbps: 120,
  escalationStepMbps: 10,
  relaxationStepMbps: 15,
  hysteresisWindows: 4,
  recoveryWindowsRequired: 5,
  maxAdjustmentsPerBurst: 4,
  maxDurationMs: 8000,
  cooldownMs: 2500,
};

export type MitigationDecisionAction =
  | "none"
  | "apply_cap"
  | "escalate_cap"
  | "relax_cap"
  | "release_cap"
  | "max_duration_release";

export interface MitigationDecision {
  action: MitigationDecisionAction;
  targetHostId: string | null;
  newLimitMbps: number | null;
  previousLimitMbps: number | null;
  reason: string;
  state: MitigationStateName;
  timestamp: number;
}

export class MitigationEngine {
  private config: MitigationPolicyConfig;
  private active = false;
  private targetHostId: string | null = null;
  private currentLimitMbps: number | null = null;
  private startedAtSim: number | null = null;
  private lastActionTime = -Infinity;
  private lastMitigationEndTime = -Infinity;
  private windowsSinceLastAdjustment = 0;
  private quietWindowsCount = 0;
  private adjustmentsCount = 0;
  private state: MitigationStateName = "idle";
  private lastReason = "System nominal, no active cap.";

  constructor(config?: Partial<MitigationPolicyConfig>) {
    this.config = { ...DEFAULT_MITIGATION_POLICY_CONFIG, ...config };
    this.state = this.config.autoEnabled ? "idle" : "disabled";
  }

  public getConfig(): MitigationPolicyConfig {
    return { ...this.config };
  }

  public setConfig(patch: Partial<MitigationPolicyConfig>): void {
    this.config = { ...this.config, ...patch };
    if (!this.config.autoEnabled && !this.active) {
      this.state = "disabled";
    } else if (this.config.autoEnabled && this.state === "disabled") {
      this.state = "idle";
    }
  }

  public isAutoEnabled(): boolean {
    return this.config.autoEnabled;
  }

  public setAutoEnabled(enabled: boolean): void {
    this.config.autoEnabled = enabled;
    if (!enabled && this.active) {
      // Manual/setting override clears active cap
      this.release("Auto-mitigation disabled by operator");
    } else if (!enabled) {
      this.state = "disabled";
    } else if (this.state === "disabled") {
      this.state = "idle";
    }
  }

  public isActive(): boolean {
    return this.active;
  }

  public getTargetHostId(): string | null {
    return this.targetHostId;
  }

  public getCurrentLimit(): number | null {
    return this.currentLimitMbps;
  }

  public getState(): MitigationStateName {
    return this.state;
  }

  public getLastReason(): string {
    return this.lastReason;
  }

  public reset(): void {
    this.active = false;
    this.targetHostId = null;
    this.currentLimitMbps = null;
    this.startedAtSim = null;
    this.lastActionTime = -Infinity;
    this.lastMitigationEndTime = -Infinity;
    this.windowsSinceLastAdjustment = 0;
    this.quietWindowsCount = 0;
    this.adjustmentsCount = 0;
    this.state = this.config.autoEnabled ? "idle" : "disabled";
    this.lastReason = "Engine reset.";
  }

  /**
   * Evaluate incoming detector events and short-window telemetry.
   * Produces a structured MitigationDecision.
   */
  public evaluate(
    detectorEvent: StructuredDetectionEvent | null,
    telemetry: WindowTelemetry | null,
  ): MitigationDecision {
    const now = telemetry?.t ?? Date.now();
    this.windowsSinceLastAdjustment += 1;

    // Check if auto mitigation is disarmed
    if (!this.config.autoEnabled) {
      this.state = "disabled";
      return {
        action: "none",
        targetHostId: null,
        newLimitMbps: null,
        previousLimitMbps: null,
        reason: "Automatic mitigation disabled.",
        state: "disabled",
        timestamp: now,
      };
    }

    // Safety: check max duration timeout
    if (this.active && this.startedAtSim !== null && now - this.startedAtSim >= this.config.maxDurationMs) {
      const prev = this.currentLimitMbps;
      const target = this.targetHostId;
      this.release(`Max enforced duration (${this.config.maxDurationMs} ms) reached. Releasing to avoid starvation.`);
      return {
        action: "max_duration_release",
        targetHostId: target,
        newLimitMbps: null,
        previousLimitMbps: prev,
        reason: `Enforced cap reached safety duration ceiling of ${this.config.maxDurationMs} ms.`,
        state: "idle",
        timestamp: now,
      };
    }

    // CASE 1: Not active -> check if detector fired a new burst
    if (!this.active) {
      if (!detectorEvent) {
        this.state = "idle";
        return {
          action: "none",
          targetHostId: null,
          newLimitMbps: null,
          previousLimitMbps: null,
          reason: "Traffic nominal. No qualifying burst event.",
          state: "idle",
          timestamp: now,
        };
      }

      // Check cooldown window
      if (now - this.lastMitigationEndTime < this.config.cooldownMs) {
        return {
          action: "none",
          targetHostId: null,
          newLimitMbps: null,
          previousLimitMbps: null,
          reason: `Policy in cooldown period (${(now - this.lastMitigationEndTime).toFixed(0)} ms < ${this.config.cooldownMs} ms).`,
          state: "idle",
          timestamp: now,
        };
      }

      // Target selection based on top contributor (with cautious attribution)
      const target = detectorEvent.topContributor?.hostId ?? "h3";
      const initialLimit =
        detectorEvent.severity === "severe"
          ? this.config.severeLimitMbps
          : this.config.initialLimitMbps;

      this.active = true;
      this.targetHostId = target;
      this.currentLimitMbps = initialLimit;
      this.startedAtSim = now;
      this.lastActionTime = now;
      this.windowsSinceLastAdjustment = 0;
      this.quietWindowsCount = 0;
      this.adjustmentsCount = 1;
      this.state = "applied";
      this.lastReason = `Applied ${initialLimit} Mbps cap on ${target.toUpperCase()} (${detectorEvent.severity} burst, ${detectorEvent.topContributor?.contributionPct.toFixed(0) ?? "top"}% volume). Note: high volume alone does not prove malicious intent.`;

      return {
        action: "apply_cap",
        targetHostId: target,
        newLimitMbps: initialLimit,
        previousLimitMbps: null,
        reason: this.lastReason,
        state: "applied",
        timestamp: now,
      };
    }

    // CASE 2: Active mitigation in progress
    // Evaluate if traffic is persisting above capacity or recovering
    const isCongested = (telemetry?.estimatedQueuePct ?? 0) > 40 || (telemetry?.rateMbps ?? 0) > (detectorEvent?.thresholdMbps ?? 150);

    if (isCongested) {
      this.quietWindowsCount = 0;
      // Check hysteresis delay and maximum adjustment safety budget
      if (
        this.windowsSinceLastAdjustment >= this.config.hysteresisWindows &&
        this.adjustmentsCount < this.config.maxAdjustmentsPerBurst &&
        this.currentLimitMbps !== null &&
        this.currentLimitMbps > this.config.minRateLimitMbps
      ) {
        const prev = this.currentLimitMbps;
        const nextLimit = Math.max(
          this.config.minRateLimitMbps,
          this.currentLimitMbps - this.config.escalationStepMbps,
        );
        this.currentLimitMbps = nextLimit;
        this.windowsSinceLastAdjustment = 0;
        this.adjustmentsCount += 1;
        this.lastActionTime = now;
        this.state = "applied";
        this.lastReason = `Persistent congestion observed (queue ${telemetry?.estimatedQueuePct?.toFixed(0) ?? 0}%). Escalated rate cap from ${prev} to ${nextLimit} Mbps.`;

        return {
          action: "escalate_cap",
          targetHostId: this.targetHostId,
          newLimitMbps: nextLimit,
          previousLimitMbps: prev,
          reason: this.lastReason,
          state: "applied",
          timestamp: now,
        };
      }
    } else {
      // Traffic is below congestion threshold
      this.quietWindowsCount += 1;
      this.state = "recovering";

      if (this.quietWindowsCount >= this.config.recoveryWindowsRequired) {
        const prev = this.currentLimitMbps;
        const target = this.targetHostId;
        this.release("Traffic sustained below threshold for recovery window. Flow unrestricted.");
        return {
          action: "release_cap",
          targetHostId: target,
          newLimitMbps: null,
          previousLimitMbps: prev,
          reason: "Flow verified recovered. Cap successfully released.",
          state: "idle",
          timestamp: now,
        };
      }
    }

    return {
      action: "none",
      targetHostId: this.targetHostId,
      newLimitMbps: this.currentLimitMbps,
      previousLimitMbps: this.currentLimitMbps,
      reason: this.lastReason,
      state: this.state,
      timestamp: now,
    };
  }

  public release(reason?: string): void {
    this.active = false;
    this.targetHostId = null;
    this.currentLimitMbps = null;
    this.startedAtSim = null;
    this.lastMitigationEndTime = Date.now();
    this.windowsSinceLastAdjustment = 0;
    this.quietWindowsCount = 0;
    this.adjustmentsCount = 0;
    this.state = this.config.autoEnabled ? "idle" : "disabled";
    this.lastReason = reason ?? "Cap released.";
  }
}
