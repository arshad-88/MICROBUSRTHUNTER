# MicroburstHunter

**Real-time detection and adaptive mitigation of microbursts in data-center
networks.** A Computer Networks course project: a working, interactive network
operations console with a real detection algorithm, source contribution
analysis, adaptive mitigation, a reproducible traffic simulator, experiment
comparison, CSV export, and a separate Python/Scapy + Linux `tc` backend for
real capture and shaping.

> **Honesty note.** The browser build is a **deterministic simulation**. It never
> claims to capture live traffic. A detected rate burst is not proof of switch
> buffer overflow — queue congestion is a separate measurement. Real capture and
> shaping live in [`backend/`](./backend/README.md) and are opt-in.

---

## 1. Tech stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui,
  Recharts, Lucide icons, Framer Motion, SVG/CSS topology.
- **Backend (app):** Convex + Convex Auth (sign-in gating the console).
- **Real-network integration (separate):** Python 3, Scapy, Linux `tc`, SQLite.

## 2. Setup & run

```bash
bun install          # install dependencies
bun run dev          # start the Vite dev server (Convex dev runs alongside)
```

Other useful commands:

```bash
bun run typecheck    # tsc -b --noEmit
bun test             # simulation unit + integration tests
```

Open the app, click **Launch the console**, sign in (email OTP or *Continue as
Guest*), and you land on `/dashboard`.

**Running without Convex.** The console computes everything in the browser, so
if `VITE_CONVEX_URL` is not set the app starts with a **local session** instead
of failing: the top status bar reports `session LOCAL (NO BACKEND)` and the
sign-in page says no email is sent. Sign-in, the `RequireAuth` gate and the
signed-in routes all still work — they just do not leave the browser. Set
`VITE_CONVEX_URL` (and run `bunx convex dev` once to generate
`src/convex/_generated`) to switch back to real accounts.

## 3. The application

Left sidebar navigation, a top status bar (monitoring state, data source,
interface, alert indicator, Start/Stop), and a main workspace:

| Page | What it does |
| --- | --- |
| **Overview** | Traffic rate, packet rate, drops, latency cards + burst count, active sources, mitigation status, experiment mode, live chart |
| **Network Topology** | Interactive SVG fabric (H1–H4 → S1 → R1, plus the controller). Click a host or link for a details panel; bursts turn red, mitigated flows amber |
| **Traffic Monitor** | Rate vs rolling baseline vs threshold, shaded burst intervals, tooltip, range control, pause/resume, summary |
| **Source Analysis** | Sortable per-source table (packets, bytes, rate, burst share, policy), per-source history, CSV export |
| **Mitigation** | Auto toggle, target source, configurable cap, severity/state/duration/recovery, before-after comparison |
| **Experiments** | Three scenarios, parameters, run/stop/reset, comparison chart, results table, CSV export |
| **Event Logs** | Filterable audit trail, CSV export, clear |
| **Settings** | Validated detection / mitigation / simulation configuration |

## 4. Controls

- **Start / Stop Monitoring** — begins/halts sampling. Repeated clicks do not
  create duplicate timers.
- **Simulate Burst** — schedules a reproducible burst on the selected source.
- **Restore Normal** — cancels scheduled bursts and releases any cap.
- **Reset Experiment** — clears history, counters and policy state.
- **Enable / Disable Mitigation** — toggles automatic mitigation.

## 5. Detection engine

Configurable parameters (Settings page): sampling window, minimum rate, baseline
multiplier, baseline window, persistence, recovery windows, cooldown.

```
rateMbps  = bytes × 8 ÷ (windowMs / 1000) ÷ 1,000,000
threshold = max(minRate, baseline × multiplier)
burst     = rate > threshold for `persistence` consecutive windows
```

Educational defaults: **10 ms** window, **80 Mbps** minimum, **×3** baseline.
The engine warms up before it arms, so startup and low-traffic periods do not
produce false positives.

## 6. Mitigation

Policy: normal → no restriction; moderate burst → mild cap; severe burst →
stricter cap + alert; recovered → cap removed; invalid parameters → fail safe,
previous state kept. The cap is applied **inside the traffic model** (the
offending source is clamped before rate and queue effects are computed), so the
chart, topology and source table all change together. Includes max duration,
cooldown, recovery and a manual override; every policy change is logged.

