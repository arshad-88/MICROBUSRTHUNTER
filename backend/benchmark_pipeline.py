"""MicroburstHunter — End-to-End Pipeline Benchmarks.

Measures stages independently and end-to-end:
1. Window processing (Source ranking + window aggregation + timeout checks).
2. Standalone source ranking.
3. Standalone burst detection engine.
4. Mitigation policy decisions (severity classification, cooldown, adaptive cap).
5. Controller dry-run command planning (HTB hierarchy validation and command generation).
6. Event persistence (SQLite insert + index updates + commit).
7. Detection-to-mitigation decision latency (in-process event -> policy -> dry-run plan -> store).
8. Bounded pipeline shutdown latency.

Provides statistical summaries: Sample Count, Mean, Median (P50), P95, P99, Max.

Distinction note:
All timings in this suite are IN-PROCESS microbenchmarks measured with monotonic clocks
(time.perf_counter()). They characterize software algorithmic and I/O efficiency,
and must NOT be confused with live-kernel netlink/RTNETLINK transaction latencies
or hardware wire transit times.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from burst_detector import BurstDetector, BurstEvent
from config import DetectionConfig, RuntimeConfig
from event_store import EventStore
from main import CapturePipeline
from metrics import Window
from mitigation_policy import MitigationPolicy
from source_ranker import SourceRanker
from tc_controller import TcController


def compute_statistics(samples: list[float]) -> dict[str, float]:
    """Calculate sample count, mean, median, p95, p99, and max from latency samples."""
    if not samples:
        return {"count": 0.0, "mean": 0.0, "median": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0}

    s = sorted(samples)
    n = len(s)
    mean = sum(s) / n

    def p(pct: float) -> float:
        k = (n - 1) * (pct / 100.0)
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return s[int(k)]
        return s[f] * (c - k) + s[c] * (k - f)

    return {
        "count": float(n),
        "mean": round(mean, 3),
        "median": round(p(50.0), 3),
        "p95": round(p(95.0), 3),
        "p99": round(p(99.0), 3),
        "max": round(s[-1], 3),
    }


def benchmark_window_processing(sample_count: int = 1000, warmup_count: int = 50) -> dict[str, Any]:
    """Measure latency of processing windows through full pipeline (ranker + detector + store)."""
    cfg = RuntimeConfig()
    store = EventStore(":memory:")
    ctrl = TcController(interface="dummy0", dry_run=True)
    pipeline = CapturePipeline(
        cfg=cfg, interface="dummy0", store=store, controller=ctrl, emit_fn=lambda _k, _p: None
    )

    # Warmup
    for i in range(warmup_count):
        win = Window(start_ms=i * 10.0, end_ms=(i + 1) * 10.0, total_bytes=18750, packet_count=13, per_source_bytes={"10.0.0.1": 18750})
        pipeline.on_window(win)

    latencies_us: list[float] = []

    for i in range(sample_count):
        rate = 15.0 if i < 900 else 150.0
        tot_bytes = int((rate * 1e6 * 0.010) / 8.0)
        win = Window(
            start_ms=(i + warmup_count) * 10.0,
            end_ms=(i + warmup_count + 1) * 10.0,
            total_bytes=tot_bytes,
            packet_count=max(1, tot_bytes // 1400),
            per_source_bytes={"10.0.0.1": tot_bytes // 2, "10.0.0.2": tot_bytes - (tot_bytes // 2)},
        )

        t0 = time.perf_counter()
        pipeline.on_window(win)
        t1 = time.perf_counter()
        latencies_us.append((t1 - t0) * 1e6)

    pipeline.close()
    store.close()

    stats_us = compute_statistics(latencies_us)
    throughput_wps = sample_count / (sum(latencies_us) * 1e-6) if sum(latencies_us) > 0 else 0.0

    return {
        "sample_count": sample_count,
        "latency_us": stats_us,
        "throughput_windows_per_sec": round(throughput_wps, 1),
    }


def benchmark_source_ranker(sample_count: int = 1000, warmup_count: int = 50) -> dict[str, Any]:
    """Measure isolated source ranker performance across multi-source traffic windows."""
    ranker = SourceRanker()
    per_source_sample = {f"10.0.1.{i}": 1000 * i for i in range(1, 11)}

    # Warmup
    for _ in range(warmup_count):
        ranker.reset()
        for ip, b in per_source_sample.items():
            ranker.observe(ip, b)
        ranker.top_source()

    latencies_us: list[float] = []
    for _ in range(sample_count):
        ranker.reset()
        t0 = time.perf_counter()
        for ip, b in per_source_sample.items():
            ranker.observe(ip, b)
        ranker.top_source()
        t1 = time.perf_counter()
        latencies_us.append((t1 - t0) * 1e6)

    return {
        "sample_count": sample_count,
        "latency_us": compute_statistics(latencies_us),
    }


def benchmark_burst_detection(sample_count: int = 1000, warmup_count: int = 50) -> dict[str, Any]:
    """Measure isolated BurstDetector engine processing latency."""
    cfg = DetectionConfig(window_ms=10, min_rate_mbps=80.0, baseline_multiplier=3.0)
    detector = BurstDetector(cfg)

    # Warmup
    for i in range(warmup_count):
        win = Window(start_ms=i * 10.0, end_ms=(i + 1) * 10.0, total_bytes=18750, packet_count=13, per_source_bytes={"10.0.0.1": 18750})
        detector.process(win)

    latencies_us: list[float] = []
    for i in range(sample_count):
        rate = 15.0 if i < 900 else 150.0
        tot_bytes = int((rate * 1e6 * 0.010) / 8.0)
        win = Window(
            start_ms=(i + warmup_count) * 10.0,
            end_ms=(i + warmup_count + 1) * 10.0,
            total_bytes=tot_bytes,
            packet_count=max(1, tot_bytes // 1400),
            per_source_bytes={"10.0.0.1": tot_bytes},
        )
        t0 = time.perf_counter()
        detector.process(win)
        t1 = time.perf_counter()
        latencies_us.append((t1 - t0) * 1e6)

    return {
        "sample_count": sample_count,
        "latency_us": compute_statistics(latencies_us),
    }


def benchmark_policy_decision(sample_count: int = 500, warmup_count: int = 50) -> dict[str, Any]:
    """Measure latency of adaptive policy decision on burst arrival."""
    cfg = RuntimeConfig()
    cfg.mitigation.auto_enabled = True
    policy = MitigationPolicy(cfg.mitigation)

    # Warmup
    for i in range(warmup_count):
        ev = BurstEvent(started_at_ms=100.0 + i, ended_at_ms=None, peak_mbps=150.0, baseline_mbps=15.0, threshold_mbps=45.0, source_ip="10.0.1.1", contribution_pct=95.0, severity="severe", detection_delay_ms=20.0)
        policy.on_burst(ev)

    latencies_us: list[float] = []
    for i in range(sample_count):
        ev = BurstEvent(
            started_at_ms=200.0 + i,
            ended_at_ms=None,
            peak_mbps=150.0,
            baseline_mbps=15.0,
            threshold_mbps=45.0,
            source_ip=f"10.0.1.{i % 250 + 1}",
            contribution_pct=95.0,
            severity="severe" if i % 2 == 0 else "moderate",
            detection_delay_ms=20.0,
        )

        t0 = time.perf_counter()
        policy.on_burst(ev)
        t1 = time.perf_counter()
        latencies_us.append((t1 - t0) * 1e6)

    return {
        "sample_count": sample_count,
        "latency_us": compute_statistics(latencies_us),
    }


def benchmark_controller_planning(sample_count: int = 200, warmup_count: int = 20) -> dict[str, Any]:
    """Measure latency of dry-run tc command planning and hierarchy validation."""
    ctrl = TcController(interface="veth_test", dry_run=True)

    # Warmup
    for i in range(warmup_count):
        ctrl.plan_source_cap("10.200.1.2", 35.0)

    latencies_us: list[float] = []
    for i in range(sample_count):
        ip = f"10.200.1.{i % 200 + 2}"
        t0 = time.perf_counter()
        ctrl.plan_source_cap(ip, 35.0)
        t1 = time.perf_counter()
        latencies_us.append((t1 - t0) * 1e6)

    return {
        "sample_count": sample_count,
        "latency_us": compute_statistics(latencies_us),
    }


def benchmark_event_persistence(sample_count: int = 500, warmup_count: int = 20) -> dict[str, Any]:
    """Measure latency of SQLite record insertions and commit."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tf:
        db_path = tf.name

    store = EventStore(db_path)

    # Warmup
    for i in range(warmup_count):
        store.record(type="warmup", severity="info", action="warmup", outcome="ok", source_ip="10.0.0.1", rate_mbps=10.0)

    latencies_us: list[float] = []
    for i in range(sample_count):
        t0 = time.perf_counter()
        store.record(
            type="burst_detected",
            severity="critical",
            action="burst_detected: severe burst from 10.0.0.1",
            outcome="peak 150.0 Mbps vs threshold 45.0 Mbps",
            source_ip="10.0.0.1",
            rate_mbps=150.0,
        )
        t1 = time.perf_counter()
        latencies_us.append((t1 - t0) * 1e6)

    store.close()
    Path(db_path).unlink(missing_ok=True)

    return {
        "sample_count": sample_count,
        "latency_us": compute_statistics(latencies_us),
    }


