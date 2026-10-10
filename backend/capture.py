"""Packet capture using Scapy.

Capture is opt-in and read-only: this module never injects or alters traffic.
It requires root (or CAP_NET_RAW) and an explicitly configured interface. If
Scapy is unavailable the import error is surfaced clearly instead of pretending
capture succeeded.
"""

from __future__ import annotations

import logging
import time
from typing import Callable

from metrics import Window, WindowAggregator

LOG = logging.getLogger("microbursthunter.capture")

try:  # Scapy is optional at import time so dry-run/CLI help still works.
    from scapy.all import IP, sniff  # type: ignore
    SCAPY_AVAILABLE = True
except Exception as exc:  # pragma: no cover - environment dependent
    SCAPY_AVAILABLE = False
    _SCAPY_IMPORT_ERROR = exc


def ensure_scapy() -> None:
    if not SCAPY_AVAILABLE:
        raise RuntimeError(
            "Scapy is not installed. Install it with `pip install -r requirements.txt` "
            "and run with sufficient privileges. Live capture is unavailable."
        )


def capture(
    interface: str,
    on_window: Callable[[Window], None],
    window_ms: int = 10,
    bpf_filter: str = "ip",
    duration_s: float | None = None,
    packet_limit: int | None = None,
) -> None:
    """Sniff packets on ``interface`` and emit completed windows.

    ``on_window`` is called for every closed sampling window. Nothing is written
    to the network; this is a passive observer.
    """
    ensure_scapy()
    aggregator = WindowAggregator(window_ms)
    started = time.monotonic()

    def handle(packet) -> None:  # type: ignore[no-untyped-def]
        if IP not in packet:
            return
        ip_layer = packet[IP]
        ts_ms = float(packet.time) * 1000.0
        length = int(len(packet))
        completed = aggregator.add(ts_ms, length, str(ip_layer.src))
        if completed is not None:
            on_window(completed)
        if duration_s is not None and (time.monotonic() - started) >= duration_s:
            raise KeyboardInterrupt

    LOG.info("Capturing on %s (filter=%r)…", interface, bpf_filter)
    try:
        sniff(
            iface=interface,
            filter=bpf_filter,
            prn=handle,
            store=False,
            count=packet_limit or 0,
        )
    except KeyboardInterrupt:
        LOG.info("Capture stopped by operator")
    finally:
        tail = aggregator.flush()
        if tail is not None:
            on_window(tail)
