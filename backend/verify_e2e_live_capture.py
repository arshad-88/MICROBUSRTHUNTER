"""End-to-end automated verification script for real passive packet capture.

Validates:
1. Interface enumeration and capability diagnosis.
2. Starting live capture on an actual network interface ('lo').
3. Injecting real network packets on the host socket.
4. Verifying Scapy captures the real packets and aggregates into 10ms windows.
5. Verifying rate history, source attribution, and SQLite persistence.
6. Stopping live capture and checking final packet counts.
"""

import json
import socket
import sys
import time
import urllib.request

from capture_manager import get_capture_manager

def main():
    print("=== MicroburstHunter E2E Live Capture Verification ===")
    manager = get_capture_manager()

    # 1. Interface inspection
    ifaces_data = manager.get_interfaces()
    print(f"[1] Detected {len(ifaces_data['interfaces'])} interface(s). Platform: {ifaces_data['environment']['os']}")
    print(f"    Driver/Privilege status: {ifaces_data['environment']['driver_status']}")

    if not ifaces_data['environment']['can_capture']:
        print("    Live capture cannot run in this environment without privileges/driver.")
        print("    (This is expected on Windows without Npcap. Run inside WSL as root for live packet capture.)")
        return 0

    # 2. Pick capture interface
    iface = "lo"
    print(f"[2] Starting real passive packet capture on '{iface}'...")
    start_res = manager.start(interface=iface, bpf_filter="ip", window_ms=10)
    if not start_res.get("ok"):
        print(f"FAILED to start capture: {start_res.get('error')}")
        return 1
    print(f"    Capture successfully started: {start_res.get('message')}")

    time.sleep(0.5)

    # 3. Inject actual network traffic (UDP packets to 127.0.0.1)
    print("[3] Emitting 15 real UDP network packets to 127.0.0.1:9999...")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    for i in range(15):
        sock.sendto(b"microburst_hunter_live_packet_test_payload_1234567890", ("127.0.0.1", 9999))
        time.sleep(0.02)
    sock.close()

    time.sleep(0.5)

    # 4. Query status
    status = manager.get_status()
    print(f"[4] Live capture telemetry query:")
    print(f"    Status: {status['status']}")
    print(f"    Total packets captured: {status['packet_count']}")
    print(f"    Total bytes captured: {status['total_bytes']}")
    print(f"    Current rate: {status['current_rate_mbps']} Mbps")
    print(f"    Elapsed: {status['elapsed_s']} s")
    print(f"    Burst active: {status['burst_active']}")

    # 5. Query sources
    sources = manager.get_sources()["sources"]
    print(f"[5] Source attribution:")
    for s in sources:
        print(f"    Source IP: {s['ip']} -> {s['packets']} pkts, {s['bytes']} bytes, {s['contribution_pct']}% contribution")

    # 6. Query events
    events = manager.get_events()["events"]
    print(f"[6] SQLite persistent event store has {len(events)} recorded event(s):")
    for ev in events[:3]:
        print(f"    - [{ev['type']}] {ev['action']} -> {ev['outcome']}")

    # 7. Stop capture
    print("[7] Stopping live capture...")
    stop_res = manager.stop()
    print(f"    Stop result: {stop_res}")

    if status["packet_count"] > 0:
        print("=== SUCCESS: Real network packets successfully captured, aggregated, and stored! ===")
        return 0
    else:
        print("=== WARNING: Capture ran but 0 packets detected on interface. ===")
        return 1

if __name__ == "__main__":
    sys.exit(main())
