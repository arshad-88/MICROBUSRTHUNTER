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
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from burst_detector import BurstDetector, BurstEvent
from config import RuntimeConfig, load_config
from event_store import EventStore
from metrics import Window
from mitigation_policy import MitigationPolicy
from source_ranker import SourceRanker
from tc_controller import TcController, TcError

LOG = logging.getLogger("microbursthunter.main")


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def _emit(kind: str, payload: dict) -> None:
    """Emit a JSON line so another process (e.g. the browser bridge) can consume it."""
    sys.stdout.write(json.dumps({"kind": kind, **payload}) + "\n")
    sys.stdout.flush()


@dataclass
class ActiveMitigation:
    """Represents an actively tracked rate limit on a source IP."""

    source_ip: str
    cap_mbps: float
    started_at_ms: float
    simulated: bool
    commands: list[str] = field(default_factory=list)
    wall_start_time: float = field(default_factory=time.monotonic)
    unresolved: bool = False
    unresolved_reason: str | None = None


class CapturePipeline:
    """Coordinates packet telemetry, detection, mitigation policy, and traffic shaping."""

    def __init__(
        self,
        cfg: RuntimeConfig,
        interface: str,
        store: EventStore | None = None,
        controller: TcController | None = None,
        policy: MitigationPolicy | None = None,
        detector: BurstDetector | None = None,
        ranker: SourceRanker | None = None,
        emit_fn: Callable[[str, dict], None] | None = None,
    ) -> None:
        self.cfg = cfg
        self.interface = interface
        self.store = store or EventStore(cfg.db_path)
        self._owns_store = store is None
        self.controller = controller or TcController(
            interface=interface,
            dry_run=cfg.dry_run,
        )
        self.policy = policy or MitigationPolicy(cfg.mitigation)
        self.ranker = ranker or SourceRanker()
        self._custom_emit = emit_fn
        self.active_mitigation: ActiveMitigation | None = None
        self._lock = threading.RLock()
        self._timeout_timer: threading.Timer | None = None
        self._timer_generation: int = 0
        self._closed = False

        self.detector = detector or BurstDetector(cfg.detection, on_event=self.on_event)

    def _arm_timeout_timer(self, timeout_sec: float) -> None:
        """Arm a wall-clock timer that expires active mitigation even on idle traffic."""
        if timeout_sec <= 0:
            return
        self._cancel_timeout_timer()
        self._timer_generation += 1
        generation = self._timer_generation
        self._timeout_timer = threading.Timer(
            timeout_sec,
            self._on_timeout_alarm,
            args=(generation,),
        )
        self._timeout_timer.daemon = True
        self._timeout_timer.start()

    def _cancel_timeout_timer(self) -> None:
        """Cancel any armed timeout timer and invalidate current generation."""
        self._timer_generation += 1
        if self._timeout_timer is not None:
            self._timeout_timer.cancel()
            self._timeout_timer = None

    def _on_timeout_alarm(self, generation: int) -> None:
        """Invoked by wall-clock timer when max mitigation duration expires during idle traffic."""
        with self._lock:
            if self._closed or self.active_mitigation is None:
                return

            if self.active_mitigation.unresolved:
                return

            if generation != self._timer_generation or self._timeout_timer is None:
                LOG.debug(
                    "Ignoring stale timeout alarm (generation %d != active generation %d)",
                    generation,
                    self._timer_generation,
                )
                return

            elapsed_ms = (time.monotonic() - self.active_mitigation.wall_start_time) * 1000.0
            max_ms = self.cfg.mitigation.max_duration_ms
            remaining_ms = max_ms - elapsed_ms
            if remaining_ms > 15.0:
                LOG.debug(
                    "Re-arming timer for remaining time (elapsed %.1f ms < ceiling %d ms, remaining %.1f ms)",
                    elapsed_ms,
                    max_ms,
                    remaining_ms,
                )
                self._timeout_timer = threading.Timer(
                    remaining_ms / 1000.0,
                    self._on_timeout_alarm,
                    args=(generation,),
                )
                self._timeout_timer.daemon = True
                self._timeout_timer.start()
                return

            target_ip = self.active_mitigation.source_ip
            LOG.info(
                "Wall-clock mitigation timeout reached (%.0f ms >= %d ms) for %s; releasing cap on idle traffic",
                elapsed_ms,
                max_ms,
                target_ip,
            )
            try:
                self.store.record(
                    type="mitigation_expired",
                    severity="info",
                    action="Mitigation duration limit reached",
                    outcome=f"Cap released after timeout (ceiling: {max_ms} ms)",
                    source_ip=target_ip,
                )
            except Exception as store_err:
                LOG.error("Failed to record mitigation expiry in store: %s", store_err)
            try:
                self.emit(
                    "mitigation",
                    {
                        "status": "expired",
                        "source_ip": target_ip,
                        "reason": f"max duration {max_ms} ms reached (idle timeout)",
                    },
                )
                self.emit(
                    "policy",
                    {
                        "action": "remove",
                        "cap_mbps": None,
                        "reason": f"max duration {max_ms} ms reached",
                    },
                )
            except Exception as emit_err:
                LOG.error("Failed to emit mitigation expiry events: %s", emit_err)
            try:
                self._rollback_mitigation(source_ip=target_ip, reason="max_duration_expired")
            except Exception as exc:
                LOG.error("Rollback error during wall-clock timeout expiration on %s: %s", target_ip, exc)

    def emit(self, kind: str, payload: dict) -> None:
        if self._custom_emit is not None:
            self._custom_emit(kind, payload)
        else:
            _emit(kind, payload)

    def on_window(self, window: Window) -> None:
        with self._lock:
            if self._closed:
                return
            for ip, byte_count in window.per_source_bytes.items():
                self.ranker.observe(ip, byte_count)

            self._check_mitigation_timeout(window.end_ms)
            self.detector.process(window)

            self.emit(
                "window",
                {
                    "end_ms": window.end_ms,
                    "rate_mbps": round(window.rate_mbps, 3),
                    "packets": window.packet_count,
                },
            )

    def _check_mitigation_timeout(self, now_ms: float) -> None:
        if self.active_mitigation is None or self.active_mitigation.unresolved:
            return

        elapsed_ms = now_ms - self.active_mitigation.started_at_ms
        if elapsed_ms < self.cfg.mitigation.max_duration_ms:
            return

        target_ip = self.active_mitigation.source_ip
        LOG.info(
            "Mitigation duration limit reached (%d ms >= %d ms) for %s; releasing cap",
            int(elapsed_ms),
            self.cfg.mitigation.max_duration_ms,
            target_ip,
        )
        try:
            self.store.record(
                type="mitigation_expired",
                severity="info",
                action="Mitigation duration limit reached",
                outcome=f"Cap released after {int(elapsed_ms)} ms (ceiling: {self.cfg.mitigation.max_duration_ms} ms)",
                source_ip=target_ip,
            )
        except Exception as store_err:
            LOG.error("Failed to record mitigation expiry in store: %s", store_err)
        try:
            self.emit(
                "mitigation",
                {
                    "status": "expired",
                    "source_ip": target_ip,
                    "reason": f"max duration {self.cfg.mitigation.max_duration_ms} ms reached",
                },
            )
            self.emit(
                "policy",
                {
                    "action": "remove",
                    "cap_mbps": None,
                    "reason": f"max duration {self.cfg.mitigation.max_duration_ms} ms reached",
                },
            )
        except Exception as emit_err:
            LOG.error("Failed to emit mitigation expiry events: %s", emit_err)
        self._rollback_mitigation(source_ip=target_ip, reason="max_duration_expired")

    def _rollback_mitigation(self, source_ip: str | None, reason: str) -> None:
        self._cancel_timeout_timer()
        try:
            self.controller.rollback()
            self.active_mitigation = None
            try:
                self.store.record(
                    type="mitigation_removed",
                    severity="success",
                    action="Mitigation removed",
                    outcome=f"Cap released on {self.controller.interface} ({reason})",
                    source_ip=source_ip,
                )
            except Exception as store_exc:
                LOG.error("Failed to record mitigation removal in store: %s", store_exc)
            self.emit(
                "mitigation",
                {
                    "status": "removed",
                    "action": "remove",
                    "reason": reason,
                    "source_ip": source_ip,
                },
            )
        except TcError as exc:
            if self.active_mitigation is not None:
                self.active_mitigation.unresolved = True
                self.active_mitigation.unresolved_reason = str(exc)
            else:
                self.active_mitigation = ActiveMitigation(
                    source_ip=source_ip or "unknown",
                    cap_mbps=0.0,
                    started_at_ms=0.0,
                    simulated=False,
                    unresolved=True,
                    unresolved_reason=str(exc),
                )
            try:
                self.store.record(
                    type="rollback_failed",
                    severity="critical",
                    action="Rollback failed",
                    outcome=str(exc),
                    source_ip=source_ip,
                )
            except Exception as store_exc:
                LOG.error("Failed to record rollback failure in store: %s", store_exc)
            self.emit(
                "mitigation",
                {
                    "status": "rollback_failed",
                    "error": str(exc),
                    "source_ip": source_ip,
                    "unresolved": True,
                },
            )
            LOG.error("Failed to roll back rules on %s: %s", self.controller.interface, exc)
            raise

    def on_event(self, kind: str, event: BurstEvent) -> None:
        with self._lock:
            action = f"{kind}: {event.severity} burst from {event.source_ip}"
            outcome = (
                f"peak {event.peak_mbps:.1f} Mbps vs threshold {event.threshold_mbps:.1f} Mbps "
                f"(baseline {event.baseline_mbps:.1f} Mbps), share {event.contribution_pct:.1f}%"
            )
            severity = "critical" if event.severity == "severe" else "warning" if kind == "burst_detected" else "success"
            self.store.record(
                type=kind,
                severity=severity,
                action=action,
                outcome=outcome,
                source_ip=event.source_ip,
                rate_mbps=event.peak_mbps,
            )
            self.emit(
                "event",
                {
                    "type": kind,
                    "source_ip": event.source_ip,
                    "rate_mbps": round(event.peak_mbps, 3),
                    "baseline_mbps": round(event.baseline_mbps, 3),
                    "threshold_mbps": round(event.threshold_mbps, 3),
                    "contribution_pct": round(event.contribution_pct, 2),
                    "severity": event.severity,
                },
            )

            if kind == "burst_detected":
                self._handle_burst_detected(event)
            elif kind == "burst_ended":
                self._handle_burst_ended(event)

    def _handle_burst_detected(self, event: BurstEvent) -> None:
        decision = self.policy.on_burst(event)
        self.emit(
            "policy",
            {"action": decision.action, "cap_mbps": decision.cap_mbps, "reason": decision.reason},
        )

        if decision.action == "none":
            self.store.record(
                type="mitigation_decision",
                severity="info",
                action="Mitigation skipped",
                outcome=decision.reason,
                source_ip=event.source_ip,
                rate_mbps=event.peak_mbps,
            )
            self.emit(
                "mitigation",
                {
                    "status": "disabled",
                    "action": "none",
                    "reason": decision.reason,
                    "source_ip": event.source_ip,
                },
            )
            return

        if decision.action == "fail":
            self.store.record(
                type="mitigation_failed",
                severity="error",
                action="Mitigation rejected",
                outcome=decision.reason,
                source_ip=event.source_ip,
                rate_mbps=event.peak_mbps,
            )
            self.emit(
                "mitigation",
                {
                    "status": "rejected",
                    "action": "fail",
                    "reason": decision.reason,
                    "source_ip": event.source_ip,
                },
            )
            return

        if decision.action == "apply":
            target_ip = decision.source_ip or event.source_ip
            cap_mbps = decision.cap_mbps or self.cfg.mitigation.moderate_cap_mbps

            if self.active_mitigation is not None:
                if self.active_mitigation.unresolved:
                    reason = (
                        f"controller busy: class 1:10 occupied by unresolved failed rollback on "
                        f"{self.active_mitigation.source_ip} ({self.active_mitigation.unresolved_reason})"
                    )
                    self.store.record(
                        type="mitigation_failed",
                        severity="critical",
                        action=f"Mitigation rejected for {target_ip}",
                        outcome=reason,
                        source_ip=target_ip,
                        rate_mbps=event.peak_mbps,
                    )
                    self.emit(
                        "mitigation",
                        {
                            "status": "busy",
                            "action": "rejected",
                            "source_ip": target_ip,
                            "active_source_ip": self.active_mitigation.source_ip,
                            "unresolved": True,
                            "reason": reason,
                        },
                    )
                    return

                if self.active_mitigation.source_ip == target_ip:
                    self.emit(
                        "mitigation",
                        {
                            "status": "already_active",
                            "source_ip": target_ip,
                            "cap_mbps": self.active_mitigation.cap_mbps,
                            "reason": "cap already active",
                        },
                    )
                    return
                else:
                    reason = f"controller busy: class 1:10 occupied by active mitigation on {self.active_mitigation.source_ip}"
                    self.store.record(
                        type="mitigation_failed",
                        severity="warning",
                        action=f"Mitigation rejected for {target_ip}",
                        outcome=reason,
                        source_ip=target_ip,
                        rate_mbps=event.peak_mbps,
                    )
                    self.emit(
                        "mitigation",
                        {
                            "status": "busy",
                            "action": "rejected",
                            "source_ip": target_ip,
                            "active_source_ip": self.active_mitigation.source_ip,
                            "reason": reason,
                        },
                    )
                    return

            if self.controller.dry_run:
                commands = self.controller.apply_source_cap(target_ip, cap_mbps)
                self.active_mitigation = ActiveMitigation(
                    source_ip=target_ip,
                    cap_mbps=cap_mbps,
                    started_at_ms=event.started_at_ms,
                    simulated=True,
                    commands=commands,
                )
                self._arm_timeout_timer(self.cfg.mitigation.max_duration_ms / 1000.0)
                self.store.record(
                    type="mitigation_simulated",
                    severity="info",
                    action=f"Dry-run cap {cap_mbps} Mbps on {target_ip}",
                    outcome=f"Planned {len(commands)} command(s); no kernel changes made",
                    source_ip=target_ip,
                    rate_mbps=event.peak_mbps,
                )
                self.emit(
                    "mitigation",
                    {
                        "status": "simulated",
                        "source_ip": target_ip,
                        "cap_mbps": cap_mbps,
                        "dry_run": True,
                        "commands": commands,
                    },
                )
            else:
                try:
                    commands = self.controller.apply_source_cap(target_ip, cap_mbps)
                    self.active_mitigation = ActiveMitigation(
                        source_ip=target_ip,
                        cap_mbps=cap_mbps,
                        started_at_ms=event.started_at_ms,
                        simulated=False,
                        commands=commands,
                    )
                    self._arm_timeout_timer(self.cfg.mitigation.max_duration_ms / 1000.0)
                    self.store.record(
                        type="mitigation_applied",
                        severity="warning",
                        action=f"Applied cap {cap_mbps} Mbps on {target_ip}",
                        outcome=f"Enforced on {self.controller.interface} via HTB class and flower filter",
                        source_ip=target_ip,
                        rate_mbps=event.peak_mbps,
                    )
                    self.emit(
                        "mitigation",
                        {
                            "status": "applied",
                            "source_ip": target_ip,
                            "cap_mbps": cap_mbps,
                            "dry_run": False,
                            "commands": commands,
                        },
                    )
                except TcError as exc:
                    self.store.record(
                        type="mitigation_failed",
                        severity="critical",
                        action=f"Failed to apply cap on {target_ip}",
                        outcome=str(exc),
                        source_ip=target_ip,
                        rate_mbps=event.peak_mbps,
                    )
                    self.emit(
                        "mitigation",
                        {
                            "status": "failed",
                            "source_ip": target_ip,
                            "cap_mbps": cap_mbps,
                            "error": str(exc),
                        },
                    )
                    LOG.error("Failed to apply traffic cap on %s: %s", self.controller.interface, exc)
                    raise

    def _handle_burst_ended(self, event: BurstEvent) -> None:
        decision = self.policy.on_recovery()
        self.emit(
            "policy",
            {"action": decision.action, "cap_mbps": decision.cap_mbps, "reason": decision.reason},
        )
        if self.active_mitigation is not None and self.active_mitigation.unresolved:
            LOG.warning(
                "Burst ended but active mitigation on %s remains in unresolved state",
                self.active_mitigation.source_ip,
            )
            return
        if self.active_mitigation is not None or self.controller.applied or self.controller.owned_resources:
            target_ip = self.active_mitigation.source_ip if self.active_mitigation else event.source_ip
            self._rollback_mitigation(source_ip=target_ip, reason="traffic_recovered")

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._cancel_timeout_timer()
            rollback_exc: BaseException | None = None

            if self.active_mitigation is not None or self.controller.applied or self.controller.owned_resources:
                try:
                    self.controller.rollback()
                    self.active_mitigation = None
                    try:
                        self.store.record(
                            type="mitigation_cleaned_up",
                            severity="info",
                            action="Mitigation rolled back on shutdown",
                            outcome=f"Cleaned up rules on {self.controller.interface}",
                        )
                    except Exception:
                        pass
                    self.emit("mitigation", {"status": "cleaned_up", "action": "rollback_on_shutdown"})
                except Exception as exc:
                    rollback_exc = exc
                    if self.active_mitigation is not None:
                        self.active_mitigation.unresolved = True
                        self.active_mitigation.unresolved_reason = str(exc)
                    else:
                        self.active_mitigation = ActiveMitigation(
                            source_ip="unknown",
                            cap_mbps=0.0,
                            started_at_ms=0.0,
                            simulated=False,
                            unresolved=True,
                            unresolved_reason=str(exc),
                        )
                    try:
                        self.store.record(
                            type="cleanup_failed",
                            severity="critical",
                            action="Shutdown rollback failed",
                            outcome=str(exc),
                        )
                    except Exception:
                        pass
                    self.emit("mitigation", {"status": "cleanup_failed", "error": str(exc), "unresolved": True})
                    LOG.error("Shutdown cleanup failed on %s: %s", self.controller.interface, exc)

            try:
                try:
                    self.store.record(
                        type="monitoring_stopped",
                        severity="info",
                        action="Capture stopped",
                        outcome="Passive capture session ended.",
                    )
                except Exception:
                    pass
            finally:
                try:
                    self.store.close()
                except Exception:
                    pass

            if rollback_exc is not None:
                raise rollback_exc


