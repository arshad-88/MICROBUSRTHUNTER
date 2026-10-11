import { describe, expect, test } from "vitest";
import { MicroburstDetector } from "../src/simulation/detector";
import type { WindowTelemetry } from "../src/simulation/scenarios";

function makeWindow(opts: {
  t: number;
  rateMbps: number;
  scenarioId?: string;
  estimatedQueuePct?: number;
  estimatedQueueBytes?: number;
  dropBytes?: number;
  perSource?: WindowTelemetry["perSource"];
}): WindowTelemetry {
  const windowMs = 100;
  const bytes = (opts.rateMbps * 1_000_000 * 0.1) / 8;
  const defaultPerSource = {
    h1: { rateMbps: opts.rateMbps * 0.4, bytes: bytes * 0.4, packets: 10, contributionPct: 40 },
    h2: { rateMbps: opts.rateMbps * 0.3, bytes: bytes * 0.3, packets: 8, contributionPct: 30 },
    h3: { rateMbps: opts.rateMbps * 0.3, bytes: bytes * 0.3, packets: 8, contributionPct: 30 },
  };

  return {
    windowMs,
    t: opts.t,
    scenarioId: (opts.scenarioId as any) ?? "normal",
    rateMbps: opts.rateMbps,
    bytes,
    packets: Math.round(bytes / 1400),
    estimatedQueueBytes: opts.estimatedQueueBytes ?? 0,
    estimatedQueuePct: opts.estimatedQueuePct ?? 0,
    isEstimatedQueue: true,
    dropBytes: opts.dropBytes ?? 0,
    dropPackets: 0,
    perSource: opts.perSource ?? defaultPerSource,
    burstInfo: {
      active: false,
      burstStartSim: null,
      burstPeakMbps: null,
      burstDurationMs: null,
    },
    dataSource: "simulated",
  };
}

