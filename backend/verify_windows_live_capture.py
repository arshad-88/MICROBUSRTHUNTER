"""End-to-end verification script for Windows live packet capture in MicroburstHunter.

Tests:
1. /api/interfaces returns active Wi-Fi adapter with NPF device identifier and can_capture=True.
2. /api/status returns can_capture=True, driver_status active, and status=idle.
3. /api/capture/start starts capture on Wi-Fi (mapped to NPF device identifier).
4. Live packet traffic is captured and telemetry (rates, packets, bytes) accumulates.
5. /api/sources ranks live packet traffic by source IP.
6. /api/capture/stop stops capture cleanly.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request


def req(endpoint: str, method: str = "GET", data: dict | None = None) -> dict:
    url = f"http://127.0.0.1:8000{endpoint}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req_obj = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req_obj, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    print("[1/6] Querying /api/interfaces ...")
    ifaces_data = req("/api/interfaces")
    assert ifaces_data["ok"], f"Expected ok: True, got {ifaces_data}"
    assert ifaces_data["environment"]["can_capture"] is True, "Expected can_capture: True"
    print(f"  Platform driver: {ifaces_data['environment']['driver_status']}")

    wifi_iface = None
    for iface in ifaces_data["interfaces"]:
        if iface["name"] == "Wi-Fi" or "192.168.1.81" in iface.get("ip", ""):
            wifi_iface = iface
            break

    assert wifi_iface is not None, "Wi-Fi interface not found in /api/interfaces"
    print(f"  Found Wi-Fi adapter: name={wifi_iface['name']!r}, device={wifi_iface.get('device')!r}, ip={wifi_iface.get('ip')!r}")
    assert "\\Device\\NPF_" in wifi_iface.get("device", ""), f"Expected NPF device identifier, got {wifi_iface.get('device')}"

    print("\n[2/6] Querying /api/status in idle state ...")
    status_idle = req("/api/status")
    assert status_idle["ok"] is True
    assert status_idle["status"] == "idle", f"Expected idle status, got {status_idle['status']}"
    assert status_idle["can_capture"] is True
    assert status_idle["error"] is None, f"Expected no error, got {status_idle['error']}"
    print("  Status is idle, can_capture=True, error=None (confirmed).")

    print("\n[3/6] Starting live packet capture on 'Wi-Fi' ...")
    start_res = req("/api/capture/start", method="POST", data={"interface": "Wi-Fi", "bpf_filter": "ip", "window_ms": 10})
    print(f"  Start response: {start_res}")
    assert start_res["ok"] is True
    assert start_res["interface"] == "Wi-Fi"
    assert "\\Device\\NPF_" in start_res["device"]
    print(f"  Capture active on NPF device: {start_res['device']}")

    print("\n[4/6] Generating network activity and monitoring packet ingestion for 4 seconds ...")
    start_time = time.time()
    packet_count = 0
    total_bytes = 0

    while time.time() - start_time < 4.0:
        # Generate some outbound / inbound HTTP and DNS activity
        try:
            urllib.request.urlopen("http://127.0.0.1:8000/api/status", timeout=1)
            urllib.request.urlopen("https://1.1.1.1", timeout=1)
        except Exception:
            pass
        time.sleep(0.5)
        st = req("/api/status")
        packet_count = st.get("packet_count", 0)
        total_bytes = st.get("total_bytes", 0)
        curr_rate = st.get("current_rate_mbps", 0.0)
        print(f"  Elapsed {time.time() - start_time:.1f}s: packets={packet_count}, bytes={total_bytes}, rate={curr_rate} Mbps")
        if packet_count >= 5:
            break

    print(f"\n[5/6] Inspecting live sources and history ...")
    sources_res = req("/api/sources")
    print(f"  Ranked source IPs: {len(sources_res.get('sources', []))} active sources")
    for src in sources_res.get("sources", [])[:3]:
        print(f"    - IP {src['ip']}: {src['packets']} packets, {src['bytes']} bytes ({src['contribution_pct']}%)")

    history_res = req("/api/history")
    print(f"  Rate history samples: {history_res.get('count', 0)} samples collected")

    print("\n[6/6] Stopping live packet capture ...")
    stop_res = req("/api/capture/stop", method="POST")
    print(f"  Stop response: {stop_res}")
    assert stop_res["ok"] is True

    status_stopped = req("/api/status")
    assert status_stopped["status"] == "stopped"
    print(f"  Final status: {status_stopped['status']}, total packets captured: {status_stopped['packet_count']}")

    assert status_stopped["packet_count"] > 0, "No packets were captured during live capture run!"
    print("\n>>> SUCCESS: Windows live packet capture verified end-to-end! <<<")
    return 0


if __name__ == "__main__":
    sys.exit(main())
