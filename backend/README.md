# MicroburstHunter — Live Capture & Linux Traffic Control Backend

This directory houses the **production Python network integration**. While the browser application runs a deterministic simulation for interactive demonstration, this backend executes real microburst detection, source ranking, policy arbitration, and Linux traffic control (`tc`/HTB) enforcement.

---

## 1. Architecture & Data Flow

```text
       +-------------------------------------------------------+
       |           Passive Packet Capture (Scapy)              |
       +-------------------------------------------------------+
                                  |
                                  v
       +-------------------------------------------------------+
       |          Window Accumulator (metrics.py)              |
       |  Emits 10 ms aggregate windows (bytes, pkts, per-IP)  |
       +-------------------------------------------------------+
                                  |
                   +--------------+--------------+
                   |                             |
                   v                             v
       +-----------------------+     +-----------------------+
       | Source Ranker (IP)    |     | Burst Detector        |
       | Tracks top offenders  |     | Rolling baseline x3.0 |
       | by byte contribution  |     | Persistence >= 2 wins |
       +-----------------------+     +-----------------------+
                   |                             |
                   +--------------+--------------+
                                  | (BurstEvent)
                                  v
       +-------------------------------------------------------+
       |            Mitigation Policy (mitigation_policy.py)   |
       |  Severe: 35 Mbps Cap | Moderate: 60 Mbps Cap | Safe   |
       +-------------------------------------------------------+
                                  |
                   +--------------+--------------+
                   |                             |
                   v                             v
       +-----------------------+     +-----------------------+
       | TcController (Linux)  |     | EventStore (SQLite3)  |
       | HTB Class 1:10 +      |     | Thread-safe audit log |
       | Flower Classifier     |     | CSV Export            |
       +-----------------------+     +-----------------------+
```

---

## 2. Directory Layout & Module Responsibilities

