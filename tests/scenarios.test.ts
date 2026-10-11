import { describe, expect, test } from "vitest";
import { SimulationEngine } from "../src/simulation/engine";
import { TRAFFIC_SCENARIOS, type TrafficScenarioType } from "../src/simulation/scenarios";
import { simulateQueue } from "../src/simulation/detection";
import { DEFAULT_CONFIG } from "../src/simulation/config";

describe("Phase 2 - Controlled Traffic Scenarios", () => {
  const scenarios: TrafficScenarioType[] = [
    "normal",
    "ramp",
    "microburst",
    "incast",
    "recovery",
  ];

  test("supports all 5 required traffic scenarios with valid metadata", () => {
    for (const sc of scenarios) {
      expect(TRAFFIC_SCENARIOS[sc]).toBeDefined();
      expect(TRAFFIC_SCENARIOS[sc].name).toBeTruthy();
      expect(TRAFFIC_SCENARIOS[sc].defaultDurationMs).toBeGreaterThan(0);
      expect(TRAFFIC_SCENARIOS[sc].defaultIntensityMbps).toBeGreaterThan(0);
      expect(TRAFFIC_SCENARIOS[sc].defaultSenderCount).toBeGreaterThan(0);
    }
  });

  test("runs Normal steady traffic without declaring false bursts on baseline", () => {
    const engine = new SimulationEngine({
      config: {
        ...DEFAULT_CONFIG,
        simulation: { ...DEFAULT_CONFIG.simulation, seed: 42 },
      },
    });
    engine.start();
    engine.setScenario({ scenario: "normal" });

    // Tick for 2 seconds (10ms windows * 200)
    for (let i = 0; i < 40; i++) {
      engine.tick();
    }

    const snap = engine.getSnapshot();
    expect(snap.activeScenario).toBe("normal");
    expect(snap.latest).not.toBeNull();
    expect(snap.latest?.rateMbps).toBeGreaterThan(0);
    expect(snap.latest?.rateMbps).toBeLessThan(snap.config.simulation.linkCapacityMbps);
    expect(snap.burstActive).toBe(false);
  });

  test("runs Ramp scenario with gradually increasing load", () => {
    const engine = new SimulationEngine({
      config: {
        ...DEFAULT_CONFIG,
        simulation: { ...DEFAULT_CONFIG.simulation, seed: 100 },
      },
    });
    engine.start();
    engine.setScenario({ scenario: "ramp" });

    // Initial rate
    for (let i = 0; i < 5; i++) engine.tick();
    const initialRate = engine.getSnapshot().latest?.rateMbps ?? 0;

    // After more elapsed simulation time, rate ramps up
    for (let i = 0; i < 50; i++) engine.tick();
    const rampedRate = engine.getSnapshot().latest?.rateMbps ?? 0;

    expect(rampedRate).toBeGreaterThan(initialRate);
  });

  test("runs Microburst scenario producing a detectable burst on target sender", () => {
    const engine = new SimulationEngine({
      config: {
        ...DEFAULT_CONFIG,
        simulation: { ...DEFAULT_CONFIG.simulation, seed: 777, windowsPerTick: 1 },
      },
    });
    engine.start();
    // Warm up baseline first
    for (let i = 0; i < 30; i++) engine.tick();

    engine.setScenario({
      scenario: "microburst",
      intensityMbps: 220,
      burstHostId: "h2",
    });

    let detected = false;
    for (let i = 0; i < 60; i++) {
      engine.tick();
      if (engine.getSnapshot().burstActive) {
        detected = true;
        break;
      }
    }

    expect(detected).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.currentBurst?.hostId).toBe("h2");
  });

  test("runs Incast scenario with synchronized multi-sender load", () => {
    const engine = new SimulationEngine({
      config: {
        ...DEFAULT_CONFIG,
        simulation: { ...DEFAULT_CONFIG.simulation, seed: 999, windowsPerTick: 1 },
      },
    });
    engine.start();
    for (let i = 0; i < 20; i++) engine.tick();

    engine.setScenario({
      scenario: "incast",
      senderCount: 4,
      intensityMbps: 250,
    });

    let hitQueueCongestion = false;
    for (let i = 0; i < 80; i++) {
      engine.tick();
      const telemetry = engine.getLatestTelemetry();
      if (telemetry && telemetry.estimatedQueuePct > 10) {
        hitQueueCongestion = true;
        // Verify multiple sources contributed
        const activeContributors = Object.values(telemetry.perSource).filter(
          (s) => s.rateMbps > 20,
        );
        expect(activeContributors.length).toBeGreaterThanOrEqual(2);
        break;
      }
    }

    expect(hitQueueCongestion).toBe(true);
  });

  test("runs Recovery scenario returning to steady state after burst concludes", () => {
    const engine = new SimulationEngine({
      config: {
        ...DEFAULT_CONFIG,
        simulation: { ...DEFAULT_CONFIG.simulation, seed: 456, windowsPerTick: 2 },
      },
    });
    engine.start();
    for (let i = 0; i < 25; i++) engine.tick();

    engine.setScenario({ scenario: "recovery", intensityMbps: 180 });

    // Step until burst is active
    let sawBurst = false;
    for (let i = 0; i < 50; i++) {
      engine.tick();
      if (engine.getSnapshot().burstActive) {
        sawBurst = true;
        break;
      }
    }
    expect(sawBurst).toBe(true);

    // Step through the recovery window until burst completes
    for (let i = 0; i < 150; i++) {
      engine.tick();
      if (!engine.getSnapshot().burstActive) {
        break;
      }
    }

    const finalSnap = engine.getSnapshot();
    expect(finalSnap.burstActive).toBe(false);
  });

  test("guarantees repeatability when initialized with the same random seed", () => {
    const run = (seed: number) => {
      const e = new SimulationEngine({
        config: {
          ...DEFAULT_CONFIG,
          simulation: { ...DEFAULT_CONFIG.simulation, seed },
        },
      });
      e.start();
      e.setScenario({ scenario: "normal" });
      for (let i = 0; i < 20; i++) e.tick();
      return e.getSnapshot().history.map((s) => Math.round(s.rateMbps * 100));
    };

    const runA = run(12345);
    const runB = run(12345);
    const runC = run(54321);

    expect(runA).toEqual(runB);
    expect(runA).not.toEqual(runC);
  });
});

