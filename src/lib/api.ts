/**
 * API client connecting the React dashboard to the Python packet-capture backend.
 */

export interface NetworkInterface {
  name: string;
  description: string;
  ip: string;
  mac: string;
  is_loopback: boolean;
}

export interface PlatformEnvironment {
  os: string;
  scapy_available: boolean;
  can_capture: boolean;
  driver_status: string;
}

export interface LiveBurstEvent {
  started_at_ms: number;
  peak_mbps: number;
  baseline_mbps: number;
  threshold_mbps: number;
  source_ip: string;
  contribution_pct: number;
  severity: "moderate" | "severe";
}

export interface LiveMitigationInfo {
  active: boolean;
  source_ip: string | null;
  cap_mbps: number | null;
  severity: string;
  reason: string;
  mode: "dry-run" | "enforced";
}

export interface BackendStatus {
  ok: boolean;
  status: "idle" | "running" | "stopped" | "error";
  interface: string | null;
  bpf_filter: string;
  started_at: number | null;
  elapsed_s: number;
  packet_count: number;
  total_bytes: number;
  current_rate_mbps: number;
  peak_rate_mbps: number;
  avg_rate_mbps: number;
  sample_count: number;
  burst_active: boolean;
  current_burst: LiveBurstEvent | null;
  burst_count: number;
  mitigation: LiveMitigationInfo;
  error: string | null;
  environment: PlatformEnvironment;
}

export interface RateSample {
  timestamp: number;
  rate_mbps: number;
  packets: number;
  bytes?: number;
  baseline_mbps: number;
  threshold_mbps: number;
}

export interface SourceRanking {
  ip: string;
  bytes: number;
  packets: number;
  mb: number;
  contribution_pct: number;
}

export interface LiveBackendEvent {
  id?: number;
  timestamp: number;
  type: string;
  severity: "info" | "moderate" | "severe";
  source_ip?: string | null;
  rate_mbps?: number | null;
  action: string;
  outcome: string;
  data_source: "live" | "simulated";
}

const API_BASE = "/api";
const DIRECT_BACKEND = "http://localhost:8000/api";

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  try {
    // Try relative /api first (works via Vite proxy)
    const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    if (res.ok) {
      return (await res.json()) as T;
    }
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Server responded with ${res.status}: ${res.statusText}`);
  } catch (err: any) {
    // If Vite proxy failed or direct port 8000 is needed, try direct URL
    try {
      const res = await fetch(`${DIRECT_BACKEND}${endpoint}`, { ...options, headers });
      if (res.ok) {
        return (await res.json()) as T;
      }
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server responded with ${res.status}`);
    } catch {
      throw new Error(err.message || "Failed to reach backend API");
    }
  }
}

export async function fetchBackendStatus(): Promise<BackendStatus> {
  return request<BackendStatus>("/status");
}

export async function fetchInterfaces(): Promise<{
  ok: boolean;
  interfaces: NetworkInterface[];
  environment: PlatformEnvironment;
  active_interface: string | null;
  status: string;
}> {
  return request<{
    ok: boolean;
    interfaces: NetworkInterface[];
    environment: PlatformEnvironment;
    active_interface: string | null;
    status: string;
  }>("/interfaces");
}

export async function startCapture(
  interfaceName: string,
  bpfFilter: string = "ip",
  windowMs: number = 10,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  return request<{ ok: boolean; message?: string; error?: string }>("/capture/start", {
    method: "POST",
    body: JSON.stringify({ interface: interfaceName, bpf_filter: bpfFilter, window_ms: windowMs }),
  });
}

export async function stopCapture(): Promise<{
  ok: boolean;
  message?: string;
  packet_count?: number;
  total_bytes?: number;
}> {
  return request<{ ok: boolean; message?: string; packet_count?: number; total_bytes?: number }>(
    "/capture/stop",
    { method: "POST" },
  );
}

export async function fetchRateHistory(): Promise<{
  ok: boolean;
  interface: string | null;
  samples: RateSample[];
  count: number;
}> {
  return request<{
    ok: boolean;
    interface: string | null;
    samples: RateSample[];
    count: number;
  }>("/history");
}

export async function fetchSourceRanking(): Promise<{
  ok: boolean;
  sources: SourceRanking[];
}> {
  return request<{ ok: boolean; sources: SourceRanking[] }>("/sources");
}

export async function fetchLiveEvents(): Promise<{
  ok: boolean;
  events: LiveBackendEvent[];
  total: number;
}> {
  return request<{ ok: boolean; events: LiveBackendEvent[]; total: number }>("/events");
}

export async function clearLiveEvents(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/events/clear", { method: "POST" });
}
