"""Linux traffic-control (tc) controller for MicroburstHunter.

SAFETY RULES ENFORCED HERE
--------------------------
* Privileged commands are never run automatically.
* The user's primary interface is never modified by default: you must pass an
  explicit ``--interface`` and the interface must not be the default route.
* ``dry_run`` is the default; nothing is executed unless it is explicitly
  turned off with ``--apply``.
* Every command is validated (interface name, IP address, rate, handle) before
  it is built or logged.
* Per-source mitigation is separated from parent hierarchy provisioning:
  MicroburstHunter treats the root qdisc as administrator-managed infrastructure.
  The controller NEVER automatically creates, replaces, or deletes root qdiscs.
* Normal per-source apply path strictly requires an approved, compatible parent
  hierarchy to be verified in the kernel before applying child classes/filters.
* Ownership is strictly established for child classes and filters created by
  MicroburstHunter. Rollback deletes only verified owned children.
* Pre-deletion and post-deletion verification are mandatory and unconditional.
"""

from __future__ import annotations

import ipaddress
import logging
import re
import shlex
import subprocess
import uuid
from dataclasses import dataclass, field
from typing import Any

LOG = logging.getLogger("microbursthunter.tc")

_IFACE_RE = re.compile(r"^[a-zA-Z0-9_.:-]{1,15}$")
_NETNS_RE = re.compile(r"^[a-zA-Z0-9_-]{1,32}$")


class TcError(RuntimeError):
    pass


class TcOwnershipError(TcError):
    pass


class TcHierarchyError(TcError):
    pass


def validate_interface(interface: str) -> str:
    if not _IFACE_RE.match(interface or ""):
        raise TcError(f"invalid interface name: {interface!r}")
    return interface


def validate_namespace(namespace: str | None) -> str | None:
    if namespace is not None:
        if not _NETNS_RE.match(namespace):
            raise TcError(f"invalid network namespace name: {namespace!r}")
    return namespace


def validate_ip(ip: str) -> str:
    try:
        ipaddress.ip_address(ip)
    except ValueError as exc:
        raise TcError(f"invalid source IP: {ip!r}") from exc
    return ip


def validate_rate_mbps(rate_mbps: float) -> float:
    if not (0 < rate_mbps < 100_000):
        raise TcError(f"invalid rate: {rate_mbps!r} Mbps")
    return rate_mbps


def validate_handle(handle: int) -> int:
    if not (1 <= handle <= 0xFFFF):
        raise TcError(f"invalid handle: {handle!r}")
    return handle


@dataclass(frozen=True)
class OwnedResource:
    """Represents a specific traffic-control child entity owned by MicroburstHunter."""

    kind: str  # "class", "filter" (root "qdisc" is infrastructure-managed, not owned)
    interface: str
    command: str
    parent: str
    session_id: str
    class_id: str | None = None
    filter_prio: int | None = None
    protocol: str | None = None
    source_ip: str | None = None
    rate_mbps: float | None = None
    ceil_mbps: float | None = None


def parse_qdisc_output(output: str) -> list[dict[str, Any]]:
    """Parse output of 'tc -s qdisc show dev <iface>' into structured dictionaries."""
    entries = []
    lines = output.strip().splitlines()
    for line in lines:
        m = re.match(r"^qdisc\s+(\S+)\s+([0-9a-fA-F]+):(?:\s+(\S+))?", line.strip())
        if m:
            kind = m.group(1)
            handle_hex = m.group(2)
            parent = m.group(3) or ""
            handle_int = int(handle_hex, 16) if handle_hex else 0
            is_root = "root" in line.split()

            default_id = None
            m_def = re.search(r"default\s+([0-9a-fA-F]+)", line)
            if m_def:
                try:
                    default_id = int(m_def.group(1), 16)
                except ValueError:
                    default_id = None

            entries.append({
                "kind": kind,
                "handle": handle_int,
                "handle_str": f"{handle_hex}:",
                "parent": "root" if is_root else parent,
                "is_root": is_root,
                "default": default_id,
                "raw": line.strip(),
            })
    return entries


