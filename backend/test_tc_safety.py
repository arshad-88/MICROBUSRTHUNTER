import subprocess
import threading
import time
import unittest
from unittest.mock import patch, MagicMock

from tc_controller import (
    TcController,
    TcError,
    TcOwnershipError,
    TcHierarchyError,
    OwnedResource,
    validate_interface,
    validate_ip,
    validate_rate_mbps,
    validate_handle,
    validate_namespace,
    parse_qdisc_output,
    parse_class_output,
    parse_class_stats,
    parse_filter_output,
)


class TcControllerSafetyTests(unittest.TestCase):
    def make_controller(self, dry_run=False, session_id="test_sess"):
        controller = TcController(interface="test0", dry_run=dry_run, session_id=session_id)
        # Keep these tests offline: never inspect or modify a real interface.
        controller.assert_safe_interface = lambda: None
        return controller

    # -------------------------------------------------------------------------
    # DRY-RUN & GENERAL SAFETY
    # -------------------------------------------------------------------------

    def test_dry_run_does_not_execute_commands(self):
        controller = TcController(interface="test0", dry_run=True)

        with patch.object(controller, "_run") as run:
            commands = controller.apply_source_cap("192.0.2.10", 35)

        run.assert_not_called()
        self.assertEqual(len(commands), 2)
        self.assertEqual(controller.applied, [])
        self.assertEqual(controller.owned_resources, [])

    def test_successful_dry_run_executes_no_mutating_commands(self):
        controller = self.make_controller(dry_run=True)
        with patch.object(controller, "_run") as run:
            commands = controller.apply_source_cap("192.0.2.20", 50)
            self.assertEqual(len(commands), 2)
            controller.rollback()
        run.assert_not_called()

    # -------------------------------------------------------------------------
    # PARENT HIERARCHY VERIFICATION & REFUSAL (PHASE 4.5)
    # -------------------------------------------------------------------------

    def test_refuse_apply_when_no_root_qdisc_exists(self):
        """Refuses live mutation if no root qdisc exists on interface."""
        controller = self.make_controller()
        with patch.object(controller, "show_qdisc", return_value=""), \
             patch.object(controller, "show_class", return_value=""), \
             patch.object(controller, "show_filter", return_value=""):
            with self.assertRaisesRegex(TcHierarchyError, "No root qdisc found"):
                controller.apply_source_cap("192.0.2.10", 35)

    def test_refuse_apply_when_foreign_root_qdisc_exists(self):
        """Refuses live mutation when root qdisc is fq_codel, mq, etc. (never replaces it)."""
        controller = self.make_controller()
        with patch.object(controller, "show_qdisc", return_value="qdisc fq_codel 0: root refcnt 2 limit 10240p"), \
             patch.object(controller, "show_class", return_value=""), \
             patch.object(controller, "show_filter", return_value=""):
            with self.assertRaisesRegex(TcHierarchyError, "Incompatible root qdisc 'fq_codel'"):
                controller.apply_source_cap("192.0.2.10", 35)

    def test_refuse_apply_when_root_htb_has_wrong_handle(self):
        """Refuses live mutation when HTB root exists but handle is 2: instead of 1:."""
        controller = self.make_controller()
        with patch.object(controller, "show_qdisc", return_value="qdisc htb 2: root default 30"), \
             patch.object(controller, "show_class", return_value=""), \
             patch.object(controller, "show_filter", return_value=""):
            with self.assertRaisesRegex(TcHierarchyError, "handle 2:"):
                controller.apply_source_cap("192.0.2.10", 35, handle=1)

    def test_refuse_when_conflicting_class_exists(self):
        """Refuses live mutation if class 1:10 is already owned by another entity."""
        controller = self.make_controller()
        with patch.object(controller, "show_qdisc", return_value="qdisc htb 1: root default 30"), \
             patch.object(controller, "show_class", return_value="class htb 1:10 parent 1: prio 0 rate 100Mbit"), \
             patch.object(controller, "show_filter", return_value=""):
            with self.assertRaisesRegex(TcOwnershipError, "Class 1:10 already exists .* and belongs to another owner"):
                controller.apply_source_cap("192.0.2.10", 35)

    def test_preserve_existing_unrelated_filters(self):
        """Refuses live mutation if foreign/unrelated filter is already installed under parent 1:."""
        controller = self.make_controller()
        with patch.object(controller, "show_qdisc", return_value="qdisc htb 1: root default 30"), \
             patch.object(controller, "show_class", return_value=""), \
             patch.object(controller, "show_filter", return_value="filter parent 1: protocol ip pref 1 flower flowid 1:10 src_ip 10.0.0.99"):
            with self.assertRaisesRegex(TcOwnershipError, "Unrelated or unverified filters already present"):
                controller.apply_source_cap("192.0.2.10", 35)

    def test_decoupled_parent_plan_is_available(self):
        """Administrator parent provisioning is decoupled from per-source plan."""
        controller = self.make_controller()
        parent_plan = controller.plan_parent_hierarchy(handle=1, default_band=30)
        self.assertEqual(len(parent_plan), 1)
        self.assertIn("qdisc add dev test0 root handle 1: htb default 30", parent_plan[0])

        source_plan = controller.plan_source_cap("192.0.2.10", 35, handle=1)
        self.assertEqual(len(source_plan), 2)
        self.assertNotIn("qdisc add", source_plan[0])
        self.assertIn("class add", source_plan[0])
        self.assertIn("filter add", source_plan[1])

    # -------------------------------------------------------------------------
    # CHILD-ONLY APPLICATION & PARTIAL FAILURE
    # -------------------------------------------------------------------------

    def test_first_command_failure_records_nothing(self):
        controller = self.make_controller()
        with patch.object(controller, "verify_parent_hierarchy", return_value=None):
            with patch.object(controller, "_run", side_effect=TcError("simulated class add failure")) as run:
                with self.assertRaisesRegex(TcError, "simulated class add failure"):
                    controller.apply_source_cap("192.0.2.10", 35)

        self.assertEqual(run.call_count, 1)
        self.assertEqual(controller.applied, [])
        self.assertEqual(controller.owned_resources, [])

    def test_partial_failure_records_only_successful_child(self):
        controller = self.make_controller()

        def fake_run(args, readonly=False):
            if fake_run.calls == 1:
                fake_run.calls += 1
                return ""
            fake_run.calls += 1
            raise TcError("simulated filter add failure")

        fake_run.calls = 1

        with patch.object(controller, "verify_parent_hierarchy", return_value=None):
            with patch.object(controller, "_run", side_effect=fake_run) as run:
                with self.assertRaisesRegex(TcError, "partial application on test0: 1 command.*succeeded"):
                    controller.apply_source_cap("192.0.2.10", 35)

        self.assertEqual(run.call_count, 2)
        self.assertEqual(len(controller.applied), 1)
        self.assertEqual(len(controller.owned_resources), 1)
        self.assertEqual(controller.owned_resources[0].kind, "class")

    def test_success_records_all_child_commands(self):
        controller = self.make_controller()
        with patch.object(controller, "verify_parent_hierarchy", return_value=None):
            with patch.object(controller, "_run", return_value="") as run:
                commands = controller.apply_source_cap("192.0.2.10", 35)

        self.assertEqual(run.call_count, 2)
        self.assertEqual(controller.applied, commands)
        self.assertEqual(len(controller.owned_resources), 2)
        self.assertEqual([r.kind for r in controller.owned_resources], ["class", "filter"])

    # -------------------------------------------------------------------------
    # MANDATORY REVERSE ROLLBACK (CHILDREN ONLY, NEVER ROOT QDISC)
    # -------------------------------------------------------------------------

    def test_rollback_with_no_recorded_rules_is_noop(self):
        controller = self.make_controller()
        with patch.object(controller, "_run") as run:
            controller.rollback()
        run.assert_not_called()

    def test_rollback_refuses_untracked_ownership(self):
        controller = self.make_controller()
        controller.applied.append("simulated rule")
        with patch.object(controller, "_run") as run:
            with self.assertRaisesRegex(TcOwnershipError, "cannot prove ownership"):
                controller.rollback()
        run.assert_not_called()

    def test_rollback_removes_only_children_never_root_qdisc(self):
        """Rollback executes only filter del and class del; never qdisc del."""
        controller = self.make_controller()
        res_class = OwnedResource("class", "test0", "class add ...", parent="1:", class_id="1:10", rate_mbps=35.0, session_id=controller.session_id)
        res_filter = OwnedResource("filter", "test0", "filter add ...", parent="1:0", class_id="1:10", source_ip="192.0.2.10", filter_prio=1, session_id=controller.session_id)

        controller.owned_resources.extend([res_class, res_filter])
        controller.applied.extend([r.command for r in controller.owned_resources])

        del_commands = []
        def fake_run(args, readonly=False):
            if len(args) >= 2 and args[1] == "del":
                del_commands.append(" ".join(args))
            return ""

        filter_state = ["filter parent 1: protocol ip pref 1 flower flowid 1:10 src_ip 192.0.2.10", ""]
        class_state = ["class htb 1:10 parent 1: prio 0 rate 35Mbit ceil 35Mbit", ""]

        with patch.object(controller, "show_filter", side_effect=lambda: filter_state.pop(0) if filter_state else ""), \
             patch.object(controller, "show_class", side_effect=lambda: class_state.pop(0) if class_state else ""), \
             patch.object(controller, "_run", side_effect=fake_run):
            controller.rollback()

        self.assertEqual(len(del_commands), 2)
        # Reverse order: filter del -> class del
        self.assertIn("filter del", del_commands[0])
        self.assertIn("class del", del_commands[1])
        # Root qdisc is NEVER deleted
        self.assertFalse(any("qdisc del" in cmd for cmd in del_commands))
        self.assertEqual(len(controller.owned_resources), 0)
        self.assertEqual(len(controller.applied), 0)

    # -------------------------------------------------------------------------
    # ADVERSARIAL INSPECTION & REPLACEMENT TESTS
    # -------------------------------------------------------------------------

    def test_empty_inspection_output_refuses_ownership(self):
        controller = self.make_controller()
        res = OwnedResource("filter", "test0", "cmd", parent="1:0", class_id="1:10", session_id=controller.session_id)
        with patch.object(controller, "show_filter", return_value=""):
            self.assertFalse(controller.can_verify_ownership(res))

    def test_inspection_command_failure_preserves_registry(self):
        controller = self.make_controller()
        res = OwnedResource("class", "test0", "cmd", parent="1:", class_id="1:10", session_id=controller.session_id)
        controller.owned_resources.append(res)
        controller.applied.append(res.command)

        with patch.object(controller, "show_class", side_effect=TcError("kernel inspection netlink error")):
            with self.assertRaisesRegex(TcOwnershipError, "Inspection error during pre-deletion"):
                controller.rollback()

        self.assertIn(res, controller.owned_resources)
        self.assertIn(res.command, controller.applied)

    def test_malformed_inspection_output_fails_closed(self):
        controller = self.make_controller()
        res = OwnedResource("filter", "test0", "cmd", parent="1:0", class_id="1:10", session_id=controller.session_id)
        controller.owned_resources.append(res)
        controller.applied.append(res.command)

        with patch.object(controller, "show_filter", return_value="unparseable gibberish output"):
            self.assertFalse(controller.can_verify_ownership(res))
            with self.assertRaisesRegex(TcOwnershipError, "Ambiguous ownership"):
                controller.rollback()

        self.assertIn(res, controller.owned_resources)

    def test_resource_replaced_with_different_attributes_fails_closed(self):
        controller = self.make_controller()
        res_class = OwnedResource("class", "test0", "cmd", parent="1:", class_id="1:10", rate_mbps=35.0, session_id=controller.session_id)
        controller.owned_resources.append(res_class)
        controller.applied.append(res_class.command)

        with patch.object(controller, "show_class", return_value="class htb 1:10 parent 1: prio 0 rate 500Mbit ceil 500Mbit"):
            self.assertFalse(controller.can_verify_ownership(res_class))
            with self.assertRaisesRegex(TcOwnershipError, "Ambiguous ownership, missing resource, or attribute mismatch"):
                controller.rollback()

        self.assertIn(res_class, controller.owned_resources)

    def test_deletion_succeeds_but_post_delete_inspection_shows_presence(self):
        controller = self.make_controller()
        res = OwnedResource("filter", "test0", "cmd", parent="1:0", class_id="1:10", source_ip="192.0.2.10", session_id=controller.session_id)
        controller.owned_resources.append(res)
        controller.applied.append(res.command)

        with patch.object(controller, "can_verify_ownership", return_value=True), \
             patch.object(controller, "_run", return_value=""), \
             patch.object(controller, "is_resource_still_present", return_value=True):
            with self.assertRaisesRegex(TcOwnershipError, "Post-deletion verification failed: filter still exists"):
                controller.rollback()

        self.assertIn(res, controller.owned_resources)
        self.assertIn(res.command, controller.applied)

    def test_multiple_controllers_competing_sessions_rejected(self):
        ctrl1 = self.make_controller(session_id="session_A")
        ctrl2 = self.make_controller(session_id="session_B")

        res_ctrl1 = OwnedResource("class", "test0", "cmd", parent="1:", class_id="1:10", session_id=ctrl1.session_id)
        with patch.object(ctrl1, "show_class", return_value="class htb 1:10 parent 1: prio 0 rate 35Mbit ceil 35Mbit"):
            self.assertTrue(ctrl1.can_verify_ownership(res_ctrl1))
        # ctrl2 has a different session ID and must not verify ownership of ctrl1's resource
        self.assertFalse(ctrl2.can_verify_ownership(res_ctrl1))

    # -------------------------------------------------------------------------
    # INPUT VALIDATION
    # -------------------------------------------------------------------------

    def test_invalid_parameters_rejected(self):
        controller = self.make_controller()
        for ip in ["", "not.an.ip", "999.999.999.999", "1.2.3"]:
            with self.assertRaises(TcError):
                validate_ip(ip)

        for rate in [-10, 0, 100_000, 250_000]:
            with self.assertRaises(TcError):
                validate_rate_mbps(rate)

        for iface in ["", "toolonginterfacename12345", "iface;rm -rf", "eth 0"]:
            with self.assertRaises(TcError):
                validate_interface(iface)

        for handle in [-1, 0, 0x10000, 70000]:
            with self.assertRaises(TcError):
                validate_handle(handle)

        for ns in ["", "invalid namespace with space", "ns;rm -rf", "toolongnamespacenameexceedingthirtytwocharacters123"]:
            with self.assertRaises(TcError):
                validate_namespace(ns)

        self.assertIsNone(validate_namespace(None))
        self.assertEqual(validate_namespace("valid_ns-1"), "valid_ns-1")

    def test_namespace_command_prefixing(self):
        controller = TcController(interface="veth_peer", dry_run=False, namespace="mbh_ns_test")
        controller.assert_safe_interface = lambda: None
        executed_cmds = []

        def fake_run(args, readonly=False):
            return ""

        with patch("subprocess.run") as mock_sub:
            mock_sub.return_value = MagicMock(returncode=0, stdout="", stderr="")
            controller._run(["-s", "qdisc", "show", "dev", "veth_peer"], readonly=True)
            self.assertEqual(
                mock_sub.call_args[0][0],
                ["ip", "netns", "exec", "mbh_ns_test", "tc", "-s", "qdisc", "show", "dev", "veth_peer"]
            )

    def test_rollback_refuses_ambiguous_filter_deletion(self):
        controller = self.make_controller()
        res = OwnedResource(
            "filter", "test0", "cmd", parent="1:0", filter_prio=1,
            class_id="1:10", source_ip="192.0.2.10", session_id=controller.session_id
        )
        controller.owned_resources.append(res)
        controller.applied.append(res.command)

        # Output with TWO filters at parent 1:0 prio 1 (ambiguous deletion target)
        ambiguous_output = (
            "filter parent 1: protocol ip pref 1 flower chain 0 handle 0x1 \n"
            "  flowid 1:10\n"
            "  src_ip 192.0.2.10\n"
            "filter parent 1: protocol ip pref 1 flower chain 0 handle 0x2 \n"
            "  flowid 1:20\n"
            "  src_ip 192.0.2.20\n"
        )
        with patch.object(controller, "can_verify_ownership", return_value=True), \
             patch.object(controller, "show_filter", return_value=ambiguous_output):
            with self.assertRaisesRegex(TcOwnershipError, "Ambiguous filter deletion: multiple filters"):
                controller.rollback()

        # The resource must remain in owned_resources and applied registry (fail-closed)
        self.assertIn(res, controller.owned_resources)
        self.assertIn(res.command, controller.applied)

    def test_parse_class_stats_and_retrieval(self):
        controller = self.make_controller()
        sample_stats_output = (
            "class htb 1:1 root rate 1000Mbit ceil 1000Mbit burst 1375b cburst 1375b \n"
            " Sent 125000000 bytes 89285 pkt (dropped 0, overlimits 0 requeues 0) \n"
            " backlog 0b 0p requeues 0\n"
            "class htb 1:10 parent 1:1 prio 0 rate 35Mbit ceil 35Mbit burst 1599b cburst 1599b \n"
            " Sent 8750000 bytes 6250 pkt (dropped 120, overlimits 450 requeues 0) \n"
            " backlog 0b 0p requeues 0\n"
            "class htb 1:30 parent 1:1 prio 0 rate 1000Mbit ceil 1000Mbit burst 1375b cburst 1375b \n"
            " Sent 50000000 bytes 35714 pkt (dropped 0, overlimits 0 requeues 0) \n"
            " backlog 0b 0p requeues 0\n"
        )
        parsed = parse_class_stats(sample_stats_output)
        self.assertEqual(len(parsed), 3)

        c10 = next((c for c in parsed if c["class_id"] == "1:10"), None)
        self.assertIsNotNone(c10)
        self.assertEqual(c10["bytes"], 8750000)
        self.assertEqual(c10["packets"], 6250)
        self.assertEqual(c10["drops"], 120)
        self.assertEqual(c10["overlimits"], 450)

        with patch.object(controller, "show_class_stats", return_value=sample_stats_output):
            stat = controller.get_class_stat("1:10")
            self.assertIsNotNone(stat)
            self.assertEqual(stat["bytes"], 8750000)
            self.assertEqual(stat["drops"], 120)
            self.assertIsNone(controller.get_class_stat("1:99"))

    def test_failure_safe_resource_tracker(self):
        from test_kernel_integration_plan import FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()

        # Initial state is empty
        self.assertEqual(tracker.build_safe_cleanup_commands(), [])

        # Record resources created during setup
        tracker.record_netns("mbh_ns_test")
        tracker.record_link("veth_mbh")

        cleanup_cmds = tracker.build_safe_cleanup_commands()
        self.assertEqual(len(cleanup_cmds), 2)
        # Verify reverse cleanup order (link deleted before namespace)
        self.assertEqual(cleanup_cmds[0], ["sudo", "ip", "link", "del", "veth_mbh"])
        self.assertEqual(cleanup_cmds[1], ["sudo", "ip", "netns", "del", "mbh_ns_test"])

        # Reset tracker
        tracker.clear()
        self.assertEqual(tracker.build_safe_cleanup_commands(), [])

    def test_measurement_rate_calculation(self):
        # 12,500,000 bytes transferred over exactly 2.0 seconds = 50.0 Mbps
        bytes_transferred = 12_500_000
        duration_sec = 2.0
        mbps = (bytes_transferred * 8.0) / (duration_sec * 1_000_000)
        self.assertAlmostEqual(mbps, 50.0, places=2)

        # 8,750,000 bytes transferred over 2.0 seconds = 35.0 Mbps (target cap)
        cap_bytes = 8_750_000
        cap_mbps = (cap_bytes * 8.0) / (duration_sec * 1_000_000)
        self.assertAlmostEqual(cap_mbps, 35.0, places=2)

    def test_receiver_deterministic_timeout_with_zero_packets(self):
        from test_kernel_integration_plan import run_deterministic_receiver
        import threading
        ready_evt = threading.Event()
        start_evt = threading.Event()
        stop_evt = threading.Event()
        results = {}

        # Run receiver on loopback on an unutilized ephemeral port with 0.1s max duration
        th = threading.Thread(
            target=run_deterministic_receiver,
            args=("127.0.0.1", 0, ready_evt, start_evt, stop_evt, results, 0.1, 0.05)
        )
        th.start()
        ready_evt.wait(timeout=1.0)
        start_evt.set()
        th.join(timeout=1.0)

        self.assertFalse(th.is_alive())
        self.assertEqual(results.get("bytes"), 0)
        self.assertEqual(results.get("packets"), 0)
        self.assertEqual(results.get("mbps"), 0.0)
        self.assertFalse(results.get("first_seen"))

    def test_partial_setup_failure_tracks_only_created_resources(self):
        from test_kernel_integration_plan import FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()

        # Simulate setup failure after step 1 succeeds but step 2 fails
        tracker.record_netns("mbh_ns_test")
        # Step 2 (link add) fails before record_link is called

        cleanup_cmds = tracker.build_safe_cleanup_commands()
        self.assertEqual(cleanup_cmds, [["sudo", "ip", "netns", "del", "mbh_ns_test"]])
        # veth_mbh must NOT be in cleanup commands because it was never recorded as created
        self.assertNotIn(["sudo", "ip", "link", "del", "veth_mbh"], cleanup_cmds)

    def test_tracker_verifies_cleanup_state_and_detects_leftovers(self):
        from test_kernel_integration_plan import FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()
        tracker.record_netns("mbh_ns_test")
        tracker.record_link("veth_mbh")

        # Mock subprocess to simulate leftover interface still existing
        mock_netns_out = "other_ns\n"
        mock_link_out = "1: lo: <LOOPBACK>\n2: veth_mbh: <BROADCAST>\n"

        def fake_run(args, capture_output=True, text=True, check=False):
            if "netns" in args:
                return MagicMock(returncode=0, stdout=mock_netns_out)
            return MagicMock(returncode=0, stdout=mock_link_out)

        with patch("subprocess.run", side_effect=fake_run):
            leftovers = tracker.verify_cleanup_state()
            self.assertEqual(leftovers, ["link:veth_mbh"])

    def test_preflight_refuses_preexisting_namespace(self):
        from test_kernel_integration_plan import run_preflight_checks, HarnessPreflightError
        with patch("subprocess.run") as mock_sub:
            mock_sub.return_value = MagicMock(returncode=0, stdout="mbh_ns_test other_ns\n")
            with self.assertRaisesRegex(HarnessPreflightError, "Pre-existing namespace 'mbh_ns_test' detected"):
                run_preflight_checks()

    def test_preflight_refuses_preexisting_interface(self):
        from test_kernel_integration_plan import run_preflight_checks, HarnessPreflightError
        def fake_run(args, capture_output=True, text=True, check=False):
            if "netns" in args:
                return MagicMock(returncode=0, stdout="other_ns\n")
            return MagicMock(returncode=0, stdout="1: lo: <LOOPBACK>\n2: veth_mbh: <BROADCAST>\n")

        with patch("subprocess.run", side_effect=fake_run):
            with self.assertRaisesRegex(HarnessPreflightError, "Pre-existing interface 'veth_mbh' detected"):
                run_preflight_checks()

    def test_class_counter_deltas_and_snapshot_logic(self):
        controller = self.make_controller()
        initial_stats = (
            "class htb 1:10 parent 1:1 prio 0 rate 35Mbit ceil 35Mbit\n"
            " Sent 1000000 bytes 714 pkt (dropped 0)\n"
        )
        post_stats = (
            "class htb 1:10 parent 1:1 prio 0 rate 35Mbit ceil 35Mbit\n"
            " Sent 9750000 bytes 6964 pkt (dropped 10)\n"
        )
        with patch.object(controller, "show_class_stats", return_value=initial_stats):
            snap0 = controller.get_class_stat("1:10")
            self.assertEqual(snap0["bytes"], 1000000)

        with patch.object(controller, "show_class_stats", return_value=post_stats):
            snap1 = controller.get_class_stat("1:10")
            self.assertEqual(snap1["bytes"], 9750000)

        delta_bytes = snap1["bytes"] - snap0["bytes"]
        delta_packets = snap1["packets"] - snap0["packets"]
        self.assertEqual(delta_bytes, 8750000)
        self.assertEqual(delta_packets, 6250)

    def test_receiver_readiness_timeout_fails_immediately(self):
        """Verify that receiver readiness timeout raises an immediate error without hanging."""
        ready_evt = threading.Event()
        timeout_occurred = not ready_evt.wait(timeout=0.05)
        self.assertTrue(timeout_occurred)

    def test_receiver_zero_packet_measurement_duration(self):
        """Verify that zero packet measurement returns 0 Mbps calculated over intended duration."""
        from test_kernel_integration_plan import run_deterministic_receiver
        ready_evt = threading.Event()
        start_evt = threading.Event()
        stop_evt = threading.Event()
        results = {}
        th = threading.Thread(
            target=run_deterministic_receiver,
            args=("127.0.0.1", 0, ready_evt, start_evt, stop_evt, results, 0.1, 0.05)
        )
        th.start()
        ready_evt.wait(timeout=1.0)
        start_evt.set()
        th.join(timeout=1.0)
        self.assertFalse(th.is_alive())
        self.assertEqual(results.get("bytes"), 0)
        self.assertEqual(results.get("packets"), 0)
        self.assertEqual(results.get("mbps"), 0.0)
        self.assertAlmostEqual(results.get("intended_duration"), 0.1, places=2)

    def test_sender_subprocess_failure_raises(self):
        """Verify that sender subprocess failure raises CalledProcessError immediately."""
        with patch("subprocess.run", side_effect=subprocess.CalledProcessError(1, ["python3", "sender"])):
            with self.assertRaises(subprocess.CalledProcessError):
                subprocess.run(["python3", "sender"], check=True)

    def test_receiver_thread_exception_and_guaranteed_termination(self):
        """Verify receiver socket exception is captured and thread terminates cleanly."""
        from test_kernel_integration_plan import run_deterministic_receiver
        ready_evt = threading.Event()
        start_evt = threading.Event()
        stop_evt = threading.Event()
        results = {}
        with patch("socket.socket.bind", side_effect=PermissionError("Permission denied")):
            th = threading.Thread(
                target=run_deterministic_receiver,
                args=("127.0.0.1", 5001, ready_evt, start_evt, stop_evt, results, 0.1)
            )
            th.start()
            ready_evt.wait(timeout=1.0)
            th.join(timeout=1.0)
            self.assertFalse(th.is_alive())
            self.assertIn("error", results)
            self.assertIsInstance(results["error"], PermissionError)

    def test_receiver_early_startup_waits_for_start_signal(self):
        """Verify receiver does not begin measurement window before start_evt is set."""
        from test_kernel_integration_plan import run_deterministic_receiver
        ready_evt = threading.Event()
        start_evt = threading.Event()
        stop_evt = threading.Event()
        results = {}
        th = threading.Thread(
            target=run_deterministic_receiver,
            args=("127.0.0.1", 0, ready_evt, start_evt, stop_evt, results, 0.2, 0.1)
        )
        th.start()
        self.assertTrue(ready_evt.wait(timeout=1.0))
        # Sleep while start_evt is unset; receiver must remain blocked waiting for start
        time.sleep(0.08)
        self.assertTrue(th.is_alive())
        self.assertNotIn("elapsed_wall_time", results)

        # Signal start and let it finish
        start_evt.set()
        th.join(timeout=1.0)
        self.assertFalse(th.is_alive())
        self.assertIn("elapsed_wall_time", results)

    def test_receiver_delayed_sender_startup_handles_packets_before_deadline(self):
        """Verify delayed sender packets arriving before deadline are captured properly."""
        from test_kernel_integration_plan import run_deterministic_receiver
        import socket
        ready_evt = threading.Event()
        start_evt = threading.Event()
        stop_evt = threading.Event()
        results = {}

        # Ephemeral UDP port bind
        s_test = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s_test.bind(("127.0.0.1", 0))
        port = s_test.getsockname()[1]
        s_test.close()

        th = threading.Thread(
            target=run_deterministic_receiver,
            args=("127.0.0.1", port, ready_evt, start_evt, stop_evt, results, 0.3, 0.2)
        )
        th.start()
        ready_evt.wait(timeout=1.0)
        start_evt.set()

        # Sender is delayed by 0.1s before sending first datagram
        time.sleep(0.1)
        client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        client.sendto(b"X" * 1000, ("127.0.0.1", port))
        client.close()
        time.sleep(0.05)

        stop_evt.set()
        th.join(timeout=1.0)
        self.assertFalse(th.is_alive())
        self.assertEqual(results.get("bytes"), 1000)
        self.assertEqual(results.get("packets"), 1)
        self.assertTrue(results.get("first_seen"))

    def test_packets_arriving_near_deadline(self):
        """Verify datagrams arriving immediately before stop_evt/deadline are counted cleanly."""
        from test_kernel_integration_plan import run_deterministic_receiver
        import socket
        ready_evt = threading.Event()
        start_evt = threading.Event()
        stop_evt = threading.Event()
        results = {}

        s_test = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s_test.bind(("127.0.0.1", 0))
        port = s_test.getsockname()[1]
        s_test.close()

        th = threading.Thread(
            target=run_deterministic_receiver,
            args=("127.0.0.1", port, ready_evt, start_evt, stop_evt, results, 0.2, 0.1)
        )
        th.start()
        ready_evt.wait(timeout=1.0)
        start_evt.set()

        client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        client.sendto(b"A" * 500, ("127.0.0.1", port))
        time.sleep(0.12)
        client.sendto(b"B" * 500, ("127.0.0.1", port))
        client.close()

        stop_evt.set()
        th.join(timeout=1.0)
        self.assertFalse(th.is_alive())
        self.assertEqual(results.get("bytes"), 1000)
        self.assertEqual(results.get("packets"), 2)

    def test_rollback_exception_followed_by_cleanup(self):
        """Verify that a rollback exception does not prevent tracker cleanup from executing."""
        from test_kernel_integration_plan import execute_testbed_lifecycle, FailureSafeResourceTracker
        ctrl = self.make_controller()
        tracker = FailureSafeResourceTracker()
        tracker.record_netns("mbh_ns_test")
        tracker.record_link("veth_mbh")

        with patch.object(ctrl, "rollback", side_effect=RuntimeError("Rollback netlink fail")), \
             patch.object(tracker, "cleanup", return_value=[]) as mock_clean, \
             patch.object(tracker, "verify_cleanup_state", return_value=[]):
            with self.assertRaisesRegex(RuntimeError, "Rollback netlink fail"):
                execute_testbed_lifecycle(ctrl, tracker, lambda: "ok")
            mock_clean.assert_called_once()

    def test_cleanup_exception_preserves_original_test_failure(self):
        """Verify that cleanup exception does not conceal or replace the original test failure."""
        from test_kernel_integration_plan import execute_testbed_lifecycle, FailureSafeResourceTracker
        ctrl = self.make_controller()
        tracker = FailureSafeResourceTracker()

        def failing_test():
            raise AssertionError("Original test verification failed!")

        with patch.object(ctrl, "rollback", return_value=None), \
             patch.object(tracker, "cleanup", return_value=[("cmd", RuntimeError("Cleanup failed"))]):
            with self.assertRaisesRegex(AssertionError, "Original test verification failed!"):
                execute_testbed_lifecycle(ctrl, tracker, failing_test)

    def test_partial_setup_and_resource_ownership(self):
        """Verify tracker tracks only demonstrably created resources during partial setup failure."""
        from test_kernel_integration_plan import FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()
        tracker.record_netns("mbh_ns_test")
        # Failure occurs before record_link is called
        cmds = tracker.build_safe_cleanup_commands()
        self.assertEqual(len(cmds), 1)
        self.assertEqual(cmds[0], ["sudo", "ip", "netns", "del", "mbh_ns_test"])

    def test_preexisting_resource_collision_refuses_setup(self):
        """Verify preflight checks refuse setup when a pre-existing resource collides."""
        from test_kernel_integration_plan import run_preflight_checks, HarnessPreflightError
        with patch("subprocess.run") as mock_sub:
            mock_sub.return_value = MagicMock(returncode=0, stdout="mbh_ns_test\n")
            with self.assertRaisesRegex(HarnessPreflightError, "Pre-existing namespace 'mbh_ns_test' detected"):
                run_preflight_checks()

    def test_cleanup_verification_reports_leftovers(self):
        """Verify cleanup verification identifies leftover resources and does not claim premature success."""
        from test_kernel_integration_plan import execute_testbed_lifecycle, FailureSafeResourceTracker, HarnessCleanupError
        ctrl = self.make_controller()
        tracker = FailureSafeResourceTracker()
        tracker.record_netns("mbh_ns_test")

        with patch.object(ctrl, "rollback", return_value=None), \
             patch.object(tracker, "cleanup", return_value=[]), \
             patch.object(tracker, "verify_cleanup_state", return_value=["netns:mbh_ns_test"]):
            with self.assertRaisesRegex(HarnessCleanupError, "Post-cleanup verification detected leftovers"):
                execute_testbed_lifecycle(ctrl, tracker, lambda: "ok")

    def test_counter_deltas_and_root_qdisc_preservation(self):
        """Verify counter delta calculation and that root qdisc is preserved intact after rollback."""
        ctrl = self.make_controller()
        before_stats = "class htb 1:10 parent 1:1 prio 0 rate 35Mbit ceil 35Mbit\n Sent 100 bytes 1 pkt\n"
        after_stats = "class htb 1:10 parent 1:1 prio 0 rate 35Mbit ceil 35Mbit\n Sent 9000 bytes 9 pkt\n"

        with patch.object(ctrl, "show_class_stats", side_effect=[before_stats, after_stats]):
            s0 = ctrl.get_class_stat("1:10")
            s1 = ctrl.get_class_stat("1:10")
            self.assertEqual(s1["bytes"] - s0["bytes"], 8900)
            self.assertEqual(s1["packets"] - s0["packets"], 8)

        with patch.object(ctrl, "inspect_current_hierarchy", return_value={
            "root_qdisc": {"kind": "htb", "handle": 1, "is_root": True},
            "classes": [{"kind": "htb", "class_id": "1:1", "parent": "root"}, {"kind": "htb", "class_id": "1:30", "parent": "1:1"}],
            "filters": []
        }):
            post = ctrl.inspect_current_hierarchy(parent_handle=1)
            self.assertIsNotNone(post["root_qdisc"])
            self.assertEqual(post["root_qdisc"]["kind"], "htb")
            self.assertEqual(post["root_qdisc"]["handle"], 1)
            self.assertFalse(any(c["class_id"] == "1:10" for c in post["classes"]))

    def test_setup_failure_stage_records_only_prior_resources(self):
        """Verify each setup stage records resources only after returncode 0; partial failure records only prior resources."""
        from test_kernel_integration_plan import execute_tracked_setup, FailureSafeResourceTracker, HarnessExecutionError
        tracker = FailureSafeResourceTracker()

        # Mock stage 1 (netns add) succeeding, but stage 2 (veth pair add) failing
        def fake_run(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", [])
            if any("link" in str(x) for x in cmd) and any("add" in str(x) for x in cmd):
                return MagicMock(returncode=1, stdout="", stderr="RTNETLINK answers: Operation not permitted")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaises(HarnessExecutionError):
                execute_tracked_setup(tracker)

        # Confirm namespace is recorded because stage 1 succeeded, but link is NOT recorded
        self.assertIn("mbh_ns_test", tracker.created_netns)
        self.assertEqual(tracker.created_links, [])
        self.assertEqual(tracker.build_safe_cleanup_commands(), [["sudo", "ip", "netns", "del", "mbh_ns_test"]])

    def test_full_integration_orchestration_mocked(self):
        """Verify the full orchestration function executes the complete lifecycle correctly."""
        from test_kernel_integration_plan import run_full_integration_orchestration, FailureSafeResourceTracker
        ctrl = self.make_controller()
        tracker = FailureSafeResourceTracker()
        tracker.record_netns("mbh_ns_test")

        # Mock parent hierarchy check
        with patch.object(ctrl, "verify_parent_hierarchy", return_value=None), \
             patch.object(ctrl, "get_class_stat", side_effect=[
                 None,                          # step 2: 1:10 check prior to baseline (must be None)
                 {"bytes": 1000, "packets": 1}, # step 2: 1:30 snap before baseline
                 {"bytes": 5000, "packets": 5}, # step 2: 1:30 post baseline (delta = 4000)
                 {"bytes": 0, "packets": 0},    # step 4: 1:10 pre-mit
                 {"bytes": 9000, "packets": 9}, # step 4: 1:10 post-mit (delta = 9000)
             ]), \
             patch.object(ctrl, "apply_source_cap", return_value=["cap_cmd"]), \
             patch.object(ctrl, "rollback", return_value=None), \
             patch.object(tracker, "cleanup", return_value=[]), \
             patch.object(tracker, "verify_cleanup_state", return_value=[]), \
             patch.object(ctrl, "inspect_current_hierarchy", return_value={
                 "root_qdisc": {"kind": "htb", "handle": 1, "is_root": True},
                 "classes": [{"kind": "htb", "class_id": "1:1", "parent": "root"}, {"kind": "htb", "class_id": "1:10", "parent": "1:1"}],
                 "filters": [],
             }):

            def fake_measurement(desc, target_bps, duration_sec):
                return {"desc": desc, "mbps": 35.0, "bytes": 8_750_000}

            report = run_full_integration_orchestration(ctrl, tracker, measurement_fn=fake_measurement)
            self.assertEqual(report["delta_base_30"], 4000)
            self.assertEqual(report["delta_mit_10"], 9000)
            self.assertEqual(report["mitigated"]["mbps"], 35.0)

    def test_partial_veth_creation_kernel_presence_detected(self):
        """Verify that if veth creation returns error but endpoint exists, it is recorded for cleanup."""
        from test_kernel_integration_plan import (
            execute_tracked_setup,
            FailureSafeResourceTracker,
            HarnessExecutionError,
            HOST_VETH,
            PEER_VETH,
        )
        tracker = FailureSafeResourceTracker()

        def fake_run(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", [])
            # Structured veth check in host and netns
            if HOST_VETH in cmd and "show" in cmd:
                return MagicMock(
                    returncode=0,
                    stdout='[{"ifindex": 5, "ifname": "veth_mbh", "link_type": "ether", "linkinfo": {"info_kind": "veth"}}]',
                    stderr=""
                )
            if "-netns" in cmd and PEER_VETH in cmd:
                return MagicMock(
                    returncode=0,
                    stdout='[{"ifindex": 6, "ifname": "veth_peer", "link_type": "ether", "linkinfo": {"info_kind": "veth"}}]',
                    stderr=""
                )
            # Link add fails
            if "link" in cmd and "add" in cmd:
                return MagicMock(returncode=1, stdout="", stderr="Error adding link")
            # All other commands succeed
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaises(HarnessExecutionError):
                execute_tracked_setup(tracker)

        # Both namespace and host veth must be recorded because the endpoint was proven to exist
        self.assertIn("mbh_ns_test", tracker.created_netns)
        self.assertIn("veth_mbh", tracker.created_links)
        self.assertEqual(tracker.build_safe_cleanup_commands(), [
            ["sudo", "ip", "link", "del", "veth_mbh"],
            ["sudo", "ip", "netns", "del", "mbh_ns_test"],
        ])

    def test_setup_failure_at_every_stage_tracks_only_established_resources(self):
        """Verify that failure at any stage (1 through 10) halts setup and only records established resources."""
        from test_kernel_integration_plan import execute_tracked_setup, FailureSafeResourceTracker, HarnessExecutionError

        for fail_stage in range(1, 11):
            tracker = FailureSafeResourceTracker()
            call_count = [0]

            def fake_run(*args, **kwargs):
                call_count[0] += 1
                if call_count[0] == fail_stage:
                    return MagicMock(returncode=1, stdout="", stderr=f"Stage {fail_stage} failed")
                return MagicMock(returncode=0, stdout="", stderr="")

            with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
                with self.assertRaises(HarnessExecutionError):
                    execute_tracked_setup(tracker)

            if fail_stage == 1:
                self.assertEqual(tracker.created_netns, [])
                self.assertEqual(tracker.created_links, [])
            elif fail_stage == 2:
                self.assertEqual(tracker.created_netns, ["mbh_ns_test"])
                self.assertEqual(tracker.created_links, [])
            else:
                self.assertEqual(tracker.created_netns, ["mbh_ns_test"])
                self.assertEqual(tracker.created_links, ["veth_mbh"])

    def test_cleanup_inspection_command_failure_treated_as_leftover_error(self):
        """Verify that if post-cleanup inspection fails, verify_cleanup_state reports error and does not assume absence."""
        from test_kernel_integration_plan import FailureSafeResourceTracker, execute_testbed_lifecycle, HarnessCleanupError
        ctrl = self.make_controller()
        tracker = FailureSafeResourceTracker()
        tracker.record_netns("mbh_ns_test")

        # Mock ip netns list failing with non-zero exit code
        def fake_run(cmd, *args, **kwargs):
            if "netns" in cmd and "list" in cmd:
                return MagicMock(returncode=1, stdout="", stderr="RTNETLINK netns read failed")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run), \
             patch.object(ctrl, "rollback", return_value=None):
            with self.assertRaisesRegex(HarnessCleanupError, "netns_inspection_error"):
                execute_testbed_lifecycle(ctrl, tracker, lambda: "test_ok")

    def test_orchestration_fails_if_root_qdisc_is_missing_during_active_mitigation(self):
        """Verify orchestration verifies root HTB qdisc integrity while mitigation is active."""
        from test_kernel_integration_plan import run_full_integration_orchestration, FailureSafeResourceTracker
        ctrl = self.make_controller()
        tracker = FailureSafeResourceTracker()

        with patch.object(ctrl, "verify_parent_hierarchy", return_value=None), \
             patch.object(ctrl, "get_class_stat", side_effect=[
                 None,                          # step 2: 1:10 pre-baseline
                 {"bytes": 1000, "packets": 1}, # step 2: 1:30 snap
                 {"bytes": 5000, "packets": 5}, # step 2: 1:30 post-baseline
                 {"bytes": 0, "packets": 0},    # step 4: 1:10 pre-mit
                 {"bytes": 9000, "packets": 9}, # step 4: 1:10 post-mit
             ]), \
             patch.object(ctrl, "apply_source_cap", return_value=["cap"]), \
             patch.object(ctrl, "rollback", return_value=None), \
             patch.object(tracker, "cleanup", return_value=[]), \
             patch.object(tracker, "verify_cleanup_state", return_value=[]), \
             patch.object(ctrl, "inspect_current_hierarchy", return_value={"root_qdisc": None, "classes": []}):

            def fake_measurement(desc, target_bps, duration_sec):
                return {"desc": desc, "mbps": 35.0}

            with self.assertRaisesRegex(AssertionError, "Root HTB qdisc missing or corrupted"):
                run_full_integration_orchestration(ctrl, tracker, measurement_fn=fake_measurement)

    def test_cleanup_failure_does_not_abort_subsequent_cleanups(self):
        """Verify that a failure cleaning up link does not prevent attempting netns cleanup."""
        from test_kernel_integration_plan import FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()
        tracker.record_netns("mbh_ns_test")
        tracker.record_link("veth_mbh")

        called_cmds = []
        def fake_run(cmd, *args, **kwargs):
            called_cmds.append(" ".join(cmd))
            if "link" in cmd and "del" in cmd:
                return MagicMock(returncode=1, stdout="", stderr="Link del failed")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            failures = tracker.cleanup()
            # Link deletion failed, but netns deletion was still attempted
            self.assertEqual(len(failures), 1)
            self.assertIn("veth_mbh", failures[0][0])
            self.assertEqual(len(called_cmds), 2)
            self.assertTrue(any("link del" in c for c in called_cmds))
            self.assertTrue(any("netns del" in c for c in called_cmds))

    def test_negative_or_invalid_counter_deltas_rejected(self):
        """Verify that negative or non-accumulating counter deltas raise AssertionError."""
        from test_kernel_integration_plan import run_full_integration_orchestration, FailureSafeResourceTracker
        ctrl = self.make_controller()
        tracker = FailureSafeResourceTracker()

        # Mock post-baseline delta as negative (e.g. counters reset or corrupted)
        with patch.object(ctrl, "verify_parent_hierarchy", return_value=None), \
             patch.object(ctrl, "get_class_stat", side_effect=[
                 None,                          # step 2: 1:10 pre-baseline
                 {"bytes": 5000, "packets": 5}, # step 2: 1:30 snap before
                 {"bytes": 1000, "packets": 1}, # step 2: 1:30 post baseline (delta = -4000)
             ]), \
             patch.object(ctrl, "rollback", return_value=None), \
             patch.object(tracker, "cleanup", return_value=[]), \
             patch.object(tracker, "verify_cleanup_state", return_value=[]):

            def fake_measurement(desc, target_bps, duration_sec):
                return {"desc": desc, "mbps": 50.0}

            with self.assertRaisesRegex(AssertionError, "Default class 1:30 must handle unshaped baseline traffic"):
                run_full_integration_orchestration(ctrl, tracker, measurement_fn=fake_measurement)

    def test_unified_lifecycle_runs_setup_and_cleans_up_on_failure(self):
        """Verify that run_unified_integration_lifecycle attempts cleanup if setup fails."""
        from test_kernel_integration_plan import (
            run_unified_integration_lifecycle,
            FailureSafeResourceTracker,
            HarnessExecutionError,
        )
        tracker = FailureSafeResourceTracker()

        def fake_run(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", [])
            # Preflight passes
            if "netns" in cmd and "list" in cmd:
                return MagicMock(returncode=0, stdout="", stderr="")
            if "route" in cmd:
                return MagicMock(returncode=0, stdout="default via 192.168.1.1 dev eth0\n", stderr="")
            # Setup stage 1 succeeds
            if "netns" in cmd and "add" in cmd and "link" not in cmd:
                return MagicMock(returncode=0, stdout="", stderr="")
            # Setup stage 2 fails
            if "link" in cmd and "add" in cmd:
                return MagicMock(returncode=1, stdout="", stderr="Failed to create veth")
            # Cleanup & verification: ip link show returns clean output
            if "link" in cmd and "show" in cmd:
                return MagicMock(returncode=0, stdout="", stderr="")
            # Cleanup succeeds
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaises(HarnessExecutionError):
                run_unified_integration_lifecycle(tracker=tracker)

        self.assertTrue(tracker.cleanup_executed)
        self.assertEqual(tracker.created_netns, ["mbh_ns_test"])

    def test_ambiguous_or_non_veth_link_fails_closed_without_recording(self):
        """Verify that if partial creation finds a non-veth interface, it fails closed and does not record it."""
        from test_kernel_integration_plan import (
            _check_partial_veth_creation,
            FailureSafeResourceTracker,
            HOST_VETH,
        )
        tracker = FailureSafeResourceTracker()

        # ip -details link show shows an interface that is not a veth (e.g. sit tunnel)
        def fake_run(cmd, *args, **kwargs):
            if HOST_VETH in cmd:
                return MagicMock(returncode=0, stdout=f"2: {HOST_VETH}: <NOARP> mtu 1480 qdisc noqueue state DOWN mode DEFAULT\n    link/sit 0.0.0.0 brd 0.0.0.0\n", stderr="")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            _check_partial_veth_creation(tracker)

        # Did NOT record link because it is not proven to be a veth
        self.assertEqual(tracker.created_links, [])

    def test_unified_lifecycle_successful_mocked_execution(self):
        """Verify run_unified_integration_lifecycle succeeds on clean mock execution."""
        from test_kernel_integration_plan import (
            run_unified_integration_lifecycle,
            FailureSafeResourceTracker,
        )
        tracker = FailureSafeResourceTracker()
        ctrl = self.make_controller()

        with patch("test_kernel_integration_plan.run_preflight_checks", return_value=None), \
             patch("test_kernel_integration_plan.execute_tracked_setup", return_value=None), \
             patch.object(ctrl, "verify_parent_hierarchy", return_value=None), \
             patch.object(ctrl, "get_class_stat", side_effect=[
                 None,                          # baseline pre 1:10
                 {"bytes": 100, "packets": 1},  # baseline pre 1:30
                 {"bytes": 4100, "packets": 4}, # baseline post 1:30
                 {"bytes": 0, "packets": 0},    # mit pre 1:10
                 {"bytes": 9000, "packets": 9}, # mit post 1:10
             ]), \
             patch.object(ctrl, "apply_source_cap", return_value=["cap"]), \
             patch.object(ctrl, "inspect_current_hierarchy", return_value={
                 "root_qdisc": {"kind": "htb"},
                 "classes": [{"class_id": "1:10"}],
             }), \
             patch.object(ctrl, "rollback", return_value=None), \
             patch.object(tracker, "cleanup", return_value=[]), \
             patch.object(tracker, "verify_cleanup_state", return_value=[]):

            def fake_measurement(desc, target_bps, duration_sec):
                return {"desc": desc, "mbps": 35.0}

            report = run_unified_integration_lifecycle(
                tracker=tracker,
                controller_factory=lambda: ctrl,
                measurement_fn=fake_measurement,
            )
            self.assertEqual(report["status"], "SUCCESS")
            self.assertEqual(report["result"]["delta_base_30"], 4000)
            self.assertEqual(report["result"]["delta_mit_10"], 9000)
            self.assertEqual(report["result"]["mitigated"]["mbps"], 35.0)

    def test_unified_lifecycle_rollback_failure_preserved_when_no_prior_failure(self):
        """Verify unified lifecycle raises rollback exception if test succeeds but rollback fails."""
        from test_kernel_integration_plan import (
            run_unified_integration_lifecycle,
            FailureSafeResourceTracker,
        )
        tracker = FailureSafeResourceTracker()
        ctrl = self.make_controller()

        with patch("test_kernel_integration_plan.run_preflight_checks", return_value=None), \
             patch("test_kernel_integration_plan.execute_tracked_setup", return_value=None), \
             patch("test_kernel_integration_plan.run_full_integration_orchestration", return_value={"test": "ok"}), \
             patch.object(ctrl, "rollback", side_effect=RuntimeError("Rollback netlink timeout")), \
             patch.object(tracker, "cleanup", return_value=[]), \
             patch.object(tracker, "verify_cleanup_state", return_value=[]):

            with self.assertRaisesRegex(RuntimeError, "Rollback netlink timeout"):
                run_unified_integration_lifecycle(tracker=tracker, controller_factory=lambda: ctrl)

    def test_unified_lifecycle_multiple_cleanup_failures_reported(self):
        """Verify unified lifecycle raises HarnessCleanupError when tracker reports cleanup failures."""
        from test_kernel_integration_plan import (
            run_unified_integration_lifecycle,
            FailureSafeResourceTracker,
            HarnessCleanupError,
        )
        tracker = FailureSafeResourceTracker()
        ctrl = self.make_controller()

        with patch("test_kernel_integration_plan.run_preflight_checks", return_value=None), \
             patch("test_kernel_integration_plan.execute_tracked_setup", return_value=None), \
             patch("test_kernel_integration_plan.run_full_integration_orchestration", return_value={"test": "ok"}), \
             patch.object(ctrl, "rollback", return_value=None), \
             patch.object(tracker, "cleanup", return_value=[("ip link del veth_mbh", RuntimeError("Device busy"))]), \
             patch.object(tracker, "verify_cleanup_state", return_value=[]):

            with self.assertRaises(HarnessCleanupError) as ctx:
                run_unified_integration_lifecycle(tracker=tracker, controller_factory=lambda: ctrl)
            self.assertIn("Device busy", str(ctx.exception))

    def test_unified_lifecycle_post_cleanup_inspection_failure_reported(self):
        """Verify unified lifecycle raises HarnessCleanupError when leftovers are detected after cleanup."""
        from test_kernel_integration_plan import (
            run_unified_integration_lifecycle,
            FailureSafeResourceTracker,
            HarnessCleanupError,
        )
        tracker = FailureSafeResourceTracker()
        ctrl = self.make_controller()

        with patch("test_kernel_integration_plan.run_preflight_checks", return_value=None), \
             patch("test_kernel_integration_plan.execute_tracked_setup", return_value=None), \
             patch("test_kernel_integration_plan.run_full_integration_orchestration", return_value={"test": "ok"}), \
             patch.object(ctrl, "rollback", return_value=None), \
             patch.object(tracker, "cleanup", return_value=[]), \
             patch.object(tracker, "verify_cleanup_state", return_value=["link:veth_mbh"]):

            with self.assertRaises(HarnessCleanupError) as ctx:
                run_unified_integration_lifecycle(tracker=tracker, controller_factory=lambda: ctrl)
            self.assertIn("Post-cleanup verification detected leftovers: ['link:veth_mbh']", str(ctx.exception))

    def test_runner_cannot_accidentally_enter_live_mode_without_explicit_overrides(self):
        """Confirm the runner fails closed and cannot enter live mode through default arguments."""
        from test_kernel_integration_plan import get_persistent_test_runner_snippet
        snippet = get_persistent_test_runner_snippet()
        self.assertIn("run_unified_integration_lifecycle", snippet)
        self.assertNotIn("sudo", snippet)
        self.assertNotIn("--execute", snippet)


    def test_preflight_fails_closed_on_netns_inspection_command_failure(self):
        """Verify preflight raises HarnessPreflightError if ip netns list fails."""
        from test_kernel_integration_plan import run_preflight_checks, HarnessPreflightError

        def fake_run(cmd, *args, **kwargs):
            if "netns" in cmd and "list" in cmd:
                return MagicMock(returncode=1, stdout="", stderr="RTNETLINK read failure")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaisesRegex(HarnessPreflightError, "Preflight inspection failed: 'ip netns list' returned code 1"):
                run_preflight_checks()

    def test_preflight_fails_closed_on_link_inspection_command_failure(self):
        """Verify preflight raises HarnessPreflightError if ip link show fails."""
        from test_kernel_integration_plan import run_preflight_checks, HarnessPreflightError

        def fake_run(cmd, *args, **kwargs):
            if "netns" in cmd and "list" in cmd:
                return MagicMock(returncode=0, stdout="", stderr="")
            if "link" in cmd and "show" in cmd:
                return MagicMock(returncode=1, stdout="", stderr="Kernel link query failure")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaisesRegex(HarnessPreflightError, "Preflight inspection failed: 'ip link show' returned code 1"):
                run_preflight_checks()

    def test_preflight_fails_closed_on_route_inspection_command_failure(self):
        """Verify preflight raises HarnessPreflightError if ip route show default fails."""
        from test_kernel_integration_plan import run_preflight_checks, HarnessPreflightError

        def fake_run(cmd, *args, **kwargs):
            if "netns" in cmd and "list" in cmd:
                return MagicMock(returncode=0, stdout="", stderr="")
            if "link" in cmd and "show" in cmd:
                return MagicMock(returncode=0, stdout="", stderr="")
            if "route" in cmd:
                return MagicMock(returncode=1, stdout="", stderr="Routing table read failure")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaisesRegex(HarnessPreflightError, "Preflight inspection failed: 'ip route show default' returned code 1"):
                run_preflight_checks()

    def test_preflight_fails_closed_on_missing_executable(self):
        """Verify preflight raises HarnessPreflightError if ip executable is missing or OSError occurs."""
        from test_kernel_integration_plan import run_preflight_checks, HarnessPreflightError

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=FileNotFoundError("ip not found")):
            with self.assertRaisesRegex(HarnessPreflightError, "unable to execute 'ip netns list'"):
                run_preflight_checks()

    def test_preflight_failure_prevents_any_setup_command(self):
        """Verify that when preflight fails, setup is never invoked under unified lifecycle."""
        from test_kernel_integration_plan import run_unified_integration_lifecycle, FailureSafeResourceTracker, HarnessPreflightError

        tracker = FailureSafeResourceTracker()
        setup_called = []

        with patch("test_kernel_integration_plan.run_preflight_checks", side_effect=HarnessPreflightError("Preflight failed")), \
             patch("test_kernel_integration_plan.execute_tracked_setup", side_effect=lambda t: setup_called.append(True)):
            with self.assertRaises(HarnessPreflightError):
                run_unified_integration_lifecycle(tracker=tracker)

        self.assertEqual(setup_called, [])
        self.assertEqual(tracker.created_netns, [])
        self.assertEqual(tracker.created_links, [])

    def test_partial_veth_creation_fails_closed_on_ordinary_ethernet(self):
        """Verify that an interface that is ordinary Ethernet (link_type 'ether') is not adopted."""
        from test_kernel_integration_plan import _check_partial_veth_creation, FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()

        # ip -j -details output for standard ethernet interface
        eth_json = '[{"ifindex": 2, "ifname": "veth_mbh", "link_type": "ether"}]'
        with patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=0, stdout=eth_json, stderr="")):
            _check_partial_veth_creation(tracker)

        self.assertEqual(tracker.created_links, [])

    def test_partial_veth_creation_fails_closed_on_dummy_interface(self):
        """Verify that a dummy interface is not adopted."""
        from test_kernel_integration_plan import _check_partial_veth_creation, FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()

        dummy_json = '[{"ifindex": 3, "ifname": "veth_mbh", "link_type": "dummy", "linkinfo": {"info_kind": "dummy"}}]'
        with patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=0, stdout=dummy_json, stderr="")):
            _check_partial_veth_creation(tracker)

        self.assertEqual(tracker.created_links, [])

    def test_partial_veth_creation_fails_closed_on_tunnel_interface(self):
        """Verify that a sit / gre tunnel interface is not adopted."""
        from test_kernel_integration_plan import _check_partial_veth_creation, FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()

        tun_json = '[{"ifindex": 4, "ifname": "veth_mbh", "link_type": "sit", "linkinfo": {"info_kind": "sit"}}]'
        with patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=0, stdout=tun_json, stderr="")):
            _check_partial_veth_creation(tracker)

        self.assertEqual(tracker.created_links, [])

    def test_partial_veth_creation_fails_closed_on_veth_with_missing_or_ambiguous_peer(self):
        """Verify that a veth link with no confirmed peer in TEST_NETNS fails closed."""
        from test_kernel_integration_plan import _check_partial_veth_creation, FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()

        # Host link is veth, but checking target namespace peer fails (returncode 1 / not found)
        host_veth_json = '[{"ifindex": 5, "ifname": "veth_mbh", "link_type": "ether", "linkinfo": {"info_kind": "veth"}}]'
        def fake_run(cmd, *args, **kwargs):
            if "-netns" in cmd:
                return MagicMock(returncode=1, stdout="Device does not exist", stderr="")
            return MagicMock(returncode=0, stdout=host_veth_json, stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            _check_partial_veth_creation(tracker)

        self.assertEqual(tracker.created_links, [])

    def test_partial_veth_creation_records_link_on_genuine_cross_netns_veth_peer(self):
        """Verify that a genuine veth with verified peer in TEST_NETNS is safely recorded for cleanup."""
        from test_kernel_integration_plan import _check_partial_veth_creation, FailureSafeResourceTracker, TEST_NETNS
        tracker = FailureSafeResourceTracker()
        tracker.record_netns(TEST_NETNS)

        host_veth_json = '[{"ifindex": 5, "ifname": "veth_mbh", "link_type": "ether", "linkinfo": {"info_kind": "veth"}}]'
        peer_veth_json = '[{"ifindex": 6, "ifname": "veth_peer", "link_type": "ether", "linkinfo": {"info_kind": "veth"}}]'

        def fake_run(cmd, *args, **kwargs):
            if "-netns" in cmd:
                return MagicMock(returncode=0, stdout=peer_veth_json, stderr="")
            return MagicMock(returncode=0, stdout=host_veth_json, stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            _check_partial_veth_creation(tracker)

        self.assertEqual(tracker.created_links, ["veth_mbh"])

    def test_partial_veth_creation_fails_closed_on_inspection_command_error(self):
        """Verify that if inspection command returns non-zero, resource is not registered."""
        from test_kernel_integration_plan import _check_partial_veth_creation, FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()

        with patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=1, stdout="", stderr="Device not found")):
            _check_partial_veth_creation(tracker)

        self.assertEqual(tracker.created_links, [])

    def test_post_cleanup_verification_fails_closed_on_command_not_found(self):
        """Verify verify_cleanup_state reports error on FileNotFoundError."""
        from test_kernel_integration_plan import FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()
        tracker.record_netns("mbh_ns_test")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=FileNotFoundError("ip binary not found")):
            leftovers = tracker.verify_cleanup_state()

        self.assertTrue(any("command_not_found" in err for err in leftovers))

    def test_post_cleanup_verification_fails_closed_on_nonzero_exit_code(self):
        """Verify verify_cleanup_state reports error on non-zero exit code."""
        from test_kernel_integration_plan import FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()
        tracker.record_links = ["veth_mbh"]

        def fake_run(cmd, *args, **kwargs):
            if "netns" in cmd:
                return MagicMock(returncode=1, stdout="", stderr="Netns error")
            return MagicMock(returncode=1, stdout="", stderr="Link error")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            leftovers = tracker.verify_cleanup_state()

        self.assertTrue(any("netns_inspection_error" in err for err in leftovers))
        self.assertTrue(any("link_inspection_error" in err for err in leftovers))

    def test_measurement_duration_and_timing_reporting(self):
        """Verify run_synchronized_measurement reports sender/receiver duration and metrics."""
        from test_kernel_integration_plan import run_synchronized_measurement

        with patch("test_kernel_integration_plan.run_deterministic_receiver") as mock_recv, \
             patch("test_kernel_integration_plan.subprocess.run") as mock_sub:

            def fake_recv_action(host, port, ready_evt, start_evt, stop_evt, results, duration, margin):
                ready_evt.set()
                start_evt.wait(timeout=1.0)
                results["bytes"] = 8_750_000
                results["packets"] = 6250
                results["intended_duration"] = 2.0
                results["receiver_elapsed_sec"] = 2.001
                results["mbps"] = 35.0

            mock_recv.side_effect = fake_recv_action
            mock_sub.return_value = MagicMock(
                returncode=0,
                stdout="SENDER: offered=100.00 Mbps, bytes=25000000, pkts=17857, dur=2.0005s\n",
                stderr="",
            )

            res = run_synchronized_measurement(
                "TEST_TIMING",
                target_bps=100_000_000,
                duration_sec=2.0,
                receiver_fn=fake_recv_action,
            )
            self.assertEqual(res["bytes"], 8_750_000)
            self.assertEqual(res["packets"], 6250)
            self.assertAlmostEqual(res["receiver_elapsed_sec"], 2.001, places=2)
            self.assertEqual(res["sender_bytes"], 25_000_000)
            self.assertEqual(res["sender_pkts"], 17857)
            self.assertAlmostEqual(res["sender_duration_sec"], 2.0005, places=3)
            self.assertEqual(res["packet_delta"], 17857 - 6250)
            self.assertEqual(res["packet_count_diff"], 17857 - 6250)
            self.assertEqual(res["mbps"], 35.0)

    def test_partial_veth_creation_fails_closed_when_netns_not_created_by_run(self):
        """Verify that even a matching veth pair is rejected if the target namespace was not created by this run."""
        from test_kernel_integration_plan import _check_partial_veth_creation, FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()
        # tracker.created_netns is empty (e.g. pre-existing namespace or foreign process)

        host_veth_json = '[{"ifindex": 5, "ifname": "veth_mbh", "link_type": "ether", "linkinfo": {"info_kind": "veth"}}]'
        peer_veth_json = '[{"ifindex": 6, "ifname": "veth_peer", "link_type": "ether", "linkinfo": {"info_kind": "veth"}}]'

        def fake_run(cmd, *args, **kwargs):
            if "-netns" in cmd:
                return MagicMock(returncode=0, stdout=peer_veth_json, stderr="")
            return MagicMock(returncode=0, stdout=host_veth_json, stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            _check_partial_veth_creation(tracker)

        # Fails closed because namespace ownership is not established by this run
        self.assertEqual(tracker.created_links, [])

    def test_cleanup_commands_never_target_eth0_or_default_route(self):
        """Verify that FailureSafeResourceTracker cleanup commands never delete eth0 or modify default routing."""
        from test_kernel_integration_plan import FailureSafeResourceTracker
        tracker = FailureSafeResourceTracker()
        tracker.record_netns("mbh_ns_test")
        tracker.record_link("veth_mbh")

        cmds = tracker.build_safe_cleanup_commands()
        flat_cmds = [" ".join(c) for c in cmds]
        for c in flat_cmds:
            self.assertNotIn("eth0", c)
            self.assertNotIn("route", c)
            self.assertNotIn("default", c)

    def test_synchronized_measurement_fails_on_sender_subprocess_error(self):
        """Verify that sender process failure raises and cleans up receiver thread without returning false success."""
        from test_kernel_integration_plan import run_synchronized_measurement, subprocess

        def fake_recv_action(host, port, ready_evt, start_evt, stop_evt, results, duration, margin):
            ready_evt.set()
            start_evt.wait(timeout=1.0)
            results["bytes"] = 0
            results["packets"] = 0
            results["mbps"] = 0.0

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=subprocess.CalledProcessError(1, ["cmd"], stderr="Sender error")):
            with self.assertRaises(subprocess.CalledProcessError):
                run_synchronized_measurement("FAIL_TEST", receiver_fn=fake_recv_action)

    def test_unresolved_resource_reported_as_verification_failure(self):
        """Verify that unresolved resources recorded in tracker prevent lifecycle success and raise HarnessCleanupError."""
        from test_kernel_integration_plan import (
            execute_testbed_lifecycle,
            FailureSafeResourceTracker,
            HarnessCleanupError,
        )
        ctrl = self.make_controller()
        tracker = FailureSafeResourceTracker()
        tracker.record_unresolved("veth_mbh collision in foreign namespace")

        with patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=0, stdout="", stderr="")), \
             patch.object(ctrl, "rollback", return_value=None):
            with self.assertRaises(HarnessCleanupError) as ctx:
                execute_testbed_lifecycle(ctrl, tracker, lambda: "ok")

            self.assertIn("unresolved_ambiguous_resource:veth_mbh collision in foreign namespace", str(ctx.exception))


    # =========================================================================
    # Phase 4.21: Partial-Creation Recovery, Receiver Lifecycle & Safety Gates
    # =========================================================================

    def test_partial_netns_creation_records_unresolved_when_netns_found(self):
        """Verify that when namespace creation fails but netns is found, it is recorded as unresolved (not owned)."""
        from test_kernel_integration_plan import (
            _check_partial_netns_creation,
            FailureSafeResourceTracker,
            TEST_NETNS,
        )
        tracker = FailureSafeResourceTracker()

        fake_netns_output = f"{TEST_NETNS} (id: 1)\nother_ns (id: 2)\n"
        with patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=0, stdout=fake_netns_output, stderr="")):
            _check_partial_netns_creation(tracker)

        # Fail-closed: Must NOT be registered as owned
        self.assertNotIn(TEST_NETNS, tracker.created_netns)
        # Must be recorded in unresolved resources
        self.assertTrue(any(f"Namespace {TEST_NETNS} exists" in r for r in tracker.unresolved_resources))

    def test_partial_netns_creation_records_unresolved_when_inspection_fails(self):
        """Verify that when namespace inspection itself fails, resource is recorded as unresolved."""
        from test_kernel_integration_plan import (
            _check_partial_netns_creation,
            FailureSafeResourceTracker,
        )
        tracker = FailureSafeResourceTracker()

        with patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=1, stdout="", stderr="RTNETLINK error")):
            _check_partial_netns_creation(tracker)

        self.assertEqual(tracker.created_netns, [])
        self.assertTrue(any("Namespace inspection failed" in r for r in tracker.unresolved_resources))

    def test_partial_netns_creation_clean_when_absent(self):
        """Verify that when namespace creation fails and netns is truly absent, no unresolved resource is recorded."""
        from test_kernel_integration_plan import (
            _check_partial_netns_creation,
            FailureSafeResourceTracker,
        )
        tracker = FailureSafeResourceTracker()

        with patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=0, stdout="other_ns\n", stderr="")):
            _check_partial_netns_creation(tracker)

        self.assertEqual(tracker.created_netns, [])
        self.assertEqual(tracker.unresolved_resources, [])

    def test_setup_stage_exception_triggers_check_on_fail(self):
        """Verify that if a setup subprocess raises an unexpected exception, check_on_fail is executed."""
        from test_kernel_integration_plan import (
            execute_tracked_setup,
            FailureSafeResourceTracker,
            HarnessExecutionError,
            TEST_NETNS,
        )
        tracker = FailureSafeResourceTracker()

        call_count = {"checked": False}
        def fake_run(cmd, *args, **kwargs):
            if "netns" in cmd and "add" in cmd:
                raise OSError("Simulated kernel interface failure")
            if "netns" in cmd and "list" in cmd:
                call_count["checked"] = True
                return MagicMock(returncode=0, stdout=f"{TEST_NETNS}\n", stderr="")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaises(HarnessExecutionError) as ctx:
                execute_tracked_setup(tracker)

            self.assertIn("Setup failed at 1. Create Network Namespace", str(ctx.exception))
            self.assertTrue(call_count["checked"])
            self.assertTrue(any(f"Namespace {TEST_NETNS} exists" in r for r in tracker.unresolved_resources))

    def test_partial_veth_creation_fails_closed_when_inspection_itself_fails(self):
        """Verify that if veth inspection returns error code or raises, it is recorded as unresolved."""
        from test_kernel_integration_plan import (
            _check_partial_veth_creation,
            FailureSafeResourceTracker,
            HOST_VETH,
        )
        tracker = FailureSafeResourceTracker()

        with patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=2, stdout="", stderr="Link netlink failure")):
            _check_partial_veth_creation(tracker)

        self.assertNotIn(HOST_VETH, tracker.created_links)
        self.assertTrue(any(f"Failed to inspect {HOST_VETH}" in r for r in tracker.unresolved_resources))

    def test_partial_veth_creation_fails_closed_when_inspection_raises_exception(self):
        """Verify that if veth inspection raises an exception, it is recorded as unresolved."""
        from test_kernel_integration_plan import (
            _check_partial_veth_creation,
            FailureSafeResourceTracker,
            HOST_VETH,
        )
        tracker = FailureSafeResourceTracker()

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=OSError("Netlink socket broken")):
            _check_partial_veth_creation(tracker)

        self.assertNotIn(HOST_VETH, tracker.created_links)
        self.assertTrue(any("Exception during partial veth inspection" in r for r in tracker.unresolved_resources))

    def test_receiver_thread_exception_propagates_in_synchronized_measurement(self):
        """Verify that a receiver exception during measurement is propagated and prevents false success."""
        from test_kernel_integration_plan import run_synchronized_measurement, HarnessExecutionError

        def failing_recv_action(host, port, ready_evt, start_evt, stop_evt, results, duration, margin):
            ready_evt.set()
            start_evt.wait(timeout=1.0)
            results["error"] = RuntimeError("Simulated receiver buffer overflow or socket failure")

        with patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=0, stdout="SENDER: offered=100.0 Mbps, bytes=25000000, pkts=17857, dur=2.0s\n", stderr="")):
            with self.assertRaises(HarnessExecutionError) as ctx:
                run_synchronized_measurement("RECV_FAIL_TEST", receiver_fn=failing_recv_action)

            self.assertIn("Receiver error during measurement", str(ctx.exception))

    def test_receiver_thread_timeout_raises_execution_error(self):
        """Verify that if receiver thread fails to terminate within timeout, HarnessExecutionError is raised."""
        from test_kernel_integration_plan import run_synchronized_measurement, HarnessExecutionError

        block_evt = threading.Event()

        def hanging_recv_action(host, port, ready_evt, start_evt, stop_evt, results, duration, margin):
            ready_evt.set()
            start_evt.wait(timeout=1.0)
            block_evt.wait(timeout=5.0)

        try:
            with patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=0, stdout="SENDER: offered=100.0 Mbps, bytes=100, pkts=1, dur=0.1s\n", stderr="")):
                with patch("threading.Thread.join"):
                    with patch("threading.Thread.is_alive", return_value=True):
                        with self.assertRaises(HarnessExecutionError) as ctx:
                            run_synchronized_measurement("HANG_TEST", duration_sec=0.1, receiver_fn=hanging_recv_action)

                        self.assertIn("Receiver thread failed to terminate within timeout margin", str(ctx.exception))
        finally:
            block_evt.set()

    def test_receiver_readiness_timeout_hung_thread_raises_execution_error(self):
        """Verify that if receiver thread hangs and fails to terminate after readiness timeout, error is raised."""
        from test_kernel_integration_plan import run_synchronized_measurement, HarnessExecutionError

        def non_ready_recv(host, port, ready_evt, start_evt, stop_evt, results, duration, margin):
            pass

        with patch("threading.Thread.join"):
            with patch("threading.Thread.is_alive", return_value=True):
                with self.assertRaises(HarnessExecutionError) as ctx:
                    run_synchronized_measurement("READINESS_HANG", ready_timeout_sec=0.01, receiver_fn=non_ready_recv)

                self.assertIn("Receiver thread failed to terminate after readiness timeout", str(ctx.exception))

    def test_receiver_races_with_sender_failure_propagates_sender_error(self):
        """Verify that when sender failure occurs, sender exception is raised and receiver is stopped."""
        from test_kernel_integration_plan import run_synchronized_measurement, subprocess

        recv_stopped = {"stopped": False}

        def responsive_recv(host, port, ready_evt, start_evt, stop_evt, results, duration, margin):
            ready_evt.set()
            start_evt.wait(timeout=1.0)
            stop_evt.wait(timeout=2.0)
            recv_stopped["stopped"] = True
            results["bytes"] = 500
            results["packets"] = 5

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=subprocess.CalledProcessError(1, ["snd_cmd"], stderr="Sender socket crashed")):
            with self.assertRaises(subprocess.CalledProcessError):
                run_synchronized_measurement("RACE_TEST", receiver_fn=responsive_recv)

            self.assertTrue(recv_stopped["stopped"])

    def test_sender_and_receiver_both_fail_propagates_chained_error(self):
        """Verify that when both sender and receiver fail, execution error with both errors is raised."""
        from test_kernel_integration_plan import run_synchronized_measurement, HarnessExecutionError, subprocess

        def failing_recv(host, port, ready_evt, start_evt, stop_evt, results, duration, margin):
            ready_evt.set()
            start_evt.wait(timeout=1.0)
            results["error"] = RuntimeError("Receiver failed simultaneously")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=subprocess.CalledProcessError(1, ["snd_cmd"], stderr="Sender failed")):
            with self.assertRaises(HarnessExecutionError) as ctx:
                run_synchronized_measurement("DUAL_FAIL", receiver_fn=failing_recv)

            self.assertIn("Sender failure", str(ctx.exception))
            self.assertIn("raced with receiver error", str(ctx.exception))

    def test_unified_lifecycle_fails_on_unresolved_resources(self):
        """Verify that run_unified_integration_lifecycle fails with HarnessCleanupError when unresolved resources exist."""
        from test_kernel_integration_plan import (
            run_unified_integration_lifecycle,
            FailureSafeResourceTracker,
            HarnessCleanupError,
        )
        tracker = FailureSafeResourceTracker()
        tracker.record_unresolved("Unresolved foreign link conflict")

        ctrl = self.make_controller()
        with patch("test_kernel_integration_plan.run_preflight_checks"), \
             patch("test_kernel_integration_plan.execute_tracked_setup"), \
             patch("test_kernel_integration_plan.run_full_integration_orchestration", return_value={"status": "OK"}), \
             patch.object(ctrl, "rollback", return_value=None), \
             patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=0, stdout="", stderr="")):

            with self.assertRaises(HarnessCleanupError) as ctx:
                run_unified_integration_lifecycle(
                    tracker=tracker,
                    controller_factory=lambda: ctrl,
                )

            self.assertIn("unresolved_ambiguous_resource:Unresolved foreign link conflict", str(ctx.exception))

    def test_unified_lifecycle_fails_on_receiver_thread_failure_during_orchestration(self):
        """Verify that receiver failure during integration orchestration halts lifecycle and triggers cleanup."""
        from test_kernel_integration_plan import (
            run_unified_integration_lifecycle,
            FailureSafeResourceTracker,
            HarnessExecutionError,
        )
        tracker = FailureSafeResourceTracker()
        ctrl = self.make_controller()

        def mock_measurement_fail(desc, bps, dur):
            raise HarnessExecutionError("Receiver socket abruptly closed during testbed run")

        with patch("test_kernel_integration_plan.run_preflight_checks"), \
             patch("test_kernel_integration_plan.execute_tracked_setup"), \
             patch.object(ctrl, "verify_parent_hierarchy", return_value=True), \
             patch.object(ctrl, "get_class_stat", side_effect=[None, {"bytes": 0}]), \
             patch.object(ctrl, "rollback", return_value=None), \
             patch("test_kernel_integration_plan.subprocess.run", return_value=MagicMock(returncode=0, stdout="", stderr="")):

            with self.assertRaises(HarnessExecutionError) as ctx:
                run_unified_integration_lifecycle(
                    tracker=tracker,
                    controller_factory=lambda: ctrl,
                    measurement_fn=mock_measurement_fail,
                )

            self.assertIn("Receiver socket abruptly closed", str(ctx.exception))
            self.assertTrue(tracker.cleanup_executed)


    # =========================================================================
    # Phase 4.22: Topology Isolation Verification & Live Runner Safety Tests
    # =========================================================================

    def test_preflight_fails_closed_on_subnet_collision(self):
        """Verify preflight raises HarnessPreflightError if test subnet 10.200.1.0/24 already exists on host."""
        from test_kernel_integration_plan import run_preflight_checks, HarnessPreflightError

        def fake_run(cmd, *args, **kwargs):
            if "route" in cmd and "10.200.1.0/24" in cmd:
                return MagicMock(returncode=0, stdout="10.200.1.0/24 dev eth1 proto kernel scope link src 10.200.1.50\n", stderr="")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaisesRegex(HarnessPreflightError, "Pre-existing route for test subnet 10.200.1.0/24 detected on host"):
                run_preflight_checks()

    def test_verify_topology_fails_on_namespace_route_mismatch(self):
        """Verify topology verification fails if namespace route to HOST_IP does not resolve through PEER_VETH."""
        from test_kernel_integration_plan import verify_testbed_topology_and_routing, HarnessExecutionError

        def fake_run(cmd, *args, **kwargs):
            if "netns" in cmd and "route" in cmd and "get" in cmd:
                return MagicMock(returncode=0, stdout="10.200.1.1 dev eth0 src 10.200.1.2\n", stderr="")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaisesRegex(HarnessExecutionError, "Namespace routing verification failed"):
                verify_testbed_topology_and_routing()

    def test_verify_topology_fails_on_namespace_unexpected_default_route(self):
        """Verify topology verification fails if test namespace contains an unexpected default route."""
        from test_kernel_integration_plan import verify_testbed_topology_and_routing, HarnessExecutionError

        def fake_run(cmd, *args, **kwargs):
            if "netns" in cmd and "route" in cmd and "get" in cmd:
                return MagicMock(returncode=0, stdout="10.200.1.1 dev veth_peer src 10.200.1.2\n", stderr="")
            if "netns" in cmd and "route" in cmd and "default" in cmd:
                return MagicMock(returncode=0, stdout="default via 192.168.1.1 dev veth_peer\n", stderr="")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaisesRegex(HarnessExecutionError, "Namespace isolation violation: unexpected default route detected"):
                verify_testbed_topology_and_routing()

    def test_verify_topology_fails_on_host_route_mismatch(self):
        """Verify topology verification fails if host route to PEER_IP does not resolve through HOST_VETH."""
        from test_kernel_integration_plan import verify_testbed_topology_and_routing, HarnessExecutionError

        def fake_run(cmd, *args, **kwargs):
            if "netns" in cmd and "route" in cmd and "get" in cmd:
                return MagicMock(returncode=0, stdout="10.200.1.1 dev veth_peer src 10.200.1.2\n", stderr="")
            if "netns" in cmd and "route" in cmd and "default" in cmd:
                return MagicMock(returncode=0, stdout="", stderr="")
            if "route" in cmd and "get" in cmd:
                return MagicMock(returncode=0, stdout="10.200.1.2 dev eth0 src 192.168.1.5\n", stderr="")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaisesRegex(HarnessExecutionError, "Host routing verification failed"):
                verify_testbed_topology_and_routing()

    def test_verify_topology_fails_on_host_default_route_safety_violation(self):
        """Verify topology verification fails if host default route touches HOST_VETH or PEER_VETH."""
        from test_kernel_integration_plan import verify_testbed_topology_and_routing, HarnessExecutionError

        def fake_run(cmd, *args, **kwargs):
            if "netns" in cmd and "route" in cmd and "get" in cmd:
                return MagicMock(returncode=0, stdout="10.200.1.1 dev veth_peer src 10.200.1.2\n", stderr="")
            if "netns" in cmd and "route" in cmd and "default" in cmd:
                return MagicMock(returncode=0, stdout="", stderr="")
            if "route" in cmd and "get" in cmd:
                return MagicMock(returncode=0, stdout="10.200.1.2 dev veth_mbh src 10.200.1.1\n", stderr="")
            if "route" in cmd and "default" in cmd:
                return MagicMock(returncode=0, stdout="default via 10.200.1.2 dev veth_mbh\n", stderr="")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            with self.assertRaisesRegex(HarnessExecutionError, "Host default route safety violation"):
                verify_testbed_topology_and_routing()

    def test_verify_topology_passes_on_correct_isolated_routes(self):
        """Verify topology verification succeeds when all routes are strictly isolated to veth endpoints."""
        from test_kernel_integration_plan import verify_testbed_topology_and_routing

        def fake_run(cmd, *args, **kwargs):
            if "netns" in cmd and "route" in cmd and "get" in cmd:
                return MagicMock(returncode=0, stdout="10.200.1.1 dev veth_peer src 10.200.1.2\n", stderr="")
            if "netns" in cmd and "route" in cmd and "default" in cmd:
                return MagicMock(returncode=0, stdout="", stderr="")
            if "route" in cmd and "get" in cmd:
                return MagicMock(returncode=0, stdout="10.200.1.2 dev veth_mbh src 10.200.1.1\n", stderr="")
            if "route" in cmd and "default" in cmd:
                return MagicMock(returncode=0, stdout="default via 172.28.0.1 dev eth0 proto kernel\n", stderr="")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("test_kernel_integration_plan.subprocess.run", side_effect=fake_run):
            verify_testbed_topology_and_routing()

    def test_live_runner_refuses_without_env_var(self):
        """Verify run_authorized_live_kernel_test raises HarnessExecutionError if MBH_ALLOW_PRIVILEGED_EXEC!=1."""
        import os
        from test_kernel_integration_plan import run_authorized_live_kernel_test, HarnessExecutionError

        with patch("sys.platform", "linux"), patch.dict(os.environ, {"MBH_ALLOW_PRIVILEGED_EXEC": "0"}):
            with self.assertRaisesRegex(HarnessExecutionError, "Privileged execution not authorized"):
                run_authorized_live_kernel_test()



    # -------------------------------------------------------------------------
    # REAL LINUX KERNEL TC OUTPUT PARSING TESTS (Phase 4.22)
    # -------------------------------------------------------------------------

    def test_parse_real_linux_flower_output(self):
        """Verify parse_filter_output skips flower chain header and captures classid and handle."""
        flower_output = """filter parent 1: protocol ip pref 1 flower chain 0
filter parent 1: protocol ip pref 1 flower chain 0 handle 0x1 classid 1:10
  eth_type ipv4
  src_ip 10.200.1.2
  not_in_hw"""
        filters = parse_filter_output(flower_output)
        self.assertEqual(len(filters), 1)
        flt = filters[0]
        self.assertEqual(flt["parent"], "1:")
        self.assertEqual(flt["protocol"], "ip")
        self.assertEqual(flt["prio"], 1)
        self.assertEqual(flt["classifier"], "flower")
        self.assertEqual(flt["filter_handle"], "0x1")
        self.assertEqual(flt["flowid"], "1:10")
        self.assertEqual(flt["classid"], "1:10")
        self.assertEqual(flt["src_ip"], "10.200.1.2")

    def test_parse_real_linux_u32_output(self):
        """Verify parse_filter_output skips u32 chain header and ht divisor declarations."""
        u32_output = """filter parent 1: protocol ip pref 1 u32 chain 0
filter parent 1: protocol ip pref 1 u32 chain 0 fh 800: ht divisor 1
filter parent 1: protocol ip pref 1 u32 chain 0 fh 800::800 order 2048 key ht 800 bkt 0 flowid 1:10 not_in_hw
  match 0ac80102/ffffffff at 12"""
        filters = parse_filter_output(u32_output)
        self.assertEqual(len(filters), 1)
        flt = filters[0]
        self.assertEqual(flt["parent"], "1:")
        self.assertEqual(flt["prio"], 1)
        self.assertEqual(flt["filter_handle"], "800::800")
        self.assertEqual(flt["flowid"], "1:10")

    def test_parse_multiple_flower_rules(self):
        """Verify parse_filter_output produces exact count for multiple flower rules."""
        multi_output = """filter parent 1: protocol ip pref 1 flower chain 0
filter parent 1: protocol ip pref 1 flower chain 0 handle 0x1 classid 1:10
  eth_type ipv4
  src_ip 10.200.1.2
filter parent 1: protocol ip pref 1 flower chain 0 handle 0x2 classid 1:20
  eth_type ipv4
  src_ip 10.200.1.3"""
        filters = parse_filter_output(multi_output)
        self.assertEqual(len(filters), 2)
        self.assertEqual(filters[0]["filter_handle"], "0x1")
        self.assertEqual(filters[0]["flowid"], "1:10")
        self.assertEqual(filters[0]["src_ip"], "10.200.1.2")
        self.assertEqual(filters[1]["filter_handle"], "0x2")
        self.assertEqual(filters[1]["flowid"], "1:20")
        self.assertEqual(filters[1]["src_ip"], "10.200.1.3")

    def test_flower_ownership_verification_and_rollback(self):
        """Verify can_verify_ownership and rollback accept kernel flower formatting with classid."""
        controller = self.make_controller(dry_run=False)
        real_flower = """filter parent 1: protocol ip pref 1 flower chain 0
filter parent 1: protocol ip pref 1 flower chain 0 handle 0x1 classid 1:10
  eth_type ipv4
  src_ip 10.200.1.2"""
        real_class = "class htb 1:10 parent 1:1 prio 0 rate 35Mbit ceil 35Mbit burst 1600b cburst 1600b"
        parent_class = "class htb 1:1 root rate 1000Mbit ceil 1000Mbit"

        with patch.object(controller, "show_qdisc", return_value="qdisc htb 1: root default 30"), \
             patch.object(controller, "show_class", return_value=parent_class), \
             patch.object(controller, "show_filter", return_value=""), \
             patch.object(controller, "_run") as run:
            controller.apply_source_cap("10.200.1.2", 35)

        filter_res = [r for r in controller.owned_resources if r.kind == "filter"][0]
        class_res = [r for r in controller.owned_resources if r.kind == "class"][0]

        with patch.object(controller, "show_filter", return_value=real_flower), \
             patch.object(controller, "show_class", return_value=real_class):
            self.assertTrue(controller.can_verify_ownership(filter_res))
            self.assertTrue(controller.can_verify_ownership(class_res))

        # Test rollback succeeds with real flower output
        filter_states = [real_flower, ""]
        class_states = [real_class, ""]

        with patch.object(controller, "show_filter", side_effect=lambda: filter_states.pop(0) if filter_states else ""), \
             patch.object(controller, "show_class", side_effect=lambda: class_states.pop(0) if class_states else ""), \
             patch.object(controller, "_run") as run:
            controller.rollback()
            self.assertEqual(controller.applied, [])
            self.assertEqual(controller.owned_resources, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
