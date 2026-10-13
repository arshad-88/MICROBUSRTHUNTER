"""Automated test suite for Phase 4.23: End-to-End Capture -> Detection -> Mitigation Pipeline.

Covers:
1. Capture measurements reaching detector and mitigation policy.
2. Disabled mitigation never invoking traffic-control controller.
3. Dry-run mode planning commands without mutating traffic control.
4. Live mitigation invoking controller and recording confirmed result.
5. Controller failures producing accurate failed state and propagating.
6. Persistence and cooldown preventing spurious / duplicate actions.
7. Traffic recovery triggering rollback.
8. Maximum duration ceiling releasing cap to avoid starvation.
9. Rollback failure remaining visible and recorded.
10. Safe shutdown cleaning up active rules and recording status.
11. Shutdown cleanup failure remaining visible and recorded.
12. Safety check refusing live mitigation on the host's default route interface.
"""

from __future__ import annotations

import argparse
import io
import os
import subprocess
import sys
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import MagicMock, patch

from burst_detector import BurstDetector, BurstEvent
from config import DetectionConfig, MitigationConfig, RuntimeConfig
from metrics import Window
from mitigation_policy import MitigationPolicy
from main import ActiveMitigation, CapturePipeline, cmd_capture
from tc_controller import TcController, TcError, TcOwnershipError


class FakeStore:
    def __init__(self, db_path: str = ":memory:") -> None:
        self.records: list[dict] = []
        self.closed: bool = False

    def record(self, **kwargs) -> None:
        self.records.append(kwargs)

    def close(self) -> None:
        self.closed = True


def make_window(t_ms: float, rate_mbps: float, source_ip: str = "10.200.1.2", duration_ms: int = 10) -> Window:
    # 1 Mbps over 10 ms is 1250 bytes
    byte_count = int(rate_mbps * 1250 * (duration_ms / 10))
    w = Window(
        start_ms=t_ms - duration_ms,
        end_ms=t_ms,
        total_bytes=byte_count,
        packet_count=10 if byte_count > 0 else 0,
        per_source_bytes={source_ip: byte_count} if byte_count > 0 else {},
    )
    return w


def prime_baseline(pipeline: CapturePipeline, num_windows: int = 5, rate_mbps: float = 10.0) -> None:
    for idx in range(num_windows):
        t = (idx + 1) * 10.0
        pipeline.on_window(make_window(t, rate_mbps))


class PipelineIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = FakeStore()
        self.emitted: list[dict] = []

    def custom_emit(self, kind: str, payload: dict) -> None:
        self.emitted.append({"kind": kind, **payload})

    def make_pipeline(
        self,
        auto_mitigate: bool = False,
        dry_run: bool = True,
        max_duration_ms: int = 8000,
        interface: str = "test0",
        controller: TcController | None = None,
    ) -> CapturePipeline:
        cfg = RuntimeConfig()
        cfg.detection = DetectionConfig(
            min_rate_mbps=80.0,
            baseline_multiplier=3.0,
            persistence_windows=3,
            recovery_windows=3,
            cooldown_ms=2000,
            baseline_window_ms=1000,
        )
        cfg.mitigation = MitigationConfig(
            auto_enabled=auto_mitigate,
            moderate_cap_mbps=60.0,
            severe_cap_mbps=35.0,
            max_duration_ms=max_duration_ms,
            cooldown_ms=3000,
        )
        cfg.dry_run = dry_run
        ctrl = controller or TcController(interface=interface, dry_run=dry_run)
        return CapturePipeline(
            cfg=cfg,
            interface=interface,
            store=self.store,
            controller=ctrl,
            emit_fn=self.custom_emit,
        )

    # -------------------------------------------------------------------------
    # 1. Measurements -> Detector -> Policy
    # -------------------------------------------------------------------------
    def test_measurements_reach_detector_and_policy(self) -> None:
        pipeline = self.make_pipeline(auto_mitigate=False)
        prime_baseline(pipeline, num_windows=5, rate_mbps=10.0)

        # Feed 3 sustained burst windows (150 Mbps)
        for idx in range(3):
            t = 60.0 + idx * 10.0
            pipeline.on_window(make_window(t, 150.0))

        events = [e for e in self.emitted if e["kind"] == "event"]
        self.assertTrue(any(e["type"] == "burst_detected" for e in events))
        policies = [p for p in self.emitted if p["kind"] == "policy"]
        self.assertTrue(len(policies) > 0)
        self.assertEqual(policies[0]["action"], "none")  # disabled by default

    # -------------------------------------------------------------------------
    # 2. Disabled mitigation never invokes controller
    # -------------------------------------------------------------------------
    def test_disabled_mitigation_never_invokes_controller(self) -> None:
        mock_ctrl = MagicMock(spec=TcController)
        mock_ctrl.dry_run = True
        mock_ctrl.interface = "test0"
        mock_ctrl.applied = []
        mock_ctrl.owned_resources = []

        pipeline = self.make_pipeline(auto_mitigate=False, controller=mock_ctrl)
        prime_baseline(pipeline)

        for idx in range(3):
            pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))

        mock_ctrl.apply_source_cap.assert_not_called()
        decisions = [r for r in self.store.records if r["type"] == "mitigation_decision"]
        self.assertEqual(len(decisions), 1)
        self.assertIn("disabled", decisions[0]["outcome"])

    # -------------------------------------------------------------------------
    # 3. Dry-run mode plans commands without mutating traffic control
    # -------------------------------------------------------------------------
    def test_dry_run_never_executes_tc_commands(self) -> None:
        ctrl = TcController(interface="test0", dry_run=True)
        with patch.object(ctrl, "_run") as mock_run:
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=True, controller=ctrl)
            prime_baseline(pipeline)

            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))

            # Controller should execute zero mutating tc commands
            mock_run.assert_not_called()
            self.assertEqual(ctrl.applied, [])
            self.assertEqual(ctrl.owned_resources, [])

        sim_records = [r for r in self.store.records if r["type"] == "mitigation_simulated"]
        self.assertEqual(len(sim_records), 1)
        self.assertIn("Dry-run cap 35.0 Mbps", sim_records[0]["action"])
        self.assertEqual(sim_records[0]["source_ip"], "10.200.1.2")

        mit_emits = [m for m in self.emitted if m["kind"] == "mitigation"]
        self.assertEqual(mit_emits[0]["status"], "simulated")
        self.assertTrue(mit_emits[0]["dry_run"])

    # -------------------------------------------------------------------------
    # 4. Live mitigation invokes controller and records confirmed result
    # -------------------------------------------------------------------------
    def test_successful_live_mitigation_records_confirmed_result(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        planned_cmds = [
            "class add dev test0 parent 1: classid 1:10 htb rate 35.0mbit ceil 35.0mbit",
            "filter add dev test0 protocol ip parent 1:0 prio 1 flower src_ip 10.200.1.2 flowid 1:10",
        ]

        with patch.object(ctrl, "apply_source_cap", return_value=planned_cmds) as mock_apply:
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=False, controller=ctrl)
            prime_baseline(pipeline)

            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))

            mock_apply.assert_called_once_with("10.200.1.2", 35.0)

        applied_records = [r for r in self.store.records if r["type"] == "mitigation_applied"]
        self.assertEqual(len(applied_records), 1)
        self.assertIn("Applied cap 35.0 Mbps", applied_records[0]["action"])
        self.assertEqual(applied_records[0]["source_ip"], "10.200.1.2")

        mit_emits = [m for m in self.emitted if m["kind"] == "mitigation"]
        self.assertEqual(mit_emits[0]["status"], "applied")
        self.assertFalse(mit_emits[0]["dry_run"])
        self.assertEqual(mit_emits[0]["commands"], planned_cmds)

    # -------------------------------------------------------------------------
    # 5. Controller failures produce accurate failed state and propagate
    # -------------------------------------------------------------------------
    def test_controller_failure_records_failed_state_and_raises(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        with patch.object(ctrl, "apply_source_cap", side_effect=TcError("No root qdisc found on test0")):
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=False, controller=ctrl)
            prime_baseline(pipeline)

            with self.assertRaisesRegex(TcError, "No root qdisc found on test0"):
                for idx in range(3):
                    pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))

        failed_records = [r for r in self.store.records if r["type"] == "mitigation_failed"]
        self.assertEqual(len(failed_records), 1)
        self.assertEqual(failed_records[0]["outcome"], "No root qdisc found on test0")

        mit_emits = [m for m in self.emitted if m["kind"] == "mitigation"]
        self.assertEqual(mit_emits[0]["status"], "failed")
        self.assertEqual(mit_emits[0]["error"], "No root qdisc found on test0")

    # -------------------------------------------------------------------------
    # 6. Persistence and cooldown prevent spurious / duplicate actions
    # -------------------------------------------------------------------------
    def test_persistence_and_cooldown_prevent_duplicate_mitigations(self) -> None:
        pipeline = self.make_pipeline(auto_mitigate=True, dry_run=True)
        prime_baseline(pipeline)

        # 1. Single burst window should NOT trigger mitigation (persistence_windows = 3)
        pipeline.on_window(make_window(60.0, 150.0))
        self.assertIsNone(pipeline.active_mitigation)
        sim_records = [r for r in self.store.records if r["type"] == "mitigation_simulated"]
        self.assertEqual(len(sim_records), 0)

        # 2. Second and third windows trigger mitigation
        pipeline.on_window(make_window(70.0, 150.0))
        pipeline.on_window(make_window(80.0, 150.0))
        self.assertIsNotNone(pipeline.active_mitigation)
        sim_records = [r for r in self.store.records if r["type"] == "mitigation_simulated"]
        self.assertEqual(len(sim_records), 1)

        # 3. Sustained burst while active should not create duplicate mitigation records
        pipeline.on_window(make_window(90.0, 160.0))
        sim_records = [r for r in self.store.records if r["type"] == "mitigation_simulated"]
        self.assertEqual(len(sim_records), 1)

    # -------------------------------------------------------------------------
    # 7. Traffic recovery triggers rollback
    # -------------------------------------------------------------------------
    def test_traffic_recovery_triggers_controller_rollback(self) -> None:
        ctrl = TcController(interface="test0", dry_run=True)
        with patch.object(ctrl, "rollback") as mock_rollback:
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=True, controller=ctrl)
            prime_baseline(pipeline)

            # Trigger burst
            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))
            self.assertIsNotNone(pipeline.active_mitigation)

            # Feed recovery windows (recovery_windows = 3)
            for idx in range(3):
                pipeline.on_window(make_window(90.0 + idx * 10.0, 10.0))

            mock_rollback.assert_called_once()
            self.assertIsNone(pipeline.active_mitigation)

        removed_records = [r for r in self.store.records if r["type"] == "mitigation_removed"]
        self.assertEqual(len(removed_records), 1)
        self.assertEqual(removed_records[0]["source_ip"], "10.200.1.2")

    # -------------------------------------------------------------------------
    # 8. Maximum duration ceiling releases cap to avoid starvation
    # -------------------------------------------------------------------------
    def test_mitigation_duration_limit_releases_cap(self) -> None:
        ctrl = TcController(interface="test0", dry_run=True)
        with patch.object(ctrl, "rollback") as mock_rollback:
            # max_duration_ms = 500 ms for test
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=True, max_duration_ms=500, controller=ctrl)
            prime_baseline(pipeline)

            # Trigger burst starting at t = 80 ms
            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))
            self.assertIsNotNone(pipeline.active_mitigation)

            # Traffic remains heavy for 400 ms (elapsed = 400 < 500) -> not expired
            pipeline.on_window(make_window(480.0, 150.0))
            self.assertIsNotNone(pipeline.active_mitigation)
            mock_rollback.assert_not_called()

            # Advance time past 500 ms ceiling (t = 600 ms, elapsed = 520 ms)
            pipeline.on_window(make_window(600.0, 150.0))
            mock_rollback.assert_called_once()
            self.assertIsNone(pipeline.active_mitigation)

        expired_records = [r for r in self.store.records if r["type"] == "mitigation_expired"]
        self.assertEqual(len(expired_records), 1)
        self.assertEqual(expired_records[0]["source_ip"], "10.200.1.2")

    # -------------------------------------------------------------------------
    # 9. Rollback failure remaining visible and recorded
    # -------------------------------------------------------------------------
    def test_rollback_failure_recorded_and_propagated(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        with (
            patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]),
            patch.object(ctrl, "rollback", side_effect=TcOwnershipError("Cannot verify child filter ownership")),
        ):
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=False, controller=ctrl)
            prime_baseline(pipeline)

            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))

            # Quiet window triggers burst_ended -> rollback fails
            with self.assertRaisesRegex(TcOwnershipError, "Cannot verify child filter ownership"):
                for idx in range(3):
                    pipeline.on_window(make_window(90.0 + idx * 10.0, 10.0))

        failed_records = [r for r in self.store.records if r["type"] == "rollback_failed"]
        self.assertEqual(len(failed_records), 1)
        self.assertIn("Cannot verify child filter ownership", failed_records[0]["outcome"])

        mit_emits = [m for m in self.emitted if m["kind"] == "mitigation" and m["status"] == "rollback_failed"]
        self.assertEqual(len(mit_emits), 1)

        self.assertIsNotNone(pipeline.active_mitigation)
        self.assertTrue(pipeline.active_mitigation.unresolved)
        self.assertEqual(pipeline.active_mitigation.source_ip, "10.200.1.2")

    # -------------------------------------------------------------------------
    # 10. Safe shutdown cleans up active rules and records status
    # -------------------------------------------------------------------------
    def test_shutdown_cleans_up_active_mitigation(self) -> None:
        ctrl = TcController(interface="test0", dry_run=True)
        with patch.object(ctrl, "rollback") as mock_rollback:
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=True, controller=ctrl)
            prime_baseline(pipeline)

            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))
            self.assertIsNotNone(pipeline.active_mitigation)

            # Operator stops capture or session terminates
            pipeline.close()

            mock_rollback.assert_called_once()
            self.assertIsNone(pipeline.active_mitigation)

        cleaned_records = [r for r in self.store.records if r["type"] == "mitigation_cleaned_up"]
        self.assertEqual(len(cleaned_records), 1)
        stopped_records = [r for r in self.store.records if r["type"] == "monitoring_stopped"]
        self.assertEqual(len(stopped_records), 1)

    # -------------------------------------------------------------------------
    # 11. Shutdown cleanup failure remaining visible and recorded
    # -------------------------------------------------------------------------
    def test_shutdown_cleanup_failure_recorded_and_raised(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        with (
            patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]),
            patch.object(ctrl, "rollback", side_effect=TcError("Shutdown cleanup error")),
        ):
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=False, controller=ctrl)
            prime_baseline(pipeline)

            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))

            with self.assertRaisesRegex(TcError, "Shutdown cleanup error"):
                pipeline.close()

        cleanup_fail_records = [r for r in self.store.records if r["type"] == "cleanup_failed"]
        self.assertEqual(len(cleanup_fail_records), 1)
        self.assertEqual(cleanup_fail_records[0]["outcome"], "Shutdown cleanup error")

    # -------------------------------------------------------------------------
    # 12. Host default route refusal in cmd_capture
    # -------------------------------------------------------------------------
    def test_host_default_interface_refuses_live_mitigation(self) -> None:
        cfg = RuntimeConfig()
        cfg.dry_run = True
        args = argparse.Namespace(
            interface="eth0",
            duration=1.0,
            mitigate=True,
            apply=True,  # requesting live modification
            namespace=None,
        )

        ctrl = TcController(interface="eth0", dry_run=False)
        with patch.object(ctrl, "default_route_interface", return_value="eth0"):
            with self.assertRaisesRegex(TcError, "refusing to shape the default-route interface 'eth0'"):
                cmd_capture(args, cfg, controller=ctrl)

    # -------------------------------------------------------------------------
    # 13. End-to-end cmd_capture test with synthetic traffic flow
    # -------------------------------------------------------------------------
    def test_end_to_end_cmd_capture_dry_run_execution(self) -> None:
        cfg = RuntimeConfig()
        cfg.dry_run = True
        cfg.mitigation.auto_enabled = False

        args = argparse.Namespace(
            interface="test0",
            duration=1.0,
            mitigate=True,  # enabled via flag
            apply=False,    # dry-run
            namespace=None,
        )

        def fake_capture(**kwargs) -> None:
            on_window = kwargs["on_window"]
            # Baseline
            for idx in range(3):
                on_window(make_window((idx + 1) * 10.0, 10.0))
            # Burst
            for idx in range(3):
                on_window(make_window(40.0 + idx * 10.0, 150.0))
            # Recovery (needs >= recovery_windows=10)
            for idx in range(12):
                on_window(make_window(70.0 + idx * 10.0, 10.0))

        output = io.StringIO()
        with (
            patch("capture.capture", side_effect=fake_capture),
            redirect_stdout(output),
        ):
            code = cmd_capture(args, cfg, store=self.store)

        self.assertEqual(code, 0)
        types = [r["type"] for r in self.store.records]
        self.assertIn("burst_detected", types)
        self.assertIn("mitigation_simulated", types)
        self.assertIn("burst_ended", types)
        self.assertIn("mitigation_removed", types)
        self.assertIn("monitoring_stopped", types)

    # -------------------------------------------------------------------------
    # 14. Mitigation expiry when traffic becomes idle (P0)
    # -------------------------------------------------------------------------
    def test_idle_traffic_triggers_wall_clock_timeout_and_rollback(self) -> None:
        ctrl = TcController(interface="test0", dry_run=True)
        with patch.object(ctrl, "rollback") as mock_rollback:
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=True, max_duration_ms=50, controller=ctrl)
            prime_baseline(pipeline)

            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))
            self.assertIsNotNone(pipeline.active_mitigation)
            mock_rollback.assert_not_called()

            # Zero packets arrive (idle traffic). Wait for wall-clock timer to fire
            time.sleep(0.15)

            self.assertIsNone(pipeline.active_mitigation)
            mock_rollback.assert_called_once()

            expired_records = [r for r in self.store.records if r["type"] == "mitigation_expired"]
            self.assertEqual(len(expired_records), 1)
            self.assertEqual(expired_records[0]["source_ip"], "10.200.1.2")

            removed_records = [r for r in self.store.records if r["type"] == "mitigation_removed"]
            self.assertEqual(len(removed_records), 1)
            self.assertIn("max_duration_expired", removed_records[0]["outcome"])

            pipeline.close()

    def test_idle_traffic_timeout_rollback_failure_recorded_accurately(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        with (
            patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]),
            patch.object(ctrl, "rollback", side_effect=TcError("RTNETLINK error on rollback")),
        ):
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=False, max_duration_ms=50, controller=ctrl)
            prime_baseline(pipeline)

            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))
            self.assertIsNotNone(pipeline.active_mitigation)

            # Wait for wall-clock timer
            time.sleep(0.15)

            # Active mitigation must NOT be cleared; must be preserved in unresolved state
            self.assertIsNotNone(pipeline.active_mitigation)
            self.assertTrue(pipeline.active_mitigation.unresolved)
            self.assertIn("RTNETLINK error on rollback", pipeline.active_mitigation.unresolved_reason or "")

            # Rollback failed must be recorded
            rollback_failed = [r for r in self.store.records if r["type"] == "rollback_failed"]
            self.assertEqual(len(rollback_failed), 1)
            self.assertIn("RTNETLINK error on rollback", rollback_failed[0]["outcome"])

            # mitigation_removed must NOT be recorded
            removed = [r for r in self.store.records if r["type"] == "mitigation_removed"]
            self.assertEqual(len(removed), 0)

            # Shutdown respects unresolved state and attempts cleanup, re-raising failure
            with self.assertRaises(TcError):
                pipeline.close()

            # Repeated shutdown is safe and preserves unresolved failure state
            pipeline.close()
            self.assertIsNotNone(pipeline.active_mitigation)
            self.assertTrue(pipeline.active_mitigation.unresolved)

    # -------------------------------------------------------------------------
    # 15. Same-source duplicate and conflicting concurrent source mitigations (P0)
    # -------------------------------------------------------------------------
    def test_same_source_duplicate_mitigation_emits_already_active(self) -> None:
        ctrl = TcController(interface="test0", dry_run=True)
        with patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]) as mock_apply:
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=True, controller=ctrl)
            prime_baseline(pipeline)

            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0, source_ip="10.200.1.2"))
            self.assertEqual(mock_apply.call_count, 1)

            dup_event = BurstEvent(
                started_at_ms=100.0,
                ended_at_ms=None,
                peak_mbps=150.0,
                baseline_mbps=10.0,
                threshold_mbps=80.0,
                source_ip="10.200.1.2",
                contribution_pct=95.0,
                severity="severe",
                detection_delay_ms=20.0,
            )
            pipeline.on_event("burst_detected", dup_event)

            self.assertEqual(mock_apply.call_count, 1)

            already_active_emits = [
                m for m in self.emitted if m["kind"] == "mitigation" and m["status"] == "already_active"
            ]
            self.assertEqual(len(already_active_emits), 1)
            self.assertEqual(already_active_emits[0]["source_ip"], "10.200.1.2")
            pipeline.close()

    def test_conflicting_concurrent_source_mitigation_rejected_as_busy(self) -> None:
        ctrl = TcController(interface="test0", dry_run=True)
        with patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]) as mock_apply:
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=True, controller=ctrl)
            prime_baseline(pipeline)

            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0, source_ip="10.200.1.2"))
            self.assertEqual(mock_apply.call_count, 1)
            self.assertEqual(pipeline.active_mitigation.source_ip, "10.200.1.2")

            conflict_event = BurstEvent(
                started_at_ms=120.0,
                ended_at_ms=None,
                peak_mbps=160.0,
                baseline_mbps=10.0,
                threshold_mbps=80.0,
                source_ip="10.200.1.99",
                contribution_pct=95.0,
                severity="severe",
                detection_delay_ms=20.0,
            )
            pipeline.on_event("burst_detected", conflict_event)

            self.assertEqual(mock_apply.call_count, 1)
            self.assertEqual(pipeline.active_mitigation.source_ip, "10.200.1.2")

            busy_emits = [
                m for m in self.emitted if m["kind"] == "mitigation" and m["status"] == "busy"
            ]
            self.assertEqual(len(busy_emits), 1)
            self.assertEqual(busy_emits[0]["action"], "rejected")
            self.assertEqual(busy_emits[0]["source_ip"], "10.200.1.99")
            self.assertEqual(busy_emits[0]["active_source_ip"], "10.200.1.2")

            rejected_records = [
                r for r in self.store.records
                if r["type"] == "mitigation_failed" and r.get("source_ip") == "10.200.1.99"
            ]
            self.assertEqual(len(rejected_records), 1)
            self.assertIn("class 1:10 occupied", rejected_records[0]["outcome"])

            pipeline.close()

    # -------------------------------------------------------------------------
    # 16. CLI authorization and MBH_DRY_RUN handling (P0)
    # -------------------------------------------------------------------------
    def test_mbh_dry_run_zero_without_apply_flag_remains_dry_run(self) -> None:
        with patch.dict(os.environ, {"MBH_DRY_RUN": "0"}):
            cfg = RuntimeConfig()
            cfg.dry_run = False

            args = argparse.Namespace(
                interface="test0",
                duration=1.0,
                mitigate=True,
                apply=False,
                namespace=None,
            )

            ctrl = TcController(interface="test0", dry_run=False)
            with (
                patch("capture.capture"),
                patch.object(ctrl, "assert_safe_interface") as mock_assert,
            ):
                code = cmd_capture(args, cfg, controller=ctrl, store=self.store)

            self.assertEqual(code, 0)
            self.assertTrue(cfg.dry_run)
            self.assertTrue(ctrl.dry_run)
            mock_assert.assert_not_called()

    def test_explicit_apply_flag_enables_live_mutation(self) -> None:
        cfg = RuntimeConfig()
        cfg.dry_run = True

        args = argparse.Namespace(
            interface="test0",
            duration=1.0,
            mitigate=True,
            apply=True,
            namespace=None,
        )

        ctrl = TcController(interface="test0", dry_run=True)
        with (
            patch("capture.capture"),
            patch.object(ctrl, "assert_safe_interface") as mock_assert,
        ):
            code = cmd_capture(args, cfg, controller=ctrl, store=self.store)

        self.assertEqual(code, 0)
        self.assertFalse(cfg.dry_run)
        self.assertFalse(ctrl.dry_run)
        mock_assert.assert_called_once()

    # -------------------------------------------------------------------------
    # 17. Store closure and cleanup when rollback raises (P1)
    # -------------------------------------------------------------------------
    def test_store_closure_guaranteed_when_rollback_raises(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        with (
            patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]),
            patch.object(ctrl, "rollback", side_effect=TcError("catastrophic rollback failure")),
        ):
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=False, controller=ctrl)
            prime_baseline(pipeline)
            for idx in range(3):
                pipeline.on_window(make_window(60.0 + idx * 10.0, 150.0))

            self.assertFalse(self.store.closed)

            with self.assertRaisesRegex(TcError, "catastrophic rollback failure"):
                pipeline.close()

            self.assertTrue(self.store.closed)
            self.assertIsNotNone(pipeline.active_mitigation)
            self.assertTrue(pipeline.active_mitigation.unresolved)
            self.assertEqual(pipeline.active_mitigation.unresolved_reason, "catastrophic rollback failure")

            # Repeated close is safe and does not hide unresolved cleanup failure
            pipeline.close()
            self.assertIsNotNone(pipeline.active_mitigation)
            self.assertTrue(pipeline.active_mitigation.unresolved)

    # -------------------------------------------------------------------------
    # 18. Route-query failure fail-closed semantics (P1)
    # -------------------------------------------------------------------------
    def test_route_query_nonzero_exit_code_fails_closed(self) -> None:
        ctrl = TcController(interface="veth0", dry_run=False)
        mock_res = MagicMock(returncode=1, stdout="", stderr="RTNETLINK answers: Operation not permitted")
        with patch("subprocess.run", return_value=mock_res):
            with self.assertRaisesRegex(TcError, "cannot verify safety"):
                ctrl.assert_safe_interface()

    def test_route_query_empty_output_fails_closed(self) -> None:
        ctrl = TcController(interface="veth0", dry_run=False)
        mock_res = MagicMock(returncode=0, stdout="", stderr="")
        with patch("subprocess.run", return_value=mock_res):
            with self.assertRaisesRegex(TcError, "cannot verify safety: Route inspection produced empty output"):
                ctrl.assert_safe_interface()

    def test_route_query_unparseable_output_fails_closed(self) -> None:
        ctrl = TcController(interface="veth0", dry_run=False)
        mock_res = MagicMock(returncode=0, stdout="invalid route syntax without dev\n", stderr="")
        with patch("subprocess.run", return_value=mock_res):
            with self.assertRaisesRegex(TcError, "cannot verify safety: Unparseable default route output"):
                ctrl.assert_safe_interface()

    def test_route_query_tool_not_found_fails_closed(self) -> None:
        ctrl = TcController(interface="veth0", dry_run=False)
        with patch("subprocess.run", side_effect=FileNotFoundError("ip binary missing")):
            with self.assertRaisesRegex(TcError, "Route inspection tool 'ip' not found"):
                ctrl.assert_safe_interface()

    def test_assert_safe_interface_forbids_eth0_and_lo(self) -> None:
        ctrl_eth0 = TcController(interface="eth0", dry_run=False)
        mock_res = MagicMock(returncode=0, stdout="default via 192.168.1.1 dev eth1\n", stderr="")
        with patch("subprocess.run", return_value=mock_res):
            with self.assertRaisesRegex(TcError, "refusing to shape 'eth0'; shaping eth0 or loopback is forbidden"):
                ctrl_eth0.assert_safe_interface()

        ctrl_lo = TcController(interface="lo", dry_run=False)
        with patch("subprocess.run", return_value=mock_res):
            with self.assertRaisesRegex(TcError, "refusing to shape 'lo'; shaping eth0 or loopback is forbidden"):
                ctrl_lo.assert_safe_interface()

    def test_host_route_query_valid_default_route_passes_for_non_default_interface(self) -> None:
        ctrl = TcController(interface="veth0", dry_run=False)
        mock_res = MagicMock(returncode=0, stdout="default via 192.168.1.1 dev eth0\n", stderr="")
        with patch("subprocess.run", return_value=mock_res):
            self.assertEqual(ctrl.default_route_interface(), "eth0")
            # Must succeed because veth0 != eth0
            ctrl.assert_safe_interface()

    def test_host_route_query_matching_interface_rejected(self) -> None:
        ctrl = TcController(interface="eth1", dry_run=False)
        mock_res = MagicMock(returncode=0, stdout="default via 192.168.1.1 dev eth1\n", stderr="")
        with patch("subprocess.run", return_value=mock_res):
            self.assertEqual(ctrl.default_route_interface(), "eth1")
            with self.assertRaisesRegex(TcError, "refusing to shape the default-route interface 'eth1'"):
                ctrl.assert_safe_interface()

    def test_verified_isolated_namespace_empty_route_output_succeeds(self) -> None:
        ctrl = TcController(interface="veth_peer", namespace="mbh_ns_test", dry_run=False)
        mock_res = MagicMock(returncode=0, stdout="", stderr="")
        with patch("subprocess.run", return_value=mock_res) as mock_run:
            self.assertIsNone(ctrl.default_route_interface())
            ctrl.assert_safe_interface()
            mock_run.assert_called_with(
                ["ip", "netns", "exec", "mbh_ns_test", "ip", "route", "show", "default"],
                capture_output=True,
                text=True,
                check=False,
                timeout=5.0,
            )

    def test_isolated_namespace_default_route_matching_interface_rejected(self) -> None:
        ctrl = TcController(interface="veth_peer", namespace="mbh_ns_test", dry_run=False)
        mock_res = MagicMock(returncode=0, stdout="default via 10.200.1.1 dev veth_peer\n", stderr="")
        with patch("subprocess.run", return_value=mock_res):
            self.assertEqual(ctrl.default_route_interface(), "veth_peer")
            with self.assertRaisesRegex(TcError, "refusing to shape the default-route interface 'veth_peer'"):
                ctrl.assert_safe_interface()

    def test_namespace_route_query_command_failure_fails_closed(self) -> None:
        ctrl = TcController(interface="veth_peer", namespace="missing_ns", dry_run=False)
        mock_res = MagicMock(
            returncode=1,
            stdout="",
            stderr="Cannot open network namespace 'missing_ns': No such file or directory",
        )
        with patch("subprocess.run", return_value=mock_res):
            with self.assertRaisesRegex(TcError, "cannot verify safety: Route inspection failed with return code 1"):
                ctrl.assert_safe_interface()

    def test_namespace_route_query_timeout_fails_closed(self) -> None:
        ctrl = TcController(interface="veth_peer", namespace="mbh_ns_test", dry_run=False)
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["ip"], timeout=5.0)):
            with self.assertRaisesRegex(TcError, "Route inspection command timed out after 5.0s"):
                ctrl.assert_safe_interface()

    def test_namespace_command_construction_and_interface_scoping(self) -> None:
        ctrl = TcController(interface="veth_peer", namespace="mbh_ns_test", dry_run=True)
        # Check command construction for plan
        cmds = ctrl.plan_source_cap("10.200.1.2", 35.0, handle=1, parent_class="1:1")
        self.assertEqual(len(cmds), 2)
        self.assertIn("dev veth_peer", cmds[0])
        self.assertIn("parent 1:1 classid 1:10", cmds[0])
        self.assertIn("dev veth_peer", cmds[1])
        self.assertIn("src_ip 10.200.1.2 flowid 1:10", cmds[1])

        # Check _run command prefixing
        with patch("subprocess.run", return_value=MagicMock(returncode=0, stdout="", stderr="")) as mock_run:
            ctrl._run(["qdisc", "show", "dev", "veth_peer"], readonly=True)
            mock_run.assert_called_once_with(
                ["ip", "netns", "exec", "mbh_ns_test", "tc", "qdisc", "show", "dev", "veth_peer"],
                capture_output=True,
                text=True,
                check=False,
            )

    def test_isolated_namespace_forbids_eth0_and_lo_even_with_namespace(self) -> None:
        mock_res = MagicMock(returncode=0, stdout="", stderr="")
        with patch("subprocess.run", return_value=mock_res):
            ctrl_eth0 = TcController(interface="eth0", namespace="mbh_ns_test", dry_run=False)
            with self.assertRaisesRegex(TcError, "refusing to shape 'eth0'; shaping eth0 or loopback is forbidden"):
                ctrl_eth0.assert_safe_interface()

            ctrl_lo = TcController(interface="lo", namespace="mbh_ns_test", dry_run=False)
            with self.assertRaisesRegex(TcError, "refusing to shape 'lo'; shaping eth0 or loopback is forbidden"):
                ctrl_lo.assert_safe_interface()

    # -------------------------------------------------------------------------
    # 19. Network namespace mismatch rejection (P1)
    # -------------------------------------------------------------------------
    def test_cmd_capture_rejects_unsupported_namespace(self) -> None:
        cfg = RuntimeConfig()
        args = argparse.Namespace(
            interface="veth0",
            duration=1.0,
            mitigate=True,
            apply=False,
            namespace="isolated_ns",
        )
        err_output = io.StringIO()
        with redirect_stderr(err_output):
            code = cmd_capture(args, cfg, store=self.store)

        self.assertEqual(code, 2)
        err_text = err_output.getvalue()
        self.assertIn("network namespace capture is not supported", err_text)

    # -------------------------------------------------------------------------
    # 20. HTB parent/class hierarchy alignment
    # -------------------------------------------------------------------------
    def test_htb_hierarchy_supports_explicit_parent_class(self) -> None:
        ctrl = TcController(interface="test0", dry_run=True)
        default_cmds = ctrl.plan_source_cap("10.200.1.2", 35.0, handle=1)
        self.assertIn("parent 1: classid 1:10", default_cmds[0])

        hier_cmds = ctrl.plan_source_cap("10.200.1.2", 35.0, handle=1, parent_class="1:1")
        self.assertIn("parent 1:1 classid 1:10", hier_cmds[0])
        self.assertIn("filter add dev test0 protocol ip parent 1:0 prio 1 flower src_ip 10.200.1.2 flowid 1:10", hier_cmds[1])

        applied_cmds = ctrl.apply_source_cap("10.200.1.2", 35.0, handle=1, parent_class="1:1")
        self.assertEqual(applied_cmds, hier_cmds)

    # -------------------------------------------------------------------------
    # 21. Rollback failure retains unresolved state and blocks subsequent burst caps (Phase 4.25 P0)
    # -------------------------------------------------------------------------
    def test_rollback_failure_retains_unresolved_state_and_rejects_subsequent_bursts(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        with (
            patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]) as mock_apply,
            patch.object(ctrl, "rollback") as mock_rollback,
        ):
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=False, controller=ctrl)

            # 1. Trigger burst on source 1 (10.200.1.2)
            event_s1 = BurstEvent(
                started_at_ms=60.0,
                ended_at_ms=None,
                peak_mbps=150.0,
                baseline_mbps=10.0,
                threshold_mbps=80.0,
                source_ip="10.200.1.2",
                contribution_pct=95.0,
                severity="severe",
                detection_delay_ms=20.0,
            )
            pipeline.on_event("burst_detected", event_s1)
            self.assertEqual(mock_apply.call_count, 1)
            self.assertIsNotNone(pipeline.active_mitigation)
            self.assertEqual(pipeline.active_mitigation.source_ip, "10.200.1.2")
            self.assertFalse(pipeline.active_mitigation.unresolved)

            # 2. Simulate rollback failure on recovery
            mock_rollback.side_effect = TcError("RTNETLINK error on rollback")
            recovery_event = BurstEvent(
                started_at_ms=60.0,
                ended_at_ms=90.0,
                peak_mbps=150.0,
                baseline_mbps=10.0,
                threshold_mbps=80.0,
                source_ip="10.200.1.2",
                contribution_pct=95.0,
                severity="none",
                detection_delay_ms=20.0,
            )
            with self.assertRaises(TcError):
                pipeline.on_event("burst_ended", recovery_event)

            # Rollback failed must be recorded and active_mitigation must retain unresolved state
            self.assertIsNotNone(pipeline.active_mitigation)
            self.assertTrue(pipeline.active_mitigation.unresolved)
            self.assertEqual(pipeline.active_mitigation.source_ip, "10.200.1.2")
            self.assertIn("RTNETLINK error on rollback", pipeline.active_mitigation.unresolved_reason or "")

            rollback_failed = [r for r in self.store.records if r["type"] == "rollback_failed"]
            self.assertEqual(len(rollback_failed), 1)

            # 3. Subsequent burst from different source (10.200.1.3) must be rejected
            event_s2 = BurstEvent(
                started_at_ms=120.0,
                ended_at_ms=None,
                peak_mbps=160.0,
                baseline_mbps=10.0,
                threshold_mbps=80.0,
                source_ip="10.200.1.3",
                contribution_pct=95.0,
                severity="severe",
                detection_delay_ms=20.0,
            )
            pipeline.on_event("burst_detected", event_s2)

            # No second cap applied! mock_apply must still be 1
            self.assertEqual(mock_apply.call_count, 1)

            # Rejection must be recorded and emitted with busy / unresolved status
            busy_emits = [
                e for e in self.emitted
                if e["kind"] == "mitigation" and e.get("status") == "busy" and e.get("unresolved") is True
            ]
            self.assertGreaterEqual(len(busy_emits), 1)
            self.assertEqual(busy_emits[-1]["source_ip"], "10.200.1.3")
            self.assertEqual(busy_emits[-1]["active_source_ip"], "10.200.1.2")

            mit_failed = [r for r in self.store.records if r["type"] == "mitigation_failed"]
            self.assertGreaterEqual(len(mit_failed), 1)
            self.assertIn("class 1:10 occupied by unresolved failed rollback", mit_failed[-1]["outcome"])

            # 4. Successful remediation clears unresolved state
            mock_rollback.side_effect = None
            mock_rollback.return_value = None
            pipeline._rollback_mitigation(source_ip="10.200.1.2", reason="manual_remediation")
            self.assertIsNone(pipeline.active_mitigation)

            # 5. Subsequent burst from different source can now be applied safely
            pipeline.on_event("burst_detected", event_s2)
            self.assertEqual(mock_apply.call_count, 2)
            self.assertIsNotNone(pipeline.active_mitigation)
            self.assertEqual(pipeline.active_mitigation.source_ip, "10.200.1.3")
            self.assertFalse(pipeline.active_mitigation.unresolved)

            pipeline.close()

    # -------------------------------------------------------------------------
    # 22. Stale timer cannot expire newer mitigation (Phase 4.25 P0)
    # -------------------------------------------------------------------------
    def test_stale_timer_from_m1_cannot_expire_newer_mitigation_m2(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        with (
            patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]) as mock_apply,
            patch.object(ctrl, "rollback") as mock_rollback,
        ):
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=False, max_duration_ms=8000, controller=ctrl)

            # Trigger M1 on source 1 (10.200.1.2)
            event_m1 = BurstEvent(
                started_at_ms=60.0,
                ended_at_ms=None,
                peak_mbps=150.0,
                baseline_mbps=10.0,
                threshold_mbps=80.0,
                source_ip="10.200.1.2",
                contribution_pct=95.0,
                severity="severe",
                detection_delay_ms=20.0,
            )
            pipeline.on_event("burst_detected", event_m1)
            self.assertEqual(mock_apply.call_count, 1)
            self.assertIsNotNone(pipeline.active_mitigation)
            self.assertEqual(pipeline.active_mitigation.source_ip, "10.200.1.2")
            gen_m1 = pipeline._timer_generation
            self.assertGreater(gen_m1, 0)

            # Cleanly roll back M1
            pipeline._rollback_mitigation(source_ip="10.200.1.2", reason="traffic_recovered")
            self.assertIsNone(pipeline.active_mitigation)
            self.assertEqual(mock_rollback.call_count, 1)

            # Trigger M2 on source 2 (10.200.1.3)
            event_m2 = BurstEvent(
                started_at_ms=100.0,
                ended_at_ms=None,
                peak_mbps=150.0,
                baseline_mbps=10.0,
                threshold_mbps=80.0,
                source_ip="10.200.1.3",
                contribution_pct=95.0,
                severity="severe",
                detection_delay_ms=20.0,
            )
            pipeline.on_event("burst_detected", event_m2)
            self.assertEqual(mock_apply.call_count, 2)
            self.assertIsNotNone(pipeline.active_mitigation)
            self.assertEqual(pipeline.active_mitigation.source_ip, "10.200.1.3")
            gen_m2 = pipeline._timer_generation
            self.assertGreater(gen_m2, gen_m1)

            # Simulate stale timer from M1 firing now
            pipeline._on_timeout_alarm(generation=gen_m1)

            # M2 must remain active! Stale timer must NOT expire M2!
            self.assertIsNotNone(pipeline.active_mitigation)
            self.assertEqual(pipeline.active_mitigation.source_ip, "10.200.1.3")
            self.assertEqual(mock_rollback.call_count, 1)  # Still only 1 from M1 recovery

            # Normal timeout: when M2's own duration expires and its generation fires
            pipeline.active_mitigation.wall_start_time = time.monotonic() - 10.0  # 10s > 8s ceiling
            pipeline._on_timeout_alarm(generation=gen_m2)

            # Now M2 must be expired and rolled back
            self.assertIsNone(pipeline.active_mitigation)
            self.assertEqual(mock_rollback.call_count, 2)
            expired_records = [
                r for r in self.store.records
                if r["type"] == "mitigation_expired" and r["source_ip"] == "10.200.1.3"
            ]
            self.assertEqual(len(expired_records), 1)

            pipeline.close()

    # -------------------------------------------------------------------------
    # 23. Premature timer callback rejected when monotonic duration not elapsed (Phase 4.25 P0)
    # -------------------------------------------------------------------------
    def test_premature_timeout_callback_rejected_when_duration_not_elapsed(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        with (
            patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]) as mock_apply,
            patch.object(ctrl, "rollback") as mock_rollback,
        ):
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=False, max_duration_ms=8000, controller=ctrl)

            event = BurstEvent(
                started_at_ms=60.0,
                ended_at_ms=None,
                peak_mbps=150.0,
                baseline_mbps=10.0,
                threshold_mbps=80.0,
                source_ip="10.200.1.2",
                contribution_pct=95.0,
                severity="severe",
                detection_delay_ms=20.0,
            )
            pipeline.on_event("burst_detected", event)
            self.assertIsNotNone(pipeline.active_mitigation)
            current_gen = pipeline._timer_generation

            # Invoke alarm prematurely (elapsed time is nearly 0 ms < 8000 ms ceiling)
            pipeline._on_timeout_alarm(generation=current_gen)

            # Mitigation must remain active; rollback not called
            self.assertIsNotNone(pipeline.active_mitigation)
            mock_rollback.assert_not_called()

            # Advance wall_start_time past ceiling
            pipeline.active_mitigation.wall_start_time = time.monotonic() - 9.0
            pipeline._on_timeout_alarm(generation=current_gen)

            # Now mitigation must expire
            self.assertIsNone(pipeline.active_mitigation)
            mock_rollback.assert_called_once()

            pipeline.close()

    # -------------------------------------------------------------------------
    # 24. Cancelled timer callback that was in-flight is rejected (Phase 4.25 P0)
    # -------------------------------------------------------------------------
    def test_cancelled_timer_callback_rejected(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        with (
            patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]),
            patch.object(ctrl, "rollback") as mock_rollback,
        ):
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=False, max_duration_ms=8000, controller=ctrl)

            event = BurstEvent(
                started_at_ms=60.0,
                ended_at_ms=None,
                peak_mbps=150.0,
                baseline_mbps=10.0,
                threshold_mbps=80.0,
                source_ip="10.200.1.2",
                contribution_pct=95.0,
                severity="severe",
                detection_delay_ms=20.0,
            )
            pipeline.on_event("burst_detected", event)
            self.assertIsNotNone(pipeline.active_mitigation)
            saved_gen = pipeline._timer_generation

            # Cancel timer explicitly
            pipeline._cancel_timeout_timer()
            self.assertIsNone(pipeline._timeout_timer)
            self.assertGreater(pipeline._timer_generation, saved_gen)

            # Simulate in-flight callback trying to execute
            pipeline._on_timeout_alarm(generation=saved_gen)

            # Controller rollback not called from the cancelled alarm
            mock_rollback.assert_not_called()
            self.assertIsNotNone(pipeline.active_mitigation)

            pipeline.close()

    # -------------------------------------------------------------------------
    # 25. Event store persistence failure during rollback and shutdown (Workstream C)
    # -------------------------------------------------------------------------
    def test_store_record_failure_during_rollback_and_shutdown(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        with (
            patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]),
            patch.object(ctrl, "rollback") as mock_rollback,
        ):
            pipeline = self.make_pipeline(auto_mitigate=True, dry_run=False, controller=ctrl)
            event = BurstEvent(
                started_at_ms=60.0,
                ended_at_ms=None,
                peak_mbps=150.0,
                baseline_mbps=10.0,
                threshold_mbps=80.0,
                source_ip="10.200.1.2",
                contribution_pct=95.0,
                severity="severe",
                detection_delay_ms=20.0,
            )
            pipeline.on_event("burst_detected", event)
            self.assertIsNotNone(pipeline.active_mitigation)

            # Make store.record raise an exception
            with patch.object(self.store, "record", side_effect=RuntimeError("disk full / sqlite write error")):
                # Rollback should still successfully execute and clear active_mitigation
                pipeline._rollback_mitigation(source_ip="10.200.1.2", reason="traffic_recovered")
                mock_rollback.assert_called_once()
                self.assertIsNone(pipeline.active_mitigation)

                # Shutdown should still successfully close the store
                pipeline.close()
                self.assertTrue(self.store.closed)

    # -------------------------------------------------------------------------
    # 26. Partial application leaves owned resources tracked for safe rollback (Workstream C)
    # -------------------------------------------------------------------------
    def test_partial_application_in_controller_leaves_owned_resources_for_rollback(self) -> None:
        ctrl = TcController(interface="test0", dry_run=False)
        with patch.object(ctrl, "assert_safe_interface"):
            with patch.object(ctrl, "verify_parent_hierarchy"):
                call_count = [0]
                def fake_run(args, readonly=False):
                    call_count[0] += 1
                    if call_count[0] == 2:
                        raise TcError("Filter creation failed in kernel")
                    return ""

                with patch.object(ctrl, "_run", side_effect=fake_run):
                    with self.assertRaisesRegex(TcError, "partial application on test0"):
                        ctrl.apply_source_cap("10.200.1.2", 35.0, handle=1)

                self.assertEqual(len(ctrl.applied), 1)
                self.assertEqual(len(ctrl.owned_resources), 1)
                self.assertEqual(ctrl.owned_resources[0].kind, "class")
                self.assertEqual(ctrl.owned_resources[0].class_id, "1:10")


if __name__ == "__main__":
    unittest.main(verbosity=2)
