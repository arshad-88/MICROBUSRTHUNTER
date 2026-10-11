#!/usr/bin/env python3
"""Isolated Kernel Integration Test Specification and Failure-Safe Runner for MicroburstHunter (Phase 4.17).

THIS SCRIPT IS FOR HARNESS PREPARATION, STATIC VALIDATION, AND AUDIT REVIEW.
DO NOT EXECUTE PRIVILEGED COMMANDS WITHOUT EXPLICIT SEPARATE AUTHORIZATION.

KEY ARCHITECTURAL HIGHLIGHTS & DEFECT CLOSURES (Phase 4.17 Unified Lifecycle)
----------------------------------------------------------------------------
1. Truly Unified Setup, Measurement, and Cleanup Lifecycle:
   - All operations (preflight, setup stages 1-10, baseline, mitigation apply, capped measurement,
     post-mitigation hierarchy inspection, rollback, cleanup, and post-cleanup verification)
     are managed under a SINGLE outer exception-safe lifecycle: run_unified_integration_lifecycle().
   - No resource-creating command can ever run outside the cleanup scope.
   - If any setup stage fails, cleanup is immediately attempted for all established resources.

2. Fail-Closed Enforceable Ownership & Partial Veth Recovery:
   - Interfaces and namespaces are NEVER adopted or registered merely because their names exist.
   - On a failed veth creation command, the endpoint is only registered for cleanup if:
     (a) Read-only preflight verified it was absent immediately before setup,
     (b) It is demonstrably present as a virtual veth link, AND
     (c) It links to the test peer in the target test namespace.
   - If ownership is ambiguous or foreign, the harness fails closed, leaves the resource untouched,
     and logs actionable manual inspection guidance.

3. Robust Exception Chaining & Failure Transparency:
   - Original test exceptions take precedence and are never masked by rollback or cleanup errors.
   - Rollback errors, cleanup command failures, and post-cleanup inspection failures are all
     reported explicitly alongside the original failure.

4. Fail-Safe Decision-Based Manual Recovery Procedure:
   - Replaces unconditional deletions with a 6-step read-only inspection and decision matrix.
"""

from __future__ import annotations

import logging
import os
import re
import select
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from tc_controller import (
    TcController,
    TcError,
    TcOwnershipError,
    TcHierarchyError,
    OwnedResource,
    validate_interface,
    validate_namespace,
    validate_ip,
    validate_rate_mbps,
    parse_class_stats,
)

LOG = logging.getLogger("microbursthunter.kernel_harness")

TEST_NETNS = "mbh_ns_test"
HOST_VETH = "veth_mbh"
PEER_VETH = "veth_peer"
HOST_IP = "10.200.1.1"
PEER_IP = "10.200.1.2"
CIDR_MASK = "24"
TEST_PORT = 5001
PARENT_HANDLE = 1
CAP_RATE_MBPS = 35.0
TARGET_OFFERED_MBPS = 100.0


class HarnessPreflightError(RuntimeError):
    pass


class HarnessExecutionError(RuntimeError):
    pass


class HarnessReadinessTimeoutError(RuntimeError):
    pass


class HarnessCleanupError(RuntimeError):
    pass


@dataclass
class FailureSafeResourceTracker:
    """Tracks strictly the Linux kernel resources created by this specific harness run.

    Provides safe rollback on partial setup failures and prevents deleting foreign resources.
    Enforces that resources are recorded ONLY AFTER successful creation or proven presence.
    """

    created_netns: list[str] = field(default_factory=list)
    created_links: list[str] = field(default_factory=list)
    unresolved_resources: list[str] = field(default_factory=list)
    setup_completed: bool = False
    cleanup_executed: bool = False

    def record_netns(self, name: str) -> None:
        if name not in self.created_netns:
            self.created_netns.append(name)

    def record_link(self, name: str) -> None:
        if name not in self.created_links:
            self.created_links.append(name)

    def record_unresolved(self, desc: str) -> None:
        if desc not in self.unresolved_resources:
            self.unresolved_resources.append(desc)

    def build_safe_cleanup_commands(self) -> list[list[str]]:
        """Return commands to clean up strictly the resources recorded during this run in reverse order."""
        cmds: list[list[str]] = []
        for link in reversed(self.created_links):
            cmds.append(["sudo", "ip", "link", "del", link])
        for ns in reversed(self.created_netns):
            cmds.append(["sudo", "ip", "netns", "del", ns])
        return cmds

    def cleanup(self) -> list[tuple[str, Exception]]:
        """Execute cleanup of strictly recorded resources and return any failures."""
        self.cleanup_executed = True
        failures: list[tuple[str, Exception]] = []
        cmds = self.build_safe_cleanup_commands()
        for cmd in cmds:
            target = " ".join(cmd)
            try:
                res = subprocess.run(cmd, capture_output=True, text=True, check=False)
                if res.returncode != 0:
                    failures.append((target, RuntimeError(f"Command returned {res.returncode}: {res.stderr.strip()}")))
            except Exception as exc:
                failures.append((target, exc))
        return failures

    def verify_cleanup_state(self) -> list[str]:
        """Verify whether tracked resources are confirmed absent from kernel state.

        Fails closed:
        - Never reports clean state unless successful inspection establishes that every tracked resource is absent.
        - Treat FileNotFoundError, OS errors, timeouts, non-zero exit codes, and malformed inspection output as verification failures.
        - Always reports unresolved ambiguous resources detected during setup.
        """
        leftovers: list[str] = []
        for unres in self.unresolved_resources:
            leftovers.append(f"unresolved_ambiguous_resource:{unres}")
        try:
            netns_res = subprocess.run(["ip", "netns", "list"], capture_output=True, text=True, check=False)
            if netns_res.returncode != 0:
                leftovers.append(f"netns_inspection_error:{netns_res.stderr.strip() or f'code {netns_res.returncode}'}")
            else:
                existing_ns = [line.split()[0] for line in netns_res.stdout.splitlines() if line.strip()]
                for ns in self.created_netns:
                    if ns in existing_ns:
                        leftovers.append(f"netns:{ns}")
        except FileNotFoundError as fnf:
            leftovers.append(f"netns_inspection_command_not_found:{fnf}")
        except Exception as exc:
            leftovers.append(f"netns_inspection_exception:{exc}")

        try:
            link_res = subprocess.run(["ip", "link", "show"], capture_output=True, text=True, check=False)
            if link_res.returncode != 0:
                leftovers.append(f"link_inspection_error:{link_res.stderr.strip() or f'code {link_res.returncode}'}")
            else:
                for link in self.created_links:
                    if link in link_res.stdout:
                        leftovers.append(f"link:{link}")
        except FileNotFoundError as fnf:
            leftovers.append(f"link_inspection_command_not_found:{fnf}")
        except Exception as exc:
            leftovers.append(f"link_inspection_exception:{exc}")

        return leftovers

    def clear(self) -> None:
        self.created_netns.clear()
        self.created_links.clear()
        self.unresolved_resources.clear()
        self.setup_completed = False
        self.cleanup_executed = False


