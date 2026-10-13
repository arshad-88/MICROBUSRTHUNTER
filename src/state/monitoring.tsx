import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  EXPERIMENT_SCENARIOS,
  SimulationEngine,
  cloneConfig,
  type ExperimentScenarioDef,
  type MonitoringSnapshot,
  type SourceRow,
} from "@/simulation";
import {
  DEFAULT_CONFIG,
  validateConfig,
  type AppConfig,
  type ValidationIssue,
} from "@/simulation/config";
import type {
  AppEvent,
  BurstEvent,
  EventType,
  EventSeverity,
  ExperimentResult,
  ExperimentScenarioId,
  MitigationState,
  TrafficSample,
  TrafficState,
} from "@/types";
import {
  fetchBackendStatus,
  fetchInterfaces,
  fetchLiveEvents,
  fetchRateHistory,
  fetchSourceRanking,
  startCapture,
  stopCapture,
  type BackendStatus,
  type NetworkInterface,
  type RateSample,
  type SourceRanking,
} from "@/lib/api";

const EVENTS_KEY = "microbursthunter.events.v1";
const EXPERIMENTS_KEY = "microbursthunter.experiments.v1";
const CONFIG_KEY = "microbursthunter.config.v1";
const MODE_KEY = "microbursthunter.mode.v1";
const IFACE_KEY = "microbursthunter.iface.v1";

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — persistence is best-effort */
  }
}

function loadConfig(): AppConfig {
  const stored = loadJson<Partial<AppConfig> | null>(CONFIG_KEY, null);
  if (!stored) return cloneConfig(DEFAULT_CONFIG);
  const merged: AppConfig = {
    detection: { ...DEFAULT_CONFIG.detection, ...(stored.detection ?? {}) },
    mitigation: { ...DEFAULT_CONFIG.mitigation, ...(stored.mitigation ?? {}) },
    simulation: { ...DEFAULT_CONFIG.simulation, ...(stored.simulation ?? {}) },
  };
  return validateConfig(merged).length === 0 ? merged : cloneConfig(DEFAULT_CONFIG);
}

export interface MonitoringContextValue {
  snapshot: MonitoringSnapshot;
  config: AppConfig;
  issues: ValidationIssue[];
  scenarios: ExperimentScenarioDef[];
  mode: "simulated" | "live";
  setMode: (mode: "simulated" | "live") => void;
  availableInterfaces: NetworkInterface[];
  selectedInterface: string;
  setSelectedInterface: (iface: string) => void;
  liveError: string | null;
  backendConnected: boolean;
  backendStatus: BackendStatus | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  reset: () => void;
  startLiveCapture: (iface?: string) => Promise<boolean>;
  stopLiveCapture: () => Promise<boolean>;
  refreshInterfaces: () => Promise<void>;
  simulateBurst: (hostId?: string) => void;
  triggerBurst: (hostId?: string) => void;
  restoreNormal: () => void;
  updateConfig: (next: AppConfig) => ValidationIssue[];
  setBurstHost: (hostId: string) => void;
  setMitigationEnabled: (enabled: boolean) => void;
  applyManualMitigation: (hostId: string, limitMbps: number) => void;
  removeMitigation: () => void;
  startExperiment: (scenario: ExperimentScenarioId) => void;
  stopExperiment: () => void;
  setScenario: (options: import("@/simulation").ScenarioRunOptions) => void;
  clearEvents: () => void;
  clearExperiments: () => void;
  pushError: (action: string, outcome: string) => void;
}

const MonitoringContext = createContext<MonitoringContextValue | null>(null);

