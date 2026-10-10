"""Window aggregation and rate math shared by the live-capture pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field


def bytes_to_mbps(byte_count: int, window_ms: int) -> float:
    """rateMbps = bytes * 8 / (window_ms / 1000) / 1_000_000"""
    if window_ms <= 0:
        return 0.0
    return (byte_count * 8) / (window_ms / 1000) / 1_000_000


@dataclass
class Window:
    """One detector sampling window."""

    start_ms: float
    end_ms: float
    total_bytes: int = 0
    packet_count: int = 0
    per_source_bytes: dict[str, int] = field(default_factory=dict)

    @property
    def duration_ms(self) -> float:
        return max(1e-9, self.end_ms - self.start_ms)

    @property
    def rate_mbps(self) -> float:
        return bytes_to_mbps(self.total_bytes, int(self.duration_ms))

    def add_packet(self, ts_ms: float, length: int, src_ip: str) -> None:
        self.total_bytes += length
        self.packet_count += 1
        self.per_source_bytes[src_ip] = self.per_source_bytes.get(src_ip, 0) + length
        self.end_ms = max(self.end_ms, ts_ms)


class WindowAggregator:
    """Slices a packet stream into fixed-length windows."""

    def __init__(self, window_ms: int) -> None:
        self.window_ms = window_ms
        self._current: Window | None = None
        self._anchor_ms: float | None = None

    def add(self, ts_ms: float, length: int, src_ip: str) -> Window | None:
        """Add a packet; return the completed window when one closes."""
        if self._anchor_ms is None:
            self._anchor_ms = ts_ms
            self._current = Window(ts_ms, ts_ms)

        completed: Window | None = None
        while self._current is not None and ts_ms - self._anchor_ms >= self.window_ms:
            completed = self._current
            self._anchor_ms += self.window_ms
            self._current = Window(self._anchor_ms, self._anchor_ms)

        assert self._current is not None
        self._current.add_packet(ts_ms, length, src_ip)
        return completed

    def flush(self) -> Window | None:
        completed = self._current
        self._current = None
        self._anchor_ms = None
        return completed