def parse_class_output(output: str) -> list[dict[str, Any]]:
    """Parse output of 'tc class show dev <iface>' into structured dictionaries."""
    entries = []
    lines = output.strip().splitlines()
    for line in lines:
        m = re.search(r"class\s+(\S+)\s+([0-9a-fA-F]+:[0-9a-fA-F]+)(?:\s+parent\s+([0-9a-fA-F:]+|root))?", line.strip())
        if m:
            kind = m.group(1)
            class_id = m.group(2)
            parent = m.group(3) or ""

            rate_mbps = None
            ceil_mbps = None
            m_rate = re.search(r"rate\s+([0-9.]+)([kKmMgGtT]?)bit", line)
            if m_rate:
                val = float(m_rate.group(1))
                unit = m_rate.group(2).lower()
                multiplier = {"k": 0.001, "m": 1.0, "g": 1000.0, "t": 1000000.0}.get(unit, 0.000001)
                rate_mbps = round(val * multiplier, 2)

            m_ceil = re.search(r"ceil\s+([0-9.]+)([kKmMgGtT]?)bit", line)
            if m_ceil:
                val = float(m_ceil.group(1))
                unit = m_ceil.group(2).lower()
                multiplier = {"k": 0.001, "m": 1.0, "g": 1000.0, "t": 1000000.0}.get(unit, 0.000001)
                ceil_mbps = round(val * multiplier, 2)

            entries.append({
                "kind": kind,
                "class_id": class_id,
                "parent": parent,
                "rate_mbps": rate_mbps,
                "ceil_mbps": ceil_mbps,
                "raw": line.strip(),
            })
    return entries


def parse_class_stats(output: str) -> list[dict[str, Any]]:
    """Parse output of 'tc -s class show dev <iface>' into structured dictionaries with statistics."""
    entries = []
    current: dict[str, Any] | None = None
    for line in output.splitlines():
        line_s = line.strip()
        m = re.search(r"class\s+(\S+)\s+([0-9a-fA-F]+:[0-9a-fA-F]+)(?:\s+parent\s+([0-9a-fA-F:]+|root))?", line_s)
        if m:
            if current:
                entries.append(current)
            current = {
                "kind": m.group(1),
                "class_id": m.group(2),
                "parent": m.group(3) or "",
                "bytes": 0,
                "packets": 0,
                "drops": 0,
                "overlimits": 0,
                "lines": [line_s],
            }
            continue

        if current:
            current["lines"].append(line_s)
            m_sent = re.search(r"Sent\s+(\d+)\s+bytes\s+(\d+)\s+pkt", line_s, re.IGNORECASE)
            if m_sent:
                current["bytes"] = int(m_sent.group(1))
                current["packets"] = int(m_sent.group(2))
            m_drop = re.search(r"dropped\s+(\d+)", line_s, re.IGNORECASE)
            if m_drop:
                current["drops"] = int(m_drop.group(1))
            m_over = re.search(r"overlimits\s+(\d+)", line_s, re.IGNORECASE)
            if m_over:
                current["overlimits"] = int(m_over.group(1))

    if current:
        entries.append(current)
    return entries


