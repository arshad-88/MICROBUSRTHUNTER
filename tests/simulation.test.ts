import { describe, expect, test } from "vitest";
import {
  applyRateCap,
  bytesToMbps,
  classifySeverity,
  contributionPct,
  detectionThreshold,
  isQualifying,
  mbpsToBytes,
  rollingBaseline,
  simulateQueue,
} from "../src/simulation/detection";
import { SimulationEngine } from "../src/simulation/engine";
import {
  DEFAULT_CONFIG,
  SOURCE_HOST_IDS,
  type AppConfig,
} from "../src/simulation/config";
import type { TrafficSample } from "../src/types";

function config(overrides?: (c: AppConfig) => void): AppConfig {
  const c: AppConfig = {
    detection: { ...DEFAULT_CONFIG.detection },
    mitigation: { ...DEFAULT_CONFIG.mitigation },
    simulation: { ...DEFAULT_CONFIG.simulation },
  };
  overrides?.(c);
  return c;
}

function sample(t: number, rate: number): TrafficSample {
  return {
    t,
    rateMbps: rate,
    baselineMbps: 50,
    thresholdMbps: 150,
    bytes: mbpsToBytes(rate, 10),
    packets: 0,
    dropBytes: 0,
    latencyMs: 0,
    perSource: {},
  };
}

describe("rate calculations", () => {
  test("converts bytes in a 10 ms window to Mbps", () => {
    // 125,000 bytes over 10 ms => 100 Mbps
    expect(bytesToMbps(125_000, 10)).toBeCloseTo(100, 6);
  });

  test("mbpsToBytes is the inverse of bytesToMbps", () => {
    const bytes = mbpsToBytes(200, 10);
    expect(bytesToMbps(bytes, 10)).toBeCloseTo(200, 6);
  });

  test("guards against a zero window", () => {
    expect(bytesToMbps(1000, 0)).toBe(0);
  });
});

describe("detection thresholds", () => {
  test("threshold is the greater of minimum rate and baseline multiple", () => {
    expect(detectionThreshold(50, 80, 3)).toBe(150); // 3x50 dominates
    expect(detectionThreshold(10, 80, 3)).toBe(80); // minimum rate dominates
  });

  test("qualification is strictly above the threshold", () => {
    expect(isQualifying(151, 150)).toBe(true);
    expect(isQualifying(150, 150)).toBe(false);
    expect(isQualifying(80, 80)).toBe(false);
  });

  test("rolling baseline averages only samples inside the window", () => {
    const samples = [sample(0, 10), sample(10, 20), sample(20, 30)];
    expect(rollingBaseline(samples, 1000)).toBeCloseTo(20, 6);
    expect(rollingBaseline([], 1000)).toBeNull();
    // newest t=20, cutoff t>=5 keeps the 10 and 20 samples => (20 + 30) / 2
    expect(rollingBaseline(samples, 15)).toBeCloseTo(25, 6);
  });

  test("severity uses the peak/baseline ratio", () => {
    expect(classifySeverity(500, 100, 5)).toBe("severe");
    expect(classifySeverity(200, 100, 5)).toBe("moderate");
  });
});

describe("source contribution", () => {
  test("computes burst byte share as a percentage", () => {
    expect(contributionPct(25, 100)).toBe(25);
    expect(contributionPct(0, 100)).toBe(0);
  });

  test("returns 0 instead of dividing by zero", () => {
    expect(contributionPct(10, 0)).toBe(0);
  });
});

describe("mitigation caps", () => {
  test("applies a cap to a modelled flow", () => {
    expect(applyRateCap(300, 60)).toBe(60);
    expect(applyRateCap(30, 60)).toBe(30);
    expect(applyRateCap(300, null)).toBe(300);
  });
});

describe("queue / overflow model", () => {
  test("no drops below capacity and drops above it", () => {
    const under = simulateQueue(100, 220, 0.4, 10);
    expect(under.dropBytes).toBe(0);
    const over = simulateQueue(300, 220, 0.4, 10);
    expect(over.dropBytes).toBeCloseTo(mbpsToBytes(80, 10), 4);
    expect(over.latencyMs).toBeGreaterThan(under.latencyMs);
  });
});

