# MicroburstHunter — Demonstration Guide (DEMO_GUIDE.md)

## 1. Project Objective & The Microburst Problem

In data-center networks, **microbursts** are short, sub-RTT traffic surges (often lasting 5–100 ms) caused by concurrent TCP incast or bulk transfers. Although aggregate multi-second link utilization appears low (e.g., 20–30% average utilization on SNMP/sFlow graphs), these instantaneous surges rapidly exhaust shallow switch packet buffers, causing queue tail-drops, packet retransmissions, and high tail latency for latency-sensitive RPC flows.

**MicroburstHunter** provides a sub-RTT software telemetry, detection, source attribution, and adaptive traffic-control pipeline designed to:
1. Detect rate bursts within sub-second timescales (10 ms sliding windows).
2. Rank contributing IP sources to pinpoint top offenders without penalizing innocent flows.
3. Apply targeted egress rate-limiting using Linux traffic control (`tc`/HTB/flower).
4. Automatically restore unshaped operation once traffic recovers or an inactivity watchdog fires.

---

## 2. Prerequisites & Environment Setup

### Environment A: Windows or macOS (Safe Mode Only)
- **Python:** Python 3.10 or higher (Python 3.12 recommended).
- **Node.js (Optional, for web console):** Node.js 18+ and npm.
- **Privilege Requirement:** **Zero root/administrator privileges required**.

```bash
# Clone and enter directory
cd C:\Users\Mohd Arshad Ali\.gemini\antigravity-ide\scratch\MICROBUSRTHUNTER

# Install Python requirements
pip install -r backend/requirements.txt
```

### Environment B: Linux / WSL2 (Safe Mode + Optional Authorized Live Kernel Mode)
- **OS:** Ubuntu 22.04+ on bare-metal or WSL2 with kernel headers.
- **Kernel Modules (for Mode B only):** `sch_htb`, `cls_flower`, `iproute2`.

```bash
# In WSL2:
cd /home/arshad_33/microbursthunter-backend
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 3. Mode A: The Safe Dry-Run Demonstration

This is the primary demonstration suitable for evaluators, presentations, and code walk-throughs. It executes all state transitions without modifying the kernel or network interfaces.

### Exact Execution Command
```bash
# Option 1: Standalone demo script
python backend/demo_dry_run.py

# Option 2: CLI subcommand
python backend/main.py demo
```

### Expected Execution Stages & Observed Terminal Output

```text
=====================================================================================
  MICROBURSTHUNTER — SAFE DRY-RUN END-TO-END DEMONSTRATION (MODE A)
=====================================================================================
  Mode       : SAFE DRY-RUN (Zero privileged operations, zero host mutations)
  Resolution : 10 ms aggregation windows
  Parameters : Baseline Multiplier = 3.0x | Min Rate = 80.0 Mbps | Persistence = 2 win
               Recovery = 3 win | Cooldown = 30 ms | Severe Ratio = 5.0x (Cap: 35 Mbps)
