"""Stateful microburst detector — the Python mirror of the browser engine.

A burst is declared only when the measured rate exceeds BOTH the configured
absolute minimum and the rolling baseline multiplied by the configured factor,
and that condition persists for several consecutive windows. Recovery and
cooldown rules end the event.

Note: a rate spike does not prove switch-buffer overflow. Queue congestion is a
separate measurement.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Callable

from config import DetectionConfig
from metrics import Window


@dataclass
class BurstEvent:
    started_at_ms: float
    ended_at_ms: float | None
    peak_mbps: float
    baseline_mbps: float
    threshold_mbps: float
    source_ip: str
    contribution_pct: float
    severity: str
    detection_delay_ms: float | None


def detection_threshold(baseline_mbps: float, cfg: DetectionConfig) -> float:
    return max(cfg.min_rate_mbps, baseline_mbps * cfg.baseline_multiplier)


def classify_severity(peak_mbps: float, baseline_mbps: float, cfg: DetectionConfig) -> str:
    if baseline_mbps <= 0:
        return "severe"
    return "severe" if peak_mbps / baseline_mbps >= cfg.severe_ratio else "moderate"


class BurstDetector:
    def __init__(
        self,
        cfg: DetectionConfig,
        on_event: Callable[[str, BurstEvent], None] | None = None,
    ) -> None:
        self.cfg = cfg
        self.on_event = on_event or (lambda _kind, _event: None)
        self._baseline: deque[tuple[float, float]] = deque()
        self._consecutive = 0
        self._quiet = 0
        self._last_end_ms = float("-inf")
        self.active: BurstEvent | None = None

    def _rolling_baseline(self, now_ms: float) -> float | None:
        cutoff = now_ms - self.cfg.baseline_window_ms
        while self._baseline and self._baseline[0][0] < cutoff:
            self._baseline.popleft()
        if not self._baseline:
            return None
        return sum(rate for _, rate in self._baseline) / len(self._baseline)

    def process(self, window: Window) -> None:
        now = window.end_ms
        baseline = self._rolling_baseline(now)
        used_baseline = baseline if baseline is not None else max(1.0, self.cfg.min_rate_mbps / 2)
        threshold = detection_threshold(used_baseline, self.cfg)
        rate = window.rate_mbps
        qualifying = rate > threshold

        if self.active is None:
            if qualifying and baseline is not None:
                # Do not let candidate burst samples inflate their own baseline.
                self._consecutive += 1
                if (
                    self._consecutive >= self.cfg.persistence_windows
                    and (now - self._last_end_ms) >= self.cfg.cooldown_ms
                ):
                    self._start(window, used_baseline, threshold)
            else:
                self._consecutive = 0
                # Learn only from non-qualifying traffic while idle.
                self._baseline.append((now, rate))
            return

        # inside a burst: keep the pre-burst baseline frozen.
        self.active.peak_mbps = max(self.active.peak_mbps, rate)
        if not qualifying:
            self._quiet += 1
            if self._quiet >= self.cfg.recovery_windows:
                self._end(window)
        else:
            self._quiet = 0

    def _start(self, window: Window, baseline: float, threshold: float) -> None:
        total = max(1, window.total_bytes)
        top_ip, top_bytes = ("unknown", 0)
        for ip, byte_count in window.per_source_bytes.items():
            if byte_count > top_bytes:
                top_ip, top_bytes = ip, byte_count
        self.active = BurstEvent(
            started_at_ms=window.end_ms,
            ended_at_ms=None,
            peak_mbps=window.rate_mbps,
            baseline_mbps=baseline,
            threshold_mbps=threshold,
            source_ip=top_ip,
            contribution_pct=(top_bytes / total) * 100.0,
            severity=classify_severity(window.rate_mbps, baseline, self.cfg),
            detection_delay_ms=None,
        )
        self._consecutive = 0
        self._quiet = 0
        self.on_event("burst_detected", self.active)

    def _end(self, window: Window) -> None:
        if self.active is None:
            return
        self.active.ended_at_ms = window.end_ms
        self._last_end_ms = window.end_ms
        event = self.active
        self.active = None
        self._consecutive = 0
        self._quiet = 0
        self.on_event("burst_ended", event)
