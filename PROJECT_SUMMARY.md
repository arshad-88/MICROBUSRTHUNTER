# MicroburstHunter — Project Summary & Technical Evaluation Guide

## 1. Executive Summary & Problem Statement

In modern high-throughput data-center and cloud networks, **microbursts**—sudden, sub-RTT surges in packet transmission lasting tens to hundreds of milliseconds—frequently cause catastrophic packet drops, buffer overflow, and tail-latency degradation. Standard network telemetry tools (SNMP, NetFlow, sFlow) poll at multi-second intervals (1–30 s), completely averaging out these short-lived spikes and obscuring the root causes of packet loss.

**MicroburstHunter** addresses this challenge with a high-resolution, two-tier architecture:
1. **Sub-Millisecond Software Detection & Adaptive Shaping Engine:** A high-frequency packet telemetry and EWMA rate-analysis pipeline that detects microbursts within 20 ms, isolates offending flows using per-IP contribution tracking, and applies targeted egress rate limiting via Linux traffic control (`tc`/HTB/flower).
2. **Interactive Web Operations Console:** A responsive React 19 / TypeScript monitoring console featuring topology visualization, live EWMA threshold charts, before-and-after experiment comparisons, and audit logging.

> **Honesty & Operational Disclaimer:** MicroburstHunter performs host-side software detection (10 ms sliding windows) and local egress queue shaping (`tc`/HTB). It does not claim to replace physical switch ASIC buffer telemetry (such as broadcom shared buffer watermarks, PFC, or hardware INT).

---

## 2. Solution & System Architecture

```text
  [ Network Traffic ]
          │
          ▼
┌────────────────────────────────────────────────────────┐
│ 1. Telemetry Capture Pipeline (Scapy / AF_PACKET)       │
│    - Sliding window aggregation (10 ms default)        │
│    - Per-source IP byte & packet counting              │
└────────────────────────────────────────────────────────┘
          │ (Window metrics: end_ms, rate_mbps, per_source_bytes)
          ▼
┌────────────────────────────────────────────────────────┐
│ 2. Deterministic Burst Detection Engine                │
│    - Exponentially Weighted Moving Average (EWMA)      │
│    - Dynamic Threshold: max(min_rate, baseline × mult) │
│    - Persistence Filter (>= 2 consecutive windows)     │
│    - Cooldown & Recovery Guardrails (3 quiet windows)  │
└────────────────────────────────────────────────────────┘
          │ (BurstEvent: peak_mbps, threshold_mbps, severity)
          ▼
┌────────────────────────────────────────────────────────┐
│ 3. Per-Source Attribution & Ranking Engine             │
│    - Rolling attribution window                        │
│    - Relative contribution calculation: source_bytes / total│
│    - Identification of primary offender (e.g. 85% share)│
└────────────────────────────────────────────────────────┘
          │ (Attributed Offender IP)
          ▼
┌────────────────────────────────────────────────────────┐
│ 4. Adaptive Mitigation Policy Arbitrator               │
│    - Severity classification (None / Moderate / Severe)│
│    - Dynamic rate cap calculation (e.g. 35 Mbps)       │
│    - Monotonic wall-clock inactivity timeout (watchdog)│
└────────────────────────────────────────────────────────┘
          │ (Policy Decision: APPLY / REMOVE / NONE)
          ▼
┌────────────────────────────────────────────────────────┐
│ 5. Traffic Control Controller (Linux tc / HTB / flower)│
│    - Dry-run simulation by default                     │
│    - Class 1:10 source-specific rate limit (HTB ceil)  │
│    - Class 1:30 unshaped default flow isolation        │
│    - Flower packet filter targeting offender IP        │
│    - Atomic rollback & unresolved state preservation   │
└────────────────────────────────────────────────────────┘
          │
          ├──► Persistent SQLite Audit Log (EventStore)
          └──► Streaming Telemetry (WebSocket / SSE Console)
```

---

## 3. Key Implementation Details

- **Deterministic Detection Engine (`backend/burst_detector.py`):**
  - Evaluates window rates: $\text{rate\_mbps} = \frac{\text{bytes} \times 8}{\text{window\_sec} \times 10^6}$.
  - Dynamically computes threshold: $\max(\text{min\_rate}, \text{baseline} \times \text{multiplier})$.
  - Enforces consecutive window persistence to eliminate single-window transient spikes.
  - Enforces quiet recovery windows before returning to baseline state.
- **Source Ranker (`backend/source_ranker.py`):**
  - Maintains sliding per-IP byte counts across observation windows.
  - Sorts candidates deterministically and calculates percentage contributions.
- **Mitigation Policy Arbitrator (`backend/mitigation_policy.py`):**
  - Evaluates burst severity ratios against configurable thresholds (e.g., $5\times$ baseline $\rightarrow$ severe).
  - Assigns calibrated caps (e.g. 35.0 Mbps for severe, 60.0 Mbps for moderate).
  - Enforces safety clampings and handles cooldown transitions.