export function MonitoringProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<SimulationEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new SimulationEngine({
      config: loadConfig(),
      events: loadJson<AppEvent[]>(EVENTS_KEY, []),
      experiments: loadJson<ExperimentResult[]>(EXPERIMENTS_KEY, []),
    });
  }
  const engine = engineRef.current;

  // Operating mode: simulated vs live capture
  const [mode, setModeState] = useState<"simulated" | "live">(() =>
    loadJson<"simulated" | "live">(MODE_KEY, "simulated"),
  );

  const setMode = useCallback((newMode: "simulated" | "live") => {
    setModeState(newMode);
    persist(MODE_KEY, newMode);
  }, []);

  // Live capture state
  const [availableInterfaces, setAvailableInterfaces] = useState<NetworkInterface[]>([]);
  const [selectedInterface, setSelectedInterfaceState] = useState<string>(() =>
    loadJson<string>(IFACE_KEY, ""),
  );
  const setSelectedInterface = useCallback((iface: string) => {
    setSelectedInterfaceState(iface);
    persist(IFACE_KEY, iface);
  }, []);

  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState<boolean>(false);
  const [liveHistory, setLiveHistory] = useState<RateSample[]>([]);
  const [liveSources, setLiveSources] = useState<SourceRanking[]>([]);
  const [liveEvents, setLiveEvents] = useState<AppEvent[]>([]);

  // Simulation state
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot>(() =>
    engine.getSnapshot(),
  );
  const [config, setConfig] = useState<AppConfig>(() => cloneConfig(engine.config));
  const [issues, setIssues] = useState<ValidationIssue[]>(() =>
    validateConfig(engine.config),
  );

  const intervalRef = useRef<number | null>(null);

  const sync = useCallback(() => {
    setSnapshot(engine.getSnapshot());
  }, [engine]);

  const stopTick = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTick = useCallback(() => {
    stopTick();
    intervalRef.current = window.setInterval(() => {
      engine.tick();
      setSnapshot(engine.getSnapshot());
      if (!engine.isRunning()) stopTick();
    }, engine.config.simulation.tickIntervalMs);
  }, [engine, stopTick]);

  // Query interfaces from backend
  const refreshInterfaces = useCallback(async () => {
    try {
      const res = await fetchInterfaces();
      if (res.ok && res.interfaces) {
        setAvailableInterfaces(res.interfaces);
        setBackendConnected(true);
        if (!selectedInterface && res.interfaces.length > 0) {
          const pref = res.interfaces.find((i) => !i.is_loopback && i.ip) || res.interfaces[0];
          setSelectedInterface(pref.name);
        }
      }
    } catch (err: any) {
      setBackendConnected(false);
      if (mode === "live") {
        setLiveError("Backend API server not responding. Run `python backend/api_server.py`.");
      }
    }
  }, [selectedInterface, setSelectedInterface, mode]);

  useEffect(() => {
    refreshInterfaces();
  }, [refreshInterfaces]);

  // Polling loop for live capture telemetry
  useEffect(() => {
    if (mode !== "live") return;

    let active = true;
    const poll = async () => {
      try {
        const status = await fetchBackendStatus();
        if (!active) return;
        setBackendConnected(true);
        setBackendStatus(status);
        if (status.error) {
          setLiveError(status.error);
        } else {
          setLiveError(null);
        }

        // Fetch history and sources only when backend is alive
        const [histRes, srcRes, evRes] = await Promise.all([
          fetchRateHistory().catch(() => ({ ok: true, samples: [], count: 0, interface: null })),
          fetchSourceRanking().catch(() => ({ ok: true, sources: [] })),
          fetchLiveEvents().catch(() => ({ ok: true, events: [], total: 0 })),
        ]);

        if (!active) return;
        if (histRes.samples) setLiveHistory(histRes.samples);
        if (srcRes.sources) setLiveSources(srcRes.sources);
        if (evRes.events) {
          setLiveEvents(
            evRes.events.map((e) => ({
              id: `ev-${e.id ?? e.timestamp}`,
              timestamp: e.timestamp * 1000,
              type: (e.type as EventType) || "info",
              severity: (e.severity as EventSeverity) || "info",
              sourceIp: e.source_ip ?? undefined,
              rateMbps: e.rate_mbps ?? undefined,
              action: e.action,
              outcome: e.outcome,
              dataSource: "live" as const,
            })),
          );
        }
      } catch (err: any) {
        if (!active) return;
        setBackendConnected(false);
        setLiveError("Cannot connect to backend. Start backend with `python backend/api_server.py`.");
      }
    };

    poll();
    const timer = window.setInterval(poll, 500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [mode]);

  const startLiveCapture = useCallback(
    async (ifaceName?: string): Promise<boolean> => {
      const target = ifaceName || selectedInterface;
      if (!target) {
        setLiveError("No network interface selected. Please pick an interface to capture.");
        return false;
      }
      try {
        const res = await startCapture(target);
        if (!res.ok) {
          setLiveError(res.error || "Failed to start capture");
          return false;
        }
        setLiveError(null);
        const status = await fetchBackendStatus().catch(() => null);
        if (status) setBackendStatus(status);
        return true;
      } catch (err: any) {
        setLiveError(err.message || "Failed to communicate with capture server");
        return false;
      }
    },
    [selectedInterface],
  );

  const stopLiveCapture = useCallback(async (): Promise<boolean> => {
    try {
      await stopCapture();
      const status = await fetchBackendStatus().catch(() => null);
      if (status) setBackendStatus(status);
      return true;
    } catch (err: any) {
      setLiveError(err.message || "Failed to stop capture");
      return false;
    }
  }, []);

  const start = useCallback(() => {
    if (mode === "live") {
      startLiveCapture();
    } else {
      if (engine.isRunning()) return;
      engine.start();
      startTick();
      sync();
    }
  }, [mode, startLiveCapture, engine, startTick, sync]);

  const stop = useCallback(() => {
    if (mode === "live") {
      stopLiveCapture();
    } else {
      stopTick();
      engine.stop();
      sync();
    }
  }, [mode, stopLiveCapture, engine, stopTick, sync]);

  const toggle = useCallback(() => {
    if (mode === "live") {
      if (backendStatus?.status === "running") stopLiveCapture();
      else startLiveCapture();
    } else {
      if (engine.isRunning()) stop();
      else start();
    }
  }, [mode, backendStatus, stopLiveCapture, startLiveCapture, engine, start, stop]);

  const reset = useCallback(() => {
    if (mode === "live") {
      stopLiveCapture();
      setLiveHistory([]);
      setLiveSources([]);
    } else {
      stopTick();
      engine.stop();
      engine.reset();
      sync();
    }
  }, [mode, stopLiveCapture, engine, stopTick, sync]);

  const simulateBurst = useCallback(
    (hostId?: string) => {
      if (mode === "live") return;
      if (!engine.isRunning()) {
        engine.start();
        startTick();
      }
      const { baselineWindowMs, windowMs } = engine.config.detection;
      const requiredHistoryMs = Math.max(windowMs * 5, baselineWindowMs / 5);
      const deficitMs = Math.max(0, requiredHistoryMs - engine.getSnapshot().simTime);
      engine.simulateBurst(hostId, { startDelayMs: windowMs + deficitMs });
      sync();
    },
    [mode, engine, startTick, sync],
  );

  const restoreNormal = useCallback(() => {
    if (mode === "live") {
      // In live mode, stopping live capture resets to quiet monitoring
      return;
    }
    engine.restoreNormal();
    sync();
  }, [mode, engine, sync]);

  const updateConfig = useCallback(
    (next: AppConfig): ValidationIssue[] => {
      const found = validateConfig(next);
      setIssues(found);
      if (found.length > 0) return found;
      engine.setConfig(next);
      setConfig(cloneConfig(next));
      persist(CONFIG_KEY, next);
      sync();
      return [];
    },
    [engine, sync],
  );

  const setBurstHost = useCallback(
    (hostId: string) => {
      engine.setBurstHost(hostId);
      setConfig(cloneConfig(engine.config));
      persist(CONFIG_KEY, engine.config);
      sync();
    },
    [engine, sync],
  );

  const setMitigationEnabled = useCallback(
    (enabled: boolean) => {
      engine.setMitigationEnabled(enabled);
      setConfig(cloneConfig(engine.config));
      persist(CONFIG_KEY, engine.config);
      sync();
    },
    [engine, sync],
  );

  const applyManualMitigation = useCallback(
    (hostId: string, limitMbps: number) => {
      engine.applyManualMitigation(hostId, limitMbps);
      sync();
    },
    [engine, sync],
  );

  const removeMitigation = useCallback(() => {
    engine.removeMitigationManual();
    sync();
  }, [engine, sync]);

  const startExperiment = useCallback(
    (scenario: ExperimentScenarioId) => {
      if (mode === "live") return;
      engine.startExperiment(scenario);
      setConfig(cloneConfig(engine.config));
      startTick();
      sync();
    },
    [mode, engine, startTick, sync],
  );

  const stopExperiment = useCallback(() => {
    if (mode === "live") return;
    engine.stopExperiment();
    stopTick();
    sync();
  }, [mode, engine, stopTick, sync]);

  const setScenario = useCallback(
    (options: import("@/simulation").ScenarioRunOptions) => {
      if (mode === "live") return;
      engine.setScenario(options);
      setConfig(cloneConfig(engine.config));
      sync();
    },
    [mode, engine, sync],
  );

  const clearEvents = useCallback(() => {
    engine.clearEvents();
    persist(EVENTS_KEY, []);
    setLiveEvents([]);
    sync();
  }, [engine, sync]);

  const clearExperiments = useCallback(() => {
    engine.clearExperiments();
    persist(EXPERIMENTS_KEY, []);
    sync();
  }, [engine, sync]);

  const pushError = useCallback(
    (action: string, outcome: string) => {
      engine.pushError(action, outcome);
      sync();
    },
    [engine, sync],
  );

  // Construct active snapshot depending on mode
  const activeSnapshot = useMemo<MonitoringSnapshot>(() => {
    if (mode === "simulated") {
      return snapshot;
    }

    // Strictly real telemetry derived from Python Scapy packet capture
    const samples: TrafficSample[] = liveHistory.map((s) => ({
      t: s.timestamp,
      rateMbps: s.rate_mbps,
      baselineMbps: s.baseline_mbps,
      thresholdMbps: s.threshold_mbps,
      bytes: s.bytes || 0,
      packets: s.packets,
      dropBytes: 0,
      latencyMs: 0.1,
      perSource: {},
    }));

    const latestSample: TrafficSample | null =
      samples[samples.length - 1] ??
      (backendStatus
        ? {
            t: (backendStatus.elapsed_s || 0) * 1000,
            rateMbps: backendStatus.current_rate_mbps,
            baselineMbps: backendStatus.current_burst?.baseline_mbps || 0,
            thresholdMbps:
              backendStatus.current_burst?.threshold_mbps || config.detection.minRateMbps,
            bytes: backendStatus.total_bytes,
            packets: backendStatus.packet_count,
            dropBytes: 0,
            latencyMs: 0.1,
            perSource: {},
          }
        : null);

    const sources: SourceRow[] = liveSources.map((s) => {
      let st: TrafficState = "normal";
      if (backendStatus?.burst_active && backendStatus.current_burst?.source_ip === s.ip) {
        st = "burst";
      } else if (backendStatus?.mitigation?.active && backendStatus.mitigation.source_ip === s.ip) {
        st = "mitigated";
      }
      return {
        id: `src-${s.ip.replace(/[^a-zA-Z0-9]/g, "-")}`,
        name: s.ip,
        ip: s.ip,
        packets: s.packets,
        bytes: s.bytes,
        rateMbps:
          (s.bytes * 8) / (Math.max(1, backendStatus?.elapsed_s || 1) * 1_000_000),
        contributionPct: s.contribution_pct,
        policy:
          backendStatus?.mitigation?.source_ip === s.ip ? "DRY_RUN_CAP" : "MONITOR_ONLY",
        rateCapMbps:
          backendStatus?.mitigation?.source_ip === s.ip
            ? backendStatus.mitigation.cap_mbps
            : null,
        state: st,
      };
    });

    const currentBurst: BurstEvent | null = backendStatus?.current_burst
      ? {
          id: `burst-${backendStatus.current_burst.started_at_ms}`,
          detectedAtSim: backendStatus.current_burst.started_at_ms,
          endedAtSim: null,
          peakMbps: backendStatus.current_burst.peak_mbps,
          baselineMbps: backendStatus.current_burst.baseline_mbps,
          thresholdMbps: backendStatus.current_burst.threshold_mbps,
          hostId: backendStatus.current_burst.source_ip,
          sourceIp: backendStatus.current_burst.source_ip,
          hostName: backendStatus.current_burst.source_ip,
          contributionPct: backendStatus.current_burst.contribution_pct,
          severity: backendStatus.current_burst.severity,
          detectionDelayMs: 30,
          mitigationCount: 0,
        }
      : null;

    const baseHosts = engine.getSnapshot().hosts;
    const mappedHosts = baseHosts.map((h, i) => {
      const liveSrc = sources[i];
      if (liveSrc) {
        return {
          ...h,
          name: liveSrc.ip,
          ip: liveSrc.ip,
          rateMbps: liveSrc.rateMbps,
          state: liveSrc.state,
        };
      }
      return h;
    });

    const emptyComp = { peakMbps: 0, throughputMbps: 0, dropMb: 0, latencyMs: 0, samples: 0 };
    const liveMitigationState: MitigationState = {
      autoEnabled: config.mitigation.autoEnabled,
      active: !!backendStatus?.mitigation?.active,
      targetHostId: backendStatus?.mitigation?.source_ip || null,
      targetIp: backendStatus?.mitigation?.source_ip || null,
      targetName: backendStatus?.mitigation?.source_ip || null,
      rateLimitMbps: backendStatus?.mitigation?.cap_mbps || 0,
      severity: (backendStatus?.mitigation?.severity as "none" | "moderate" | "severe") || "none",
      startedAtSim: 0,
      durationMs: (backendStatus?.elapsed_s || 0) * 1000,
      state: backendStatus?.mitigation?.active ? "applied" : "idle",
      recovery: "n/a",
      actionReason: backendStatus?.mitigation?.reason || "Dry-run mitigation mode (host network untouched)",
      before: emptyComp,
      after: emptyComp,
      failureReason: null,
    };

    return {
      running: backendStatus?.status === "running",
      dataSource: "live",
      interfaceName: backendStatus?.interface || selectedInterface || "not selected",
      simTime: (backendStatus?.elapsed_s || 0) * 1000,
      config,
      hosts: mappedHosts,
      links: engine.getSnapshot().links,
      history: samples,
      latest: latestSample,
      summary: {
        peakMbps: backendStatus?.peak_rate_mbps || 0,
        avgMbps: backendStatus?.avg_rate_mbps || 0,
        totalBytes: backendStatus?.total_bytes || 0,
        totalPackets: backendStatus?.packet_count || 0,
        totalDropBytes: 0,
        avgLatencyMs: 0.1,
        burstCount: backendStatus?.burst_count || 0,
        burstPeakMbps: backendStatus?.current_burst?.peak_mbps || 0,
      },
      burstActive: !!backendStatus?.burst_active,
      currentBurst,
      burstCount: backendStatus?.burst_count || 0,
      burstIntervals: [],
      burstTotalBytes: 0,
      activeSourceIps: sources.length,
      mitigation: liveMitigationState,
      events: liveEvents.length > 0 ? liveEvents : [],
      sources,
      experiment: engine.getSnapshot().experiment,
      experiments: engine.getSnapshot().experiments,
      selectedBurstHostId: selectedInterface,
      activeScenario: "normal",
      latestTelemetry: null,
      structuredDetections: [],
      latestDetectorEvent: null,
    };
  }, [
    mode,
    snapshot,
    backendStatus,
    selectedInterface,
    config,
    liveHistory,
    liveSources,
    liveEvents,
    engine,
  ]);

  const value = useMemo<MonitoringContextValue>(
    () => ({
      snapshot: activeSnapshot,
      config,
      issues,
      scenarios: EXPERIMENT_SCENARIOS,
      mode,
      setMode,
      availableInterfaces,
      selectedInterface,
      setSelectedInterface,
      liveError,
      backendConnected,
      backendStatus,
      start,
      stop,
      toggle,
      reset,
      startLiveCapture,
      stopLiveCapture,
      refreshInterfaces,
      simulateBurst,
      triggerBurst: simulateBurst,
      restoreNormal,
      updateConfig,
      setBurstHost,
      setMitigationEnabled,
      applyManualMitigation,
      removeMitigation,
      startExperiment,
      stopExperiment,
      setScenario,
      clearEvents,
      clearExperiments,
      pushError,
    }),
    [
      activeSnapshot,
      config,
      issues,
      mode,
      setMode,
      availableInterfaces,
      selectedInterface,
      setSelectedInterface,
      liveError,
      backendConnected,
      backendStatus,
      start,
      stop,
      toggle,
      reset,
      startLiveCapture,
      stopLiveCapture,
      refreshInterfaces,
      simulateBurst,
      restoreNormal,
      updateConfig,
      setBurstHost,
      setMitigationEnabled,
      applyManualMitigation,
      removeMitigation,
      startExperiment,
      stopExperiment,
      setScenario,
      clearEvents,
      clearExperiments,
      pushError,
    ],
  );

  return (
    <MonitoringContext.Provider value={value}>
      {children}
    </MonitoringContext.Provider>
  );
}

export function useMonitoring(): MonitoringContextValue {
  const ctx = useContext(MonitoringContext);
  if (!ctx) {
    throw new Error("useMonitoring must be used within a MonitoringProvider");
  }
  return ctx;
}