| Module | Purpose |
| :--- | :--- |
| [`capture.py`](file:///C:/Users/Mohd%20Arshad%20Ali/.gemini/antigravity-ide/scratch/MICROBUSRTHUNTER/backend/capture.py) | Passive packet capture on Linux interface using Scapy; discretizes stream into 10 ms windows. |
| [`metrics.py`](file:///C:/Users/Mohd%20Arshad%20Ali/.gemini/antigravity-ide/scratch/MICROBUSRTHUNTER/backend/metrics.py) | Structured `Window` model and Mbps rate calculation formula aligned with frontend. |
| [`burst_detector.py`](file:///C:/Users/Mohd%20Arshad%20Ali/.gemini/antigravity-ide/scratch/MICROBUSRTHUNTER/backend/burst_detector.py) | Stateful detector enforcing baseline warm-up, rate threshold, persistence windows, and cooldown. |
| [`source_ranker.py`](file:///C:/Users/Mohd%20Arshad%20Ali/.gemini/antigravity-ide/scratch/MICROBUSRTHUNTER/backend/source_ranker.py) | Tracks byte distribution by source IP to identify top burst contributors. |
| [`mitigation_policy.py`](file:///C:/Users/Mohd%20Arshad%20Ali/.gemini/antigravity-ide/scratch/MICROBUSRTHUNTER/backend/mitigation_policy.py) | Maps burst severity to rate limit decisions (35.0 Mbps severe, 60.0 Mbps moderate). |
| [`tc_controller.py`](file:///C:/Users/Mohd%20Arshad%20Ali/.gemini/antigravity-ide/scratch/MICROBUSRTHUNTER/backend/tc_controller.py) | Plans, audits, applies, and rolls back Linux HTB classes and flower classifiers. |
| [`event_store.py`](file:///C:/Users/Mohd%20Arshad%20Ali/.gemini/antigravity-ide/scratch/MICROBUSRTHUNTER/backend/event_store.py) | Multi-threaded SQLite3 persistence with thread-safe locking and structured querying. |
| [`main.py`](file:///C:/Users/Mohd%20Arshad%20Ali/.gemini/antigravity-ide/scratch/MICROBUSRTHUNTER/backend/main.py) | Central CLI runner, background timeout watchdog, and pipeline coordinator. |
| [`test_kernel_integration_plan.py`](file:///C:/Users/Mohd%20Arshad%20Ali/.gemini/antigravity-ide/scratch/MICROBUSRTHUNTER/backend/test_kernel_integration_plan.py) | Dual-gate authorized live Linux kernel integration harness in isolated network namespaces. |
| [`benchmark_detector.py`](file:///C:/Users/Mohd%20Arshad%20Ali/.gemini/antigravity-ide/scratch/MICROBUSRTHUNTER/backend/benchmark_detector.py) | Deterministic detector benchmarking (latency, false positives, transient rejection, resource overhead). |
| [`benchmark_pipeline.py`](file:///C:/Users/Mohd%20Arshad%20Ali/.gemini/antigravity-ide/scratch/MICROBUSRTHUNTER/backend/benchmark_pipeline.py) | End-to-end pipeline latency and throughput benchmarking across stages. |

---

## 3. Installation & Requirements

### Prerequisites
- Python 3.10+ (tested on Linux / WSL2).
- Linux kernel with `sch_htb`, `cls_flower`, and network namespace support (`iproute2`).
- Root or `sudo` privileges **only** when running live network shaping or capture.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 4. Safety Architecture & Authorization Gates

The backend enforces strict non-negotiable safety rules:
1. **Host Route Protection:** `assert_safe_interface()` inspects the routing table before any mutation and strictly refuses to touch `eth0`, `lo`, or any interface carrying the machine's default route.
2. **Dry-Run by Default:** Mitigation commands default to simulation (`--dry-run`). Live kernel modification requires the explicit `--apply` flag.
3. **Dual Authorization Gates for Kernel Testing:**
   - Explicit CLI flag: `--live-kernel-test`
   - Explicit environment variable: `MBH_ALLOW_PRIVILEGED_EXEC=1`
   - If either gate is absent, execution fails closed immediately.
4. **Namespace Isolation:** Privileged integration tests operate entirely inside disposable test namespaces (`mbh_ns_test`) on dedicated veth pairs (`veth_mbh` / `veth_peer`), with automatic `try/finally` cleanup and zero host mutation.
5. **Ownership Tracking & Rollback:** The controller records exact resource handles created (`class 1:10`, filter prio 1) and removes only its own child rules during rollback, preserving the root queueing discipline.
6. **Thread-Safe Wall-Clock Timeout:** Active mitigations are expired by an internal monotonic wall-clock timer even when traffic becomes completely idle, preventing lingering kernel state.

---

## 5. Overload Shaping & Kernel Benchmark Results (Phase 6)
*(Historical live-kernel verification artifact recorded during authorized Phase 6 isolated testing)*

Tested in live Linux kernel (WSL2 environment) inside disposable network namespace `mbh_ns_test` on `veth_peer` with a configured 35.0 Mbps HTB source cap on `10.200.1.2`:

### 6-Layer Empirical Measurement Breakdown
### 6-Layer Empirical Measurement Breakdown
The benchmark explicitly distinguishes application-level attempted load, socket buffer admission, kernel netdevice backpressure, HTB queue discipline counters, and receiver-observed throughput:

#### Newly Measured Phase 12 Live-Kernel Revalidation (Current Run: 2026-10-12)
*Status: SUCCESS | Target Cap: 35.0 Mbps on HTB Class 1:10 | Default Class 1:30: 1,000 Mbps line rate*

| Layer / Measurement Metric | Baseline (Unshaped) | Overload Trial 1 | Overload Trial 2 | Overload Trial 3 | Phase 12 Mean |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **1. Application Attempted Rate** | 91.02 Mbps | 92.04 Mbps | 92.12 Mbps | 92.30 Mbps | **92.15 Mbps** |
| **Attempted Packets / Bytes** | 16,254 pkts / 22.76 MB | 16,443 pkts / 23.02 MB | 16,452 pkts / 23.03 MB | 16,488 pkts / 23.08 MB | **16,461 pkts / 23.04 MB** |
| **2. Socket Admitted Rate** | 91.02 Mbps | 34.46 Mbps | 34.48 Mbps | 34.46 Mbps | **34.47 Mbps** |
| **Admitted Packets / Bytes** | 16,254 pkts / 22.76 MB | 6,156 pkts / 8.62 MB | 6,158 pkts / 8.62 MB | 6,156 pkts / 8.62 MB | **6,157 pkts / 8.62 MB** |
| **3. Socket Backpressure Throttles** | **0 pkts** | **10,287 pkts** | **10,294 pkts** | **10,332 pkts** | **10,304 pkts** |
| **4. HTB Class 1:10 Byte Delta** | N/A (no cap) | 8,813,504 B | 8,863,974 B | 8,865,416 B | **8,847,631 B** |
| **HTB Class 1:10 Overlimits** | 0 events | 6,109 events | 6,146 events | 6,148 events | **6,134 events** |
| **HTB Class 1:10 Packet Drops** | 0 pkts | 0 pkts | 0 pkts | 0 pkts | **0 pkts (token-controlled)** |
| **5. Receiver Observed Rate** | **91.07 Mbps** | **33.75 Mbps** | **33.98 Mbps** | **33.99 Mbps** | **33.91 Mbps** |
| **Receiver Observed Packets** | 16,254 pkts | 6,098 pkts | 6,135 pkts | 6,133 pkts | **6,122 pkts** |
| **6. Receiver Packet-Count Difference** | 0 pkts (0.0%) | 58 pkts (0.94%) | 23 pkts (0.37%) | 23 pkts (0.37%) | **34.67 pkts (0.563%, ~35 rounded pkts)** |

> **Standalone Single Mitigated Sample:** A separate single-trial run yielded: Offered: **91.25 Mbps**, Admitted: **34.21 Mbps**, Receiver Observed: **33.714 Mbps**, Socket Throttles: **10,188 pkts**, Receiver Difference: **76 pkts (1.244%)**. Recorded separately from the 3-run summary trials.

#### Historical Phase 6 Baseline Comparison
- **Historical Phase 6 Mean:** Offered 92.54 Mbps, Admitted 34.43 Mbps, Receiver 33.97 Mbps, Socket Throttles 10,380 pkts, Overlimits 6,129.
- **Repeatability Across Runs:** Both Phase 6 (33.97 Mbps) and Phase 12 (33.91 Mbps) converge within ~3% of the configured 35.0 Mbps cap.

> [!NOTE]
> **Resolution of Sender-vs-Shaper Ambiguity:** The unshaped baseline achieves **91.02 Mbps** with **0 socket throttles**, proving that the test environment easily generates over 90 Mbps. Under the 35.0 Mbps cap, the sender experiences **~10,304 non-blocking socket backpressure rejections (BlockingIOError)** because the HTB token bucket holds packets in the kernel queue, causing the receiver throughput to settle precisely at **33.91 Mbps (within 3.11% of the configured 35.0 Mbps cap)**. Socket backpressure is application rate-limiting. Kernel HTB drops were 0. The difference between admitted socket packets and receiver observed packets averaged 34.67 pkts (~35 rounded pkts, 0.563%); zero HTB drops does not prove physical wire loss, so this metric is reported neutrally as a receiver packet-count difference.
### Traffic Isolation & Lifecycle Validation
1. **Concurrent Flow Isolation:** Probe traffic from secondary source `10.200.1.3` concurrently routed through default class `1:30`: **+2,163,042 bytes** forwarded at line rate while class `1:10` actively constrained `10.200.1.2`.
2. **Manual Rollback & Hierarchy Audit:** Controller rollback cleanly deleted child filter and class `1:10`, restoring parent class `1:1` without residual rules.
3. **Clean Re-Application:** Controller re-applied 35 Mbps cap after verified removal without hierarchy collision.
4. **Live Idle Wall-Clock Timeout:** Inactivity watchdog cleanly expired active mitigation after 200 ms wall-clock elapsed without traffic, removing kernel rules.
5. **Conflicting Mitigation Rejection:** Controller rejected concurrent burst mitigation request on busy class `1:10` (`status: busy`).
6. **Failure Recovery & Zero Leftovers:** Deliberately injected failure during live lifecycle triggered 100% automated cleanup with **0 leftovers** (`ip netns list` and `ip link` confirmed empty).

---

## 6. Detector & Pipeline Benchmarks (Phase 6)

### Detector Benchmark (`benchmark_detector.py`)
- **False Positive Rate:** **0 in 1,000 windows (0.0%)** during continuous fluctuating traffic.
- **Detection Rate:** **100/100 (100.0%)** across independent burst trials.
- **Detection Latency:** **20.0 ms (2.0 windows)** from burst onset to detection.
- **Transient Spike Rejection:** **100.0% rejected** (0 false triggers across 100 single-window spikes).
- **Recovery Latency:** **30.0 ms (3.0 windows)** following burst cessation.
- **Cooldown Enforcement:** **100.0%** of candidate bursts during cooldown suppressed.
- **Boundary Condition Verification:**
  - *Rate Sub-Threshold (79.5 Mbps vs 80.0 Mbps threshold):* **0 bursts triggered (PASS)**.
  - *Rate Super-Threshold (80.5 Mbps vs 80.0 Mbps threshold):* **1 burst triggered (PASS)**.
  - *Persistence Lower Border (1 window spike < 2 window threshold):* **0 bursts triggered (PASS)**.
  - *Persistence Exact Border (2 windows sustained == 2 window threshold):* **1 burst triggered (PASS)**.
- **Multi-Source Attribution:**
  - *Dominant Offender (75% / 15% / 10%):* Correctly attributed to `10.0.1.100` at **75.0% contribution (PASS)**.
  - *Co-Equal Sources (50% / 50%):* Correctly attributed at **50.0% contribution (PASS)**.
- **Processing Throughput:** **230,968 windows/second** (CPU: **4.33 µs/window**, Peak RAM: **3.9 KB**).

### Pipeline Latency Benchmark (`benchmark_pipeline.py`)
*All timings in-process measured with monotonic clock (`time.perf_counter()`), characterising software overhead.*

| Pipeline Stage | Sample Count | Mean | Median (P50) | P95 Latency | P99 Latency | Max Latency |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Window Processing** | 1,000 | 4.61 µs | 4.31 µs | 5.27 µs | 11.18 µs | 73.59 µs |
| **Source Ranking** | 1,000 | 4.54 µs | 4.39 µs | 4.63 µs | 6.62 µs | 10.15 µs |
| **Burst Detector Engine** | 1,000 | 2.83 µs | 2.88 µs | 3.01 µs | 3.36 µs | 5.24 µs |
| **Mitigation Policy Decision** | 500 | 0.43 µs | 0.43 µs | 0.46 µs | 0.48 µs | 1.12 µs |
| **Controller Dry-Run Planning** | 200 | 2.25 µs | 2.15 µs | 2.73 µs | 3.03 µs | 5.48 µs |
| **SQLite Event Persistence** | 500 | 70.09 µs | 58.94 µs | 122.86 µs | 198.80 µs | 284.15 µs |
| **Detection-to-Mitigation Decision** | 500 | 8.30 µs | 7.52 µs | 9.51 µs | 26.71 µs | 42.10 µs |
| **Bounded Pipeline Shutdown** | 50 | 1.82 ms | 1.78 ms | 2.22 ms | 2.45 ms | 2.53 ms |

### Machine-Readable Benchmark Artifacts
Trial-level measurements, configurations, and timestamps are exported to:
- `backend/detector_benchmark_results.json`
- `backend/pipeline_benchmark_results.json`
- `backend/overload_benchmark_results.json`

---

## 7. Execution Commands

### Run Full Backend Unit & Integration Tests
```bash
python -m unittest discover -v
```

### Run Detector Benchmarks
```bash
python benchmark_detector.py
```

### Run Pipeline Latency & Throughput Benchmarks
```bash
python benchmark_pipeline.py
```

### Run Authorized Live Linux Kernel Overload Test (Privileged)
```bash
MBH_ALLOW_PRIVILEGED_EXEC=1 sudo python test_kernel_integration_plan.py --live-kernel-test
```

### CLI Operations
```bash
# Inspect current interface qdisc
python main.py tc-inspect --interface eth0

# Dry-run source cap planning
python main.py tc-plan --interface veth-test --source-ip 10.0.1.13 --rate 35.0

# Live passive capture (JSON stream)
sudo python main.py capture --interface veth-test --duration 30

# Export recorded events to CSV
python main.py export --csv live-events.csv
```

---

## 8. Known Limitations & Technical Boundaries

1. **Hardware Switch vs Software Rate Shaping:** The 10 ms window operates at software network stack resolution. Physical datacenter switches experience microbursts on microsecond scales causing switch buffer occupancy and packet drops; this prototype detects rate bursts above dynamic rolling baselines and shapes host egress.
2. **Host Egress vs Fabric Policing:** Linux `tc`/HTB controls local egress queueing. It does not replace distributed switch-fabric flow control (e.g. PFC, ECN, or programmable P4 switches).
3. **Namespace Isolation in Live Test:** The live kernel integration test requires Linux root privileges (`CAP_NET_ADMIN`) to construct namespaces and veth pairs; on Windows without WSL2, unit tests run against validated mocks.
