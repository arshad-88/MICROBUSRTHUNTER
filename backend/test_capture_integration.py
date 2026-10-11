import argparse
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main
from config import RuntimeConfig
from metrics import Window


class FakeStore:
    def __init__(self, db_path):
        self.records = []

    def record(self, **kwargs):
        self.records.append(kwargs)

    def close(self):
        pass


class CaptureIntegrationTests(unittest.TestCase):
    def test_burst_and_recovery_reach_policy_handler(self):
        emitted = []
        stores = []

        def fake_emit(kind, payload):
            emitted.append({"kind": kind, **payload})

        def fake_capture(**kwargs):
            # Warm the rolling baseline with normal traffic.
            for index in range(3):
                kwargs["on_window"](
                    Window(
                        start_ms=index * 10,
                        end_ms=(index + 1) * 10,
                        total_bytes=1250,  # 1 Mbps over 10 ms
                        packet_count=1,
                        per_source_bytes={"192.0.2.10": 1250},
                    )
                )

            # Sustained high-rate windows should trigger a burst.
            for index in range(3, 7):
                kwargs["on_window"](
                    Window(
                        start_ms=index * 10,
                        end_ms=(index + 1) * 10,
                        total_bytes=125000,  # 100 Mbps over 10 ms
                        packet_count=50,
                        per_source_bytes={"192.0.2.10": 125000},
                    )
                )

            # Sustained quiet windows should end the burst.
            for index in range(7, 20):
                kwargs["on_window"](
                    Window(
                        start_ms=index * 10,
                        end_ms=(index + 1) * 10,
                        total_bytes=0,
                        packet_count=0,
                        per_source_bytes={},
                    )
                )

        def fake_store_factory(db_path):
            store = FakeStore(db_path)
            stores.append(store)
            return store

        cfg = RuntimeConfig()
        cfg.db_path = str(Path(tempfile.gettempdir()) / "mbh-test.sqlite3")

        args = argparse.Namespace(interface="test0", duration=1)
        output = io.StringIO()

        with (
            patch.object(main, "EventStore", side_effect=fake_store_factory),
            patch.object(main, "_emit", side_effect=fake_emit),
            patch("capture.capture", side_effect=fake_capture),
            contextlib.redirect_stdout(output),
        ):
            result = main.cmd_capture(args, cfg)

        self.assertEqual(result, 0)
        event_types = [
            item["type"]
            for item in emitted
            if item["kind"] == "event"
        ]
        self.assertIn("burst_detected", event_types)
        self.assertIn("burst_ended", event_types)

        policy_actions = [
            item["action"]
            for item in emitted
            if item["kind"] == "policy"
        ]
        self.assertIn("none", policy_actions)
        self.assertIn("remove", policy_actions)

        self.assertEqual(len(stores), 1)
        self.assertTrue(
            any(record["type"] == "monitoring_stopped"
                for record in stores[0].records)
        )

        print("PASS: synthetic burst reaches event handler")
        print("PASS: burst policy decision is emitted")
        print("PASS: recovery policy decision is emitted")
        print("PASS: storage and capture were mocked; no tc commands ran")


if __name__ == "__main__":
    unittest.main(verbosity=2)