def parse_filter_output(output: str) -> list[dict[str, Any]]:
    """Parse output of 'tc filter show dev <iface>' into structured dictionaries."""
    entries = []
    current: dict[str, Any] | None = None
    for line in output.splitlines():
        line_s = line.strip()
        if not line_s:
            continue
        # Skip pure chain headers ('filter ... chain N') that do not define a rule
        if re.search(r"chain\s+\d+\s*$", line_s) and not re.search(r"(?:handle|fh|flowid|classid)\s+", line_s):
            continue
        # Skip hash table divisor declarations
        if re.search(r"ht\s+divisor\s+\d+", line_s):
            continue

        m_head = re.search(
            r"filter\s+parent\s+([0-9a-fA-F:]+)\s+protocol\s+(\S+)\s+pref\s+(\d+)\s+(\S+)"
            r"(?:\s+chain\s+\d+)?"
            r"(?:\s+(?:handle|fh)\s+(\S+))?",
            line_s,
        )
        if m_head:
            if current:
                entries.append(current)
            current = {
                "parent": m_head.group(1),
                "protocol": m_head.group(2),
                "prio": int(m_head.group(3)),
                "classifier": m_head.group(4),
                "filter_handle": m_head.group(5) or None,
                "flowid": None,
                "classid": None,
                "src_ip": None,
                "lines": [line_s],
            }
            m_target = re.search(r"(?:flowid|classid)\s+([0-9a-fA-F:]+)", line_s)
            if m_target:
                current["flowid"] = m_target.group(1)
                current["classid"] = m_target.group(1)
            m_src_head = re.search(r"src_ip\s+([0-9a-fA-F.:/]+)", line_s)
            if m_src_head:
                current["src_ip"] = m_src_head.group(1)
            continue

        if current:
            current["lines"].append(line_s)
            m_target = re.search(r"(?:flowid|classid)\s+([0-9a-fA-F:]+)", line_s)
            if m_target and not current["flowid"]:
                current["flowid"] = m_target.group(1)
                current["classid"] = m_target.group(1)
            m_src = re.search(r"src_ip\s+([0-9a-fA-F.:/]+)", line_s)
            if m_src and not current["src_ip"]:
                current["src_ip"] = m_src.group(1)

    if current:
        entries.append(current)
    return entries


