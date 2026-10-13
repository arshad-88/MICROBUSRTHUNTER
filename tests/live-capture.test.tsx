import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { MonitoringProvider } from "@/state/monitoring";
import { ControlBar } from "@/components/ControlBar";
import {
  fetchBackendStatus,
  fetchInterfaces,
  startCapture,
  stopCapture,
  fetchRateHistory,
  fetchSourceRanking,
  fetchLiveEvents,
} from "@/lib/api";

describe("Live Capture API Client and Component Rendering", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches backend status successfully", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        status: "running",
        interface: "eth0",
        packet_count: 1420,
        total_bytes: 1850000,
        current_rate_mbps: 24.5,
        peak_rate_mbps: 112.4,
        avg_rate_mbps: 18.2,
        burst_active: true,
        current_burst: {
          started_at_ms: 5000,
          peak_mbps: 112.4,
          baseline_mbps: 12.0,
          threshold_mbps: 36.0,
          source_ip: "10.0.1.50",
          contribution_pct: 88.5,
          severity: "severe",
        },
        burst_count: 3,
        mitigation: {
          active: true,
          source_ip: "10.0.1.50",
          cap_mbps: 35.0,
          severity: "severe",
          reason: "severe burst cap",
          mode: "dry-run",
        },
        environment: {
          os: "linux",
          scapy_available: true,
          can_capture: true,
          driver_status: "Linux raw socket ready (root)",
        },
      }),
    } as any);

    const status = await fetchBackendStatus();
    expect(status.ok).toBe(true);
    expect(status.status).toBe("running");
    expect(status.interface).toBe("eth0");
    expect(status.burst_active).toBe(true);
    expect(status.current_burst?.source_ip).toBe("10.0.1.50");
    expect(status.mitigation.mode).toBe("dry-run");
  });

  it("fetches interface listing from backend", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        interfaces: [
          { name: "eth0", description: "Ethernet", ip: "192.168.1.10", mac: "00:11:22:33:44:55", is_loopback: false },
          { name: "lo", description: "Loopback", ip: "127.0.0.1", mac: "", is_loopback: true },
        ],
        environment: { os: "linux", scapy_available: true, can_capture: true, driver_status: "Ready" },
        active_interface: null,
        status: "idle",
      }),
    } as any);

    const data = await fetchInterfaces();
    expect(data.ok).toBe(true);
    expect(data.interfaces).toHaveLength(2);
    expect(data.interfaces[0].name).toBe("eth0");
    expect(data.environment.can_capture).toBe(true);
  });

  it("sends start and stop capture requests", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, message: "Started" }),
    } as any);

    const startRes = await startCapture("eth0", "ip", 10);
    expect(startRes.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/capture/start"),
      expect.objectContaining({ method: "POST" })
    );

    const stopRes = await stopCapture();
    expect(stopRes.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/capture/stop"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("renders ControlBar with mode selection tabs", () => {
    const html = renderToStaticMarkup(
      <MonitoringProvider>
        <ControlBar />
      </MonitoringProvider>
    );

    expect(html).toContain("Live Capture");
    expect(html).toContain("Simulation");
    expect(html).toContain("Simulate burst");
    expect(html).toContain("auto mitigation");
  });
});