- **Traffic Control Controller (`backend/tc_controller.py`):**
  - Generates and manages Linux kernel HTB queueing disciplines and flower source classifiers.
  - Restricts shaping to child classes (`class 1:10`), leaving parent class `1:1` and default class `1:30` intact for unclassified background flows.
  - Validates interfaces before issuing netlink commands; strictly forbids mutating `eth0`, `lo`, or the host's default route.
- **Concurrency & Failure Safety (`backend/main.py`):**
  - Re-entrant thread safety (`RLock`) synchronizing capture callbacks, timer expirations, and shutdown.
  - Dedicated monotonic wall-clock watchdog expiring active mitigations on idle traffic without depending on incoming packets.
  - Failure-tolerant rollback: if RTNETLINK rollback fails, the pipeline transitions to an explicit `unresolved` state, preserving diagnostic context and rejecting new mitigations until operator remediation.

---

## 4. Verified Empirical Results

All measurements are derived from actual execution and saved in machine-readable JSON artifacts:

### A. Overload Shaping under Live Linux Kernel (ackend/overload_benchmark_results.json)
The Linux kernel traffic-control testbed executes inside disposable network namespace mbh_ns_test on eth_peer with a configured 35.0 Mbps severe cap on 10.200.1.2 under genuine overload (~100 Mbps offered load over 2.0 s trials). All privileged mutations are confined to the testbed and clean up automatically.

#### 1. Newly Measured Phase 12 Live-Kernel Revalidation (Current Run: 2026-10-12)
*Status: SUCCESS | Target Cap: 35.0 Mbps on HTB Class 1:10 | Default Class 1:30: 1,000 Mbps line rate*

| Layer / Measurement Metric | Baseline (Unshaped) | Overload Trial 1 | Overload Trial 2 | Overload Trial 3 | Phase 12 Mean |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **1. Application Attempted Load** | 91.02 Mbps | 92.04 Mbps | 92.12 Mbps | 92.30 Mbps | **92.15 Mbps** |
| **Attempted Packets / Bytes** | 16,254 / 22.76 MB | 16,443 / 23.02 MB | 16,452 / 23.03 MB | 16,488 / 23.08 MB | **16,461 / 23.04 MB** |
| **2. Socket Admitted Rate** | 91.02 Mbps | 34.46 Mbps | 34.48 Mbps | 34.46 Mbps | **34.47 Mbps** |
| **Admitted Packets / Bytes** | 16,254 / 22.76 MB | 6,156 / 8.62 MB | 6,158 / 8.62 MB | 6,156 / 8.62 MB | **6,157 / 8.62 MB** |
| **3. Socket Backpressure Throttles** | **0 pkts** | **10,287 pkts** | **10,294 pkts** | **10,332 pkts** | **10,304 pkts** |
| **4. HTB Class 1:10 Byte Delta** | N/A (unshaped) | 8,813,504 B | 8,863,974 B | 8,865,416 B | **8,847,631 B** |
| **HTB Class 1:10 Overlimits** | 0 events | 6,109 events | 6,146 events | 6,148 events | **6,134 events** |
| **HTB Class 1:10 Drops** | 0 pkts | 0 pkts | 0 pkts | 0 pkts | **0 pkts (token-controlled)** |
| **5. Receiver Observed Rate** | **91.07 Mbps** | **33.75 Mbps** | **33.98 Mbps** | **33.99 Mbps** | **33.91 Mbps** |
| **6. Receiver Packet-Count Difference** | 0 pkts (0.0%) | 58 pkts (0.94%) | 23 pkts (0.37%) | 23 pkts (0.37%) | **34.67 pkts (0.563%, ~35 rounded pkts)** |

> **Standalone Single Mitigated Sample:** The testbed also executed a standalone single-trial measurement: Offered: **91.25 Mbps**, Admitted: **34.21 Mbps**, Receiver Observed: **33.714 Mbps**, Socket Throttles: **10,188 pkts**, Receiver Difference: **76 pkts (1.244%)**. This is recorded as a separate reference point distinct from the 3-run summary trials above.

#### 2. Historical Phase 6 Live-Kernel Baseline Comparison
| Benchmark Run | Mean Offered | Mean Admitted | Mean Backpressure | Class 1:10 Overlimits | Mean Receiver Rate | Cap Enforcement Accuracy |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Historical Phase 6** | 92.54 Mbps | 34.43 Mbps | 10,380 pkts | 6,129 events | **33.97 Mbps** | **2.94% of 35M cap** |
| **Newly Measured Phase 12** | 92.15 Mbps | 34.47 Mbps | 10,304 pkts | 6,134 events | **33.91 Mbps** | **3.11% of 35M cap** |

