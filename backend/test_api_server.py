"""Automated unit and integration tests for the MicroburstHunter API server and CaptureManager."""

import json
import unittest
from unittest.mock import MagicMock, patch

from api_server import app
from capture_manager import CaptureManager
from config import RuntimeConfig
from metrics import Window


class ApiServerTests(unittest.TestCase):
    def setUp(self):
        self.app = app
        self.client = self.app.test_client()
        self.cfg = RuntimeConfig()
        self.cfg.db_path = ":memory:"
        self.manager = CaptureManager(self.cfg)

    def tearDown(self):
        self.manager.close()

    def test_status_endpoint_returns_json_and_environment(self):
        with patch("api_server.get_capture_manager", return_value=self.manager):
            resp = self.client.get("/api/status")
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data["ok"])
            self.assertEqual(data["status"], "idle")
            self.assertIn("environment", data)
            self.assertIn("os", data["environment"])
            self.assertIn("can_capture", data["environment"])
            self.assertIn("packet_count", data)
            self.assertIn("mitigation", data)
            self.assertEqual(data["mitigation"]["mode"], "dry-run")

    def test_interfaces_endpoint_returns_interface_list(self):
        with patch("api_server.get_capture_manager", return_value=self.manager):
            resp = self.client.get("/api/interfaces")
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data["ok"])
            self.assertIsInstance(data["interfaces"], list)
            self.assertIn("environment", data)

    def test_capture_start_missing_interface_returns_400(self):
        with patch("api_server.get_capture_manager", return_value=self.manager):
            resp = self.client.post("/api/capture/start", json={})
            self.assertEqual(resp.status_code, 400)
            data = resp.get_json()
            self.assertFalse(data["ok"])
            self.assertIn("Interface name is required", data["error"])

    def test_capture_start_capability_error(self):
        with (
            patch("api_server.get_capture_manager", return_value=self.manager),
            patch("capture_manager.check_capture_capability", return_value=(False, "Npcap driver missing")),
        ):
            resp = self.client.post("/api/capture/start", json={"interface": "eth0"})
            self.assertEqual(resp.status_code, 400)
            data = resp.get_json()
            self.assertFalse(data["ok"])
            self.assertIn("Npcap driver missing", data["error"])
            self.assertEqual(self.manager.status, "error")

    def test_capture_start_and_stop_lifecycle_mocked(self):
        def blocking_capture(*args, **kwargs):
            stop_event = kwargs.get("stop_event")
            if stop_event:
                stop_event.wait(timeout=5.0)

        with (
            patch("api_server.get_capture_manager", return_value=self.manager),
            patch("capture_manager.check_capture_capability", return_value=(True, "Ready")),
            patch("capture_manager.capture", side_effect=blocking_capture),
        ):
            resp_start = self.client.post("/api/capture/start", json={"interface": "test0", "window_ms": 10})
            self.assertEqual(resp_start.status_code, 200)
            self.assertTrue(resp_start.get_json()["ok"])
            self.assertEqual(self.manager.status, "running")
            self.assertEqual(self.manager.interface, "test0")

            # Duplicate start attempt while running should be rejected
            resp_dup = self.client.post("/api/capture/start", json={"interface": "test0"})
            self.assertEqual(resp_dup.status_code, 400)
            self.assertFalse(resp_dup.get_json()["ok"])

            resp_stop = self.client.post("/api/capture/stop")
            self.assertEqual(resp_stop.status_code, 200)
            self.assertTrue(resp_stop.get_json()["ok"])
            self.assertEqual(self.manager.status, "stopped")

    def test_window_processing_updates_metrics_and_detects_burst(self):
        self.manager.status = "running"
        self.manager.interface = "test0"
        self.manager.started_at = 1000.0

        from main import CapturePipeline
        self.manager.pipeline = CapturePipeline(
            cfg=self.cfg,
            interface="test0",
            store=self.manager.store,
            emit_fn=self.manager._handle_emit,
        )

        # 1. Warm rolling baseline with 3 normal windows
        for i in range(3):
            self.manager._on_window(
                Window(
                    start_ms=i * 10.0,
                    end_ms=(i + 1) * 10.0,
                    total_bytes=1250,  # 1 Mbps
                    packet_count=2,
                    per_source_bytes={"10.0.1.10": 1250},
                )
            )

        self.assertEqual(self.manager.packet_count, 6)
        self.assertEqual(self.manager.total_bytes, 3750)
        self.assertEqual(len(self.manager.history), 3)

        # 2. Inject high-rate burst windows (> 80 Mbps and > 3x baseline)
        for i in range(3, 7):
            self.manager._on_window(
                Window(
                    start_ms=i * 10.0,
                    end_ms=(i + 1) * 10.0,
                    total_bytes=125000,  # 100 Mbps
                    packet_count=50,
                    per_source_bytes={"10.0.1.50": 120000, "10.0.1.10": 5000},
                )
            )

        # Check burst was declared
        status = self.manager.get_status()
        self.assertTrue(status["burst_active"])
        self.assertIsNotNone(status["current_burst"])
        self.assertEqual(status["current_burst"]["source_ip"], "10.0.1.50")

        # 3. Check sources endpoint returns ranked IPs
        sources = self.manager.get_sources()["sources"]
        self.assertTrue(len(sources) >= 2)
        top_source = sources[0]
        self.assertEqual(top_source["ip"], "10.0.1.50")
        self.assertTrue(top_source["contribution_pct"] > 80.0)

        # 4. Check history endpoint returns time series
        history = self.manager.get_history()
        self.assertEqual(history["count"], 7)
        self.assertEqual(len(history["samples"]), 7)

        # 5. Check events endpoint has recorded monitoring events
        events = self.manager.get_events()
        self.assertTrue(events["total"] > 0)

    def test_windows_capability_detection_npcap_present(self):
        """Verify Windows capability detection succeeds when Npcap is available."""
        from capture import check_capture_capability
        from scapy.all import conf

        mock_lib = MagicMock()
        mock_lib.pcap_lib_version.return_value = b"Npcap version 1.89, based on libpcap"

        orig_use_pcap = getattr(conf, "use_pcap", False)
        orig_l2 = getattr(conf, "L2listen", None)
        try:
            conf.use_pcap = True
            conf.L2listen = MagicMock(desc="pcap socket")
            with (
                patch("sys.platform", "win32"),
                patch.dict("sys.modules", {"scapy.libs.winpcapy": mock_lib}),
            ):
                can_cap, reason = check_capture_capability()
                self.assertTrue(can_cap)
                self.assertIn("Npcap driver is active", reason)
                self.assertIn("1.89", reason)
        finally:
            conf.use_pcap = orig_use_pcap
            conf.L2listen = orig_l2

    def test_windows_capability_detection_npcap_missing(self):
        """Verify Windows capability detection fails with clear guidance when Npcap is missing."""
        from capture import check_capture_capability
        from scapy.all import conf

        orig_use_pcap = getattr(conf, "use_pcap", False)
        try:
            conf.use_pcap = False
            with (
                patch("sys.platform", "win32"),
                patch("capture._ensure_windows_pcap_initialized", return_value=False),
            ):
                can_cap, reason = check_capture_capability()
                self.assertFalse(can_cap)
                self.assertIn("Windows requires the Npcap packet-capture driver", reason)
                self.assertIn("npcap.com", reason)
        finally:
            conf.use_pcap = orig_use_pcap

    def test_linux_capability_root_and_non_root(self):
        """Verify Linux capability detection for root and non-root users."""
        from capture import check_capture_capability

        with patch("sys.platform", "linux"):
            with patch("os.geteuid", return_value=0, create=True):
                can_cap, reason = check_capture_capability()
                self.assertTrue(can_cap)
                self.assertIn("root", reason)

            # Non-root without CAP_NET_RAW raises PermissionError
            with (
                patch("os.geteuid", return_value=1000, create=True),
                patch("socket.socket", side_effect=PermissionError("Operation not permitted")),
            ):
                can_cap, reason = check_capture_capability()
                self.assertFalse(can_cap)
                self.assertIn("requires root privileges", reason)

    def test_interface_resolution_mapping_all_variants(self):
        """Verify interface resolution maps friendly names, GUIDs, IPs, and NPF devices."""
        from capture import resolve_capture_interface
        from scapy.all import conf

        npf_dev = r"\Device\NPF_{286F5688-A255-4744-8DF4-C5C88CDF5D41}"
        mock_iface = MagicMock()
        mock_iface.name = "Wi-Fi"
        mock_iface.network_name = npf_dev
        mock_iface.guid = "{286F5688-A255-4744-8DF4-C5C88CDF5D41}"
        mock_iface.ip = "192.168.1.81"
        mock_iface.description = "Realtek 8852BE-VT Wireless LAN WiFi 6 PCI-E NIC"
        mock_iface.is_loopback = False

        mock_loop = MagicMock()
        mock_loop.name = "Loopback Pseudo-Interface 1"
        mock_loop.network_name = r"\Device\NPF_Loopback"
        mock_loop.guid = r"\Device\NPF_Loopback"
        mock_loop.ip = "127.0.0.1"
        mock_loop.description = "Npcap Loopback Adapter"
        mock_loop.is_loopback = True

        fake_ifaces = {
            npf_dev: mock_iface,
            r"\Device\NPF_Loopback": mock_loop,
        }

        with patch.object(conf, "ifaces", fake_ifaces):
            # 1. By friendly name
            dev, name = resolve_capture_interface("Wi-Fi")
            self.assertEqual(dev, npf_dev)
            self.assertEqual(name, "Wi-Fi")

            # 2. Case-insensitive friendly name
            dev, name = resolve_capture_interface("wi-fi")
            self.assertEqual(dev, npf_dev)

            # 3. By exact NPF device string
            dev, name = resolve_capture_interface(npf_dev)
            self.assertEqual(dev, npf_dev)

            # 4. By GUID with curly braces
            dev, name = resolve_capture_interface("{286F5688-A255-4744-8DF4-C5C88CDF5D41}")
            self.assertEqual(dev, npf_dev)

            # 5. By GUID without curly braces
            dev, name = resolve_capture_interface("286F5688-A255-4744-8DF4-C5C88CDF5D41")
            self.assertEqual(dev, npf_dev)

            # 6. By IP address
            dev, name = resolve_capture_interface("192.168.1.81")
            self.assertEqual(dev, npf_dev)

            # 7. By description substring
            dev, name = resolve_capture_interface("Realtek 8852BE-VT")
            self.assertEqual(dev, npf_dev)

            # 8. Loopback by alias / IP
            dev, name = resolve_capture_interface("127.0.0.1")
            self.assertEqual(dev, r"\Device\NPF_Loopback")

            dev, name = resolve_capture_interface("loopback")
            self.assertEqual(dev, r"\Device\NPF_Loopback")

    def test_interface_resolution_unknown_raises_actionable_error(self):
        """Unknown interfaces raise ValueError listing available options."""
        from capture import resolve_capture_interface
        from scapy.all import conf

        mock_iface = MagicMock()
        mock_iface.name = "Wi-Fi"
        mock_iface.network_name = r"\Device\NPF_{GUID}"
        mock_iface.ip = "192.168.1.81"

        with patch.object(conf, "ifaces", {r"\Device\NPF_{GUID}": mock_iface}):
            with self.assertRaises(ValueError) as ctx:
                resolve_capture_interface("nonexistent_adapter_xyz")
            self.assertIn("could not be resolved", str(ctx.exception))
            self.assertIn("Wi-Fi", str(ctx.exception))

    def test_capture_start_unknown_interface_returns_400(self):
        """Start capture with unresolvable interface returns 400 and actionable error."""
        with (
            patch("api_server.get_capture_manager", return_value=self.manager),
            patch("capture_manager.check_capture_capability", return_value=(True, "Ready")),
            patch(
                "capture_manager.resolve_capture_interface",
                side_effect=ValueError("Interface 'bad_nic' could not be resolved."),
            ),
        ):
            resp = self.client.post("/api/capture/start", json={"interface": "bad_nic"})
            self.assertEqual(resp.status_code, 400)
            data = resp.get_json()
            self.assertFalse(data["ok"])
            self.assertIn("could not be resolved", data["error"])

    def test_capture_start_immediate_worker_failure_returns_400(self):
        """Immediate worker failure (e.g. invalid BPF filter or permission) surfaces HTTP 400."""
        with (
            patch("api_server.get_capture_manager", return_value=self.manager),
            patch("capture_manager.check_capture_capability", return_value=(True, "Ready")),
            patch(
                "capture_manager.capture",
                side_effect=RuntimeError("Cannot set filter: syntax error"),
            ),
        ):
            resp = self.client.post("/api/capture/start", json={"interface": "test0", "bpf_filter": "bad_syntax"})
            self.assertEqual(resp.status_code, 400)
            data = resp.get_json()
            self.assertFalse(data["ok"])
            self.assertIn("syntax error", data["error"])
            self.assertEqual(self.manager.status, "error")

    def test_status_endpoint_reports_device_and_can_capture(self):
        """Status endpoint includes device, can_capture, and clean idle state."""
        with patch("api_server.get_capture_manager", return_value=self.manager):
            resp = self.client.get("/api/status")
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertIn("can_capture", data)
            self.assertIn("device", data)
            self.assertIsNone(data["error"])


if __name__ == "__main__":
    unittest.main()