## 7. Demonstrating the three experiments

1. Open **Experiments**, pick **Experiment 1 — Normal traffic**, press **Start**.
   Normal load runs with no burst and no drops.
2. Pick **Experiment 2 — Burst traffic (no mitigation)**, press **Start**. A
   seeded burst fires; the detector logs it and traffic stays uncapped.
3. Pick **Experiment 3 — Burst with adaptive mitigation**, press **Start**. The
   *same* burst fires, but the source flow is capped once detected. Compare the
   peak, drops and latency before/after in the comparison table.
4. Use **Export CSV** to capture the results for the review.

Identical generator settings and PRNG seed per scenario keep results comparable.
Mitigation does not guarantee an improvement in every metric — read the numbers.

## 8. Reproducible Demonstration & Single-Command Validation

MicroburstHunter provides two clearly separated demonstration modes and a unified validation runner:

### Mode A: Safe Dry-Run Demonstration (Unprivileged)
Executes a complete end-to-end telemetry, detection, source attribution, and policy planning cycle with **zero root privileges** and **zero host network mutations**:
```bash
# Run standalone demo script:
python backend/demo_dry_run.py

# Or via backend CLI:
python backend/main.py demo
```
**What it demonstrates:**
1. *Baseline Normal Traffic:* 200 ms (20 windows @ 15 Mbps) establishing rolling baseline and dynamic 80 Mbps threshold.
2. *Sustained Microburst Injection:* 50 ms (5 windows @ 150 Mbps) with offender `10.0.0.99` generating 85% of traffic.
3. *Real-Time Detection:* Persistence check passed $\rightarrow$ `burst_detected` declared.
4. *Source Attribution:* Top offender identified as `10.0.0.99` (85.0% contribution).
5. *Adaptive Mitigation:* Severe classification ($10\times > 5.0\times$) triggers 35 Mbps adaptive cap.
6. *Controller Dry-Run Planning:* Generates candidate Linux `tc` HTB class and flower filter commands without kernel netlink mutations.
7. *Traffic Recovery:* Quiet windows observed $\rightarrow$ `burst_ended` $\rightarrow$ rollback executed.
8. *Idle Timeout Watchdog:* Inactivity watchdog cleanly releases mitigation on idle traffic.
9. *Audit Trail:* Displays persistent SQLite event records.

### Mode B: Authorized Isolated Linux Kernel Demo (Privileged)
Requires Linux/WSL2 and explicit dual authorization gates (`MBH_ALLOW_PRIVILEGED_EXEC=1` and `--live-kernel-test`):
```bash
cd backend
MBH_ALLOW_PRIVILEGED_EXEC=1 sudo .venv/bin/python test_kernel_integration_plan.py --live-kernel-test
```
**What it demonstrates:**
- Disposable network namespace `mbh_ns_test` with dedicated `veth_mbh` $\leftrightarrow$ `veth_peer` link pair.
- Preflight safety checks proving host `eth0`, `lo`, and default route are untouched.
- Genuine overload traffic (~92.2 Mbps offered vs 35.0 Mbps cap) across 3 bounded trials.
- Socket backpressure throttles (~10,304 BlockingIOError pkts) and HTB class 1:10 overlimits (6,134 events) constraining throughput to 33.91 Mbps.
- Concurrent unclassified traffic through default class `1:30` (+2.16 MB at line rate).
- Manual rollback, verified clean re-application, live idle timeout (200 ms), conflicting burst rejection (`status: busy`), and 100% automated cleanup with 0 leftovers.

### Single-Command Release Validation Workflow
Executes all safe validation stages in order with clean exit codes:
```bash
python run_validation.py
```
Invokes Python bytecode compilation, backend 149-test suite, detector benchmarks, pipeline microbenchmarks, Vitest frontend tests (55 tests), frontend production build, and Git diff checks.

---

## 9. Tests Performed