def cmd_capture(
    args: argparse.Namespace,
    cfg: RuntimeConfig,
    controller: TcController | None = None,
    store: EventStore | None = None,
) -> int:
    from capture import capture

    if not args.interface:
        print("error: --interface is required for live capture", file=sys.stderr)
        return 2

    if getattr(args, "namespace", None) is not None:
        print(
            "error: network namespace capture is not supported; Scapy packet capture runs in the "
            "process namespace while --namespace modifies an isolated namespace. Omit --namespace "
            "or run inside the namespace.",
            file=sys.stderr,
        )
        return 2

    # Live shaping must require the explicit --apply CLI flag.
    # --mitigate alone must never enable live shaping, even if MBH_DRY_RUN=0 exists in the environment.
    is_apply = bool(getattr(args, "apply", False))
    cfg.dry_run = not is_apply

    if getattr(args, "mitigate", False):
        cfg.mitigation.auto_enabled = True

    namespace = getattr(args, "namespace", None)
    if controller is None:
        controller = TcController(
            interface=args.interface,
            dry_run=cfg.dry_run,
            namespace=namespace,
        )
    else:
        controller.dry_run = cfg.dry_run

    # MANDATORY SAFETY CHECK: If live mitigation is requested, verify safe interface before starting capture
    if cfg.mitigation.auto_enabled and not cfg.dry_run:
        controller.assert_safe_interface()

    pipeline = CapturePipeline(
        cfg=cfg,
        interface=args.interface,
        store=store,
        controller=controller,
    )

    logging.getLogger("microbursthunter.detector").info(
        "Starting capture on %s (dry_run=%s, auto_mitigate=%s)",
        args.interface,
        cfg.dry_run,
        cfg.mitigation.auto_enabled,
    )

    try:
        capture(
            interface=args.interface,
            on_window=pipeline.on_window,
            window_ms=cfg.detection.window_ms,
            bpf_filter=cfg.bpf_filter,
            duration_s=args.duration,
        )
    except TcError as exc:
        print(f"traffic control error during capture: {exc}", file=sys.stderr)
        return 1
    finally:
        pipeline.close()

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


