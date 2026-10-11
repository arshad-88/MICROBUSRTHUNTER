import unittest

from burst_detector import BurstDetector
from config import DetectionConfig
from metrics import Window


SOURCE = "192.0.2.10"


def make_window(t, rate_mbps, source=SOURCE):
    # A 10 ms window: 1 Mbps = 1,250 bytes.
    byte_count = round(rate_mbps * 1250)
    return Window(
        start_ms=t - 10,
        end_ms=t,
        total_bytes=byte_count,
        packet_count=10 if byte_count else 0,
        per_source_bytes={source: byte_count} if byte_count else {},
    )


def prime_baseline(detector):
    for t in range(10, 101, 10):
        detector.process(make_window(t, 10))


class DetectorRegressionTests(unittest.TestCase):
    def test_baseline_does_not_absorb_candidate_burst(self):
        detector = BurstDetector(DetectionConfig())
        prime_baseline(detector)

        baseline_before = list(detector._baseline)

        detector.process(make_window(110, 200))
        detector.process(make_window(120, 200))

        self.assertEqual(list(detector._baseline), baseline_before)
        self.assertIsNone(detector.active)

        detector.process(make_window(130, 200))
        self.assertIsNotNone(detector.active)
        self.assertEqual(detector.active.source_ip, SOURCE)

    def test_baseline_stays_frozen_during_active_burst(self):
        detector = BurstDetector(DetectionConfig())
        prime_baseline(detector)

        for t in (110, 120, 130):
            detector.process(make_window(t, 200))

        self.assertIsNotNone(detector.active)
        baseline_during_burst = list(detector._baseline)

        detector.process(make_window(140, 200))
        detector.process(make_window(150, 200))

        self.assertEqual(list(detector._baseline), baseline_during_burst)

    def test_recovery_occurs_after_configured_quiet_windows(self):
        cfg = DetectionConfig(recovery_windows=3)
        events = []
        detector = BurstDetector(
            cfg, lambda kind, event: events.append(kind)
        )
        prime_baseline(detector)

        for t in (110, 120, 130):
            detector.process(make_window(t, 200))

        self.assertIsNotNone(detector.active)

        detector.process(make_window(140, 10))
        detector.process(make_window(150, 10))
        self.assertIsNotNone(detector.active)

        detector.process(make_window(160, 10))
        self.assertIsNone(detector.active)
        self.assertIn("burst_ended", events)

    def test_second_burst_respects_cooldown(self):
        cfg = DetectionConfig(recovery_windows=1, cooldown_ms=100)
        events = []
        detector = BurstDetector(
            cfg, lambda kind, event: events.append((kind, event.started_at_ms))
        )
        prime_baseline(detector)

        for t in (110, 120, 130):
            detector.process(make_window(t, 200))

        self.assertIsNotNone(detector.active)
        detector.process(make_window(140, 10))
        self.assertIsNone(detector.active)

        # Only 10 ms after recovery: cooldown must prevent a new event.
        for t in (150, 160, 170):
            detector.process(make_window(t, 200))

        starts = [
            t for kind, t in events if kind == "burst_detected"
        ]
        self.assertEqual(len(starts), 1)

    def test_nonqualifying_idle_traffic_updates_baseline(self):
        detector = BurstDetector(DetectionConfig())
        detector.process(make_window(10, 10))
        detector.process(make_window(20, 12))

        self.assertEqual(len(detector._baseline), 2)
        self.assertAlmostEqual(
            sum(rate for _, rate in detector._baseline)
            / len(detector._baseline),
            11.0,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
