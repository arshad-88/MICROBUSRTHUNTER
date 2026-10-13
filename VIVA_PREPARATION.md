# MicroburstHunter — Technical Viva & Evaluation Preparation (VIVA_PREPARATION.md)

## 1. The 60–90 Second Project Elevator Pitch

> *"Good morning/afternoon, examiners. In modern data-center networks, microbursts are sudden traffic surges lasting only a few milliseconds—often caused by partition-aggregate query patterns or concurrent TCP incasts. Because standard network monitoring tools like SNMP or NetFlow sample traffic at multi-second intervals (every 1 to 30 seconds), they average out these millisecond spikes, showing an apparently normal 20% link utilization while shallow switch buffers are actually overflowing and dropping packets.*
>
> *Our project, **MicroburstHunter**, solves this blind spot. We built a high-frequency telemetry and adaptive mitigation pipeline operating on 10-millisecond sliding windows. It calculates an Exponentially Weighted Moving Average baseline, applies a multi-window persistence filter to distinguish true microbursts from transient single-packet spikes, ranks contributing IP flows using sliding byte attribution, and applies targeted egress rate limiting via Linux traffic control (`tc`/HTB/flower). Innocent traffic continues unaffected through default classes, and active mitigations automatically expire via an internal wall-clock watchdog when traffic normalizes.*
>
> *We have validated this across 149 backend regression tests, verified sub-15 microsecond pipeline latencies, and demonstrated 35 Mbps shaping under 100 Mbps overload in an isolated Linux kernel namespace with zero leftover host mutation."*

---

## 2. Recommended 3–5 Minute Demonstration Sequence

When presenting live to examiners, follow this exact sequence:

1. **Minute 1: The Problem & Architecture (Slides / Console Topology)**
   - Show the interactive React dashboard topology (H1–H4 talking through Switch S1 to R1).
   - Point out that standard 1-second monitoring misses 10 ms spikes.
2. **Minute 2: The Safe Dry-Run Demo Execution**
   - In terminal, execute: `python backend/demo_dry_run.py`.
   - **Show Stage 1:** 15.0 Mbps normal baseline established over 200 ms.
   - **Show Stage 2:** 150 Mbps burst injected. Point out the terminal log where the detector requires 2 consecutive windows (20 ms persistence) before declaring `burst_detected`.
   - **Show Source Attribution:** Point to the attribution log showing `10.0.0.99` causing **85.0%** of the traffic.
3. **Minute 3: Mitigation Planning & Isolation**
   - Point out the planned `tc` command:
     `tc class add dev demo0 parent 1: classid 1:10 htb rate 35.0mbit ceil 35.0mbit`
     `tc filter add dev demo0 ... flower src_ip 10.0.0.99 flowid 1:10`
   - Emphasize that **only** `10.0.0.99` is clamped to 35 Mbps; other sources continue unshaped in default class `1:30`.
4. **Minute 4: The Inactivity Timeout Watchdog**
   - Show Stage 4 in the demo: traffic drops to 0 packets, but the wall-clock watchdog wakes up after 250 ms and releases the cap. Explain that this prevents lingering kernel state if the offending sender disconnects.
5. **Minute 5: Empirical Evidence & Code Walkthrough**
   - Show [`PROJECT_SUMMARY.md`](./PROJECT_SUMMARY.md) or [`overload_benchmark_results.json`](./backend/overload_benchmark_results.json) showing actual live kernel shaping at 33.91 Mbps (reproduced Phase 12) and 33.97 Mbps (historical Phase 6) under 100 Mbps offered load.

---

## 3. Core Technical Viva Questions & Answers

### Q1: What problem does MicroburstHunter solve?
**Answer:** MicroburstHunter detects and mitigates sub-RTT traffic spikes (microbursts) in data-center networks that cause buffer queue overflow and packet loss, but are invisible to coarse-grained multi-second SNMP/sFlow polling. It performs 10 ms window telemetry, identifies top offending flows, and applies targeted local egress rate limiting.