### Frontend Suite (Vitest)
`npm test` executes 55 tests across 5 test suites (100% passing):
- `tests/detector.test.ts` (9 tests): Rate calculations, thresholds, baseline slices, zero-division guards.
- `tests/scenarios.test.ts` (11 tests): Scenario parameterization, reproducible seeding.
- `tests/simulation.test.ts` (19 tests): Engine simulation, burst triggering, adaptive clamping.
- `tests/mitigation.test.ts` (11 tests): Policy arbitration, cooldown, manual overrides.
- `tests/render.test.tsx` (5 tests): Component rendering and dashboard integration.

### Backend Suite (Python unittest)
`python -m unittest discover -v` executes 149 unit and integration tests (100% passing):
- Pipeline window processing, state transitions, wall-clock timeout expiration.
- Concurrency, timer race safety, and conflict rejection on occupied classes.
- Fail-closed route safety: namespace isolation, `eth0`/`lo` rejection, and command timeouts.
- Thread-safe SQLite event store persistence across multi-threaded callers.
- Unresolved state preservation on failed rollbacks.

---

## 10. Phase 12 Live Kernel Overload Validation & Benchmarks

### Live Linux Kernel Overload Validation (6-Layer Empirical Measurement)
Executed in an isolated test namespace (mbh_ns_test) on a dedicated eth pair under dual authorization gates (MBH_ALLOW_PRIVILEGED_EXEC=1 and --live-kernel-test):

#### Phase 12 Live Revalidation (Current Run: 2026-10-12)
- **Unshaped Baseline:** 91.02 Mbps attempted, 91.02 Mbps socket admitted, 91.07 Mbps received, 0 dropped packets, 0 socket throttles.
- **Genuine Overload Load (Target 100 Mbps against 35 Mbps Cap):**
  - Application Attempted Rate: **92.15 Mbps** (mean across 3 trials: 92.04, 92.12, 92.30 Mbps).
  - Admitted Socket Rate: **34.47 Mbps** (mean across 3 trials: 34.46, 34.48, 34.46 Mbps).
  - Receiver Observed Rate: **33.91 Mbps** (mean across 3 trials: 33.75, 33.98, 33.99 Mbps; within 3.11% of the 35.0 Mbps cap).
  - Socket Backpressure Throttling: **~10,304 pkts/trial** rejected by non-blocking socket backpressure (BlockingIOError).
  - Kernel HTB Class 1:10 Overlimits: **+6,134 overlimits/trial** accumulated on class 1:10.
  - Kernel HTB Class 1:10 Drops: **0 pkts** (rate controlled by token bucket scheduler).
  - Receiver Packet-Count Difference: **34.67 pkts/trial (0.563%, or 35 rounded packets)** between sender admissions and receiver arrivals. (Zero HTB drops were recorded; observed packet-count differences are reported neutrally as application socket-to-receiver differences rather than physical wire loss).
- **Standalone Single Sample:** Offered 91.25 Mbps, Admitted 34.21 Mbps, Receiver Observed 33.714 Mbps, 10,188 backpressure pkts, 76 pkts difference (1.244%).
- **Dual-Flow Isolation:** Unclassified probe traffic from 10.200.1.3 concurrently routed through default class 1:30 at full line rate (+2.16 MB) without interference from the 35 Mbps cap on 10.200.1.2.
- **Lifecycle & Cleanup Audit:** Verified manual rollback, clean re-application, live idle wall-clock timeout (200 ms), conflicting burst rejection (status: busy), and zero testbed leftovers on clean exit or injected failure.