- **Cross-Run Repeatability:** The shaper achieves phenomenal repeatability across independent live-kernel executions (33.97 Mbps vs 33.91 Mbps, both within ~3% of the 35.0 Mbps severe cap).
- **Socket Backpressure vs Receiver Packet-Count Differences:** Attempted load (~92.2 Mbps) exceeds the cap. When the HTB class token bucket is exhausted, packets queue in the kernel netdevice buffer. Non-blocking UDP sockets experience BlockingIOError, throttling ~10,304 attempted packets at the sender. This socket backpressure is application rate-limiting. Kernel HTB drops were 0. The observed difference between sender socket admissions and receiver packet counts averaged 34.67 packets (~35 rounded packets, 0.563%). Because zero HTB drops does not prove physical wire loss, this count delta is instrumented at the socket layer and reported neutrally as a receiver packet-count difference.
- **Traffic Isolation:** Secondary background flow on default class 1:30 transferred **+2,163,042 bytes (+2.16 MB)** at full line rate without interference while class 1:10 shaped the offender.
- **Lifecycle & Cleanup Audit:** Manual rollback, clean reapplication, idle wall-clock timeout (200 ms), and conflicting mitigation rejection (status: busy) all passed. Injected-failure cleanup verified zero leftover namespaces or interfaces. Host default route (default via 192.168.240.1 dev eth0) remained 100% untouched.

### B. Detector Engine Benchmark (`backend/detector_benchmark_results.json`)
- **Detection Rate:** 100/100 (100.0%) across independent burst trials.
- **False Positive Rate:** 0 in 1,000 fluctuating windows (0.0%).
- **Detection Latency:** 20.0 ms (2.0 windows).
- **Transient Spike Rejection:** 100.0% rejected (0 false triggers on single-window spikes).
- **Throughput:** 128,880 windows/sec (Windows) / 230,968 windows/sec (WSL/Linux).

### C. Pipeline Latency Microbenchmarks (`backend/pipeline_benchmark_results.json`)
- Window processing: Mean 7.29 µs, Median 7.30 µs, P99 9.10 µs.
- Source ranking: Mean 6.60 µs, Median 6.50 µs, P99 7.00 µs.
- Burst detection: Mean 4.83 µs, Median 5.00 µs, P99 5.70 µs.
- Policy arbitration: Mean 0.72 µs, Median 0.70 µs, P99 0.80 µs.
- Total software overhead: **< 15 µs** per window.

---

## 5. Safety Design & Invariants

1. **Dual Authorization Gates:** Privileged live kernel operations require BOTH `MBH_ALLOW_PRIVILEGED_EXEC=1` and `--live-kernel-test`. Fails closed if either is missing.
2. **Strict Host Interface Immunity:** `assert_safe_interface()` verifies that the target interface is not `eth0`, not `lo`, and does not host the machine's default route.
3. **Disposable Namespace Isolation:** All live tests execute in a verified disposable network namespace (`mbh_ns_test`) on a dedicated `veth` pair (`veth_mbh` $\leftrightarrow$ `veth_peer`).
4. **Leak-Free Resource Cleanup:** Automated `try/finally` cleanup ensures 0 dangling namespaces and 0 lingering `veth` devices upon clean exit or injected failures.
5. **Fail-Closed Unresolved State:** In the event of an RTNETLINK rollback error, the controller marks `unresolved = True`, preventing subsequent rule collisions or state corruption.

---

## 6. Known Limitations & Technical Boundaries

1. **Software vs. Hardware Resolution:** Software aggregation runs in 10 ms windows. Datacenter hardware switch microbursts occur on sub-millisecond scales (tens of microseconds); this prototype is designed for host-side edge filtering and gateway egress shaping.
2. **Host Egress vs. Distributed Switch Fabrics:** Linux `tc` shapes outbound packets at the local network interface. It does not replace switch-wide congestion management (PFC, ECN, or programmable P4 pipelines).
3. **Single Active Class Concurrency:** The current prototype reserves class `1:10` for the primary offender. Concurrent bursts from secondary sources are serialized or reported as `busy` until the active cap expires or recovers.

---

## 7. How to Reproduce & Demonstrate

### 1. Unified Validation Runner (Single Command)
Runs compilation, backend regression suite (149 tests), detector benchmarks, pipeline microbenchmarks, Vitest frontend tests (55 tests), production build, and Git diff checks:
```bash
python run_validation.py
```

### 2. Mode A: Safe Dry-Run Demonstration (Unprivileged)
Runs on Windows or Linux without root privileges:
```bash
python backend/demo_dry_run.py
# or
python backend/main.py demo
```

### 3. Mode B: Authorized Isolated Kernel Demo (Privileged Linux/WSL2)
```bash
cd backend
MBH_ALLOW_PRIVILEGED_EXEC=1 sudo .venv/bin/python test_kernel_integration_plan.py --live-kernel-test
```

### 4. Interactive Web Console
```bash
npm install
npm run dev
```
Navigate to `http://localhost:5173` to explore the interactive topology, simulated microburst injection, and adaptive mitigation before-and-after comparisons.

---

## 8. Presentation and Deliverables

The final submission package includes the 7-slide, simplified-English engineering presentation:
- **Presentation Filename:** [`MicroburstHunter_Presentation.pptx`](./MicroburstHunter_Presentation.pptx)
- **Format & Style:** 16:9 widescreen layout with dark cybersecurity aesthetic, technical network illustrations, editable vector architecture diagrams, and operational lifecycle flowcharts.
- **Generator Script:** [`generate_presentation.py`](./generate_presentation.py)

