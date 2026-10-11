import { describe, expect, test } from "vitest";
import { MitigationEngine } from "../src/simulation/mitigation";
import { evaluateScenario } from "../src/simulation/evaluation";
import type { StructuredDetectionEvent } from "../src/simulation/detector";
import type { WindowTelemetry } from "../src/simulation/scenarios";

function mockEvent(opts?: Partial<StructuredDetectionEvent>): StructuredDetectionEvent {
  return {
    eventId: "mb-test-1",
    timestamp: 1000,
    scenarioId: "microburst",
    severity: "severe",
    detectionReason: "Rate exceeded threshold",
    observedRateMbps: 220,
    baselineRateMbps: 40,
    peakRateMbps: 220,
    thresholdMbps: 120,
    durationMs: 100,
    estimatedQueuePct: 85,
    estimatedQueueBytes: 200000,
    isEstimatedQueue: true,
    dropBytes: 15000,
    topContributor: {
      hostId: "h3",
      rateMbps: 180,
      bytes: 200000,
      packets: 140,
      contributionPct: 82,
      attributionNote: "Source represents top instantaneous volume; volume alone does not establish malicious congestion intent.",
    },
    contributingSourcesCount: 1,
    dataSource: "simulated",
    ...opts,
  };
}

function mockTelemetry(t: number, rateMbps = 45, queuePct = 10): WindowTelemetry {
  return {
    windowMs: 100,
    t,
    scenarioId: "normal",
    rateMbps,
    bytes: 50000,
    packets: 40,
    estimatedQueueBytes: queuePct * 2500,
    estimatedQueuePct: queuePct,
    isEstimatedQueue: true,
    dropBytes: 0,
    dropPackets: 0,
    perSource: {
      h1: { rateMbps: 15, bytes: 15000, packets: 10, contributionPct: 33 },
      h2: { rateMbps: 15, bytes: 15000, packets: 10, contributionPct: 33 },
      h3: { rateMbps: 15, bytes: 15000, packets: 10, contributionPct: 34 },
    },
    burstInfo: { active: false, burstStartSim: null, burstPeakMbps: null, burstDurationMs: null },
    dataSource: "simulated",
  };
}