#### Historical Phase 6 Comparison
- **Historical Phase 6 Mean:** Offered 92.54 Mbps, Admitted 34.43 Mbps, Receiver 33.97 Mbps, Socket Throttles 10,380 pkts, Overlimits 6,129.
- **Repeatability:** Exceptional consistency between Phase 6 (33.97 Mbps) and Phase 12 (33.91 Mbps), validating real kernel traffic-control reproducibility.
### Detector Benchmarking (`backend/benchmark_detector.py`)
- **False Positive Rate:** 0 in 1,000 windows (0.0%).
- **Detection Rate:** 100/100 (100.0%) across independent burst trials.
- **Detection Latency:** 20.0 ms (2.0 windows).
- **Transient Spike Rejection:** 100.0% rejected (0 false triggers on single-window spikes).
- **Recovery Latency:** 30.0 ms (3.0 windows); cooldown enforcement: 100.0%.
- **Boundary Conditions:** Sub-threshold (79.5 Mbps) -> 0 bursts; super-threshold (80.5 Mbps) -> 1 burst; 1-window spike -> 0 bursts; 2-window sustained -> 1 burst (all PASS).
- **Multi-Source Ranking:** Correctly attributed dominant (75%) and co-equal (50%) sources (all PASS).
- **Resource Throughput:** 230,968 windows/sec (4.33 µs/window CPU, 3.9 KB peak RAM).

### End-to-End Pipeline Latency (`backend/benchmark_pipeline.py`)
*In-process microbenchmarks on monotonic clock (`time.perf_counter()`):*
- **Window Processing (N=1000):** Mean 4.61 µs, Median 4.31 µs, P95 5.27 µs, P99 11.18 µs, Max 73.59 µs, Throughput >210,000 win/s.
- **Source Ranking (N=1000):** Mean 4.54 µs, Median 4.39 µs, P95 4.63 µs.
- **Burst Detection Engine (N=1000):** Mean 2.83 µs, Median 2.88 µs, P95 3.01 µs.
- **Policy Decision (N=500):** Mean 0.43 µs, Median 0.43 µs, P95 0.46 µs.
- **Dry-Run Planning (N=200):** Mean 2.25 µs, Median 2.15 µs, P95 2.73 µs.
- **SQLite Persistence (N=500):** Mean 70.09 µs, Median 58.94 µs, P95 122.86 µs.
- **Detection-to-Mitigation Decision (N=500):** Mean 8.30 µs, Median 7.52 µs, P95 9.51 µs.
- **Bounded Shutdown (N=50):** Mean 1.82 ms, Median 1.78 ms, P95 2.22 ms, Max 2.53 ms.

### Machine-Readable Benchmark Artifacts
- `backend/detector_benchmark_results.json`
- `backend/pipeline_benchmark_results.json`
- `backend/overload_benchmark_results.json`

---

## 10. Live capture & `tc` (separate, opt-in)

See [`backend/README.md`](./backend/README.md). Highlights: passive capture only,
dry-run by default, dual authorization gates, refuses to touch the default-route
interface or `eth0`/`lo`, validates every parameter, uses a genuine per-source
`flower` classifier, and supports automated rollback and timeout recovery.

## 11. Known Limitations

- The browser build cannot execute Python/`tc`; all in-app metrics are simulated demonstrations.
- A rate spike is not measured queue congestion; physical datacenter switch buffer overflow requires hardware switch counters (e.g. PFC/ECN).
- 10 ms / 80 Mbps / ×3 are educational defaults, not universal definitions.
- `tc` shaping is host-egress queueing, not a distributed fabric policing policy.

---

## 12. Presentation and Deliverables

The final, simplified-English, 7-slide engineering showcase presentation is generated and verified in the repository root:
- **Presentation File:** [`MicroburstHunter_Presentation.pptx`](./MicroburstHunter_Presentation.pptx)
- **Format:** 16:9 Widescreen (13.333" × 7.500")
- **Visual Design Identity:** Deep midnight navy backgrounds, electric cyan accents, white typography, controlled crimson congestion alerts, and editable vector pipeline/flowchart diagrams.
- **Generator Script:** [`generate_presentation.py`](./generate_presentation.py) (uses `python-pptx` and `Pillow`).

---

## Template notes (auth & conventions)

- Routes live in `src/main.tsx`; pages in `src/pages`, components in
  `src/components`, shadcn primitives in `src/components/ui`.
- Auth uses Convex Auth (email OTP + anonymous). Use the `useAuth` hook; protect
  routes with `RequireAuth`. Do not modify `src/convex/auth.ts`,
  `src/convex/auth.config.ts` or `src/convex/auth/emailOtp.ts`.
- Convex environment variables (`JWKS`, `JWT_PRIVATE_KEY`, `SITE_URL`) are
  managed by the platform.