describe("Phase 3 - Microburst Detection Engine", () => {
  test("1. Normal steady traffic produces no false positive alerts", () => {
    const detector = new MicroburstDetector({
      minRateMbps: 80,
      baselineMultiplier: 2.5,
      persistenceWindows: 2,
    });

    // Feed 30 windows of normal traffic hovering around 40-50 Mbps
    let detectedEvent = null;
    for (let i = 1; i <= 30; i++) {
      const w = makeWindow({
        t: i * 100,
        rateMbps: 45 + (i % 3) * 2,
        scenarioId: "normal",
      });
      const evt = detector.processWindow(w);
      if (evt) detectedEvent = evt;
    }

    expect(detectedEvent).toBeNull();
    expect(detector.getDetections().length).toBe(0);
    expect(detector.getSnapshot().activeBurst).toBe(false);
  });

  test("2. A clear microburst is promptly detected with structured event details", () => {
    const detector = new MicroburstDetector({
      minRateMbps: 80,
      baselineMultiplier: 2.5,
      persistenceWindows: 2,
    });

    // Establish normal baseline
    for (let i = 1; i <= 15; i++) {
      detector.processWindow(makeWindow({ t: i * 100, rateMbps: 30 }));
    }

    // Inject sharp microburst on h2
    const burstSources = {
      h1: { rateMbps: 15, bytes: 1000, packets: 1, contributionPct: 7 },
      h2: { rateMbps: 180, bytes: 20000, packets: 15, contributionPct: 85 },
      h3: { rateMbps: 15, bytes: 1000, packets: 1, contributionPct: 8 },
    };

    let startEvent = null;
    // Window 1 of burst
    detector.processWindow(
      makeWindow({
        t: 1600,
        rateMbps: 210,
        scenarioId: "microburst",
        perSource: burstSources,
        estimatedQueuePct: 85,
      }),
    );

    // Window 2 of burst meets persistence
    startEvent = detector.processWindow(
      makeWindow({
        t: 1700,
        rateMbps: 215,
        scenarioId: "microburst",
        perSource: burstSources,
        estimatedQueuePct: 90,
      }),
    );

    expect(startEvent).not.toBeNull();
    if (!startEvent) return;

    expect(startEvent.severity).toBe("severe");
    expect(startEvent.observedRateMbps).toBe(215);
    expect(startEvent.topContributor?.hostId).toBe("h2");
    expect(startEvent.topContributor?.contributionPct).toBeCloseTo(83.7, 1);
    expect(startEvent.topContributor?.attributionNote).toContain("does not establish malicious congestion intent");
    expect(startEvent.isEstimatedQueue).toBe(true);
    expect(startEvent.estimatedQueuePct).toBe(90);
  });

  test("3. Gradual load increase (ramp) does not trigger microburst false alerts", () => {
    const detector = new MicroburstDetector({
      minRateMbps: 80,
      baselineMultiplier: 3.0,
      baselineWindowMs: 2000,
      persistenceWindows: 2,
    });

    let falseAlarm = null;
    // Gently ramp from 30 Mbps to 75 Mbps across 40 windows (4 seconds)
    for (let i = 1; i <= 40; i++) {
      const rate = 30 + (i / 40) * 45;
      const evt = detector.processWindow(
        makeWindow({
          t: i * 100,
          rateMbps: rate,
          scenarioId: "ramp",
        }),
      );
      if (evt) falseAlarm = evt;
    }

    expect(falseAlarm).toBeNull();
    expect(detector.getDetections().length).toBe(0);
  });

  test("4. Synchronized incast traffic is detected and flags multi-sender contribution", () => {
    const detector = new MicroburstDetector({
      minRateMbps: 80,
      baselineMultiplier: 2.0,
      persistenceWindows: 2,
    });

    for (let i = 1; i <= 15; i++) {
      detector.processWindow(makeWindow({ t: i * 100, rateMbps: 25 }));
    }

    // 4 senders simultaneously bursting
    const incastSources = {
      h1: { rateMbps: 55, bytes: 5000, packets: 4, contributionPct: 25 },
      h2: { rateMbps: 60, bytes: 5500, packets: 4, contributionPct: 27 },
      h3: { rateMbps: 50, bytes: 4800, packets: 4, contributionPct: 23 },
      h4: { rateMbps: 55, bytes: 5000, packets: 4, contributionPct: 25 },
    };

    detector.processWindow(
      makeWindow({
        t: 1600,
        rateMbps: 220,
        scenarioId: "incast",
        perSource: incastSources,
        estimatedQueuePct: 95,
      }),
    );

    const incastEvt = detector.processWindow(
      makeWindow({
        t: 1700,
        rateMbps: 220,
        scenarioId: "incast",
        perSource: incastSources,
        estimatedQueuePct: 98,
      }),
    );

    expect(incastEvt).not.toBeNull();
    expect(incastEvt?.contributingSourcesCount).toBe(4);
    expect(incastEvt?.topContributor?.contributionPct).toBeLessThan(35); // No single dominant flow
  });

  test("5. Evaluates threshold boundaries and noise rejection correctly", () => {
    const detector = new MicroburstDetector({
      minRateMbps: 100,
      baselineMultiplier: 2.0,
      persistenceWindows: 1,
    });

    for (let i = 1; i <= 10; i++) {
      detector.processWindow(makeWindow({ t: i * 100, rateMbps: 40 }));
    }

    // Rate is 99 Mbps: just below minRateMbps (100)
    const belowMin = detector.processWindow(makeWindow({ t: 1100, rateMbps: 99 }));
    expect(belowMin).toBeNull();
    expect(detector.getDetections().length).toBe(0);

    // Rate jumps to 105 Mbps: exceeds minRateMbps and baseline factor (105 > 40*2)
    const boundaryEvt = detector.processWindow(makeWindow({ t: 1200, rateMbps: 105 }));
    expect(boundaryEvt).not.toBeNull();
    expect(boundaryEvt?.observedRateMbps).toBe(105);
  });

  test("6. Event deduplication and cooldown prevents alert storms", () => {
    const detector = new MicroburstDetector({
      minRateMbps: 80,
      baselineMultiplier: 2.0,
      persistenceWindows: 1,
      recoveryWindows: 2,
      cooldownMs: 800,
    });

    for (let i = 1; i <= 10; i++) {
      detector.processWindow(makeWindow({ t: i * 100, rateMbps: 30 }));
    }

    // Burst 1 starts at t=1100
    const burst1 = detector.processWindow(makeWindow({ t: 1100, rateMbps: 150 }));
    expect(burst1).not.toBeNull();

    // 2 quiet windows end burst 1 at t=1300
    detector.processWindow(makeWindow({ t: 1200, rateMbps: 30 }));
    detector.processWindow(makeWindow({ t: 1300, rateMbps: 30 }));

    // Immediately trigger spike at t=1400 (only 100ms after end at 1300, cooldown is 800ms)
    const suppressed = detector.processWindow(makeWindow({ t: 1400, rateMbps: 160 }));
    expect(suppressed).toBeNull(); // Deduplicated / suppressed by cooldown

    // After cooldown elapses (t=2200 >= 1300 + 800)
    // Warm baseline slightly
    detector.processWindow(makeWindow({ t: 2000, rateMbps: 30 }));
    detector.processWindow(makeWindow({ t: 2100, rateMbps: 30 }));
    const burst2 = detector.processWindow(makeWindow({ t: 2200, rateMbps: 160 }));
    expect(burst2).not.toBeNull();
  });


  test("7. Handles missing, null or invalid telemetry gracefully", () => {
    const detector = new MicroburstDetector();
    expect(detector.processWindow(null)).toBeNull();
    expect(detector.processWindow(undefined)).toBeNull();
    expect(detector.processWindow({} as any)).toBeNull();
    expect(detector.processWindow({ t: "invalid", rateMbps: 100 } as any)).toBeNull();
    expect(detector.getDetections().length).toBe(0);
  });

  test("8. Yields strictly reproducible results for identical sequences", () => {
    const runSequence = () => {
      const d = new MicroburstDetector({
        minRateMbps: 80,
        baselineMultiplier: 2.5,
        persistenceWindows: 2,
      });

      const events: string[] = [];
      for (let i = 1; i <= 25; i++) {
        const rate = i === 12 || i === 13 ? 200 : 35 + (i % 4);
        const evt = d.processWindow(makeWindow({ t: i * 100, rateMbps: rate }));
        if (evt) events.push(evt.eventId);
      }
      return events;
    };

    const seqA = runSequence();
    const seqB = runSequence();
    expect(seqA.length).toBeGreaterThan(0);
    expect(seqA).toEqual(seqB);
  });

  test("9. Accurately reports false positive & false negative metrics against known scenario ground truth", () => {
    // Evaluation benchmark against known scenario ground truths:
    // - Normal: expected ground truth = NO burst (negative)
    // - Microburst: expected ground truth = BURST (positive)
    const benchmark = [
      { scenario: "normal", shouldDetect: false, rate: 40 },
      { scenario: "normal", shouldDetect: false, rate: 45 },
      { scenario: "microburst", shouldDetect: true, rate: 220 },
      { scenario: "normal", shouldDetect: false, rate: 42 },
    ];

    let falsePositives = 0;
    let falseNegatives = 0;
    let truePositives = 0;
    let trueNegatives = 0;

    const detector = new MicroburstDetector({
      minRateMbps: 80,
      baselineMultiplier: 2.5,
      persistenceWindows: 1,
    });

    // Baseline warmup
    for (let i = 1; i <= 10; i++) {
      detector.processWindow(makeWindow({ t: i * 100, rateMbps: 35 }));
    }

    benchmark.forEach((item, index) => {
      const t = 1100 + index * 100;
      const detected = detector.processWindow(
        makeWindow({ t, rateMbps: item.rate, scenarioId: item.scenario }),
      ) !== null;

      if (detected && !item.shouldDetect) falsePositives += 1;
      else if (!detected && item.shouldDetect) falseNegatives += 1;
      else if (detected && item.shouldDetect) truePositives += 1;
      else trueNegatives += 1;
    });

    expect(falsePositives).toBe(0);
    expect(falseNegatives).toBe(0);
    expect(truePositives).toBe(1);
    expect(trueNegatives).toBe(3);
  });
});