describe("engine — detection and mitigation", () => {
  test("normal traffic does not trigger false bursts under defaults", () => {
    const engine = new SimulationEngine({ config: config() });
    engine.start();
    for (let i = 0; i < 200; i += 1) engine.tick();
    const snap = engine.getSnapshot();
    expect(snap.burstCount).toBe(0);
    expect(snap.summary.peakMbps).toBeLessThan(snap.latest!.thresholdMbps);
  });

  test("simulateBurst produces a reproducible detection event", () => {
    const engine = new SimulationEngine({ config: config() });
    engine.start();
    // Warm the detector past the baseline warm-up window.
    for (let i = 0; i < 5; i += 1) engine.tick();
    engine.simulateBurst("h3");
    for (let i = 0; i < 30; i += 1) engine.tick();
    const snap = engine.getSnapshot();
    expect(snap.burstCount).toBeGreaterThanOrEqual(1);
    expect(snap.burstIntervals.length).toBeGreaterThanOrEqual(1);
  });

  test("the offending source is capped while a severe/normal burst is mitigated", () => {
    const engine = new SimulationEngine({
      config: config((c) => {
        c.mitigation.autoEnabled = true;
      }),
    });
    engine.start();
    for (let i = 0; i < 5; i += 1) engine.tick();
    engine.simulateBurst("h3");
    for (let i = 0; i < 30; i += 1) engine.tick();
    const snap = engine.getSnapshot();
    const h3 = snap.sources.find((s) => s.id === "h3")!;
    // Either the cap is currently enforced, or it was enforced and released
    // after recovery — both prove the policy acted on the model.
    const policyActed =
      h3.rateCapMbps !== null ||
      snap.events.some((e) => e.type === "mitigation_activated");
    expect(policyActed).toBe(true);
  });

  test("mitigation reduces the modelled flow below the uncapped peak", () => {
    const burstPeak = 200;
    const capped = new SimulationEngine({
      config: config((c) => {
        c.mitigation.autoEnabled = true;
        c.mitigation.rateLimitMbps = 20;
        c.mitigation.severeRateLimitMbps = 15;
        c.mitigation.maxDurationMs = 100000;
        c.simulation.burstPeakMbps = burstPeak;
      }),
    });
    capped.start();
    for (let i = 0; i < 5; i += 1) capped.tick();
    capped.simulateBurst("h3");
    for (let i = 0; i < 12; i += 1) capped.tick();
    const snap = capped.getSnapshot();
    const h3 = snap.sources.find((s) => s.id === "h3")!;
    // With a 15-20 Mbps cap the burst host must sit far below its raw peak.
    expect(h3.rateMbps).toBeLessThan(burstPeak / 2);
  });

  test("recovery releases the cap and restores unrestricted traffic", () => {
    const engine = new SimulationEngine({
      config: config((c) => {
        c.mitigation.autoEnabled = true;
        c.detection.recoveryWindows = 3;
      }),
    });
    engine.start();
    for (let i = 0; i < 5; i += 1) engine.tick();
    engine.simulateBurst("h3", { durationMs: 120, peakMbps: 200 });
    for (let i = 0; i < 40; i += 1) engine.tick();
    const snap = engine.getSnapshot();
    expect(snap.mitigation.active).toBe(false);
    expect(snap.events.some((e) => e.type === "traffic_recovered")).toBe(true);
    expect(snap.events.some((e) => e.type === "mitigation_removed")).toBe(true);
  });

  test("reset restores a clean experiment state", () => {
    const engine = new SimulationEngine({ config: config() });
    engine.start();
    for (let i = 0; i < 5; i += 1) engine.tick();
    engine.simulateBurst("h3");
    for (let i = 0; i < 20; i += 1) engine.tick();
    engine.reset();
    const snap = engine.getSnapshot();
    expect(snap.history.length).toBe(0);
    expect(snap.burstCount).toBe(0);
    expect(snap.mitigation.active).toBe(false);
    expect(SOURCE_HOST_IDS.every((id) => (snap.sources.find((s) => s.id === id)?.bytes ?? 0) === 0)).toBe(true);
  });
});

describe("engine — experiments", () => {
  test("experiment 3 runs to completion and records mitigation activity", () => {
    const engine = new SimulationEngine({
      config: config((c) => {
        c.simulation.experimentDurationMs = 2000;
        c.simulation.burstDurationMs = 400;
        c.simulation.burstPeakMbps = 200;
      }),
    });
    engine.startExperiment(3);
    let guard = 0;
    while (engine.isRunning() && guard < 500) {
      engine.tick();
      guard += 1;
    }
    const snap = engine.getSnapshot();
    expect(snap.experiments.length).toBe(1);
    const result = snap.experiments[0];
    expect(result.scenario).toBe(3);
    expect(result.burstCount).toBeGreaterThanOrEqual(1);
    expect(result.mitigationDurationMs).toBeGreaterThan(0);
    expect(result.dataSource).toBe("simulated");
  });

  test("deterministic seed yields the same average rate for the same scenario", () => {
    const make = () => {
      const engine = new SimulationEngine({
        config: config((c) => {
          c.simulation.experimentDurationMs = 1500;
        }),
      });
      engine.startExperiment(1, 4242);
      let guard = 0;
      while (engine.isRunning() && guard < 500) {
        engine.tick();
        guard += 1;
      }
      return engine.getSnapshot().experiments[0]?.avgRateMbps ?? 0;
    };
    const a = make();
    const b = make();
    expect(a).toBeCloseTo(b, 6);
  });
});