def benchmark_detection_to_mitigation_decision(sample_count: int = 500, warmup_count: int = 20) -> dict[str, Any]:
    """Measure end-to-end in-process decision latency (BurstEvent -> policy decision -> dry-run plan -> store record)."""
    cfg = RuntimeConfig()
    cfg.mitigation.auto_enabled = True
    policy = MitigationPolicy(cfg.mitigation)
    ctrl = TcController(interface="dummy0", dry_run=True)
    store = EventStore(":memory:")

    # Warmup
    for i in range(warmup_count):
        ev = BurstEvent(started_at_ms=100.0 + i, ended_at_ms=None, peak_mbps=150.0, baseline_mbps=15.0, threshold_mbps=45.0, source_ip="10.0.0.1", contribution_pct=90.0, severity="severe", detection_delay_ms=20.0)
        dec = policy.on_burst(ev)
        if dec.action == "apply" and dec.cap_mbps:
            cmds = ctrl.plan_source_cap(ev.source_ip, dec.cap_mbps)
            store.record(type="mitigation_applied", severity="critical", action="apply", outcome="dry_run", source_ip=ev.source_ip, rate_mbps=dec.cap_mbps)

    latencies_us: list[float] = []
    for i in range(sample_count):
        ev = BurstEvent(
            started_at_ms=200.0 + i,
            ended_at_ms=None,
            peak_mbps=150.0,
            baseline_mbps=15.0,
            threshold_mbps=45.0,
            source_ip=f"10.0.1.{i % 250 + 1}",
            contribution_pct=90.0,
            severity="severe",
            detection_delay_ms=20.0,
        )

        t0 = time.perf_counter()
        dec = policy.on_burst(ev)
        if dec.action == "apply" and dec.cap_mbps:
            ctrl.plan_source_cap(ev.source_ip, dec.cap_mbps)
            store.record(
                type="mitigation_applied",
                severity="critical",
                action="apply",
                outcome="dry_run",
                source_ip=ev.source_ip,
                rate_mbps=dec.cap_mbps,
            )
        t1 = time.perf_counter()
        latencies_us.append((t1 - t0) * 1e6)

    store.close()

    return {
        "sample_count": sample_count,
        "latency_us": compute_statistics(latencies_us),
    }