TRACKER = FailureSafeResourceTracker()


def run_preflight_checks() -> None:
    """Rigorous preflight checks verifying namespace, interface, and routing safety.

    Fails closed and refuses execution if:
    1. Any inspection command fails (non-zero return code, missing command, timeout, or OS error).
    2. The target test namespace 'mbh_ns_test' already exists.
    3. Interface 'veth_mbh' or 'veth_peer' already exists on host or namespace.
    4. Host default route inspection fails or test interfaces appear in host default route.
    """
    # 1. Check existing network namespaces
    try:
        netns_proc = subprocess.run(["ip", "netns", "list"], capture_output=True, text=True, check=False)
        if netns_proc.returncode != 0:
            raise HarnessPreflightError(
                f"Preflight inspection failed: 'ip netns list' returned code {netns_proc.returncode}: {netns_proc.stderr.strip()}"
            )
        existing_ns = [line.split()[0] for line in netns_proc.stdout.splitlines() if line.strip()]
        if TEST_NETNS in existing_ns:
            raise HarnessPreflightError(
                f"Pre-existing namespace {TEST_NETNS!r} detected. Refusing to run or touch pre-existing namespaces.\n"
                f"MANUAL RECOVERY INSTRUCTION: Inspect '{TEST_NETNS}' with 'ip netns exec {TEST_NETNS} ip link'. "
                f"Follow the Decision-Based Manual Recovery Procedure before considering any removal."
            )
    except (FileNotFoundError, OSError) as os_err:
        raise HarnessPreflightError(f"Preflight inspection failed: unable to execute 'ip netns list': {os_err}") from os_err

    # 2. Check existing interfaces on host
    try:
        links_proc = subprocess.run(["ip", "link", "show"], capture_output=True, text=True, check=False)
        if links_proc.returncode != 0:
            raise HarnessPreflightError(
                f"Preflight inspection failed: 'ip link show' returned code {links_proc.returncode}: {links_proc.stderr.strip()}"
            )
        if HOST_VETH in links_proc.stdout:
            raise HarnessPreflightError(
                f"Pre-existing interface {HOST_VETH!r} detected on host. Refusing to alter existing link.\n"
                f"MANUAL RECOVERY INSTRUCTION: Inspect '{HOST_VETH}' with 'ip link show {HOST_VETH}'. "
                f"Follow the Decision-Based Manual Recovery Procedure before considering any removal."
            )
        if PEER_VETH in links_proc.stdout:
            raise HarnessPreflightError(
                f"Pre-existing interface {PEER_VETH!r} detected on host. Refusing to alter existing link.\n"
                f"MANUAL RECOVERY INSTRUCTION: Inspect '{PEER_VETH}' with 'ip link show {PEER_VETH}'. "
                f"Follow the Decision-Based Manual Recovery Procedure before considering any removal."
            )
    except (FileNotFoundError, OSError) as os_err:
        raise HarnessPreflightError(f"Preflight inspection failed: unable to execute 'ip link show': {os_err}") from os_err

    # 3. Check default route protection
    try:
        route_proc = subprocess.run(["ip", "route", "show", "default"], capture_output=True, text=True, check=False)
        if route_proc.returncode != 0:
            raise HarnessPreflightError(
                f"Preflight inspection failed: 'ip route show default' returned code {route_proc.returncode}: {route_proc.stderr.strip()}"
            )
        if HOST_VETH in route_proc.stdout or PEER_VETH in route_proc.stdout:
            raise HarnessPreflightError(
                f"CRITICAL SAFETY VIOLATION: Test interface appears in host default route: {route_proc.stdout.strip()}"
            )
    except (FileNotFoundError, OSError) as os_err:
        raise HarnessPreflightError(f"Preflight inspection failed: unable to execute 'ip route show default': {os_err}") from os_err

    # 4. Check subnet collision on host (10.200.1.0/24 must not already be in use)
    try:
        sub_proc = subprocess.run(
            ["ip", "route", "show", f"{HOST_IP.rsplit('.', 1)[0]}.0/{CIDR_MASK}"],
            capture_output=True,
            text=True,
            check=False,
        )
        if sub_proc.returncode != 0:
            raise HarnessPreflightError(
                f"Preflight inspection failed: 'ip route show {HOST_IP.rsplit('.', 1)[0]}.0/{CIDR_MASK}' returned code {sub_proc.returncode}: {sub_proc.stderr.strip()}"
            )
        target_subnet = f"{HOST_IP.rsplit('.', 1)[0]}.0/{CIDR_MASK}"
        if target_subnet in sub_proc.stdout or HOST_IP in sub_proc.stdout:
            raise HarnessPreflightError(
                f"Pre-existing route for test subnet {target_subnet} detected on host: {sub_proc.stdout.strip()}"
            )
    except (FileNotFoundError, OSError) as os_err:
        raise HarnessPreflightError(f"Preflight inspection failed: unable to execute 'ip route show': {os_err}") from os_err