=====================================================================================
```

#### Stage 1: Establishing Baseline Normal Traffic (200 ms)
- 20 windows of synthetic background traffic at 15.0 Mbps across 4 IP sources (`10.0.0.1`–`10.0.0.4`).
- Computes Exponentially Weighted Moving Average (EWMA) baseline ($\alpha = 0.1$).
- Calculates dynamic threshold: $\max(80.0\text{ Mbps}, \text{baseline} \times 3.0) = 80.0\text{ Mbps}$.
- No alarms fired.

#### Stage 2: Sustained Microburst Injection (150 Mbps)
- A synthetic burst is injected for 50 ms (5 windows) at 150.0 Mbps.
- Source `10.0.0.99` generates 85.0% of the burst traffic.
- **Detection:** Window 1 exceeds threshold (persistence counter = 1). Window 2 exceeds threshold (persistence counter = 2 $\ge$ requirement). `burst_detected` is triggered.
- **Source Attribution:** `SourceRanker` inspects window byte counts and attributes `10.0.0.99` with **85.0% contribution share**.
- **Policy Decision:** Severity ratio $150.0 / 15.0 = 10.0\times \ge 5.0\times$ (Severe). Policy selects action `APPLY` with a **35.0 Mbps cap** targeting `10.0.0.99`.
- **Dry-Run Planning:** `TcController` plans candidate Linux `tc` commands:
  ```bash
  $ tc class add dev demo0 parent 1: classid 1:10 htb rate 35.0mbit ceil 35.0mbit
  $ tc filter add dev demo0 protocol ip parent 1:0 prio 1 flower src_ip 10.0.0.99 flowid 1:10
  ```
- Safeguard notice confirmed: *Commands generated in dry-run mode; no kernel rules mutated.*

#### Stage 3: Traffic Normalization & Automatic Recovery
- Traffic returns to normal baseline (15.0 Mbps) for 50 ms.
- Recovery filter counts 3 consecutive quiet windows beneath threshold.
- `burst_ended` triggered. Mitigation policy transitions to `REMOVE`.
- Controller simulates deletion of class `1:10` and flower filter, returning interface to unshaped state.

#### Stage 4: Wall-Clock Inactivity Watchdog on Idle Traffic
- A secondary burst on `10.0.0.88` (90.0% share) is injected, re-arming mitigation.
- Immediately after, all traffic stops (0 packets arrive across 300 ms).
- **The Watchdog Fires:** Rather than hanging waiting for traffic windows, an internal monotonic wall-clock timer (250 ms ceiling) wakes up.
- Logs: `Wall-clock mitigation timeout reached ... releasing cap on idle traffic`.
- Mitigation is cleanly rolled back and status updated to `REMOVED`.

#### Stage 5: Persistent Audit Trail (SQLite)
The demonstration queries the underlying `EventStore` (`microbursthunter.sqlite3`) and displays the chronological audit log showing both normal recovery and watchdog expiration:
```text
Timestamp                | Event Type             | Severity   | Source IP    | Action / Outcome
-------------------------------------------------------------------------------------
1791804738.7838194       | burst_detected         | critical   | 10.0.0.99    | burst_detected: severe burst from 10.0.0.99
1791804738.7858212       | mitigation_simulated   | info       | 10.0.0.99    | Dry-run cap 35.0 Mbps on 10.0.0.99
1791804738.7858212       | burst_ended            | critical   | 10.0.0.99    | burst_ended: severe burst from 10.0.0.99
1791804738.7858212       | mitigation_removed     | success    | 10.0.0.99    | Mitigation removed
1791804738.7868207       | burst_detected         | critical   | 10.0.0.88    | burst_detected: severe burst from 10.0.0.88
1791804738.7868207       | mitigation_simulated   | info       | 10.0.0.88    | Dry-run cap 35.0 Mbps on 10.0.0.88
1791804739.0494041       | mitigation_expired     | info       | 10.0.0.88    | Mitigation duration limit reached
1791804739.0494041       | mitigation_removed     | success    | 10.0.0.88    | Mitigation removed
```

---

## 4. Running Validation & Regression Tests

### Unified Single-Command Safe Validation
Executes all safe checks in deterministic order:
```bash
python run_validation.py
```
- Windows executes 7 stages (Compilation, 149 Unit Tests, Detector Benchmarks, Pipeline Benchmarks, Vitest Frontend Tests [55 tests], Vite Production Build, Git Diff).
- WSL executes 5 safe backend stages, explicitly marking frontend stages as `SKIPPED (Environment-specific: package.json not in repo root)`.

### Individual Test Commands
```bash
# Run full unit regression suite (149 tests):
python -m unittest discover -s backend -p "test_*.py"

# Run detector benchmark suite (accuracy, persistence, resources):
python backend/benchmark_detector.py

# Run pipeline microbenchmarks (monotonic microsecond latency percentiles):
python backend/benchmark_pipeline.py

# Run frontend tests (from repo root on machine with Node/npm):
npm test