def benchmark_shutdown_latency(trials: int = 50) -> dict[str, Any]:
    """Measure bounded shutdown latency with active timer and occupied mitigation."""
    cfg = RuntimeConfig()
    cfg.mitigation.auto_enabled = True
    cfg.dry_run = True

    latencies_ms: list[float] = []

    for _ in range(trials):
        store = EventStore(":memory:")
        ctrl = TcController(interface="dummy0", dry_run=True)
        pipeline = CapturePipeline(
            cfg=cfg, interface="dummy0", store=store, controller=ctrl, emit_fn=lambda _k, _p: None
        )

        # Trigger simulated active mitigation
        ev = BurstEvent(
            started_at_ms=100.0,
            ended_at_ms=None,
            peak_mbps=150.0,
            baseline_mbps=15.0,
            threshold_mbps=45.0,
            source_ip="10.0.0.99",
            contribution_pct=95.0,
            severity="severe",
            detection_delay_ms=20.0,
        )
        pipeline.on_event("burst_detected", ev)

        t0 = time.perf_counter()
        pipeline.close()
        t1 = time.perf_counter()
        latencies_ms.append((t1 - t0) * 1e3)

    return {
        "trials": trials,
        "shutdown_latency_ms": compute_statistics(latencies_ms),
    }


def run_all_pipeline_benchmarks() -> dict[str, Any]:
    print("=" * 80)
    print("MICROBURSTHUNTER — END-TO-END PIPELINE BENCHMARK SUITE")
    print("=" * 80)
    print("Note: In-process microbenchmarks on monotonic clock; software overhead only.")

    win = benchmark_window_processing(sample_count=1000)
    w_stats = win["latency_us"]
    print(f"\n1. Window Processing Latency (N={int(w_stats['count'])}):")
    print(f"   Mean: {w_stats['mean']:.2f} µs | Median (P50): {w_stats['median']:.2f} µs | P95: {w_stats['p95']:.2f} µs | P99: {w_stats['p99']:.2f} µs | Max: {w_stats['max']:.2f} µs")
    print(f"   Throughput Capacity: {win['throughput_windows_per_sec']:.0f} windows/second")

    rnk = benchmark_source_ranker(sample_count=1000)
    r_stats = rnk["latency_us"]
    print(f"\n2. Source Ranking Latency (N={int(r_stats['count'])}):")
    print(f"   Mean: {r_stats['mean']:.2f} µs | Median (P50): {r_stats['median']:.2f} µs | P95: {r_stats['p95']:.2f} µs | P99: {r_stats['p99']:.2f} µs")

    det = benchmark_burst_detection(sample_count=1000)
    d_stats = det["latency_us"]
    print(f"\n3. Burst Detector Engine Latency (N={int(d_stats['count'])}):")
    print(f"   Mean: {d_stats['mean']:.2f} µs | Median (P50): {d_stats['median']:.2f} µs | P95: {d_stats['p95']:.2f} µs | P99: {d_stats['p99']:.2f} µs")

    pol = benchmark_policy_decision(sample_count=500)
    p_stats = pol["latency_us"]
    print(f"\n4. Mitigation Policy Decision Latency (N={int(p_stats['count'])}):")
    print(f"   Mean: {p_stats['mean']:.2f} µs | Median (P50): {p_stats['median']:.2f} µs | P95: {p_stats['p95']:.2f} µs | P99: {p_stats['p99']:.2f} µs")

    ctrl = benchmark_controller_planning(sample_count=200)
    c_stats = ctrl["latency_us"]
    print(f"\n5. Controller Dry-Run Planning Latency (N={int(c_stats['count'])}):")
    print(f"   Mean: {c_stats['mean']:.2f} µs | Median (P50): {c_stats['median']:.2f} µs | P95: {c_stats['p95']:.2f} µs | P99: {c_stats['p99']:.2f} µs")

    pers = benchmark_event_persistence(sample_count=500)
    s_stats = pers["latency_us"]
    print(f"\n6. SQLite Persistence Latency (N={int(s_stats['count'])}):")
    print(f"   Mean: {s_stats['mean']:.2f} µs | Median (P50): {s_stats['median']:.2f} µs | P95: {s_stats['p95']:.2f} µs | P99: {s_stats['p99']:.2f} µs")

    e2e = benchmark_detection_to_mitigation_decision(sample_count=500)
    e_stats = e2e["latency_us"]
    print(f"\n7. Detection-to-Mitigation Decision Latency (In-Process) (N={int(e_stats['count'])}):")
    print(f"   Mean: {e_stats['mean']:.2f} µs | Median (P50): {e_stats['median']:.2f} µs | P95: {e_stats['p95']:.2f} µs | P99: {e_stats['p99']:.2f} µs")

    shut = benchmark_shutdown_latency(trials=50)
    sh_stats = shut["shutdown_latency_ms"]
    print(f"\n8. Bounded Shutdown Latency (N={int(sh_stats['count'])}):")
    print(f"   Mean: {sh_stats['mean']:.3f} ms | Median (P50): {sh_stats['median']:.3f} ms | P95: {sh_stats['p95']:.3f} ms | Max: {sh_stats['max']:.3f} ms")
    print("=" * 80)

    report: dict[str, Any] = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "disclaimer": (
            "In-process microbenchmarks measured using monotonic clock (time.perf_counter()). "
            "These numbers quantify Python software execution latency and memory overhead, "
            "not live-kernel netlink socket roundtrips or hardware packet transit."
        ),
        "window_processing": win,
        "source_ranking": rnk,
        "burst_detection": det,
        "policy_decision": pol,
        "controller_planning": ctrl,
        "event_persistence": pers,
        "detection_to_mitigation_decision": e2e,
        "bounded_shutdown": shut,
    }

    # Save to JSON file
    json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pipeline_benchmark_results.json")
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        print(f"Results exported to {json_path}")
    except Exception as exc:
        print(f"Warning: Failed to export results to {json_path}: {exc}")

    return report


if __name__ == "__main__":
    run_all_pipeline_benchmarks()