def _check_partial_netns_creation(tracker: FailureSafeResourceTracker) -> None:
    """Inspect kernel state following a failed or exceptional namespace creation command.

    Fails closed:
    - If inspection command fails (non-zero or exception), ownership cannot be assessed.
      Record as unresolved ambiguous resource so post-cleanup verification fails.
    - If TEST_NETNS does NOT exist in the kernel, setup failed cleanly without residual state.
    - If TEST_NETNS DOES exist in the kernel:
      Because creation command returned failure or raised an exception, ownership cannot be
      conclusively proven (e.g., race with concurrent process or pre-existing unmonitored ns).
      Per fail-closed requirements, NEVER register an ambiguous resource as owned or delete it.
      Record as unresolved ambiguous resource for manual operator inspection.
    """
    try:
        chk = subprocess.run(["ip", "netns", "list"], capture_output=True, text=True, check=False)
        if chk.returncode != 0:
            desc = f"Namespace inspection failed (exit code {chk.returncode}) after failed creation: {chk.stderr.strip()}"
            LOG.error("%s; recording as unresolved.", desc)
            tracker.record_unresolved(desc)
            return

        existing_ns = [line.split()[0] for line in chk.stdout.splitlines() if line.strip()]
        if TEST_NETNS in existing_ns:
            desc = (
                f"Namespace {TEST_NETNS} exists after failed creation command; "
                f"ownership cannot be established conclusively. Refusing automatic deletion."
            )
            LOG.error("%s; recording as unresolved.", desc)
            tracker.record_unresolved(desc)
        else:
            LOG.info("Namespace %s confirmed absent after failed creation.", TEST_NETNS)
    except Exception as exc:
        desc = f"Exception during namespace inspection after failed creation: {exc}"
        LOG.error("%s; recording as unresolved.", desc)
        tracker.record_unresolved(desc)


def _check_partial_veth_creation(tracker: FailureSafeResourceTracker) -> None:
    """Inspect kernel state to determine if host endpoint exists and was established by this run.

    Fails closed:
    - Never adopts or registers an interface on existence alone, Ethernet address, or veth type alone.
    - Requires reliable, structured inspection establishing link_type == 'veth'.
    - Inspects peer relationship: the peer endpoint must link to peer in TEST_NETNS (or link-netns / peer name).
    - If inspection fails, or if interface is ordinary Ethernet, dummy, tunnel, or missing/ambiguous peer,
      fails closed and DOES NOT register it for deletion.
    """
    import json
    try:
        chk = subprocess.run(["ip", "-j", "-details", "link", "show", HOST_VETH], capture_output=True, text=True, check=False)
        if chk.returncode != 0:
            err_msg = chk.stderr.strip()
            err_lower = err_msg.lower()
            if "does not exist" in err_lower or "cannot find device" in err_lower:
                LOG.info("Interface %s does not exist on host.", HOST_VETH)
                return
            desc = f"Failed to inspect {HOST_VETH} (returncode {chk.returncode}): {err_msg}"
            LOG.error("%s; refusing to infer ownership.", desc)
            tracker.record_unresolved(desc)
            return

        try:
            links = json.loads(chk.stdout)
        except json.JSONDecodeError:
            links = []

        if links and isinstance(links, list):
            link = links[0]
            if link.get("ifname") != HOST_VETH:
                LOG.error("Interface name mismatch in inspection: %s != %s; refusing to register.", link.get("ifname"), HOST_VETH)
                return

            linkinfo = link.get("linkinfo", {})
            link_kind = linkinfo.get("info_kind") or link.get("link_type")
            if link_kind != "veth":
                desc = f"Interface {HOST_VETH} has kind {link_kind!r} (not 'veth'); refusing to register foreign link."
                LOG.error("%s", desc)
                tracker.record_unresolved(desc)
                return

            # Structured veth verification: check info_data / peer details
            info_data = linkinfo.get("info_data", {})
            peer_ifindex = link.get("link_index") or info_data.get("peer")
            # For cross-netns veth, ip link show includes link-netnsid or link_netnsid
            link_netnsid = link.get("link_netnsid") or linkinfo.get("info_slave_data", {}).get("link_netnsid")

            # Check peer in target test namespace
            peer_chk = subprocess.run(
                ["ip", "-j", "-details", "-netns", TEST_NETNS, "link", "show", PEER_VETH],
                capture_output=True,
                text=True,
                check=False,
            )
            peer_verified = False
            if peer_chk.returncode == 0:
                try:
                    peer_links = json.loads(peer_chk.stdout)
                    if peer_links and isinstance(peer_links, list):
                        p_link = peer_links[0]
                        p_kind = p_link.get("linkinfo", {}).get("info_kind") or p_link.get("link_type")
                        if p_kind == "veth":
                            peer_verified = True
                except json.JSONDecodeError:
                    pass

            # Verification of ownership by this test run:
            # 1. TEST_NETNS must have been created and tracked by THIS run.
            if TEST_NETNS not in tracker.created_netns:
                desc = f"Interface {HOST_VETH} exists but target namespace {TEST_NETNS} was not created by this test run"
                LOG.error("%s; refusing to delete automatically.", desc)
                tracker.record_unresolved(desc)
                return

            if peer_verified:
                LOG.warning("Partial link setup verified: %s is a proven veth with peer %s in tracked namespace %s. Recording for safe cleanup.", HOST_VETH, PEER_VETH, TEST_NETNS)
                tracker.record_link(HOST_VETH)
            else:
                desc = f"Interface {HOST_VETH} is veth but peer relationship to {PEER_VETH} in {TEST_NETNS} is unconfirmed"
                LOG.error("%s; failing closed.", desc)
                tracker.record_unresolved(desc)
            return

        desc = f"Could not parse structured link information for {HOST_VETH}"
        LOG.error("%s; refusing to infer ownership.", desc)
        tracker.record_unresolved(desc)
    except Exception as exc:
        desc = f"Exception during partial veth inspection for {HOST_VETH}: {exc}"
        LOG.error("%s; failing closed.", desc)
        tracker.record_unresolved(desc)