### Q2: Why can short traffic bursts cause queue buildup and packet loss even if average bandwidth is low?
**Answer:** Switch buffers are finite (often only tens of kilobytes per port in commodity switches). If multiple senders transmit at line rate simultaneously for even 10 ms (TCP incast), the ingress rate into the switch port exceeds the egress link capacity ($R_{\text{in}} > R_{\text{out}}$). The switch buffer fills at rate $R_{\text{in}} - R_{\text{out}}$. Once the buffer memory is exhausted, all subsequent packets suffer tail-drops, triggering TCP timeouts and latency spikes, even if the 1-minute average link utilization is only 15%.

### Q3: Why use 10 ms windows, and what are the limitations?
**Answer:** 10 ms is chosen as an educational, software-accessible timescale that balances temporal resolution against CPU scheduling overhead in user-space Python.
*Limitations:* Real datacenter switch microbursts occur on microsecond scales (tens to hundreds of microseconds). User-space packet capture with Scapy cannot process packets at microsecond resolution due to OS context switches and socket buffer overhead. In hardware production, this would be implemented in switch ASICs (e.g., P4 programmable pipelines) or eBPF/XDP in the Linux kernel driver.

### Q4: How does baseline and threshold calculation work in the detector?
**Answer:**
- **Baseline:** Calculated using an Exponentially Weighted Moving Average (EWMA):
  $$\text{baseline}_t = \alpha \times \text{rate}_t + (1 - \alpha) \times \text{baseline}_{t-1} \quad (\text{default } \alpha = 0.1)$$
  A warmup period (default 5 windows) prevents premature triggering.
- **Dynamic Threshold:** Calculated as:
  $$\text{threshold} = \max(\text{min\_rate\_mbps}, \text{baseline} \times \text{multiplier}) \quad (\text{defaults: } 80.0\text{ Mbps}, 3.0\times)$$
  This ensures low-volume normal fluctuations do not trigger alarms while remaining sensitive to sudden spikes.

### Q5: Is the minimum rate threshold 8 Mbps or 80 Mbps?
**Answer:** It is **80.0 Mbps** throughout the entire codebase (`backend/config.py`, `src/simulation/config.ts`, `tests/detector.test.ts`, and all benchmark suites). Any mention of "8 Mbps" is an erroneous typographical omission of the trailing zero. The value 80.0 Mbps was selected as an educational standard so that baseline background traffic (e.g. 15–20 Mbps) does not cause spurious threshold crossings.

### Q6: How are sustained bursts distinguished from transient spikes?
**Answer:** Through a **persistence filter** (`persistence_windows = 2` in demo/benchmarks; `3` in `config.py` default). A single window exceeding the threshold merely increments an internal counter (`consecutive_bursts = 1`). Only when the high rate persists for consecutive windows is a `burst_detected` event declared. Single-window spikes (e.g., a single 10 ms burst) are rejected (100% rejection rate in benchmarks), preventing flapping. Default recovery requires consecutive quiet windows (`recovery_windows = 3` in demo/benchmarks; `10` in `config.py`).

### Q7: How does source attribution work?
**Answer:** The `SourceRanker` aggregates incoming byte counts per source IP across a sliding observation window (default 20 windows). When a burst occurs, it calculates:
$$\text{contribution\_pct} = \frac{\text{source\_bytes}}{\sum \text{total\_bytes}} \times 100$$
The source with the highest contribution is flagged as the primary offender if it exceeds an attribution threshold (e.g. 50%), ensuring innocent background flows are not throttled.

### Q8: How does the mitigation policy choose a rate cap?
**Answer:** The `MitigationPolicy` checks the ratio of the burst peak rate to the rolling baseline:
- If ratio $\ge 5.0\times$ (Severe): applies `severe_cap_mbps` (default 35.0 Mbps).
- If ratio $\ge 3.0\times$ (Moderate): applies `moderate_cap_mbps` (default 60.0 Mbps).
- If below: takes no action (`action = "none"`).
- After traffic remains below threshold for `recovery_windows` (default 3), it triggers a recovery action (`action = "remove"`).