# Run frontend production build:
npm run build
```

---

## 5. Mode B: Authorized Isolated Linux Kernel Shaping (Separate, Privileged)

> [!CAUTION]
> This mode requires Linux/WSL2 and root privileges (`CAP_NET_ADMIN`). It modifies traffic shaping only inside an isolated, disposable network namespace. Never run this mode on production interfaces.

### Dual Authorization Gates
To prevent accidental host mutation, the live test requires **both** an explicit environment variable and an explicit CLI flag:
1. Environment variable: `MBH_ALLOW_PRIVILEGED_EXEC=1`
2. CLI flag: `--live-kernel-test`

If either gate is absent, execution fails closed with exit code 1.

### Execution Command (WSL/Linux only)
```bash
cd /home/arshad_33/microbursthunter-backend
MBH_ALLOW_PRIVILEGED_EXEC=1 sudo .venv/bin/python test_kernel_integration_plan.py --live-kernel-test
```

### Safety Guarantees Enforced:
1. **Namespace Isolation:** Creates disposable namespace `mbh_ns_test` with dedicated veth link pair `veth_mbh` $\leftrightarrow$ `veth_peer`.
2. **Forbidden Interface Protection:** `assert_safe_interface()` verifies that the target interface is not `eth0`, not `lo`, and does not host the machine's default route.
3. **Automated Teardown:** A `finally` block tears down the test namespace and links on test conclusion or failure.
4. **Empirical Verification:** Live-kernel execution (Phase 12 revalidation) demonstrates that offering ~92.2 Mbps against the 35.0 Mbps cap yields exactly **33.91 Mbps receiver throughput** (within 3.11% of the cap), accumulating 6,134 HTB overlimits and ~10,304 sender socket backpressure events, with 0 leftover testbed resources.

---

## 6. Distinguishing the Three Test Paradigms

Evaluators must understand what each level of evaluation represents:

| Paradigm | What It Measures | What It Does NOT Measure |
| :--- | :--- | :--- |
| **1. Mode A: Safe Dry-Run Simulation** | Software state machine, EWMA math, persistence filters, source ranking logic, command generation, wall-clock timeout watchdog. | Kernel netlink latency, actual packet delays, physical wire transit. |
| **2. Mode B: Isolated Linux Kernel Shaping** | Linux `sch_htb` token bucket shaping, flower classifier filtering, sender socket backpressure (`BlockingIOError`), netlink command overhead. | Physical datacenter switch ASIC buffer behavior, hardware Broadcom counters, or distributed PFC/ECN flow control. |
| **3. Physical Network Validation** | Hardware switch buffer watermarks, ASIC packet memory exhaustion, switch queue tail-drops. | **NOT claimed or performed by this project.** MicroburstHunter operates at host software layer. |

---

## 7. Troubleshooting Common Issues

1. **`npm not found` when running `run_validation.py`:**
   - On backend-only checkouts (such as WSL), `npm` is omitted intentionally. The runner marks stages 5 and 6 as `SKIPPED` and proceeds to validate backend stages with exit code 0.
2. **Permission Denied on Linux Capture:**
   - Live packet capture (`python main.py capture`) requires raw socket access (`CAP_NET_RAW`). Use `sudo` or grant capabilities: `sudo setcap cap_net_raw,cap_net_admin=eip $(which python3)`.
3. **`assert_safe_interface` Rejection:**
   - If attempting to configure `eth0` or `lo`, the controller intentionally raises `TcSafetyError`. This is an intended safety invariant to prevent locking out ssh or network access.

---

## 8. Network Cleanliness & Verification

To verify that no leftover test resources exist on the host:

```bash
# 1. Verify zero leftover network namespaces (should be empty):
ip netns list

# 2. Verify zero leftover veth links (should return no results):
ip link show | grep veth

# 3. Verify host default route is intact:
ip route show default
# Expected: default via <gateway_ip> dev eth0 proto kernel onlink

# 4. Verify host eth0 has default multi-queue qdisc:
ip link show eth0
```
