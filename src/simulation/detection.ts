import type { BurstSeverity, TrafficSample } from "@/types";
import { AVG_PACKET_BYTES } from "./config";

/** Deterministic PRNG (mulberry32). Same seed => same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Convert observed bytes in a window into a rate in Mbps.
 *
 *   rateMbps = bytes * 8 / (windowMs / 1000) / 1_000_000
 */
export function bytesToMbps(bytes: number, windowMs: number): number {
  if (windowMs <= 0) return 0;
  return (bytes * 8) / (windowMs / 1000) / 1_000_000;
}

/** Inverse of bytesToMbps, used by the generator. */
export function mbpsToBytes(mbps: number, windowMs: number): number {
  return (mbps * 1_000_000 * (windowMs / 1000)) / 8;
}

export function bytesToPackets(bytes: number): number {
  return bytes <= 0 ? 0 : Math.round(bytes / AVG_PACKET_BYTES);
}

/** Bytes discovered in a single packet of the given rate/window. */
export function rateToPacketCount(mbps: number, windowMs: number): number {
  return bytesToPackets(mbpsToBytes(mbps, windowMs));
}

/**
 * Rolling mean of the last `baselineWindowMs` of samples.
 *
 * Returns `null` when there is no history (startup): the caller must then fall
 * back to a safe floor rather than dividing by zero or treating an empty
 * baseline as low traffic.
 */
export function rollingBaseline(
  samples: TrafficSample[],
  baselineWindowMs: number,
): number | null {
  if (samples.length === 0) return null;
  const newest = samples[samples.length - 1].t;
  const cutoff = newest - baselineWindowMs;
  let sum = 0;
  let count = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.t < cutoff) break;
    sum += s.rateMbps;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

/**
 * Effective detection threshold: a burst must exceed the configured absolute
 * minimum AND the baseline multiplier, so the higher of the two wins.
 */
export function detectionThreshold(
  baselineMbps: number,
  minRateMbps: number,
  baselineMultiplier: number,
): number {
  return Math.max(minRateMbps, baselineMbps * baselineMultiplier);
}

export function isQualifying(rateMbps: number, thresholdMbps: number): boolean {
  return rateMbps > thresholdMbps;
}

/** Share of a source in the burst. 0 when there is nothing to divide. */
export function contributionPct(
  sourceBytes: number,
  totalBytes: number,
): number {
  if (totalBytes <= 0) return 0;
  return (sourceBytes / totalBytes) * 100;
}

/** Apply an optional rate cap to a modelled flow (Mbps). */
export function applyRateCap(rateMbps: number, capMbps: number | null): number {
  if (capMbps === null || capMbps === undefined) return rateMbps;
  return Math.min(rateMbps, capMbps);
}

export interface QueueResult {
  utilization: number;
  dropBytes: number;
  latencyMs: number;
  estimatedQueueBytes: number;
  estimatedQueuePct: number;
}

/**
 * Switch-buffer queueing model.
 *
 * This is an EXPLICITLY SIMULATED model, not a hardware register measurement.
 * It models queue buffer buildup (default 256 KB switch buffer) and drop-tail
 * drops when incoming rate exceeds drain capacity.
 */
export function simulateQueue(
  rateMbps: number,
  capacityMbps: number,
  baseLatencyMs: number,
  windowMs: number,
  bufferSizeBytes = 256 * 1024,
): QueueResult {
  if (capacityMbps <= 0) {
    return {
      utilization: 0,
      dropBytes: 0,
      latencyMs: baseLatencyMs,
      estimatedQueueBytes: 0,
      estimatedQueuePct: 0,
    };
  }
  const utilization = rateMbps / capacityMbps;
  const incomingBytes = mbpsToBytes(rateMbps, windowMs);
  const serviceBytes = mbpsToBytes(capacityMbps, windowMs);

  const excess = Math.max(0, rateMbps - capacityMbps);
  const dropBytes = mbpsToBytes(excess, windowMs);

  // Queue occupancy estimate based on link load and buffer capacity
  const estimatedQueueBytes = Math.round(
    bufferSizeBytes * (utilization >= 1 ? clamp(utilization - 0.2, 0.8, 1.0) : Math.min(0.2, utilization * 0.2)),
  );



  const estimatedQueuePct = clamp(
    (estimatedQueueBytes / bufferSizeBytes) * 100,
    0,
    100,
  );

  // Latency grows as the link approaches saturation and queue builds up
  const load = clamp(utilization, 0, 0.999);
  const queueDelayMs = (estimatedQueueBytes / Math.max(1, serviceBytes)) * windowMs;
  const latencyMs = baseLatencyMs / Math.max(0.001, 1 - load) + queueDelayMs;

  return {
    utilization,
    dropBytes,
    latencyMs: Math.min(latencyMs, baseLatencyMs * 60),
    estimatedQueueBytes,
    estimatedQueuePct,
  };
}

export function classifySeverity(
  peakMbps: number,
  baselineMbps: number,
  severeRatio: number,
): BurstSeverity {
  if (baselineMbps <= 0) return "severe";
  return peakMbps / baselineMbps >= severeRatio ? "severe" : "moderate";
}
