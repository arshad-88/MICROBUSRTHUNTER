"""Rank source IPs by their contribution to an observed burst.

Contribution = source bytes during the burst / total bytes during the burst * 100.
A high share indicates volume, not intent: legitimate bulk transfers can also
create microbursts.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SourceStats:
    ip: str
    bytes: int = 0
    packets: int = 0

    @property
    def mb(self) -> float:
        return self.bytes * 8 / 1_000_000


class SourceRanker:
    def __init__(self) -> None:
        self._totals: dict[str, SourceStats] = {}

    def reset(self) -> None:
        self._totals.clear()

    def observe(self, src_ip: str, length: int) -> None:
        stats = self._totals.setdefault(src_ip, SourceStats(ip=src_ip))
        stats.bytes += length
        stats.packets += 1

    def ranked(self) -> list[tuple[SourceStats, float]]:
        total = sum(s.bytes for s in self._totals.values())
        if total <= 0:
            return []
        rows = [(s, (s.bytes / total) * 100.0) for s in self._totals.values()]
        rows.sort(key=lambda row: row[1], reverse=True)
        return rows

    def top_source(self) -> tuple[str, float] | None:
        rows = self.ranked()
        if not rows:
            return None
        stats, pct = rows[0]
        return stats.ip, pct