describe("Phase 4 - Adaptive Mitigation Policy Engine", () => {
  test("1. Takes no action when traffic is normal and auto is armed", () => {
    const engine = new MitigationEngine();
    const decision = engine.evaluate(null, mockTelemetry(100, 45, 5));

    expect(decision.action).toBe("none");
    expect(decision.state).toBe("idle");
    expect(engine.isActive()).toBe(false);
  });

  test("2. Applies configurable rate cap to target source when burst is confirmed", () => {
    const engine = new MitigationEngine({
      severeLimitMbps: 35,
    });

    const evt = mockEvent({ severity: "severe" });
    const decision = engine.evaluate(evt, mockTelemetry(1000, 210, 80));

    expect(decision.action).toBe("apply_cap");
    expect(decision.targetHostId).toBe("h3");
    expect(decision.newLimitMbps).toBe(35);
    expect(decision.state).toBe("applied");
    expect(engine.isActive()).toBe(true);
    expect(decision.reason).toContain("H3");
    expect(decision.reason).toContain("does not prove malicious intent");
  });

  test("3. Escalates mitigation gradually if congestion persists (hysteresis protected)", () => {
    const engine = new MitigationEngine({
      initialLimitMbps: 60,
      escalationStepMbps: 10,
      minRateLimitMbps: 20,
      hysteresisWindows: 3,
    });

    // Initial burst application at t=1000
    const d1 = engine.evaluate(mockEvent({ severity: "moderate" }), mockTelemetry(1000, 180, 75));
    expect(d1.action).toBe("apply_cap");
    expect(d1.newLimitMbps).toBe(60);

    // Traffic persists high on subsequent windows before hysteresis window passes (windows 1, 2)
    const d2 = engine.evaluate(null, mockTelemetry(1100, 175, 75));
    expect(d2.action).toBe("none"); // Hysteresis holds cap steady

    const d3 = engine.evaluate(null, mockTelemetry(1200, 175, 75));
    expect(d3.action).toBe("none");

    // Window 3 passes hysteresis threshold => Escalation triggers!
    const d4 = engine.evaluate(null, mockTelemetry(1300, 170, 70));
    expect(d4.action).toBe("escalate_cap");
    expect(d4.newLimitMbps).toBe(50); // 60 - 10
  });

  test("4. Enforces minimum rate limit floor (anti-starvation guardrail)", () => {
    const engine = new MitigationEngine({
      severeLimitMbps: 25,
      escalationStepMbps: 10,
      minRateLimitMbps: 15,
      hysteresisWindows: 1,
    });

    engine.evaluate(mockEvent({ severity: "severe" }), mockTelemetry(1000, 200, 90)); // cap = 25
    engine.evaluate(null, mockTelemetry(1100, 190, 80)); // escalate: 25 - 10 = 15 (hits min floor)
    expect(engine.getCurrentLimit()).toBe(15);

    // Further persistent load cannot decrement below 15 Mbps
    const d3 = engine.evaluate(null, mockTelemetry(1200, 190, 80));
    expect(d3.action).toBe("none");
    expect(engine.getCurrentLimit()).toBe(15);
  });

  test("5. Relaxes and removes cap after sustained recovery windows", () => {
    const engine = new MitigationEngine({
      recoveryWindowsRequired: 3,
    });

    // Apply cap
    engine.evaluate(mockEvent(), mockTelemetry(1000, 190, 80));
    expect(engine.isActive()).toBe(true);

    // Window 1 of normal traffic below congestion threshold
    const r1 = engine.evaluate(null, mockTelemetry(1100, 35, 10));
    expect(r1.state).toBe("recovering");
    expect(engine.isActive()).toBe(true);

    // Window 2
    engine.evaluate(null, mockTelemetry(1200, 35, 10));
    expect(engine.isActive()).toBe(true);

    // Window 3 reaches recoveryWindowsRequired => Cap released
    const r3 = engine.evaluate(null, mockTelemetry(1300, 35, 10));
    expect(r3.action).toBe("release_cap");
    expect(r3.state).toBe("idle");
    expect(engine.isActive()).toBe(false);
  });

  test("6. Enforces safety maximum duration timeout", () => {
    const engine = new MitigationEngine({
      maxDurationMs: 2000,
    });

    engine.evaluate(mockEvent(), mockTelemetry(1000, 190, 80));
    expect(engine.isActive()).toBe(true);

    // Advance simulation time past maxDurationMs (1000 + 2000 = 3000)
    const timeoutDecision = engine.evaluate(null, mockTelemetry(3100, 180, 75));
    expect(timeoutDecision.action).toBe("max_duration_release");
    expect(engine.isActive()).toBe(false);
  });

  test("7. Respects operator disable and manual overrides", () => {
    const engine = new MitigationEngine();
    engine.evaluate(mockEvent(), mockTelemetry(1000, 190, 80));
    expect(engine.isActive()).toBe(true);

    engine.setAutoEnabled(false);
    expect(engine.isActive()).toBe(false);
    expect(engine.getState()).toBe("disabled");

    const decision = engine.evaluate(mockEvent(), mockTelemetry(1100, 190, 80));
    expect(decision.action).toBe("none");
    expect(decision.state).toBe("disabled");
  });
});

describe("Phase 4 - Evaluation Harness (Baseline vs Mitigated)", () => {
  test("runs microburst scenario with paired baseline and mitigated comparison", () => {
    const report = evaluateScenario("microburst", 1337, 4000);

    expect(report.scenario).toBe("microburst");
    expect(report.seed).toBe(1337);
    expect(report.baseline.dropMb).toBeGreaterThanOrEqual(0);
    expect(report.mitigated.dropMb).toBeLessThanOrEqual(report.baseline.dropMb + 0.001);
    expect(report.benefits.queueReductionPct).toBeGreaterThanOrEqual(0);
    expect(report.mitigated.nonTargetThroughputMbps).toBeGreaterThan(0);
  });

  test("runs synchronized incast scenario and demonstrates drop reduction", () => {
    const report = evaluateScenario("incast", 999, 4000);

    expect(report.scenario).toBe("incast");
    expect(report.mitigated.congestedTimeMs).toBeLessThanOrEqual(report.baseline.congestedTimeMs);
  });

  test("runs gradual ramp scenario without collateral damage to nominal flows", () => {
    const report = evaluateScenario("ramp", 555, 4000);

    expect(report.scenario).toBe("ramp");
    // Collateral impact on background flows should remain low
    expect(report.benefits.collateralImpactPct).toBeLessThan(35);
  });

  test("produces deterministic identical metrics across repeated runs with identical seed", () => {
    const reportA = evaluateScenario("microburst", 777, 3000);
    const reportB = evaluateScenario("microburst", 777, 3000);

    expect(reportA.baseline.peakRateMbps).toBe(reportB.baseline.peakRateMbps);
    expect(reportA.mitigated.throughputMbps).toBe(reportB.mitigated.throughputMbps);
    expect(reportA.benefits.dropReductionMb).toBe(reportB.benefits.dropReductionMb);
  });
});
