"""MicroburstHunter — Detector Benchmarks.

Measures:
1. False positive rate across normal, fluctuating traffic traces.
2. Detection rate and latency across repeated sustained microbursts.
3. Transient spike rejection (single-window spikes below persistence threshold).
4. Recovery latency and cooldown behavior following burst cessation.
5. Boundary conditions around configured rate thresholds and persistence windows.
6. Multi-source traffic attribution and contribution ranking.
7. CPU time and memory overhead per window.

Distinction note:
The 10 ms window represents a software-level aggregation. Hardware switches experience
microbursts on microsecond scales resulting in buffer occupancy and packet drops;
this detector models rate-based microburst detection above dynamic rolling baselines.
Synthetic benchmark note:
Finite synthetic tests with 0 false positives validate state-machine correctness under
controlled conditions, but do NOT guarantee zero false positives across arbitrary
production network traffic with heavy-tailed distributions and switch buffer dynamics.
"""

from __future__ import annotations

import json
import os
import random
import time
import tracemalloc
from datetime import datetime, timezone
from typing import Any

from burst_detector import BurstDetector, BurstEvent
from config import DetectionConfig
from metrics import Window


def generate_normal_window(window_idx: int, base_mbps: float = 15.0, jitter_pct: float = 0.25) -> Window:
    """Generate a normal traffic window below detection thresholds."""
    start_ms = window_idx * 10.0
    end_ms = (window_idx + 1) * 10.0
    rate = base_mbps * (1.0 + random.uniform(-jitter_pct, jitter_pct))
    total_bytes = int((rate * 1e6 * 0.010) / 8.0)
    return Window(
        start_ms=start_ms,
        end_ms=end_ms,
        total_bytes=total_bytes,
        packet_count=max(1, total_bytes // 1400),
        per_source_bytes={"10.0.0.1": total_bytes // 2, "10.0.0.2": total_bytes - (total_bytes // 2)},
    )


def generate_burst_window(
    window_idx: int, burst_mbps: float = 150.0, burst_ip: str = "10.0.0.99"
) -> Window:
    """Generate a high-rate burst window."""
    start_ms = window_idx * 10.0
    end_ms = (window_idx + 1) * 10.0
    total_bytes = int((burst_mbps * 1e6 * 0.010) / 8.0)
    burst_bytes = int(total_bytes * 0.90)
    bg_bytes = total_bytes - burst_bytes
    return Window(
        start_ms=start_ms,
        end_ms=end_ms,
        total_bytes=total_bytes,
        packet_count=max(1, total_bytes // 1400),
        per_source_bytes={burst_ip: burst_bytes, "10.0.0.1": bg_bytes},
    )


def generate_multi_source_window(
    window_idx: int,
    total_mbps: float,
    source_distribution: dict[str, float],
) -> Window:
    """Generate a traffic window with specified per-source traffic distribution."""
    start_ms = window_idx * 10.0
    end_ms = (window_idx + 1) * 10.0
    total_bytes = int((total_mbps * 1e6 * 0.010) / 8.0)
    per_source: dict[str, int] = {}
    remaining = total_bytes
    sources = list(source_distribution.items())
    for ip, pct in sources[:-1]:
        bytes_for_src = int(total_bytes * (pct / 100.0))
        per_source[ip] = bytes_for_src
        remaining -= bytes_for_src
    last_ip = sources[-1][0]
    per_source[last_ip] = max(0, remaining)
    return Window(
        start_ms=start_ms,
        end_ms=end_ms,
        total_bytes=total_bytes,
        packet_count=max(1, total_bytes // 1400),
        per_source_bytes=per_source,
    )


def benchmark_false_positives(num_windows: int = 1000, seed: int = 42) -> dict[str, Any]:
    """Measure false positive rate during continuous normal traffic."""
    random.seed(seed)
    cfg = DetectionConfig(window_ms=10, min_rate_mbps=80.0, baseline_multiplier=3.0, persistence_windows=2)
    detected_events: list[BurstEvent] = []

    detector = BurstDetector(cfg, on_event=lambda kind, ev: detected_events.append(ev) if kind == "burst_detected" else None)

    for i in range(num_windows):
        win = generate_normal_window(i, base_mbps=20.0)
        detector.process(win)

    fp_rate = (len(detected_events) / num_windows) * 100.0
    return {
        "num_windows": num_windows,
        "false_positive_count": len(detected_events),
        "false_positive_rate_pct": fp_rate,
        "status": "PASS" if len(detected_events) == 0 else "FAIL",
    }


def benchmark_detection_latency_and_rate(trials: int = 100, seed: int = 101) -> dict[str, Any]:
    """Measure detection latency and detection rate across independent burst trials."""
    random.seed(seed)
    cfg = DetectionConfig(
        window_ms=10,
        min_rate_mbps=80.0,
        baseline_multiplier=3.0,
        persistence_windows=2,
        cooldown_ms=50.0,
    )

    detected_count = 0
    latencies_windows: list[int] = []
    latencies_ms: list[float] = []

    for _ in range(trials):
        events: list[BurstEvent] = []
        detector = BurstDetector(
            cfg,
            on_event=lambda kind, ev: events.append(ev) if kind == "burst_detected" else None,
        )

        # 1. Warm up baseline with 20 normal windows (200 ms)
        w_idx = 0
        for _ in range(20):
            detector.process(generate_normal_window(w_idx, base_mbps=15.0))
            w_idx += 1

        # 2. Inject sustained burst of 5 windows (50 ms)
        burst_start_time_ms = w_idx * 10.0

        for _ in range(5):
            detector.process(generate_burst_window(w_idx, burst_mbps=140.0))
            w_idx += 1

        if events:
            detected_count += 1
            first_event = events[0]
            delay_ms = first_event.started_at_ms - burst_start_time_ms
            delay_windows = int(round(delay_ms / 10.0))
            latencies_ms.append(delay_ms)
            latencies_windows.append(delay_windows)

    detection_rate_pct = (detected_count / trials) * 100.0
    mean_latency_ms = sum(latencies_ms) / len(latencies_ms) if latencies_ms else 0.0
    mean_latency_wins = sum(latencies_windows) / len(latencies_windows) if latencies_windows else 0.0

    return {
        "trials": trials,
        "detected_count": detected_count,
        "detection_rate_pct": detection_rate_pct,
        "mean_latency_ms": round(mean_latency_ms, 2),
        "mean_latency_windows": round(mean_latency_wins, 2),
        "persistence_setting": cfg.persistence_windows,
        "status": "PASS" if detection_rate_pct == 100.0 else "FAIL",
    }


def benchmark_transient_spike_rejection(trials: int = 100, seed: int = 202) -> dict[str, Any]:
    """Measure rejection of transient spikes (1-window duration < persistence threshold)."""
    random.seed(seed)
    cfg = DetectionConfig(
        window_ms=10,
        min_rate_mbps=80.0,
        baseline_multiplier=3.0,
        persistence_windows=2,
    )

    falsely_triggered = 0

    for _ in range(trials):
        events: list[BurstEvent] = []
        detector = BurstDetector(
            cfg,
            on_event=lambda kind, ev: events.append(ev) if kind == "burst_detected" else None,
        )

        w_idx = 0
        # Warmup
        for _ in range(20):
            detector.process(generate_normal_window(w_idx, base_mbps=15.0))
            w_idx += 1

        # Transient spike: exactly 1 window
        detector.process(generate_burst_window(w_idx, burst_mbps=150.0))
        w_idx += 1

        # Return to normal traffic for 5 windows
        for _ in range(5):
            detector.process(generate_normal_window(w_idx, base_mbps=15.0))
            w_idx += 1

        if events:
            falsely_triggered += 1

    rejection_rate_pct = ((trials - falsely_triggered) / trials) * 100.0
    return {
        "trials": trials,
        "falsely_triggered": falsely_triggered,
        "rejection_rate_pct": rejection_rate_pct,
        "status": "PASS" if falsely_triggered == 0 else "FAIL",
    }


def benchmark_recovery_and_cooldown(trials: int = 50, seed: int = 303) -> dict[str, Any]:
    """Measure recovery latency and verify cooldown behavior."""
    random.seed(seed)
    cfg = DetectionConfig(
        window_ms=10,
        min_rate_mbps=80.0,
        baseline_multiplier=3.0,
        persistence_windows=2,
        recovery_windows=3,
        cooldown_ms=50.0,
    )

    recovery_latencies_ms: list[float] = []
    cooldown_enforced_count = 0

    for _ in range(trials):
        detected_list: list[BurstEvent] = []
        ended_list: list[BurstEvent] = []

        def handle_event(kind: str, ev: BurstEvent) -> None:
            if kind == "burst_detected":
                detected_list.append(ev)
            elif kind == "burst_ended":
                ended_list.append(ev)

        detector = BurstDetector(cfg, on_event=handle_event)
        w_idx = 0

        # Warmup
        for _ in range(20):
            detector.process(generate_normal_window(w_idx, base_mbps=15.0))
            w_idx += 1

        # Sustained burst
        for _ in range(4):
            detector.process(generate_burst_window(w_idx, burst_mbps=140.0))
            w_idx += 1

        burst_stop_time_ms = w_idx * 10.0

        # Feed quiet windows until recovery ends
        while not ended_list:
            detector.process(generate_normal_window(w_idx, base_mbps=15.0))
            w_idx += 1

        end_event = ended_list[0]
        rec_delay = (end_event.ended_at_ms or 0.0) - burst_stop_time_ms
        recovery_latencies_ms.append(rec_delay)

        # Attempt immediate secondary burst within cooldown period (20 ms elapsed < 50 ms cfg)
        sec_detected_before = len(detected_list)
        detector.process(generate_burst_window(w_idx, burst_mbps=140.0))
        w_idx += 1
        detector.process(generate_burst_window(w_idx, burst_mbps=140.0))
        w_idx += 1

        # Cooldown must prevent trigger during this period
        if len(detected_list) == sec_detected_before:
            cooldown_enforced_count += 1

    mean_recovery_ms = sum(recovery_latencies_ms) / len(recovery_latencies_ms) if recovery_latencies_ms else 0.0
    return {
        "trials": trials,
        "mean_recovery_ms": round(mean_recovery_ms, 2),
        "recovery_windows_cfg": cfg.recovery_windows,
        "cooldown_enforced_count": cooldown_enforced_count,
        "cooldown_enforcement_pct": (cooldown_enforced_count / trials) * 100.0,
        "status": "PASS" if cooldown_enforced_count == trials else "FAIL",
    }


def benchmark_boundary_conditions() -> dict[str, Any]:
    """Test boundary conditions around rate threshold edges and persistence window borders."""
    cfg = DetectionConfig(
        window_ms=10,
        min_rate_mbps=80.0,
        baseline_multiplier=3.0,
        persistence_windows=2,
    )

    tests: list[dict[str, Any]] = []

    # 1. Sub-threshold boundary test: baseline 15 Mbps -> threshold = max(80.0, 15.0 * 3.0) = 80.0 Mbps
    # Traffic at 79.5 Mbps (just below 80.0 Mbps) for 5 windows -> MUST NOT trigger
    sub_events: list[BurstEvent] = []
    det_sub = BurstDetector(cfg, on_event=lambda k, ev: sub_events.append(ev) if k == "burst_detected" else None)
    w_idx = 0
    for _ in range(20):
        det_sub.process(generate_normal_window(w_idx, base_mbps=15.0, jitter_pct=0.0))
        w_idx += 1
    for _ in range(5):
        # exactly 79.5 Mbps
        tot_bytes = int((79.5 * 1e6 * 0.010) / 8.0)
        win = Window(start_ms=w_idx * 10.0, end_ms=(w_idx + 1) * 10.0, total_bytes=tot_bytes, packet_count=tot_bytes // 1400, per_source_bytes={"10.0.0.1": tot_bytes})
        det_sub.process(win)
        w_idx += 1
    tests.append({
        "case": "Rate Sub-Threshold (79.5 Mbps vs 80.0 Mbps threshold)",
        "expected_triggered": False,
        "actual_triggered": len(sub_events) > 0,
        "pass": len(sub_events) == 0,
    })

    # 2. Super-threshold boundary test: traffic at 80.5 Mbps for 5 windows -> MUST trigger on 2nd window
    super_events: list[BurstEvent] = []
    det_super = BurstDetector(cfg, on_event=lambda k, ev: super_events.append(ev) if k == "burst_detected" else None)
    w_idx = 0
    for _ in range(20):
        det_super.process(generate_normal_window(w_idx, base_mbps=15.0, jitter_pct=0.0))
        w_idx += 1
    for _ in range(5):
        tot_bytes = int((80.5 * 1e6 * 0.010) / 8.0)
        win = Window(start_ms=w_idx * 10.0, end_ms=(w_idx + 1) * 10.0, total_bytes=tot_bytes, packet_count=tot_bytes // 1400, per_source_bytes={"10.0.0.1": tot_bytes})
        det_super.process(win)
        w_idx += 1
    tests.append({
        "case": "Rate Super-Threshold (80.5 Mbps vs 80.0 Mbps threshold)",
        "expected_triggered": True,
        "actual_triggered": len(super_events) > 0,
        "pass": len(super_events) == 1,
    })

    # 3. Persistence boundary: exactly 1 window at 150 Mbps -> MUST NOT trigger (persistence=2)
    p1_events: list[BurstEvent] = []
    det_p1 = BurstDetector(cfg, on_event=lambda k, ev: p1_events.append(ev) if k == "burst_detected" else None)
    w_idx = 0
    for _ in range(20):
        det_p1.process(generate_normal_window(w_idx, base_mbps=15.0, jitter_pct=0.0))
        w_idx += 1
    det_p1.process(generate_burst_window(w_idx, burst_mbps=150.0))
    w_idx += 1
    for _ in range(5):
        det_p1.process(generate_normal_window(w_idx, base_mbps=15.0, jitter_pct=0.0))
        w_idx += 1
    tests.append({
        "case": "Persistence Lower Border (1 window spike < 2 window threshold)",
        "expected_triggered": False,
        "actual_triggered": len(p1_events) > 0,
        "pass": len(p1_events) == 0,
    })

    # 4. Persistence boundary: exactly 2 windows at 150 Mbps -> MUST trigger on 2nd window
    p2_events: list[BurstEvent] = []
    det_p2 = BurstDetector(cfg, on_event=lambda k, ev: p2_events.append(ev) if k == "burst_detected" else None)
    w_idx = 0
    for _ in range(20):
        det_p2.process(generate_normal_window(w_idx, base_mbps=15.0, jitter_pct=0.0))
        w_idx += 1
    det_p2.process(generate_burst_window(w_idx, burst_mbps=150.0))
    w_idx += 1
    det_p2.process(generate_burst_window(w_idx, burst_mbps=150.0))
    w_idx += 1
    for _ in range(5):
        det_p2.process(generate_normal_window(w_idx, base_mbps=15.0, jitter_pct=0.0))
        w_idx += 1
    tests.append({
        "case": "Persistence Exact Border (2 windows sustained == 2 window threshold)",
        "expected_triggered": True,
        "actual_triggered": len(p2_events) > 0,
        "pass": len(p2_events) == 1,
    })

    all_passed = all(t["pass"] for t in tests)
    return {
        "tests": tests,
        "all_passed": all_passed,
        "status": "PASS" if all_passed else "FAIL",
    }


def benchmark_multi_source_attribution() -> dict[str, Any]:
    """Test top offender attribution and contribution calculation across multi-source traffic."""
    cfg = DetectionConfig(
        window_ms=10,
        min_rate_mbps=80.0,
        baseline_multiplier=3.0,
        persistence_windows=2,
    )

    cases: list[dict[str, Any]] = []

    # Case A: Dominant offender (IP A = 75%, IP B = 15%, IP C = 10%)
    ev_a: list[BurstEvent] = []
    det_a = BurstDetector(cfg, on_event=lambda k, ev: ev_a.append(ev) if k == "burst_detected" else None)
    w_idx = 0
    for _ in range(20):
        det_a.process(generate_normal_window(w_idx, base_mbps=15.0))
        w_idx += 1

    dist_a = {"10.0.1.100": 75.0, "10.0.1.2": 15.0, "10.0.1.3": 10.0}
    for _ in range(3):
        det_a.process(generate_multi_source_window(w_idx, total_mbps=150.0, source_distribution=dist_a))
        w_idx += 1

    top_ip_a = ev_a[0].source_ip if ev_a else "none"
    contrib_a = ev_a[0].contribution_pct if ev_a else 0.0
    passed_a = (top_ip_a == "10.0.1.100") and (abs(contrib_a - 75.0) < 1.0)
    cases.append({
        "scenario": "Dominant Single Offender (75% / 15% / 10%)",
        "expected_top_ip": "10.0.1.100",
        "actual_top_ip": top_ip_a,
        "expected_contribution_pct": 75.0,
        "actual_contribution_pct": round(contrib_a, 2),
        "pass": passed_a,
    })

    # Case B: Co-equal multi-offender (IP A = 50%, IP B = 50%)
    ev_b: list[BurstEvent] = []
    det_b = BurstDetector(cfg, on_event=lambda k, ev: ev_b.append(ev) if k == "burst_detected" else None)
    w_idx = 0
    for _ in range(20):
        det_b.process(generate_normal_window(w_idx, base_mbps=15.0))
        w_idx += 1

    dist_b = {"10.0.2.1": 50.0, "10.0.2.2": 50.0}
    for _ in range(3):
        det_b.process(generate_multi_source_window(w_idx, total_mbps=150.0, source_distribution=dist_b))
        w_idx += 1

    top_ip_b = ev_b[0].source_ip if ev_b else "none"
    contrib_b = ev_b[0].contribution_pct if ev_b else 0.0
    passed_b = (top_ip_b in ("10.0.2.1", "10.0.2.2")) and (abs(contrib_b - 50.0) < 1.0)
    cases.append({
        "scenario": "Co-Equal Dual Sources (50% / 50%)",
        "expected_top_ip": "10.0.2.1 or 10.0.2.2",
        "actual_top_ip": top_ip_b,
        "expected_contribution_pct": 50.0,
        "actual_contribution_pct": round(contrib_b, 2),
        "pass": passed_b,
    })

    all_passed = all(c["pass"] for c in cases)
    return {
        "cases": cases,
        "all_passed": all_passed,
        "status": "PASS" if all_passed else "FAIL",
    }


def benchmark_detector_resources(num_windows: int = 10000) -> dict[str, Any]:
    """Measure CPU time and memory overhead of BurstDetector over 10,000 windows."""
    cfg = DetectionConfig(window_ms=10, min_rate_mbps=80.0, baseline_multiplier=3.0)
    detector = BurstDetector(cfg)

    # Pre-generate windows to separate generation time from processing time
    windows = [generate_normal_window(i, base_mbps=15.0) for i in range(num_windows)]

    tracemalloc.start()
    t_cpu_start = time.process_time()
    t_wall_start = time.perf_counter()

    for win in windows:
        detector.process(win)

    t_wall_end = time.perf_counter()
    t_cpu_end = time.process_time()
    _, peak_mem = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    wall_sec = max(1e-6, t_wall_end - t_wall_start)
    cpu_sec = max(1e-6, t_cpu_end - t_cpu_start)
    throughput_wps = num_windows / wall_sec
    cpu_us_per_win = (cpu_sec / num_windows) * 1e6

    return {
        "num_windows": num_windows,
        "total_wall_sec": round(wall_sec, 4),
        "total_cpu_sec": round(cpu_sec, 4),
        "throughput_windows_per_sec": round(throughput_wps, 1),
        "cpu_microsec_per_window": round(cpu_us_per_win, 2),
        "peak_memory_kb": round(peak_mem / 1024.0, 2),
        "status": "PASS",
    }


def run_all_detector_benchmarks() -> dict[str, Any]:
    print("=" * 80)
    print("MICROBURSTHUNTER — DETECTOR BENCHMARK SUITE")
    print("=" * 80)

    fp = benchmark_false_positives()
    print(f"1. False Positives       : {fp['false_positive_count']} in {fp['num_windows']} windows ({fp['false_positive_rate_pct']}%) -> {fp['status']}")

    lat = benchmark_detection_latency_and_rate()
    print(f"2. Detection Rate        : {lat['detected_count']}/{lat['trials']} ({lat['detection_rate_pct']}%) | Mean Latency: {lat['mean_latency_ms']} ms ({lat['mean_latency_windows']} windows) -> {lat['status']}")

    trans = benchmark_transient_spike_rejection()
    print(f"3. Transient Rejection   : {trans['rejection_rate_pct']}% rejected ({trans['falsely_triggered']} false triggers in {trans['trials']} spikes) -> {trans['status']}")

    rec = benchmark_recovery_and_cooldown()
    print(f"4. Recovery & Cooldown   : Mean Recovery: {rec['mean_recovery_ms']} ms | Cooldown Enforced: {rec['cooldown_enforcement_pct']}% -> {rec['status']}")

    bnd = benchmark_boundary_conditions()
    print(f"5. Boundary Conditions   : Rate edge (79.5 vs 80.5 Mbps) & Persistence borders (1 vs 2 win) -> {bnd['status']}")

    multi = benchmark_multi_source_attribution()
    print(f"6. Multi-Source Ranking  : Dominant (75%) & Co-Equal (50%) attribution -> {multi['status']}")

    res = benchmark_detector_resources()
    print(f"7. Resource Overhead     : Throughput: {res['throughput_windows_per_sec']:.0f} win/s | CPU: {res['cpu_microsec_per_window']:.2f} µs/win | Peak RAM: {res['peak_memory_kb']:.1f} KB -> {res['status']}")
    print("=" * 80)

    report: dict[str, Any] = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "disclaimer": (
            "Synthetic benchmark results validate internal state-machine correctness, latency, and attribution logic. "
            "Zero false positives in this finite synthetic suite does NOT guarantee zero false positives in production networks."
        ),
        "false_positives": fp,
        "latency_and_rate": lat,
        "transient_rejection": trans,
        "recovery_and_cooldown": rec,
        "boundary_conditions": bnd,
        "multi_source_attribution": multi,
        "resources": res,
    }

    # Save to JSON file
    json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "detector_benchmark_results.json")
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        print(f"Results exported to {json_path}")
    except Exception as exc:
        print(f"Warning: Failed to export results to {json_path}: {exc}")

    return report


if __name__ == "__main__":
    run_all_detector_benchmarks()
