"""SQLite persistence for live-capture events, mirroring the browser event log."""

from __future__ import annotations

import csv
import sqlite3
import threading
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp REAL NOT NULL,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    source_ip TEXT,
    rate_mbps REAL,
    action TEXT NOT NULL,
    outcome TEXT NOT NULL,
    data_source TEXT NOT NULL
);
"""


class EventStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        with self._lock:
            self._conn.execute(SCHEMA)
            self._conn.commit()

    def record(
        self,
        *,
        type: str,
        severity: str,
        action: str,
        outcome: str,
        source_ip: str | None = None,
        rate_mbps: float | None = None,
        data_source: str = "live",
    ) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO events (timestamp, type, severity, source_ip, rate_mbps, action, outcome, data_source)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (time.time(), type, severity, source_ip, rate_mbps, action, outcome, data_source),
            )
            self._conn.commit()

    def export_csv(self, path: str) -> int:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM events ORDER BY timestamp").fetchall()
        with Path(path).open("w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(
                [
                    "id",
                    "timestamp",
                    "type",
                    "severity",
                    "source_ip",
                    "rate_mbps",
                    "action",
                    "outcome",
                    "data_source",
                ]
            )
            writer.writerows(rows)
        return len(rows)

    @property
    def records(self) -> list[dict]:
        with self._lock:
            cursor = self._conn.execute(
                "SELECT id, timestamp, type, severity, source_ip, rate_mbps, action, outcome, data_source"
                " FROM events ORDER BY id"
            )
            cols = [col[0] for col in cursor.description]
            return [dict(zip(cols, row)) for row in cursor.fetchall()]

    def close(self) -> None:
        with self._lock:
            self._conn.close()
