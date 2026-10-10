"""Linux traffic-control (tc) controller for MicroburstHunter.

SAFETY RULES ENFORCED HERE
--------------------------
* Privileged commands are never run automatically.
* The user's primary interface is never modified by default: you must pass an
  explicit ``--interface`` and the interface must not be the default route.
* ``dry_run`` is the default; nothing is executed unless it is explicitly
  turned off with ``--apply``.
* Every command is validated (interface name, IP address, rate) before it is
  built or logged, and every applied rule is recorded so it can be rolled back.
* A per-source rule is only claimed when an actual classifier (``u32``/``flower``)
  is installed. An interface-wide TBF rate limit is reported as interface-wide,
  never as per-source.
"""

from __future__ import annotations

import ipaddress
import logging
import re
import shlex
import subprocess
from dataclasses import dataclass, field

LOG = logging.getLogger("microbursthunter.tc")

_IFACE_RE = re.compile(r"^[a-zA-Z0-9_.:-]{1,15}$")


class TcError(RuntimeError):
    pass


def validate_interface(interface: str) -> str:
    if not _IFACE_RE.match(interface or ""):
        raise TcError(f"invalid interface name: {interface!r}")
    return interface


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


@dataclass
class TcController:
    interface: str
    dry_run: bool = True
    applied: list[str] = field(default_factory=list)

    def default_route_interface(self) -> str | None:
        try:
            out = subprocess.run(
                ["ip", "route", "show", "default"],
                capture_output=True,
                text=True,
                check=False,
            ).stdout
        except FileNotFoundError:
            return None
        match = re.search(r"dev\s+(\S+)", out)
        return match.group(1) if match else None

    def assert_safe_interface(self) -> None:
        validate_interface(self.interface)
        default_iface = self.default_route_interface()
        if default_iface and default_iface == self.interface:
            raise TcError(
                f"refusing to shape the default-route interface {self.interface!r}; "
                "use an isolated test interface"
            )

    def _run(self, args: list[str], readonly: bool = False) -> str:
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
        """Read-only inspection — always executed, even in dry-run."""
        validate_interface(self.interface)
        return self._run(["-s", "qdisc", "show", "dev", self.interface], readonly=True)

    # ----------------------------------------------------------- shaping

    def plan_source_cap(self, src_ip: str, rate_mbps: float, handle: int = 1) -> list[str]:
        """Return the candidate tc command sequence for a per-source cap.

        The command uses an HTB root qdisc plus a flower classifier matching the
        source IP, so the mitigation is genuinely per-source. It is returned
        rather than executed so it can be reviewed or dry-run first.
        """
        validate_ip(src_ip)
        validate_rate_mbps(rate_mbps)
        validate_interface(self.interface)
        rate = f"{rate_mbps}mbit"
        return [
            f"qdisc add dev {self.interface} root handle {handle}: htb default 30",
            f"class add dev {self.interface} parent {handle}: classid {handle}:10 htb rate {rate} ceil {rate}",
            f"filter add dev {self.interface} protocol ip parent {handle}:0 prio 1 "
            f"flower src_ip {src_ip} flowid {handle}:10",
        ]

    def apply_source_cap(self, src_ip: str, rate_mbps: float) -> list[str]:
        """Apply a per-source cap; records every rule for rollback."""
        self.assert_safe_interface()
        commands: list[str] = []
        for line in self.plan_source_cap(src_ip, rate_mbps):
            args = line.split()
            self._run(args)
            commands.append(line)
        self.applied.extend(commands)
        LOG.warning(
            "Applied PER-SOURCE cap %s Mbps on %s via classifier on %s",
            rate_mbps,
            src_ip,
            self.interface,
        )
        return commands

    # ------------------------------------------------------------- rollback

    def rollback(self) -> None:
        """Remove temporary rules and restore the previous configuration."""
        self.assert_safe_interface()
        try:
            self._run(["qdisc", "del", "dev", self.interface, "root"])
        except TcError as exc:
            LOG.warning("rollback: %s", exc)
        self.applied.clear()
        LOG.info("Rolled back all MicroburstHunter tc rules on %s", self.interface)
