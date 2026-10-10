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

## 8. Tests performed

`bun test` runs `tests/simulation.test.ts` (19 tests, all passing):

- rate calculations (`bytesToMbps`, inverse, zero-window guard)
- detection thresholds (`max(minRate, baseline×mult)`, strict qualification)
- rolling baseline behaviour (window slice, empty baseline)
- severity classification, source contribution percentage (and zero-division guard)
- mitigation caps, queue/overflow drop + latency model
- engine: normal traffic produces no false bursts
- engine: `simulateBurst` produces a reproducible detection event
- engine: the offending source is capped
- engine: mitigation lowers the modelled flow below its raw peak
- engine: recovery releases the cap and logs recovery events
- engine: reset restores a clean state
- engine: Experiment 3 completes with mitigation activity recorded
- engine: deterministic seed yields identical averages

## 9. Live capture & `tc` (separate, opt-in)

See [`backend/README.md`](./backend/README.md). Highlights: passive capture only,
dry-run by default, refuses to touch the default-route interface, validates every
parameter, uses a genuine per-source `flower` classifier, and supports rollback.

## 10. Limitations

- The browser build cannot execute Python/`tc`; all in-app metrics are simulated.
- A rate spike is not measured queue congestion; no switch counters are read.
- 10 ms / 80 Mbps / ×3 are educational defaults, not universal definitions.
- `tc` shaping is host-egress only, not a distributed fabric policy.

---

## Template notes (auth & conventions)

- Routes live in `src/main.tsx`; pages in `src/pages`, components in
  `src/components`, shadcn primitives in `src/components/ui`.
- Auth uses Convex Auth (email OTP + anonymous). Use the `useAuth` hook; protect
  routes with `RequireAuth`. Do not modify `src/convex/auth.ts`,
  `src/convex/auth.config.ts` or `src/convex/auth/emailOtp.ts`.
- Convex environment variables (`JWKS`, `JWT_PRIVATE_KEY`, `SITE_URL`) are
  managed by the platform.