### Q9: What are HTB, qdisc, classid, filters, and rollback?
**Answer:**
- **qdisc (Queueing Discipline):** A Linux kernel scheduler controlling packet transmission on a network interface.
- **HTB (Hierarchical Token Bucket):** A classful qdisc implementing token-bucket shaping with parent/child rate and ceiling guarantees.
- **classid (`1:10`):** Unique hexadecimal handle identifying an HTB class. In MicroburstHunter, root is `1:0`, parent is `1:1`, default unshaped class is `1:30`, and capped source class is `1:10`.
- **Flower filter (`cls_flower`):** A Linux kernel classifier matching packet header fields (e.g. `src_ip 10.0.0.99`) and directing matching packets to class `1:10`.
- **Rollback:** Deleting only the child flower filter and class `1:10` via netlink, preserving the root qdisc so other flows are uninterrupted.

### Q10: Why are dry-run and dual authorization gates necessary?
**Answer:** Modifying Linux traffic control requires `CAP_NET_ADMIN` (root privileges) and directly affects the host routing stack. If an automated script misconfigures `eth0` or the default route, the host machine can lose network connectivity or lock out SSH sessions.
- **Dry-run by default:** Generates and validates command strings in memory without issuing netlink calls.
- **Dual authorization gates:** Running live privileged tests requires BOTH `MBH_ALLOW_PRIVILEGED_EXEC=1` and `--live-kernel-test`. Missing either gate causes the program to fail closed immediately.
- **Route protection:** `assert_safe_interface()` explicitly rejects `eth0`, `lo`, or any interface hosting the default route.

### Q11: How does the wall-clock timeout work when packets stop arriving?
**Answer:** If mitigation is active and an offending sender abruptly stops sending packets (idle traffic), window callbacks (`on_window`) will never be triggered. Without a wall-clock mechanism, the HTB rate cap would remain permanently installed in the kernel.
MicroburstHunter arms a `threading.Timer` pegged to `time.monotonic()`. If the duration ceiling (default 8 s, 250 ms in demo) elapses, the timer callback executes under an re-entrant lock (`RLock`), rolls back the HTB rules, and records a `mitigation_expired` event.

### Q12: How are concurrent mitigations handled?
**Answer:** The current prototype allocates a single dedicated HTB class (`1:10`) for the primary offender. If a secondary burst occurs while class `1:10` is active, the pipeline detects that class `1:10` is occupied and safely returns `status = "busy"` with action `rejected`. It does not overwrite the existing filter, preventing rule collisions or race conditions.

### Q13: What do the benchmarks actually measure?
**Answer:**
- `benchmark_detector.py`: Measures algorithmic correctness (100% detection, 0% false positives, boundary conditions) and processing throughput (128k–230k windows/sec).
- `benchmark_pipeline.py`: Measures in-memory software latency percentiles (P50, P95, P99) across 8 pipeline stages using `time.perf_counter()` (<15 µs end-to-end).
- `overload_benchmark_results.json`: Measures actual Linux kernel HTB token-bucket enforcement under 100 Mbps overload in an isolated namespace across 6 distinct metric layers.

### Q14: Why are sender socket backpressure and physical packet loss different?
**Answer:** In local host testing, the sender and shaper share the same Linux kernel network stack. When HTB shapes traffic, it holds tokens and queues packets in the netdevice queue (`qlen`). When the netdevice queue fills, the Linux kernel signals backpressure to the transmitting socket buffer. A non-blocking socket encounters `BlockingIOError` (socket throttles). The sender slows down before packets leave the machine; physical switch buffer tail-drops on physical wire cables do not occur in this local loop. Furthermore, zero HTB class drops were recorded in kernel stats; the ~34.67 packet (0.563%) delta between socket-admitted packets and receiver-observed packets is instrumented at the socket layer and reported neutrally as a receiver packet-count difference rather than physical wire loss.

### Q15: What are the current limitations and realistic future work?
**Answer:**
1. **Single active class:** Concurrency is currently limited to one active capped flow (`1:10`). *Future work:* Dynamic class allocation pool (`1:10`–`1:50`).
2. **User-space 10 ms window:** Python Scapy packet capture is limited by user-kernel context switching. *Future work:* Porting packet counting to eBPF/XDP for microsecond-level hardware-rate windowing.
3. **Host-side egress shaping:** Shapes only traffic leaving the host; does not control third-party cross-traffic at intermediate switch ASICs. *Future work:* Integration with switch telemetry (In-Band Network Telemetry / INT) or PFC pause frames.