def cmd_serve(args: argparse.Namespace, cfg: RuntimeConfig) -> int:
    from api_server import run_server
    return run_server(host=args.host, port=args.port)


def cmd_demo(args: argparse.Namespace, cfg: RuntimeConfig) -> int:
    from demo_dry_run import run_dry_run_demo
    res = run_dry_run_demo()
    return 0 if res["status"] == "SUCCESS" else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MicroburstHunter live-capture backend")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    srv = sub.add_parser("serve", help="run HTTP API server bridging backend capture to the dashboard")
    srv.add_argument("--host", default="0.0.0.0", help="host to bind (default: 0.0.0.0)")
    srv.add_argument("--port", type=int, default=8000, help="port to bind (default: 8000)")
    srv.set_defaults(func=cmd_serve)

    demo = sub.add_parser("demo", help="run safe dry-run end-to-end demonstration (Mode A)")
    demo.set_defaults(func=cmd_demo)

    cap = sub.add_parser("capture", help="passively capture and detect microbursts")
    cap.add_argument("--interface", required=True)
    cap.add_argument("--duration", type=float, default=None, help="seconds to capture")
    cap.add_argument("--mitigate", action="store_true", help="enable automatic mitigation")
    cap.add_argument("--apply", action="store_true", help="apply traffic-control changes (disables dry-run)")
    cap.add_argument("--namespace", default=None, help="network namespace for isolated interface")
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