@dataclass
class TcController:
    interface: str
    dry_run: bool = True
    session_id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    namespace: str | None = None
    applied: list[str] = field(default_factory=list)
    owned_resources: list[OwnedResource] = field(default_factory=list)

    def __post_init__(self) -> None:
        validate_interface(self.interface)
        validate_namespace(self.namespace)

    def default_route_interface(self) -> str | None:
        cmd = ["ip"]
        if self.namespace:
            cmd.extend(["netns", "exec", self.namespace, "ip"])
        cmd.extend(["route", "show", "default"])
        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                timeout=5.0,
            )
        except FileNotFoundError as exc:
            raise TcError(f"Route inspection tool 'ip' not found: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise TcError(f"Route inspection command timed out after 5.0s: {exc}") from exc
        except PermissionError as exc:
            raise TcError(f"Permission denied during route inspection: {exc}") from exc
        except Exception as exc:
            raise TcError(f"Failed to execute route inspection: {exc}") from exc

        if res.returncode != 0:
            raise TcError(
                f"Route inspection failed with return code {res.returncode}: {res.stderr.strip()}"
            )

        out = res.stdout.strip()
        if not out:
            # An isolated network namespace has no default route by design
            if self.namespace is not None:
                return None
            raise TcError("Route inspection produced empty output; cannot verify default route")

        match = re.search(r"dev\s+(\S+)", out)
        if not match:
            raise TcError(f"Unparseable default route output: {out!r}")

        return match.group(1)

    def assert_safe_interface(self) -> None:
        validate_interface(self.interface)
        validate_namespace(self.namespace)
        try:
            default_iface = self.default_route_interface()
        except TcError as exc:
            raise TcError(
                f"Refusing to modify interface {self.interface!r}: cannot verify safety: {exc}"
            ) from exc

        if default_iface is not None and default_iface == self.interface:
            raise TcError(
                f"refusing to shape the default-route interface {self.interface!r}; "
                "use an isolated test interface"
            )
        if self.interface in ("eth0", "lo"):
            raise TcError(
                f"refusing to shape {self.interface!r}; shaping eth0 or loopback is forbidden"
            )

    def _run(self, args: list[str], readonly: bool = False) -> str:
        if self.namespace:
            command = ["ip", "netns", "exec", self.namespace, "tc", *args]
        else:
            command = ["tc", *args]
        skipped = self.dry_run and not readonly
        LOG.info(
            "%s %s",
            "DRY-RUN" if skipped else "RUN",
            " ".join(shlex.quote(c) for c in command),
        )
        if skipped:
            return ""
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise TcError(f"command failed ({result.returncode}): {result.stderr.strip()}")
        return result.stdout

    # ------------------------------------------------------------- inspection

    def show_qdisc(self) -> str:
        """Read-only qdisc inspection."""
        validate_interface(self.interface)
        return self._run(["-s", "qdisc", "show", "dev", self.interface], readonly=True)

    def show_class(self) -> str:
        """Read-only class inspection."""
        validate_interface(self.interface)
        return self._run(["class", "show", "dev", self.interface], readonly=True)

    def show_class_stats(self) -> str:
        """Read-only class inspection including cumulative packet/byte statistics."""
        validate_interface(self.interface)
        return self._run(["-s", "class", "show", "dev", self.interface], readonly=True)

    def get_class_stat(self, class_id: str) -> dict[str, Any] | None:
        """Return parsed statistics (bytes, packets, drops) for a specific class ID."""
        stats_raw = self.show_class_stats()
        parsed = parse_class_stats(stats_raw)
        return next((c for c in parsed if c["class_id"] == class_id), None)

    def show_filter(self) -> str:
        """Read-only filter inspection."""
        validate_interface(self.interface)
        return self._run(["filter", "show", "dev", self.interface], readonly=True)

    # ----------------------------------------------------------- hierarchy checks

    def inspect_current_hierarchy(self, parent_handle: int = 1) -> dict[str, Any]:
        """Inspect and parse existing root qdisc, classes, and filters into structured objects."""
        qdisc_out = self.show_qdisc()
        class_out = self.show_class()
        filter_out = self.show_filter()

        qdiscs = parse_qdisc_output(qdisc_out)
        classes = parse_class_output(class_out)
        filters = parse_filter_output(filter_out)

        root_qdisc = next((q for q in qdiscs if q["is_root"]), None)

        return {
            "root_qdisc": root_qdisc,
            "qdiscs": qdiscs,
            "classes": classes,
            "filters": filters,
            "qdisc_raw": qdisc_out,
            "class_raw": class_out,
            "filter_raw": filter_out,
        }

    def verify_parent_hierarchy(self, parent_handle: int = 1) -> None:
        """Verify that an approved classful HTB parent qdisc exists and has no conflicting children.

        Fails closed if root is missing, foreign, has wrong handle, or has conflicting child class/filter.
        """
        hierarchy = self.inspect_current_hierarchy(parent_handle=parent_handle)
        root = hierarchy["root_qdisc"]

        # 1. Require approved HTB root infrastructure
        if root is None:
            raise TcHierarchyError(
                f"No root qdisc found on {self.interface}. Per-source shaping requires "
                f"a pre-existing administrator-managed HTB root qdisc (handle {parent_handle}:)."
            )

        if root["kind"] != "htb" or root["handle"] != parent_handle:
            raise TcHierarchyError(
                f"Incompatible root qdisc '{root['kind']}' (handle {root['handle']}:) on {self.interface}. "
                f"MicroburstHunter requires an approved HTB root qdisc with handle {parent_handle}:. "
                "The controller will never automatically replace or delete the existing root qdisc."
            )

        # 2. Check for conflicting class on parent:10
        target_class_id = f"{parent_handle}:10"
        for cl in hierarchy["classes"]:
            if cl["class_id"] == target_class_id:
                owns_class = any(r.kind == "class" and r.class_id == target_class_id and r.session_id == self.session_id for r in self.owned_resources)
                if not owns_class:
                    raise TcOwnershipError(
                        f"Class {target_class_id} already exists on {self.interface} and belongs to another owner. "
                        "Refusing to overwrite conflicting class."
                    )

        # 3. Check for conflicting filter targeting parent:10
        for flt in hierarchy["filters"]:
            if flt["parent"] in (f"{parent_handle}:", f"{parent_handle}:0") and flt.get("flowid") == target_class_id:
                owns_filter = any(r.kind == "filter" and r.class_id == target_class_id and r.session_id == self.session_id for r in self.owned_resources)
                if not owns_filter:
                    raise TcOwnershipError(
                        f"Unrelated or unverified filters already present under handle {parent_handle}: on {self.interface}. "
                        "Refusing to alter traffic control."
                    )

    # ----------------------------------------------------------- planning

    def plan_parent_hierarchy(self, handle: int = 1, default_band: int = 30) -> list[str]:
        """Candidate command sequence for one-time administrator provisioning of the root HTB qdisc.

        This is decoupled from per-source mitigation and is never executed automatically.
        """
        validate_handle(handle)
        validate_interface(self.interface)
        return [
            f"qdisc add dev {self.interface} root handle {handle}: htb default {default_band}",
        ]

    def plan_source_cap(
        self,
        src_ip: str,
        rate_mbps: float,
        handle: int = 1,
        parent_class: str | None = None,
    ) -> list[str]:
        """Return the candidate tc commands to cap a source under an existing parent hierarchy.

        Does NOT include root qdisc creation. Creates only child class and flower filter.
        """
        validate_ip(src_ip)
        validate_rate_mbps(rate_mbps)
        validate_interface(self.interface)
        validate_handle(handle)
        rate = f"{rate_mbps}mbit"
        parent = parent_class or f"{handle}:"
        return [
            f"class add dev {self.interface} parent {parent} classid {handle}:10 htb rate {rate} ceil {rate}",
            f"filter add dev {self.interface} protocol ip parent {handle}:0 prio 1 "
            f"flower src_ip {src_ip} flowid {handle}:10",
        ]

    def _build_owned_resources(
        self,
        src_ip: str,
        rate_mbps: float,
        handle: int = 1,
        parent_class: str | None = None,
    ) -> list[OwnedResource]:
        commands = self.plan_source_cap(src_ip, rate_mbps, handle=handle, parent_class=parent_class)
        parent = parent_class or f"{handle}:"
        return [
            OwnedResource(
                kind="class",
                interface=self.interface,
                command=commands[0],
                parent=parent,
                class_id=f"{handle}:10",
                session_id=self.session_id,
                rate_mbps=rate_mbps,
                ceil_mbps=rate_mbps,
            ),
            OwnedResource(
                kind="filter",
                interface=self.interface,
                command=commands[1],
                parent=f"{handle}:0",
                filter_prio=1,
                protocol="ip",
                source_ip=src_ip,
                class_id=f"{handle}:10",
                session_id=self.session_id,
            ),
        ]

    # ----------------------------------------------------------- apply

    def verify_resource_installation(self, resource: OwnedResource) -> bool:
        """Verify that a newly installed child resource exists in kernel state."""
        if self.dry_run:
            return True

        if resource.kind == "class":
            raw = self.show_class()
            if not raw or not raw.strip():
                raise TcError(f"Inspection returned empty output while verifying {resource.kind}")
            classes = parse_class_output(raw)
            if not classes:
                raise TcError(f"Malformed class output or parser failure while verifying {resource.kind}: {raw!r}")
            for c in classes:
                if c["kind"] == "htb" and c["class_id"] == resource.class_id:
                    if resource.rate_mbps is not None and c["rate_mbps"] is not None:
                        if abs(c["rate_mbps"] - resource.rate_mbps) > 0.1:
                            return False
                    return True
            return False

        elif resource.kind == "filter":
            raw = self.show_filter()
            if not raw or not raw.strip():
                raise TcError(f"Inspection returned empty output while verifying {resource.kind}")
            filters = parse_filter_output(raw)
            if not filters:
                raise TcError(f"Malformed filter output or parser failure while verifying {resource.kind}: {raw!r}")
            for flt in filters:
                if (
                    flt["protocol"] == (resource.protocol or "ip")
                    and flt["prio"] == (resource.filter_prio or 1)
                    and flt["parent"] in (resource.parent, resource.parent.rstrip(":0") + ":")
                    and (flt.get("flowid") == resource.class_id or flt.get("classid") == resource.class_id)
                    and (resource.source_ip is None or flt.get("src_ip") == resource.source_ip)
                ):
                    return True
            return False

        return False

    def apply_source_cap(
        self,
        src_ip: str,
        rate_mbps: float,
        handle: int = 1,
        parent_class: str | None = None,
    ) -> list[str]:
        """Apply a per-source traffic cap under an approved parent hierarchy.

        MANDATORY SAFETY: Refuses live mutation unless verify_parent_hierarchy succeeds.
        Never touches or mutates root qdiscs.
        """
        validate_interface(self.interface)
        if self.interface in ("eth0", "lo"):
            raise TcError(
                f"refusing to shape {self.interface!r}; shaping eth0 or loopback is forbidden"
            )
        validate_handle(handle)
        commands = self.plan_source_cap(src_ip, rate_mbps, handle=handle, parent_class=parent_class)

        if self.dry_run:
            LOG.info(
                "DRY-RUN: planned PER-SOURCE cap %s Mbps on %s via %s; "
                "no traffic-control commands executed",
                rate_mbps,
                src_ip,
                self.interface,
            )
            return commands

        self.assert_safe_interface()

        # MANDATORY CHECK: Refuse live mutation if approved parent hierarchy does not exist
        self.verify_parent_hierarchy(parent_handle=handle)

        planned_resources = self._build_owned_resources(
            src_ip, rate_mbps, handle=handle, parent_class=parent_class
        )

        for index, (line, res) in enumerate(zip(commands, planned_resources)):
            try:
                self._run(shlex.split(line))
            except TcError as exc:
                if self.applied:
                    LOG.error(
                        "Partial traffic-control application on %s: %d command(s) "
                        "succeeded before failure. Automatic rollback was not "
                        "attempted.",
                        self.interface,
                        len(self.applied),
                    )
                    raise TcError(
                        f"partial application on {self.interface}: "
                        f"{len(self.applied)} command(s) succeeded; command "
                        f"{index + 1}/{len(commands)} failed: {exc}. "
                        "No automatic rollback was attempted."
                    ) from exc
                raise

            # Record each child command and owned resource immediately after it succeeds
            self.applied.append(line)
            self.owned_resources.append(res)

        LOG.warning(
            "Applied PER-SOURCE cap %s Mbps on %s via classifier on %s",
            rate_mbps,
            src_ip,
            self.interface,
        )
        return commands

    # ------------------------------------------------------------- rollback

    def can_verify_ownership(self, resource: OwnedResource) -> bool:
        """Verify whether a child entity in kernel state strictly matches our owned resource."""
        if self.dry_run:
            return True

        if resource.session_id != self.session_id:
            return False

        if resource.kind == "filter":
            raw = self.show_filter()
            if not raw or not raw.strip():
                return False
            filters = parse_filter_output(raw)
            if not filters:
                return False
            for flt in filters:
                if (
                    flt["protocol"] == (resource.protocol or "ip")
                    and flt["prio"] == (resource.filter_prio or 1)
                    and flt["parent"] in (resource.parent, resource.parent.rstrip(":0") + ":")
                    and (flt.get("flowid") == resource.class_id or flt.get("classid") == resource.class_id)
                    and (resource.source_ip is None or flt.get("src_ip") == resource.source_ip)
                ):
                    return True
            return False

        elif resource.kind == "class":
            raw = self.show_class()
            if not raw or not raw.strip():
                return False
            classes = parse_class_output(raw)
            if not classes:
                return False
            for c in classes:
                if c["kind"] == "htb" and c["class_id"] == resource.class_id:
                    if resource.rate_mbps is not None and c["rate_mbps"] is not None:
                        if abs(c["rate_mbps"] - resource.rate_mbps) > 0.1:
                            return False
                    return True
            return False

        return False

    def is_resource_still_present(self, resource: OwnedResource) -> bool:
        """Check if a specific child resource is still present in kernel state."""
        if self.dry_run:
            return False

        if resource.kind == "filter":
            raw = self.show_filter()
            if not raw or not raw.strip():
                return False
            filters = parse_filter_output(raw)
            for flt in filters:
                if (
                    flt["protocol"] == (resource.protocol or "ip")
                    and flt["prio"] == (resource.filter_prio or 1)
                    and flt["parent"] in (resource.parent, resource.parent.rstrip(":0") + ":")
                    and (flt.get("flowid") == resource.class_id or flt.get("classid") == resource.class_id)
                    and (resource.source_ip is None or flt.get("src_ip") == resource.source_ip)
                ):
                    return True
            return False

        elif resource.kind == "class":
            raw = self.show_class()
            if not raw or not raw.strip():
                return False
            classes = parse_class_output(raw)
            return any(c["kind"] == "htb" and c["class_id"] == resource.class_id for c in classes)

        return False

    def rollback(self) -> None:
        """Roll back verified owned child resources in reverse order (filter -> class).

        Root qdiscs are administrator infrastructure and are NEVER deleted.
        Mandatory verification before and after deletion for every child entity.
        """
        if not self.applied and not self.owned_resources:
            LOG.info(
                "No recorded MicroburstHunter rules on %s; nothing to roll back",
                self.interface,
            )
            return

        if self.dry_run:
            LOG.info("DRY-RUN: rollback of owned child resources simulated successfully")
            self.applied.clear()
            self.owned_resources.clear()
            return

        self.assert_safe_interface()

        if not self.owned_resources:
            raise TcOwnershipError(
                "Safe rollback is unavailable: the controller cannot prove ownership "
                "of child traffic-control resources. In-memory commands alone do not prove ownership. "
                "No network changes were made. Inspect the interface and remove only "
                "explicitly identified MicroburstHunter rules."
            )

        # Reverse order of installation: filter -> class
        to_remove = list(reversed(self.owned_resources))
        failed_cleanups: list[tuple[OwnedResource, Exception]] = []

        for res in to_remove:
            # 1. MANDATORY Pre-deletion ownership verification
            try:
                verified = self.can_verify_ownership(res)
            except Exception as check_exc:
                failed_cleanups.append(
                    (res, TcOwnershipError(f"Inspection error during pre-deletion verification of {res.kind}: {check_exc}"))
                )
                continue

            if not verified:
                failed_cleanups.append(
                    (res, TcOwnershipError(f"Ambiguous ownership, missing resource, or attribute mismatch: {res.kind} {res.command}"))
                )
                continue

            del_cmd: list[str] = []
            if res.kind == "filter":
                # AUDIT NOTE: 'tc filter del dev <dev> parent <parent> pref <prio>' deletes the filter chain at that priority.
                # To prevent ambiguous deletions when multiple filters exist under the same priority/parent,
                # we verify that exactly one matching filter exists at this priority before issuing the deletion.
                raw = self.show_filter()
                matching_filters = [
                    f for f in parse_filter_output(raw)
                    if f["parent"] in (res.parent, res.parent.rstrip(":0") + ":")
                    and f["prio"] == (res.filter_prio or 1)
                ]
                if len(matching_filters) > 1:
                    failed_cleanups.append(
                        (res, TcOwnershipError(
                            f"Ambiguous filter deletion: multiple filters ({len(matching_filters)}) exist at "
                            f"parent {res.parent} prio {res.filter_prio or 1}. Refusing ambiguous deletion to prevent collateral damage."
                        ))
                    )
                    continue

                del_cmd = [
                    "filter", "del", "dev", self.interface,
                    "protocol", res.protocol or "ip",
                    "parent", res.parent,
                    "prio", str(res.filter_prio or 1),
                ]
            elif res.kind == "class":
                del_cmd = [
                    "class", "del", "dev", self.interface,
                    "classid", res.class_id or "",
                ]

            try:
                self._run(del_cmd)

                # 2. MANDATORY Post-deletion absence verification
                still_there = self.is_resource_still_present(res)
                if still_there:
                    failed_cleanups.append(
                        (res, TcOwnershipError(f"Post-deletion verification failed: {res.kind} still exists after {del_cmd}"))
                    )
                    continue

                # 3. Only remove from registry after successful deletion AND confirmed absence
                if res in self.owned_resources:
                    self.owned_resources.remove(res)
                if res.command in self.applied:
                    self.applied.remove(res.command)
            except Exception as exc:
                failed_cleanups.append((res, exc))

        if failed_cleanups:
            remaining = [f"{r.kind}:{r.command}" for r, _ in failed_cleanups]
            raise TcOwnershipError(
                f"Rollback partially failed or incomplete on {self.interface}. "
                f"Remaining unverified/unremoved child resources: {remaining}. "
                f"Errors: {[str(e) for _, e in failed_cleanups]}"
            )

        LOG.info("Successfully and safely rolled back all verified MicroburstHunter child resources on %s", self.interface)
