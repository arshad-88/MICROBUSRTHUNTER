"""Capture Manager for MicroburstHunter.

Encapsulates passive packet capture execution, the detector/mitigation pipeline,
metrics aggregation, and thread-safe state access for the API server.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from dataclasses import asdict
from typing import Any

from burst_detector import BurstEvent, detection_threshold
from capture import (
    capture,
    check_capture_capability,
    get_platform_info,
    list_interfaces,
    resolve_capture_interface,
)
from config import RuntimeConfig, load_config
from event_store import EventStore
from main import CapturePipeline
from metrics import Window

LOG = logging.getLogger("microbursthunter.manager")


class CaptureManager:
    """Coordinates the live capture thread and serves snapshots to the dashboard."""

    def __init__(self, cfg: RuntimeConfig | None = None) -> None:
        self.cfg = cfg or load_config()
        self._lock = threading.RLock()
        self._worker_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self.pipeline: CapturePipeline | None = None
        self.status: str = "idle"  # "idle" | "running" | "stopped" | "error"
        self.interface: str | None = None
        self.device: str | None = None
        self.bpf_filter: str = "ip"
        self.started_at: float | None = None
        self.packet_count: int = 0
        self.total_bytes: int = 0
        self.latest_rate_mbps: float = 0.0
        self.peak_rate_mbps: float = 0.0
        self.sum_rate_mbps: float = 0.0
        self.sample_count: int = 0
        self.history: deque[dict[str, Any]] = deque(maxlen=300)
        self.recent_bursts: deque[dict[str, Any]] = deque(maxlen=50)
        self.error_message: str | None = None
        self.store = EventStore(self.cfg.db_path)

    def get_interfaces(self) -> dict[str, Any]:
        """Return available network interfaces and capture capability diagnostics."""
        with self._lock:
            ifaces = list_interfaces()
            platform_info = get_platform_info()
            return {
                "ok": True,
                "interfaces": ifaces,
                "environment": platform_info,
                "active_interface": self.interface,
                "active_device": self.device,
                "status": self.status,
            }

    def _handle_emit(self, kind: str, payload: dict) -> None:
        """Capture pipeline emissions (burst alerts, policy decisions)."""
        with self._lock:
            if kind == "event":
                self.recent_bursts.append(payload)

    def _on_packet(self, meta) -> None:
        """Track raw packet counter in real-time immediately as packets arrive."""
        with self._lock:
            self._packet_callback_used = True
            self.packet_count += 1
            self.total_bytes += meta.length

    def _on_window(self, window: Window) -> None:
        """Process completed 10ms sampling window from Scapy."""
        with self._lock:
            if not getattr(self, "_packet_callback_used", False):
                self.packet_count += window.packet_count
                self.total_bytes += window.total_bytes
            self.latest_rate_mbps = round(window.rate_mbps, 3)
            self.peak_rate_mbps = max(self.peak_rate_mbps, self.latest_rate_mbps)
            self.sum_rate_mbps += self.latest_rate_mbps
            self.sample_count += 1

            # Extract detector baseline & threshold
            baseline_val = 0.0
            threshold_val = self.cfg.detection.min_rate_mbps
            if self.pipeline and self.pipeline.detector:
                bl = self.pipeline.detector._rolling_baseline(window.end_ms)
                if bl is not None:
                    baseline_val = bl
                    threshold_val = detection_threshold(bl, self.cfg.detection)

            self.history.append({
                "timestamp": window.end_ms,
                "rate_mbps": self.latest_rate_mbps,
                "packets": window.packet_count,
                "bytes": window.total_bytes,
                "baseline_mbps": round(baseline_val, 3),
                "threshold_mbps": round(threshold_val, 3),
            })

        # Feed the existing detector, ranker, and dry-run policy
        if self.pipeline:
            self.pipeline.on_window(window)

    def start(self, interface: str, bpf_filter: str = "ip", window_ms: int = 10) -> dict[str, Any]:
        """Start passive live packet capture worker."""
        with self._lock:
            if self.status == "running":
                return {
                    "ok": False,
                    "error": f"Capture is already running on {self.interface}. Stop it before starting a new interface.",
                }

            can_cap, reason = check_capture_capability()
            if not can_cap:
                self.status = "error"
                self.error_message = reason
                return {
                    "ok": False,
                    "error": reason,
                    "environment": get_platform_info(),
                }

            try:
                device_id, friendly_name = resolve_capture_interface(interface)
            except Exception as exc:
                self.status = "error"
                self.error_message = str(exc)
                return {
                    "ok": False,
                    "error": str(exc),
                    "environment": get_platform_info(),
                }

            self.interface = friendly_name
            self.device = device_id
            self.bpf_filter = bpf_filter or "ip"
            self.error_message = None
            self.started_at = time.time()
            self.packet_count = 0
            self.total_bytes = 0
            self.latest_rate_mbps = 0.0
            self.peak_rate_mbps = 0.0
            self.sum_rate_mbps = 0.0
            self.sample_count = 0
            self.history.clear()
            self.recent_bursts.clear()
            self._stop_event.clear()

            # Ensure pipeline runs with safe dry-run mode
            self.cfg.detection.window_ms = window_ms
            self.pipeline = CapturePipeline(
                cfg=self.cfg,
                interface=friendly_name,
                store=self.store,
                emit_fn=self._handle_emit,
            )

            startup_error: list[Exception] = []

            self._worker_thread = threading.Thread(
                target=self._worker_run,
                args=(device_id, friendly_name, self.bpf_filter, window_ms, startup_error),
                daemon=True,
                name=f"CaptureWorker-{friendly_name}",
            )
            self._worker_thread.start()

            # Wait briefly for worker initialization to catch immediate socket/filter failures
            time.sleep(0.06)
            if startup_error:
                err = startup_error[0]
                self.status = "error"
                self.error_message = str(err)
                if self.pipeline:
                    self.pipeline.close()
                    self.pipeline = None
                return {
                    "ok": False,
                    "error": f"Failed to start packet capture on {friendly_name}: {err}",
                    "environment": get_platform_info(),
                }

            if not self._worker_thread.is_alive():
                err_text = self.error_message or "Worker thread terminated immediately during startup."
                self.status = "error"
                self.error_message = err_text
                if self.pipeline:
                    self.pipeline.close()
                    self.pipeline = None
                return {
                    "ok": False,
                    "error": f"Failed to start packet capture on {friendly_name}: {err_text}",
                    "environment": get_platform_info(),
                }

            self.status = "running"
            self.store.record(
                type="monitoring_started",
                severity="info",
                action=f"Live capture started on {friendly_name} ({device_id})",
                outcome=f"Passive packet sniffing initialized (filter: {self.bpf_filter}, window: {window_ms}ms)",
                data_source="live",
            )

            LOG.info("Started live packet capture on interface %s (%s)", friendly_name, device_id)
            return {
                "ok": True,
                "message": f"Live passive capture started on {friendly_name}",
                "interface": friendly_name,
                "device": device_id,
            }

    def _worker_run(
        self,
        device_id: str,
        friendly_name: str,
        bpf_filter: str,
        window_ms: int,
        startup_error: list[Exception] | None = None,
    ) -> None:
        """Worker thread executing Scapy sniff."""
        try:
            capture(
                interface=device_id,
                on_window=self._on_window,
                window_ms=window_ms,
                bpf_filter=bpf_filter,
                stop_event=self._stop_event,
                on_packet=self._on_packet,
            )
        except Exception as exc:
            LOG.error("Capture worker error on %s: %s", friendly_name, exc)
            if startup_error is not None:
                startup_error.append(exc)

            with self._lock:
                self.status = "error"
                self.error_message = str(exc)
                try:
                    self.store.record(
                        type="capture_error",
                        severity="severe",
                        action=f"Capture error on {friendly_name}",
                        outcome=str(exc),
                        data_source="live",
                    )
                except Exception:
                    pass
        finally:
            with self._lock:
                if self.status == "running":
                    self.status = "stopped"

    def stop(self) -> dict[str, Any]:
        """Stop passive live packet capture cleanly."""
        worker = None
        with self._lock:
            if self.status != "running":
                return {"ok": True, "message": "Capture is not currently running"}
            self._stop_event.set()
            worker = self._worker_thread

        if worker and worker.is_alive():
            worker.join(timeout=3.0)

        with self._lock:
            if self.pipeline:
                self.pipeline.close()
                self.pipeline = None
            self.status = "stopped"
            self.error_message = None
            self._worker_thread = None

            try:
                self.store.record(
                    type="monitoring_stopped",
                    severity="info",
                    action=f"Live capture stopped on {self.interface}",
                    outcome=f"Captured {self.packet_count} packets ({self.total_bytes} bytes)",
                    data_source="live",
                )
            except Exception:
                pass

            LOG.info("Stopped live packet capture on %s", self.interface)
            return {
                "ok": True,
                "message": f"Capture stopped. Captured {self.packet_count} packets.",
                "packet_count": self.packet_count,
                "total_bytes": self.total_bytes,
            }

    def get_status(self) -> dict[str, Any]:
        """Return real-time capture status, rates, detected bursts, and dry-run mitigation."""
        with self._lock:
            now = time.time()
            elapsed_s = round(now - self.started_at, 2) if self.started_at and self.status == "running" else 0.0
            avg_rate = round(self.sum_rate_mbps / self.sample_count, 3) if self.sample_count > 0 else 0.0

            current_burst = None
            burst_active = False
            if self.pipeline and self.pipeline.detector and self.pipeline.detector.active:
                burst_active = True
                b = self.pipeline.detector.active
                current_burst = {
                    "started_at_ms": b.started_at_ms,
                    "peak_mbps": round(b.peak_mbps, 2),
                    "baseline_mbps": round(b.baseline_mbps, 2),
                    "threshold_mbps": round(b.threshold_mbps, 2),
                    "source_ip": b.source_ip,
                    "contribution_pct": round(b.contribution_pct, 1),
                    "severity": b.severity,
                }

            mitigation_info = {
                "active": False,
                "source_ip": None,
                "cap_mbps": None,
                "severity": "none",
                "reason": "Traffic nominal / no mitigation required",
                "mode": "dry-run",
            }
            if self.pipeline and self.pipeline.active_mitigation:
                m = self.pipeline.active_mitigation
                mitigation_info = {
                    "active": True,
                    "source_ip": m.source_ip,
                    "cap_mbps": m.cap_mbps,
                    "severity": "severe" if m.cap_mbps <= self.cfg.mitigation.severe_cap_mbps else "moderate",
                    "reason": f"Active dry-run cap of {m.cap_mbps} Mbps planned for {m.source_ip}",
                    "mode": "dry-run",
                }

            platform_info = get_platform_info()
            err_msg = self.error_message if self.status == "error" else None

            return {
                "ok": True,
                "status": self.status,
                "interface": self.interface,
                "device": self.device,
                "bpf_filter": self.bpf_filter,
                "started_at": self.started_at,
                "elapsed_s": elapsed_s,
                "packet_count": self.packet_count,
                "total_bytes": self.total_bytes,
                "current_rate_mbps": self.latest_rate_mbps,
                "peak_rate_mbps": round(self.peak_rate_mbps, 3),
                "avg_rate_mbps": avg_rate,
                "sample_count": self.sample_count,
                "burst_active": burst_active,
                "current_burst": current_burst,
                "burst_count": len(self.recent_bursts),
                "mitigation": mitigation_info,
                "error": err_msg,
                "can_capture": platform_info.get("can_capture", False),
                "environment": platform_info,
            }

    def get_history(self) -> dict[str, Any]:
        """Return rate samples history for live charts."""
        with self._lock:
            return {
                "ok": True,
                "interface": self.interface,
                "samples": list(self.history),
                "count": len(self.history),
            }

    def get_sources(self) -> dict[str, Any]:
        """Return real ranked sources from packet IP headers."""
        with self._lock:
            if not self.pipeline or not self.pipeline.ranker:
                return {"ok": True, "sources": []}

            rows = self.pipeline.ranker.ranked()
            sources = [
                {
                    "ip": stats.ip,
                    "bytes": stats.bytes,
                    "packets": stats.packets,
                    "mb": round(stats.mb, 3),
                    "contribution_pct": round(pct, 2),
                }
                for stats, pct in rows
            ]
            return {"ok": True, "sources": sources}

    def get_events(self) -> dict[str, Any]:
        """Return recorded events from SQLite store."""
        with self._lock:
            records = self.store.records
            # Reverse so newest is first
            records_reversed = list(reversed(records))
            return {
                "ok": True,
                "events": records_reversed[:100],
                "total": len(records),
            }

    def clear_events(self) -> dict[str, Any]:
        """Clear events from SQLite store."""
        with self._lock:
            try:
                with self.store._lock:
                    self.store._conn.execute("DELETE FROM events")
                    self.store._conn.commit()
                return {"ok": True, "message": "Event log cleared"}
            except Exception as exc:
                return {"ok": False, "error": str(exc)}

    def close(self) -> None:
        """Shut down capture manager and database connections."""
        self.stop()
        with self._lock:
            self.store.close()


# Singleton instance
_manager_instance: CaptureManager | None = None
_manager_lock = threading.Lock()


def get_capture_manager() -> CaptureManager:
    global _manager_instance
    with _manager_lock:
        if _manager_instance is None:
            _manager_instance = CaptureManager()
        return _manager_instance
