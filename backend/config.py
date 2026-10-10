"""Configuration for the MicroburstHunter live-capture backend.

These defaults mirror the browser simulation so results are conceptually
comparable. They are educational starting points, not a universal definition of
a microburst.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class DetectionConfig:
    window_ms: int = 10
    min_rate_mbps: float = 80.0
    baseline_multiplier: float = 3.0
    persistence_windows: int = 3
    recovery_windows: int = 10
    cooldown_ms: int = 2000
    baseline_window_ms: int = 1000
    severe_ratio: float = 5.0


@dataclass
class MitigationConfig:
    auto_enabled: bool = False  # OFF by default: never shape traffic unasked
    moderate_cap_mbps: float = 60.0
    severe_cap_mbps: float = 35.0
    max_duration_ms: int = 8000
    cooldown_ms: int = 3000


@dataclass
class RuntimeConfig:
    interface: str | None = None
    dry_run: bool = True
    bpf_filter: str = "ip"
    db_path: str = "microbursthunter.sqlite3"
    detection: DetectionConfig = field(default_factory=DetectionConfig)
    mitigation: MitigationConfig = field(default_factory=MitigationConfig)


def load_config() -> RuntimeConfig:
    """Load configuration from environment variables (with safe defaults)."""

    cfg = RuntimeConfig()
    cfg.interface = os.environ.get("MBH_INTERFACE") or None
    cfg.dry_run = os.environ.get("MBH_DRY_RUN", "1") not in ("0", "false", "no")
    cfg.bpf_filter = os.environ.get("MBH_BPF", cfg.bpf_filter)
    cfg.db_path = os.environ.get("MBH_DB", cfg.db_path)
    return cfg
