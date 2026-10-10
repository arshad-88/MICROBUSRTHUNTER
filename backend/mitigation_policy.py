"""Adaptive mitigation policy.

Decision logic only — the policy returns the cap it wants applied. Actually
enforcing a cap requires the tc_controller, which never runs privileged
commands unless the operator explicitly asks for it and dry-run is disabled.

1. Normal traffic      -> no restriction
2. Moderate burst      -> mild temporary cap
3. Severe burst        -> stricter cap + alert
4. Recovered traffic   -> cap relaxed / removed
5. Invalid parameters  -> fail safe, keep previous state
"""

from __future__ import annotations

from dataclasses import dataclass

from burst_detector import BurstEvent
from config import MitigationConfig


@dataclass
class PolicyDecision:
    action: str  # "none" | "apply" | "adjust" | "remove" | "fail"
    source_ip: str | None
    cap_mbps: float | None
    severity: str
    reason: str


class MitigationPolicy:
    def __init__(self, cfg: MitigationConfig) -> None:
        self.cfg = cfg
        self._previous: PolicyDecision | None = None

    def on_burst(self, event: BurstEvent) -> PolicyDecision:
        if not self.cfg.auto_enabled:
            return PolicyDecision("none", event.source_ip, None, event.severity, "automatic mitigation disabled")

        cap = self.cfg.severe_cap_mbps if event.severity == "severe" else self.cfg.moderate_cap_mbps
        if cap <= 0:
            # Fail safe: never enforce an invalid cap.
            return PolicyDecision(
                "fail",
                event.source_ip,
                None,
                event.severity,
                f"invalid rate limit {cap} Mbps; previous safe state retained",
            )

        decision = PolicyDecision(
            "apply",
            event.source_ip,
            cap,
            event.severity,
            f"{event.severity} burst -> cap {cap} Mbps on {event.source_ip}",
        )
        self._previous = decision
        return decision

    def on_recovery(self) -> PolicyDecision:
        return PolicyDecision("remove", None, None, "none", "traffic recovered -> cap removed")
