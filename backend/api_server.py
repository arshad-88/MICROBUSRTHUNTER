"""HTTP API server for MicroburstHunter.

Exposes REST endpoints to bridge the passive packet capture Python backend
with the React dashboard.
"""

from __future__ import annotations

import argparse
import logging
import sys

from flask import Flask, jsonify, request

from capture_manager import get_capture_manager

LOG = logging.getLogger("microbursthunter.api")

app = Flask("microbursthunter")


@app.after_request
def add_cors_headers(response):
    """Enable CORS so frontend on any port (5173, 4173) can reach the backend."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, DELETE"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


@app.route("/api/status", methods=["GET"])
def api_status():
    """Return real-time capture status, rates, and active mitigation decisions."""
    manager = get_capture_manager()
    return jsonify(manager.get_status())


@app.route("/api/interfaces", methods=["GET"])
def api_interfaces():
    """List available network interfaces and platform capture capabilities."""
    manager = get_capture_manager()
    return jsonify(manager.get_interfaces())


@app.route("/api/capture/start", methods=["POST"])
def api_start_capture():
    """Start passive live packet capture on the selected interface."""
    data = request.get_json(silent=True) or {}
    interface = data.get("interface")
    if not interface:
        return jsonify({"ok": False, "error": "Interface name is required"}), 400

    bpf_filter = data.get("bpf_filter", "ip")
    window_ms = int(data.get("window_ms", 10))

    manager = get_capture_manager()
    result = manager.start(interface=interface, bpf_filter=bpf_filter, window_ms=window_ms)
    status_code = 200 if result.get("ok") else 400
    return jsonify(result), status_code


@app.route("/api/capture/stop", methods=["POST"])
def api_stop_capture():
    """Stop passive live packet capture."""
    manager = get_capture_manager()
    result = manager.stop()
    return jsonify(result)


@app.route("/api/history", methods=["GET"])
def api_history():
    """Return rolling rate samples history for live charts."""
    manager = get_capture_manager()
    return jsonify(manager.get_history())


@app.route("/api/sources", methods=["GET"])
def api_sources():
    """Return source IPs ranked by contribution to traffic / bursts."""
    manager = get_capture_manager()
    return jsonify(manager.get_sources())


@app.route("/api/events", methods=["GET"])
def api_events():
    """Return recent events from the SQLite event store."""
    manager = get_capture_manager()
    return jsonify(manager.get_events())


@app.route("/api/events/clear", methods=["POST"])
def api_clear_events():
    """Clear recorded session events."""
    manager = get_capture_manager()
    return jsonify(manager.clear_events())


def run_server(host: str = "0.0.0.0", port: int = 8000) -> int:
    """Run the Flask development server."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    print(f"Starting MicroburstHunter Live Capture API on http://{host}:{port} ...")
    app.run(host=host, port=port, threaded=True, debug=False)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MicroburstHunter Live Capture API Server")
    parser.add_argument("--host", default="0.0.0.0", help="Binding host (default 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Binding port (default 8000)")
    args = parser.parse_args(argv)
    return run_server(host=args.host, port=args.port)


if __name__ == "__main__":
    sys.exit(main())
