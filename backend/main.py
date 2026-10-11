"""MicroburstHunter live-capture backend CLI.

This is the SEPARATE real-network integration. The browser app is a simulation;
this backend performs actual (passive) packet capture and, only when explicitly
asked and only after validation, Linux tc traffic shaping.

Examples
--------
Inspect current queueing configuration (read-only):
    python main.py tc-inspect --interface eth0

Dry-run a per-source cap (prints commands, changes nothing):
    python main.py tc-plan --interface eth0 --source-ip 10.0.1.13 --rate 50

Actually apply a per-source cap (requires --apply and root):
    sudo python main.py tc-apply --interface veth1 --source-ip 10.0.1.13 --rate 50 --apply

Passively capture and detect microbursts for 30 seconds:
    sudo python main.py capture --interface eth0 --duration 30

Export recorded events to CSV:
    python main.py export --csv events.csv
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from burst_detector import BurstDetector, BurstEvent
from config import RuntimeConfig, load_config
from event_store import EventStore
from mitigation_policy import MitigationPolicy
from source_ranker import SourceRanker
from tc_controller import TcController, TcError


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def _emit(kind: str, payload: dict) -> None:
    """Emit a JSON line so another process (e.g. the browser bridge) can consume it."""
    sys.stdout.write(json.dumps({"kind": kind, **payload}) + "\n")
    sys.stdout.flush()


def cmd_capture(args: argparse.Namespace, cfg: RuntimeConfig) -> int:
    from capture import capture

    if not args.interface:
        print("error: --interface is required for live capture", file=sys.stderr)
        return 2

    store = EventStore(cfg.db_path)
    ranker = SourceRanker()
    policy = MitigationPolicy(cfg.mitigation)

    def on_window(window) -> None:  # type: ignore[no-untyped-def]
        for ip, byte_count in window.per_source_bytes.items():
            ranker.observe(ip, byte_count)
        detector.process(window)
        _emit(
            "window",
            {
                "end_ms": window.end_ms,
                "rate_mbps": round(window.rate_mbps, 3),
                "packets": window.packet_count,
            },
        )

    def on_event(kind: str, event: BurstEvent) -> None:
        action = f"{kind}: {event.severity} burst from {event.source_ip}"
        outcome = (
            f"peak {event.peak_mbps:.1f} Mbps vs threshold {event.threshold_mbps:.1f} Mbps "
            f"(baseline {event.baseline_mbps:.1f} Mbps), share {event.contribution_pct:.1f}%"
        )
        severity = "critical" if event.severity == "severe" else "warning" if kind == "burst_detected" else "success"
        store.record(
            type=kind,
            severity=severity,
            action=action,
            outcome=outcome,
            source_ip=event.source_ip,
            rate_mbps=event.peak_mbps,
        )
        _emit("event", {"type": kind, "source_ip": event.source_ip, "rate_mbps": round(event.peak_mbps, 3)})
        if kind == "burst_detected":
            decision = policy.on_burst(event)
            _emit("policy", {"action": decision.action, "cap_mbps": decision.cap_mbps, "reason": decision.reason})
        elif kind == "burst_ended":
            decision = policy.on_recovery()
            _emit("policy", {"action": decision.action, "cap_mbps": decision.cap_mbps, "reason": decision.reason})

    # Wire detector events only after the callback has been defined.
    detector = BurstDetector(cfg.detection, on_event=on_event)

    logging.getLogger("microbursthunter.detector").info("Starting passive capture on %s", args.interface)
    try:
        capture(
            interface=args.interface,
            on_window=on_window,
            window_ms=cfg.detection.window_ms,
            bpf_filter=cfg.bpf_filter,
            duration_s=args.duration,
        )
    finally:
        store.record(
            type="monitoring_stopped",
            severity="info",
            action="Capture stopped",
            outcome="Passive capture session ended.",
        )
        store.close()
    return 0


def cmd_tc_inspect(args: argparse.Namespace, cfg: RuntimeConfig) -> int:
    controller = TcController(interface=args.interface, dry_run=True)
    try:
        output = controller.show_qdisc()
    except TcError as exc:
        print(f"tc error: {exc}", file=sys.stderr)
        return 1
    print(output or "(no output)")
    return 0


def cmd_tc_plan(args: argparse.Namespace, cfg: RuntimeConfig) -> int:
    controller = TcController(interface=args.interface, dry_run=True)
    try:
        commands = controller.plan_source_cap(args.source_ip, args.rate)
    except TcError as exc:
        print(f"tc error: {exc}", file=sys.stderr)
        return 1
    print("# Candidate commands (not executed):")
    for line in commands:
        print(f"tc {line}")
    print(
        "\n# This plan would create a root HTB qdisc and a flower source classifier."
        "\n# WARNING: applying it may replace existing root queueing configuration."
        "\n# Automated rollback is intentionally unavailable until rule ownership "
        "can be verified."
    )
    return 0


def cmd_tc_apply(args: argparse.Namespace, cfg: RuntimeConfig) -> int:
    if not args.apply:
        print(
            "refusing to run: pass --apply to confirm you want to modify the interface "
            "(dry-run first with `tc-plan`)",
            file=sys.stderr,
        )
        return 2
    controller = TcController(interface=args.interface, dry_run=False)
    try:
        controller.assert_safe_interface()
        controller.apply_source_cap(args.source_ip, args.rate)
    except TcError as exc:
        print(f"tc error: {exc}", file=sys.stderr)
        return 1
    print(f"Applied per-source cap {args.rate} Mbps on {args.source_ip}.")
    return 0


def cmd_tc_rollback(args: argparse.Namespace, cfg: RuntimeConfig) -> int:
    if not args.apply:
        print("refusing to run: pass --apply to confirm rollback", file=sys.stderr)
        return 2
    controller = TcController(interface=args.interface, dry_run=False)
    try:
        controller.rollback()
    except TcError as exc:
        print(f"tc error: {exc}", file=sys.stderr)
        return 1
    print("Rolled back MicroburstHunter tc rules.")
    return 0


def cmd_export(args: argparse.Namespace, cfg: RuntimeConfig) -> int:
    store = EventStore(cfg.db_path)
    count = store.export_csv(args.csv)
    store.close()
    print(f"Exported {count} events to {args.csv}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MicroburstHunter live-capture backend")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    cap = sub.add_parser("capture", help="passively capture and detect microbursts")
    cap.add_argument("--interface", required=True)
    cap.add_argument("--duration", type=float, default=None, help="seconds to capture")
    cap.set_defaults(func=cmd_capture)

    insp = sub.add_parser("tc-inspect", help="show current qdisc configuration (read-only)")
    insp.add_argument("--interface", required=True)
    insp.set_defaults(func=cmd_tc_inspect)

    plan = sub.add_parser("tc-plan", help="dry-run a per-source cap")
    plan.add_argument("--interface", required=True)
    plan.add_argument("--source-ip", required=True)
    plan.add_argument("--rate", type=float, required=True, help="cap in Mbps")
    plan.set_defaults(func=cmd_tc_plan)

    apply = sub.add_parser("tc-apply", help="apply a per-source cap (requires --apply)")
    apply.add_argument("--interface", required=True)
    apply.add_argument("--source-ip", required=True)
    apply.add_argument("--rate", type=float, required=True)
    apply.add_argument("--apply", action="store_true")
    apply.set_defaults(func=cmd_tc_apply)

    roll = sub.add_parser("tc-rollback", help="remove MicroburstHunter tc rules")
    roll.add_argument("--interface", required=True)
    roll.add_argument("--apply", action="store_true")
    roll.set_defaults(func=cmd_tc_rollback)

    exp = sub.add_parser("export", help="export recorded live events to CSV")
    exp.add_argument("--csv", required=True)
    exp.set_defaults(func=cmd_export)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)
    cfg = load_config()
    return args.func(args, cfg)


if __name__ == "__main__":
    raise SystemExit(main())