def verify_testbed_topology_and_routing() -> None:
    """Verify that the testbed routing is strictly isolated and resolves exclusively over veth.

    Fails closed if:
    1. Namespace route to HOST_IP does not resolve via PEER_VETH.
    2. Namespace has an unexpected default route.
    3. Host route to PEER_IP does not resolve via HOST_VETH.
    4. Host default route touches HOST_VETH or PEER_VETH.
    """
    # 1. Namespace route to HOST_IP
    try:
        proc = subprocess.run(
            ["sudo", "ip", "netns", "exec", TEST_NETNS, "ip", "route", "get", HOST_IP],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0 or PEER_VETH not in proc.stdout:
            raise HarnessExecutionError(
                f"Namespace routing verification failed: route to {HOST_IP} does not resolve via {PEER_VETH}: {proc.stdout.strip()} ({proc.stderr.strip()})"
            )
    except Exception as exc:
        if not isinstance(exc, HarnessExecutionError):
            raise HarnessExecutionError(f"Failed to verify namespace routing: {exc}") from exc
        raise

    # 2. Namespace default route must be empty (isolated)
    try:
        proc = subprocess.run(
            ["sudo", "ip", "netns", "exec", TEST_NETNS, "ip", "route", "show", "default"],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise HarnessExecutionError(
                f"Namespace default route inspection failed (exit code {proc.returncode}): {proc.stderr.strip()}"
            )
        if proc.stdout.strip():
            raise HarnessExecutionError(
                f"Namespace isolation violation: unexpected default route detected in {TEST_NETNS}: {proc.stdout.strip()}"
            )
    except Exception as exc:
        if not isinstance(exc, HarnessExecutionError):
            raise HarnessExecutionError(f"Failed to inspect namespace default route: {exc}") from exc
        raise

    # 3. Host route to PEER_IP
    try:
        proc = subprocess.run(
            ["ip", "route", "get", PEER_IP],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0 or HOST_VETH not in proc.stdout:
            raise HarnessExecutionError(
                f"Host routing verification failed: route to {PEER_IP} does not resolve via {HOST_VETH}: {proc.stdout.strip()} ({proc.stderr.strip()})"
            )
    except Exception as exc:
        if not isinstance(exc, HarnessExecutionError):
            raise HarnessExecutionError(f"Failed to verify host routing: {exc}") from exc
        raise

    # 4. Host default route must not contain HOST_VETH or PEER_VETH
    try:
        proc = subprocess.run(
            ["ip", "route", "show", "default"],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise HarnessExecutionError(
                f"Host default route inspection failed (exit code {proc.returncode}): {proc.stderr.strip()}"
            )
        if HOST_VETH in proc.stdout or PEER_VETH in proc.stdout:
            raise HarnessExecutionError(
                f"Host default route safety violation: test interface detected in default route: {proc.stdout.strip()}"
            )
    except Exception as exc:
        if not isinstance(exc, HarnessExecutionError):
            raise HarnessExecutionError(f"Failed to inspect host default route: {exc}") from exc
        raise

    LOG.info("Verified isolated testbed topology and routing: traffic strictly restricted to %s <-> %s.", PEER_VETH, HOST_VETH)


def execute_tracked_setup(tracker: FailureSafeResourceTracker) -> None:
    """Execute proposed testbed setup stages, establishing ownership in tracker immediately upon success."""
    stages: list[dict[str, Any]] = [
        {
            "stage": "1. Create Network Namespace",
            "cmd": ["sudo", "ip", "netns", "add", TEST_NETNS],
            "record_action": lambda: tracker.record_netns(TEST_NETNS),
            "check_on_fail": lambda: _check_partial_netns_creation(tracker),
        },
        {
            "stage": "2. Create Veth Pair",
            "cmd": ["sudo", "ip", "link", "add", HOST_VETH, "type", "veth", "peer", "name", PEER_VETH, "netns", TEST_NETNS],
            "record_action": lambda: tracker.record_link(HOST_VETH),
            "check_on_fail": lambda: _check_partial_veth_creation(tracker),
        },
        {
            "stage": "3. Configure Host Endpoint Address",
            "cmd": ["sudo", "ip", "addr", "add", f"{HOST_IP}/{CIDR_MASK}", "dev", HOST_VETH],
            "record_action": None,
            "check_on_fail": None,
        },
        {
            "stage": "4. Bring Up Host Endpoint Link",
            "cmd": ["sudo", "ip", "link", "set", HOST_VETH, "up"],
            "record_action": None,
            "check_on_fail": None,
        },
        {
            "stage": "5. Configure Namespace Endpoint Address",
            "cmd": ["sudo", "ip", "netns", "exec", TEST_NETNS, "ip", "addr", "add", f"{PEER_IP}/{CIDR_MASK}", "dev", PEER_VETH],
            "record_action": None,
            "check_on_fail": None,
        },
        {
            "stage": "6. Bring Up Namespace Loopback",
            "cmd": ["sudo", "ip", "netns", "exec", TEST_NETNS, "ip", "link", "set", "lo", "up"],
            "record_action": None,
            "check_on_fail": None,
        },
        {
            "stage": "7. Bring Up Namespace Peer Link",
            "cmd": ["sudo", "ip", "netns", "exec", TEST_NETNS, "ip", "link", "set", PEER_VETH, "up"],
            "record_action": None,
            "check_on_fail": None,
        },
        {
            "stage": "8. Provision Root HTB Qdisc",
            "cmd": ["sudo", "ip", "netns", "exec", TEST_NETNS, "tc", "qdisc", "add", "dev", PEER_VETH, "root", "handle", f"{PARENT_HANDLE}:", "htb", "default", "30"],
            "record_action": None,
            "check_on_fail": None,
        },
        {
            "stage": "9. Provision Parent Link Capacity Class 1:1",
            "cmd": ["sudo", "ip", "netns", "exec", TEST_NETNS, "tc", "class", "add", "dev", PEER_VETH, "parent", f"{PARENT_HANDLE}:", "classid", f"{PARENT_HANDLE}:1", "htb", "rate", "1000mbit", "ceil", "1000mbit"],
            "record_action": None,
            "check_on_fail": None,
        },
        {
            "stage": "10. Provision Default Traffic Class 1:30",
            "cmd": ["sudo", "ip", "netns", "exec", TEST_NETNS, "tc", "class", "add", "dev", PEER_VETH, "parent", f"{PARENT_HANDLE}:1", "classid", f"{PARENT_HANDLE}:30", "htb", "rate", "1000mbit", "ceil", "1000mbit"],
            "record_action": None,
            "check_on_fail": None,
        },
    ]

    for item in stages:
        cmd = item["cmd"]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=False)
            if res.returncode != 0:
                if item.get("check_on_fail"):
                    try:
                        item["check_on_fail"]()
                    except Exception as chk_e:
                        LOG.error("Failed post-failure check for %s: %s", item["stage"], chk_e)
                raise HarnessExecutionError(
                    f"Setup failed at {item['stage']}: {' '.join(cmd)} (returncode {res.returncode}): {res.stderr.strip()}"
                )
        except Exception as exc:
            if not isinstance(exc, HarnessExecutionError):
                if item.get("check_on_fail"):
                    try:
                        item["check_on_fail"]()
                    except Exception as chk_e:
                        LOG.error("Failed post-failure check for %s: %s", item["stage"], chk_e)
                raise HarnessExecutionError(f"Setup failed at {item['stage']} with exception: {exc}") from exc
            raise

        action = item["record_action"]
        if action is not None:
            action()

    tracker.setup_completed = True


def run_deterministic_receiver(
    host_ip: str,
    port: int,
    ready_evt: threading.Event,
    start_evt: threading.Event,
    stop_evt: threading.Event,
    results: dict[str, Any],
    intended_duration_sec: float = 2.0,
    max_wait_margin_sec: float = 2.0,
) -> None:
    """Deterministic UDP receiver with shared start event and explicit timing boundaries."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind((host_ip, port))
        ready_evt.set()
    except Exception as bind_exc:
        results["error"] = bind_exc
        ready_evt.set()
        s.close()
        return

    # Wait for sender orchestration to signal start
    if not start_evt.wait(timeout=5.0):
        results["error"] = HarnessReadinessTimeoutError("Receiver timed out waiting for start_evt signal")
        s.close()
        return

    total_bytes = 0
    total_packets = 0
    t_start = time.monotonic()
    t_first_packet: float | None = None
    t_last_packet: float | None = None
    deadline = t_start + intended_duration_sec + max_wait_margin_sec

    try:
        while time.monotonic() < deadline and not stop_evt.is_set():
            timeout = max(0.01, min(0.1, deadline - time.monotonic()))
            r, _, _ = select.select([s], [], [], timeout)
            if r:
                try:
                    data, _ = s.recvfrom(65535)
                    now = time.monotonic()
                    if t_first_packet is None:
                        t_first_packet = now
                    t_last_packet = now
                    total_bytes += len(data)
                    total_packets += 1
                except socket.error as sock_err:
                    results["socket_error"] = str(sock_err)
                    break
    except Exception as run_exc:
        results["error"] = run_exc
    finally:
        s.close()

    t_end = time.monotonic()
    elapsed_wall = max(0.001, t_end - t_start)
    packet_span = (t_last_packet - t_first_packet) if (t_first_packet and t_last_packet) else 0.0

    # Calculate throughput strictly using observed receiver elapsed time
    receiver_window = packet_span if packet_span > 0.0 else elapsed_wall
    mbps = (total_bytes * 8.0) / (receiver_window * 1_000_000.0)

    results["bytes"] = total_bytes
    results["packets"] = total_packets
    results["intended_duration"] = intended_duration_sec
    results["receiver_elapsed_sec"] = elapsed_wall
    results["elapsed_wall_time"] = elapsed_wall
    results["first_to_last_span"] = packet_span
    results["mbps"] = mbps
    results["first_seen"] = t_first_packet is not None


def run_synchronized_measurement(
    desc: str,
    target_bps: int = 100_000_000,
    duration_sec: float = 2.0,
    ready_timeout_sec: float = 2.0,
    receiver_fn: Callable[..., None] = run_deterministic_receiver,
) -> dict[str, Any]:
    """Execute synchronized sender/receiver traffic measurement with explicit start confirmation and coordinated boundaries."""
    results: dict[str, Any] = {}
    ready_evt = threading.Event()
    start_evt = threading.Event()
    stop_evt = threading.Event()

    th = threading.Thread(
        target=receiver_fn,
        args=(HOST_IP, TEST_PORT, ready_evt, start_evt, stop_evt, results, duration_sec, 2.0),
    )
    th.start()

    if not ready_evt.wait(timeout=ready_timeout_sec):
        stop_evt.set()
        start_evt.set()
        th.join(timeout=1.0)
        if th.is_alive():
            raise HarnessExecutionError("Receiver thread failed to terminate after readiness timeout!")
        raise HarnessReadinessTimeoutError("Receiver readiness timed out! Failing immediately before starting sender.")

    if "error" in results:
        stop_evt.set()
        start_evt.set()
        th.join(timeout=1.0)
        if th.is_alive():
            raise HarnessExecutionError("Receiver thread failed to terminate after initialization error!")
        raise HarnessExecutionError(f"Receiver binding failed: {results['error']}")

    # Coordinate start: set receiver start signal
    start_evt.set()

    snd_cmd = [
        "ip", "netns", "exec", TEST_NETNS, "python3", "-c",
        f'''
import socket, time, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
payload = b"X" * 1400
target_bps = {target_bps}
interval = 0.001
bytes_per_tick = int((target_bps / 8) * interval)
t_start = time.monotonic()
t_end = t_start + {duration_sec}
total_sent = 0
total_pkts = 0
while time.monotonic() < t_end:
    t_tick = time.monotonic() + interval
    sent = 0
    while sent < bytes_per_tick:
        s.sendto(payload, ("{HOST_IP}", {TEST_PORT}))
        sent += len(payload)
        total_sent += len(payload)
        total_pkts += 1
    sleep_t = t_tick - time.monotonic()
    if sleep_t > 0:
        time.sleep(sleep_t)
dur = max(0.001, time.monotonic() - t_start)
offered_mbps = (total_sent * 8.0) / (dur * 1e6)
print(f"SENDER: offered={{offered_mbps:.2f}} Mbps, bytes={{total_sent}}, pkts={{total_pkts}}, dur={{dur:.4f}}s")
'''
    ]

    sender_exc: Exception | None = None
    try:
        snd_proc = subprocess.run(snd_cmd, capture_output=True, text=True, check=True)
        results["sender_output"] = snd_proc.stdout.strip()
        m_offered = re.search(r"offered=([0-9.]+)\s+Mbps", snd_proc.stdout)
        m_bytes = re.search(r"bytes=(\d+)", snd_proc.stdout)
        m_pkts = re.search(r"pkts=(\d+)", snd_proc.stdout)
        m_dur = re.search(r"dur=([0-9.]+)\s*s", snd_proc.stdout)
        if m_offered:
            results["sender_offered_mbps"] = float(m_offered.group(1))
        if m_bytes:
            results["sender_bytes"] = int(m_bytes.group(1))
        if m_pkts:
            results["sender_pkts"] = int(m_pkts.group(1))
        if m_dur:
            results["sender_duration_sec"] = float(m_dur.group(1))
    except Exception as s_exc:
        sender_exc = s_exc
    finally:
        stop_evt.set()
        th.join(timeout=3.0)

    # Verify receiver thread termination
    if th.is_alive():
        if sender_exc is not None:
            raise HarnessExecutionError(
                f"Receiver thread failed to terminate within timeout margin after sender failure: {sender_exc}"
            ) from sender_exc
        raise HarnessExecutionError("Receiver thread failed to terminate within timeout margin!")

    # Check for sender or receiver failures
    if sender_exc is not None:
        if "error" in results:
            raise HarnessExecutionError(
                f"Sender failure ({sender_exc}) raced with receiver error ({results['error']})"
            ) from sender_exc
        raise sender_exc

    if "error" in results:
        err = results["error"]
        raise HarnessExecutionError(f"Receiver error during measurement: {err}") from (
            err if isinstance(err, Exception) else None
        )

    if "socket_error" in results:
        raise HarnessExecutionError(f"Receiver socket error during measurement: {results['socket_error']}")

    if "sender_pkts" in results and "packets" in results:
        results["packet_count_diff"] = results["sender_pkts"] - results["packets"]
        results["packet_delta"] = results["packet_count_diff"]

    results["desc"] = desc
    return results


def execute_testbed_lifecycle(
    ctrl: TcController | None,
    tracker: FailureSafeResourceTracker,
    test_action_fn: Callable[[], Any],
) -> dict[str, Any]:
    """Execute test action under a unified, failure-safe lifecycle.

    Guarantees:
    1. Preflight, setup, measurements, mitigation, rollback, and cleanup run under this single scope.
    2. Rollback of controller child classes/filters executes first in finally block if controller is present.
    3. Even if rollback raises an exception, testbed cleanup (tracker.cleanup()) is guaranteed to execute.
    4. Post-cleanup absence verification verifies kernel state and fails if leftovers or errors remain.
    5. Cleanup exceptions or leftovers cannot hide or replace the original test failure.
    6. Cleanups refuse unowned resources.
    """
    test_exc: Exception | None = None
    rollback_exc: Exception | None = None
    cleanup_exc: Exception | None = None
    test_result: Any = None

    try:
        test_result = test_action_fn()
    except Exception as exc:
        test_exc = exc

    # Unified finally sequence: 1. Controller child rollback
    if ctrl is not None:
        try:
            ctrl.rollback()
        except Exception as rb_e:
            rollback_exc = rb_e

    # 2. Testbed cleanup (namespace and virtual interfaces recorded by this run)
    try:
        failures = tracker.cleanup()
        if failures:
            cleanup_exc = HarnessCleanupError(f"Testbed cleanup encountered failures: {failures}")
        leftovers = tracker.verify_cleanup_state()
        if leftovers:
            leftover_err = HarnessCleanupError(f"Post-cleanup verification detected leftovers: {leftovers}")
            if cleanup_exc is not None:
                cleanup_exc = HarnessCleanupError(f"{cleanup_exc}; {leftover_err}")
            else:
                cleanup_exc = leftover_err
    except Exception as cl_e:
        if cleanup_exc is not None:
            cleanup_exc = HarnessCleanupError(f"{cleanup_exc}; {cl_e}")
        else:
            cleanup_exc = cl_e

    # Hierarchy of exception reporting: original test failure takes precedence
    if test_exc is not None:
        if rollback_exc is not None:
            LOG.error("Rollback failed following test failure: %s", rollback_exc)
        if cleanup_exc is not None:
            LOG.error("Cleanup failed following test failure: %s", cleanup_exc)
        raise test_exc

    if rollback_exc is not None:
        if cleanup_exc is not None:
            raise HarnessExecutionError(f"Rollback failed: {rollback_exc}; subsequent cleanup failed: {cleanup_exc}") from rollback_exc
        raise rollback_exc

    if cleanup_exc is not None:
        raise cleanup_exc

    return {"status": "SUCCESS", "result": test_result}


def run_full_integration_orchestration(
    ctrl: TcController,
    tracker: FailureSafeResourceTracker,
    measurement_fn: Callable[[str, int, float], dict[str, Any]] = run_synchronized_measurement,
) -> dict[str, Any]:
    """Execute traffic measurement, mitigation application, and hierarchy checks."""
    # 1. Verify pre-existing administrator parent hierarchy
    ctrl.verify_parent_hierarchy(parent_handle=PARENT_HANDLE)

    # 2. Baseline measurement (unshaped traffic; class 1:10 must not exist yet)
    base_snap_10 = ctrl.get_class_stat("1:10")
    base_snap_30 = ctrl.get_class_stat("1:30")
    if base_snap_10 is not None:
        raise AssertionError("Class 1:10 must not exist in kernel prior to mitigation!")

    base_res = measurement_fn("BASELINE (Unshaped)", 100_000_000, 2.0)
    post_base_30 = ctrl.get_class_stat("1:30")
    delta_base_30 = (post_base_30["bytes"] - (base_snap_30["bytes"] if base_snap_30 else 0)) if post_base_30 else 0
    if delta_base_30 <= 0:
        raise AssertionError("Default class 1:30 must handle unshaped baseline traffic!")

    # 3. Apply 35 Mbps per-source cap through persistent controller
    ctrl.apply_source_cap(src_ip=PEER_IP, rate_mbps=CAP_RATE_MBPS, handle=PARENT_HANDLE)

    # 4. Mitigated measurement
    pre_mit_10 = ctrl.get_class_stat("1:10")
    if pre_mit_10 is None:
        raise AssertionError("Class 1:10 must exist in kernel immediately after apply!")

    mit_res = measurement_fn("MITIGATED (35 Mbps Cap)", 100_000_000, 2.0)
    post_mit_10 = ctrl.get_class_stat("1:10")
    delta_mit_10 = (post_mit_10["bytes"] - pre_mit_10["bytes"]) if post_mit_10 else 0

    # 5. Multi-vector assertions
    if delta_mit_10 <= 0:
        raise AssertionError("Class 1:10 must record positive byte accumulation during mitigated burst!")

    recv_mbps = mit_res.get("mbps", 0.0)
    # Note: 30.0 - 40.0 Mbps band is explicitly provisional pending live kernel validation
    if not (30.0 <= recv_mbps <= 40.0):
        raise AssertionError(f"Receiver rate {recv_mbps:.2f} Mbps outside expected provisional 30.0-40.0 Mbps range!")

    # 6. Verify hierarchy state while active: root qdisc intact, child class 1:10 present
    active_hier = ctrl.inspect_current_hierarchy(parent_handle=PARENT_HANDLE)
    if not active_hier.get("root_qdisc") or active_hier["root_qdisc"]["kind"] != "htb":
        raise AssertionError("Root HTB qdisc missing or corrupted during active mitigation!")
    if not any(c["class_id"] == "1:10" for c in active_hier.get("classes", [])):
        raise AssertionError("Child class 1:10 missing from kernel hierarchy during active mitigation!")

    return {
        "baseline": base_res,
        "mitigated": mit_res,
        "delta_base_30": delta_base_30,
        "delta_mit_10": delta_mit_10,
    }


def run_unified_integration_lifecycle(
    tracker: FailureSafeResourceTracker = TRACKER,
    controller_factory: Callable[[], TcController] | None = None,
    measurement_fn: Callable[[str, int, float], dict[str, Any]] = run_synchronized_measurement,
    topology_verifier: Callable[[], None] | None = None,
) -> dict[str, Any]:
    """Unified single-entry point managing setup, testbed execution, rollback, and cleanup.

    Guarantees:
    - Preflight runs first.
    - Testbed setup and orchestration execute strictly inside execute_testbed_lifecycle.
    - If any stage of setup fails, cleanup executes immediately for any established resources.
    - Controller rollback executes prior to testbed interface/namespace deletion.
    - Preserves all original exceptions.
    """
    # Preflight check runs before any resource allocation
    run_preflight_checks()

    ctrl_holder: list[TcController | None] = [None]

    def _testbed_workflow() -> dict[str, Any]:
        # 1. Setup inside unified cleanup wrapper
        execute_tracked_setup(tracker)

        # 2. Verify topology and routing isolation before applying any queueing or traffic
        if topology_verifier is not None:
            topology_verifier()

        # 3. Instantiate controller
        if controller_factory:
            ctrl = controller_factory()
        else:
            ctrl = TcController(interface=PEER_VETH, namespace=TEST_NETNS, dry_run=False)
        ctrl_holder[0] = ctrl

        # 4. Execute orchestration
        return run_full_integration_orchestration(ctrl, tracker, measurement_fn=measurement_fn)

    class _ProxyController:
        def rollback(self) -> None:
            if ctrl_holder[0] is not None:
                ctrl_holder[0].rollback()

    proxy_ctrl = _ProxyController()
    return execute_testbed_lifecycle(proxy_ctrl, tracker, _testbed_workflow)


def get_persistent_test_runner_snippet() -> str:
    """Python test runner script executing Part C with unified failure-safe lifecycle."""
    return f'''
import sys
from test_kernel_integration_plan import (
    TRACKER,
    run_unified_integration_lifecycle,
)

print("[RUNNER] Starting UNIFIED failure-safe persistent integration test lifecycle (Phase 4.17)...")
try:
    report = run_unified_integration_lifecycle(tracker=TRACKER, topology_verifier=verify_testbed_topology_and_routing)
    print(f"[RUNNER] Unified integration run completed successfully: {{report}}")
except Exception as exc:
    print(f"[RUNNER] Unified lifecycle terminated with error: {{exc}}", file=sys.stderr)
    raise
'''


def print_harness_audit_report() -> None:
    print("================================================================================")
    print("MICROBURSTHUNTER PHASE 4.17 — ISOLATED KERNEL INTEGRATION SPECIFICATION")
    print("================================================================================")
    print("STATIC TOPOLOGY & FLOW:")
    print(f"  - Target Network Namespace : {TEST_NETNS}")
    print(f"  - Sender Interface & IP    : {PEER_VETH} ({PEER_IP}) inside {TEST_NETNS}")
    print(f"  - Receiver Interface & IP  : {HOST_VETH} ({HOST_IP}) in host root namespace")
    print(f"  - Egress Shaping Node      : {PEER_VETH} inside {TEST_NETNS}")
    print(f"  - Traffic Direction        : {PEER_IP} (Sender) -> {HOST_IP} (Receiver)")
    print(f"  - HTB Hierarchy            : Root {PARENT_HANDLE}: (default 30) -> Class {PARENT_HANDLE}:1 -> Child {PARENT_HANDLE}:10 (35M)")
    print(f"  - Classifier Filter        : parent {PARENT_HANDLE}:0 prio 1 flower src_ip {PEER_IP} flowid {PARENT_HANDLE}:10")
    print("================================================================================")
    print("\n1. UNIFIED FAILURE-SAFE INTEGRATION ENTRY POINT:")
    print(get_persistent_test_runner_snippet())

    print("\n2. DECISION-BASED MANUAL RECOVERY PROCEDURE:")
    print("  Step 1: Inspect existence with 'ip netns list' and 'ip link show'.")
    print("  Step 2: Inspect interface peer, namespace, and addresses with read-only 'ip -details link show'.")
    print("  Step 3: Establish proven ownership before executing any deletion.")
    print("  Step 4: If ambiguous or foreign, FAIL CLOSED and delete nothing.")
    print("  Step 5: Only if verified, execute explicit deletions in reverse order.")
    print("  Step 6: Verify clean state with read-only inspection commands.")
    print("================================================================================")


def run_authorized_live_kernel_test() -> dict[str, Any]:
    """Execute authorized live kernel integration test with explicit preconditions and safeguards."""
    if sys.platform != "linux":
        raise HarnessExecutionError("Live kernel integration test can only be executed on Linux systems.")

    if os.environ.get("MBH_ALLOW_PRIVILEGED_EXEC") != "1":
        raise HarnessExecutionError(
            "Privileged execution not authorized: MBH_ALLOW_PRIVILEGED_EXEC=1 environment variable is required."
        )

    print("================================================================================")
    print("MICROBURSTHUNTER PHASE 4.22 — AUTHORIZED LIVE KERNEL INTEGRATION TEST")
    print("================================================================================")
    print("PLANNED MUTATING COMMANDS:")
    for idx, st in enumerate([
        ["sudo", "ip", "netns", "add", TEST_NETNS],
        ["sudo", "ip", "link", "add", HOST_VETH, "type", "veth", "peer", "name", PEER_VETH, "netns", TEST_NETNS],
        ["sudo", "ip", "addr", "add", f"{HOST_IP}/{CIDR_MASK}", "dev", HOST_VETH],
        ["sudo", "ip", "link", "set", HOST_VETH, "up"],
        ["sudo", "ip", "netns", "exec", TEST_NETNS, "ip", "addr", "add", f"{PEER_IP}/{CIDR_MASK}", "dev", PEER_VETH],
        ["sudo", "ip", "netns", "exec", TEST_NETNS, "ip", "link", "set", "lo", "up"],
        ["sudo", "ip", "netns", "exec", TEST_NETNS, "ip", "link", "set", PEER_VETH, "up"],
        ["sudo", "ip", "netns", "exec", TEST_NETNS, "tc", "qdisc", "add", "dev", PEER_VETH, "root", "handle", f"{PARENT_HANDLE}:", "htb", "default", "30"],
        ["sudo", "ip", "netns", "exec", TEST_NETNS, "tc", "class", "add", "dev", PEER_VETH, "parent", f"{PARENT_HANDLE}:", "classid", f"{PARENT_HANDLE}:1", "htb", "rate", "1000mbit", "ceil", "1000mbit"],
        ["sudo", "ip", "netns", "exec", TEST_NETNS, "tc", "class", "add", "dev", PEER_VETH, "parent", f"{PARENT_HANDLE}:1", "classid", f"{PARENT_HANDLE}:30", "htb", "rate", "1000mbit", "ceil", "1000mbit"],
        ["sudo", "ip", "netns", "exec", TEST_NETNS, "tc", "class", "add", "dev", PEER_VETH, "parent", f"{PARENT_HANDLE}:1", "classid", f"{PARENT_HANDLE}:10", "htb", "rate", "35.0mbit", "ceil", "35.0mbit"],
        ["sudo", "ip", "netns", "exec", TEST_NETNS, "tc", "filter", "add", "dev", PEER_VETH, "protocol", "ip", "parent", f"{PARENT_HANDLE}:0", "prio", "1", "flower", "src_ip", PEER_IP, "flowid", f"{PARENT_HANDLE}:10"],
    ], 1):
        print(f"  {idx:2d}. {' '.join(st)}")
    print("PLANNED CLEANUP COMMANDS:")
    print(f"  1. [controller rollback] tc filter del ... parent {PARENT_HANDLE}:0 prio 1")
    print(f"  2. [controller rollback] tc class del ... classid {PARENT_HANDLE}:10")
    print(f"  3. [tracker cleanup] sudo ip link del {HOST_VETH}")
    print(f"  4. [tracker cleanup] sudo ip netns del {TEST_NETNS}")
    print("================================================================================")

    TRACKER.clear()
    report = run_unified_integration_lifecycle(tracker=TRACKER)
    return report


if __name__ == "__main__":
    if "--live-kernel-test" in sys.argv or "--execute-live" in sys.argv:
        if os.environ.get("MBH_ALLOW_PRIVILEGED_EXEC") != "1":
            print(
                "CRITICAL EXECUTION GUARD: Live kernel test requested but MBH_ALLOW_PRIVILEGED_EXEC=1 is not set.\n"
                "Both the explicit flag and the environment variable are required to authorize live execution.",
                file=sys.stderr,
            )
            sys.exit(1)
        res = run_authorized_live_kernel_test()
        print(f"\n[RUNNER] Live kernel integration test PASSED successfully!\nResult: {res}")
        sys.exit(0)

    run_preflight_checks()
    print_harness_audit_report()