describe("Phase 3 - Short-Window Telemetry Engine", () => {
  test("generates strictly ordered timestamps and consistent windows", () => {
    const engine = new SimulationEngine({
      config: {
        ...DEFAULT_CONFIG,
        detection: { ...DEFAULT_CONFIG.detection, windowMs: 100 },
        simulation: { ...DEFAULT_CONFIG.simulation, seed: 123 },
      },
    });
    engine.start();
    for (let i = 0; i < 15; i++) engine.tick();

    const history = engine.getSnapshot().history;
    expect(history.length).toBeGreaterThan(10);

    for (let i = 1; i < history.length; i++) {
      expect(history[i].t).toBeGreaterThan(history[i - 1].t);
      expect(history[i].t - history[i - 1].t).toBe(100);
    }
  });

  test("validates WindowTelemetry schema and explicit estimated queue metadata", () => {
    const engine = new SimulationEngine();
    engine.start();
    engine.setScenario({ scenario: "normal" });
    for (let i = 0; i < 5; i++) engine.tick();

    const telemetry = engine.getLatestTelemetry();
    expect(telemetry).not.toBeNull();
    if (!telemetry) return;

    expect(telemetry.dataSource).toBe("simulated");
    expect(telemetry.isEstimatedQueue).toBe(true);
    expect(telemetry.windowMs).toBe(engine.config.detection.windowMs);
    expect(telemetry.rateMbps).toBeGreaterThan(0);
    expect(telemetry.bytes).toBeGreaterThan(0);
    expect(telemetry.packets).toBeGreaterThan(0);
    expect(telemetry.estimatedQueueBytes).toBeGreaterThanOrEqual(0);
    expect(telemetry.estimatedQueuePct).toBeGreaterThanOrEqual(0);
    expect(telemetry.estimatedQueuePct).toBeLessThanOrEqual(100);
    expect(telemetry.dropBytes).toBeGreaterThanOrEqual(0);
    expect(telemetry.dropPackets).toBeGreaterThanOrEqual(0);
    expect(telemetry.burstInfo).toBeDefined();

    // Verify per-source breakdown sums to ~100%
    const totalShare = Object.values(telemetry.perSource).reduce(
      (sum, s) => sum + s.contributionPct,
      0,
    );
    expect(totalShare).toBeCloseTo(100, 1);
  });

  test("queue model computes buffer buildup without fabricating live metrics", () => {
    // Normal rate below link capacity (220 Mbps)
    const normalQueue = simulateQueue(100, 220, 0.4, 100);
    expect(normalQueue.dropBytes).toBe(0);
    expect(normalQueue.estimatedQueuePct).toBeLessThan(20);

    // Severe rate above capacity (350 Mbps > 220 Mbps)
    const overloadQueue = simulateQueue(350, 220, 0.4, 100);
    expect(overloadQueue.dropBytes).toBeGreaterThan(0);
    expect(overloadQueue.estimatedQueueBytes).toBeGreaterThan(0);
    expect(overloadQueue.latencyMs).toBeGreaterThan(normalQueue.latencyMs);
  });

  test("start, stop and reset controls behave cleanly", () => {
    const engine = new SimulationEngine();
    expect(engine.isRunning()).toBe(false);

    engine.start();
    expect(engine.isRunning()).toBe(true);

    engine.tick();
    const timeAfterTick = engine.getSnapshot().simTime;
    expect(timeAfterTick).toBeGreaterThan(0);

    engine.stop();
    expect(engine.isRunning()).toBe(false);
    engine.tick(); // When stopped, tick should not advance
    expect(engine.getSnapshot().simTime).toBe(timeAfterTick);

    engine.reset();
    expect(engine.getSnapshot().simTime).toBe(0);
    expect(engine.getSnapshot().history.length).toBe(0);
  });
});
