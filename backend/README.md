# MicroburstHunter — live-capture backend (Python)

This folder is the **separate real-network integration**. The browser app is a
deterministic simulation and never claims to capture live traffic. This backend
does real work, but only on an interface you name explicitly, and only runs
privileged commands when you ask it to.

## What it does

| Module | Responsibility |
| --- | --- |
| `capture.py` | Passive packet capture with Scapy; emits 10 ms windows |
| `metrics.py` | Window aggregation + the same rate formula as the frontend |
| `burst_detector.py` | Baseline + minimum-rate + persistence + cooldown detection |
| `source_ranker.py` | Ranks sources by burst byte contribution |
| `mitigation_policy.py` | Decides the mild/strict cap from burst severity |
| `tc_controller.py` | Builds, validates and (optionally) applies Linux `tc` rules |
| `event_store.py` | SQLite event history + CSV export |
| `main.py` | CLI orchestrator |

## Install

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Capture and shaping need root (or `CAP_NET_RAW` / `CAP_NET_ADMIN`).

## Usage

```bash
# 1. Inspect the existing queueing configuration (read-only, safe)
python main.py tc-inspect --interface eth0

# 2. Dry-run a per-source cap — prints the exact commands, changes nothing
python main.py tc-plan --interface veth-test --source-ip 10.0.1.13 --rate 50

# 3. Apply the per-source cap (only when you really mean it)
sudo python main.py tc-apply --interface veth-test --source-ip 10.0.1.13 --rate 50 --apply

# 4. Undo everything
sudo python main.py tc-rollback --interface veth-test --apply

# 5. Capture passively and detect bursts for 30 seconds
sudo python main.py capture --interface eth0 --duration 30

# 6. Export recorded events
python main.py export --csv live-events.csv
```

`capture` also prints JSON lines (`{"kind": "window"|"event"|"policy", ...}`) so a
bridge process could stream live results to the browser app.

## Safety model

- **Dry-run by default.** `tc_apply`/`tc_rollback` require an explicit `--apply`.
- **No default-route interface.** `assert_safe_interface()` refuses to touch the
  interface carrying the machine's default route — use an isolated test
  interface (a `veth` pair or network namespace works well).
- **Validated inputs.** Interface names, IP addresses and rates are validated
  before any command is built.
- **Per-source means per-source.** `tc-plan` installs an HTB class plus a
  `flower` classifier matching the source IP, so the cap really is per-flow. An
  interface-wide TBF limit is *never* reported as per-source.
- **Rollback.** `tc_rollback` deletes the MicroburstHunter qdisc and clears the
  recorded rule list.

## Limitations (read this for the review)

- The browser build cannot run this backend, so the app reports **simulated**
  data only. There is no fake "live" status.
- A measured traffic-rate spike does **not** prove switch-buffer overflow. Queue
  occupancy requires switch counters (e.g. PFC/ECN/`tc -s`), which this prototype
  does not read.
- 10 ms / 80 Mbps / ×3 are educational defaults, configurable in both the app and
  `config.py`.
- `tc` shaping affects the host's egress only and is visible to that host; it is
  not a distributed fabric policy.
