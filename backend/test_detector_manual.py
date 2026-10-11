from config import DetectionConfig
from burst_detector import BurstDetector
from metrics import Window, bytes_to_mbps

def make_window(t, rate_mbps, source="192.0.2.10"):
    # A 10 ms window: 1 Mbps = 1,250 bytes per 10 ms.
    byte_count = round(rate_mbps * 1250)
    return Window(
        start_ms=t - 10,
        end_ms=t,
        total_bytes=byte_count,
        packet_count=10,
        per_source_bytes={source: byte_count},
    )

def test_rate_calculation():
    assert abs(bytes_to_mbps(100_000, 10) - 80.0) < 1e-9
    print("PASS: rate calculation")

def test_normal_traffic_no_alert():
    events = []
    detector = BurstDetector(DetectionConfig(), lambda kind, event: events.append(kind))
    for t in range(10, 101, 10):
        detector.process(make_window(t, 20))
    assert "burst_detected" not in events, events
    print("PASS: normal traffic does not trigger detection")

def test_sustained_burst_detected():
    events = []
    detector = BurstDetector(DetectionConfig(), lambda kind, event: events.append((kind, event)))
    # Establish a baseline below the 80 Mbps minimum.
    for t in range(10, 101, 10):
        detector.process(make_window(t, 10))
    for t in (110, 120, 130):
        detector.process(make_window(t, 200))
    detected = [event for kind, event in events if kind == "burst_detected"]
    assert len(detected) == 1, events
    assert detected[0].source_ip == "192.0.2.10"
    assert detected[0].peak_mbps == 200
    print("PASS: sustained burst detected after persistence threshold")

def test_recovery_ends_event():
    events = []
    cfg = DetectionConfig(recovery_windows=3)
    detector = BurstDetector(cfg, lambda kind, event: events.append(kind))
    for t in range(10, 101, 10):
        detector.process(make_window(t, 10))
    for t in (110, 120, 130):
        detector.process(make_window(t, 200))
    assert detector.active is not None, "Burst did not activate"
    for t in (140, 150, 160):
        detector.process(make_window(t, 10))
    assert detector.active is None, "Burst did not end after quiet windows"
    assert "burst_ended" in events, events
    print("PASS: recovery ends active burst")

def main():
    test_rate_calculation()
    test_normal_traffic_no_alert()
    test_sustained_burst_detected()
    test_recovery_ends_event()
    print("\\nAll manual detector tests passed.")

if __name__ == "__main__":
    main()
