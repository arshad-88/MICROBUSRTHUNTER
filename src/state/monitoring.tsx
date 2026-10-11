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
} from "@/simulation";
import {
  DEFAULT_CONFIG,
  validateConfig,
  type AppConfig,
  type ValidationIssue,
} from "@/simulation/config";
import type { AppEvent, ExperimentResult, ExperimentScenarioId } from "@/types";

const EVENTS_KEY = "microbursthunter.events.v1";
const EXPERIMENTS_KEY = "microbursthunter.experiments.v1";
const CONFIG_KEY = "microbursthunter.config.v1";

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
  // The browser build has no capture path: never report a live data source.
  merged.simulation.dataSource = "simulated";
  // Never let a corrupted stored config disable detection.
  return validateConfig(merged).length === 0 ? merged : cloneConfig(DEFAULT_CONFIG);
}

export interface MonitoringContextValue {
  snapshot: MonitoringSnapshot;
  config: AppConfig;
  issues: ValidationIssue[];
  scenarios: ExperimentScenarioDef[];
  start: () => void;
  stop: () => void;
  toggle: () => void;
  reset: () => void;
  simulateBurst: (hostId?: string) => void;
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

  const start = useCallback(() => {
    if (engine.isRunning()) return;
    engine.start();
    startTick();
    sync();
  }, [engine, startTick, sync]);

  const stop = useCallback(() => {
    stopTick();
    engine.stop();
    sync();
  }, [engine, stopTick, sync]);

  const toggle = useCallback(() => {
    if (engine.isRunning()) stop();
    else start();
  }, [engine, start, stop]);

  const reset = useCallback(() => {
    stopTick();
    engine.stop();
    engine.reset();
    sync();
  }, [engine, stopTick, sync]);

  const simulateBurst = useCallback(
    (hostId?: string) => {
      if (!engine.isRunning()) {
        engine.start();
        startTick();
      }
      // The detector compares the observed rate against a rolling baseline.
      // Injecting a burst before that baseline holds undisturbed traffic means
      // the burst raises its own threshold and can never be declared, so the
      // onset is scheduled once the detector has real history to compare with
      // (a fifth of the baseline window). Detection rules are unchanged.
      const { baselineWindowMs, windowMs } = engine.config.detection;
      const requiredHistoryMs = Math.max(windowMs * 5, baselineWindowMs / 5);
      const deficitMs = Math.max(0, requiredHistoryMs - engine.getSnapshot().simTime);
      engine.simulateBurst(hostId, { startDelayMs: windowMs + deficitMs });
      sync();
    },
    [engine, startTick, sync],
  );

  const restoreNormal = useCallback(() => {
    engine.restoreNormal();
    sync();
  }, [engine, sync]);

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
      engine.startExperiment(scenario);
      setConfig(cloneConfig(engine.config));
      startTick();
      sync();
    },
    [engine, startTick, sync],
  );

  const stopExperiment = useCallback(() => {
    engine.stopExperiment();
    stopTick();
    sync();
  }, [engine, stopTick, sync]);

  const setScenario = useCallback(
    (options: import("@/simulation").ScenarioRunOptions) => {
      engine.setScenario(options);
      setConfig(cloneConfig(engine.config));
      sync();
    },
    [engine, sync],
  );

  const clearEvents = useCallback(() => {
    engine.clearEvents();
    persist(EVENTS_KEY, []);
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

  // Persist events / experiments only when the tail actually changes, so we
  // do not write to localStorage on every animation tick.
  const lastEventIdRef = useRef<string | null>(
    snapshot.events[snapshot.events.length - 1]?.id ?? null,
  );
  useEffect(() => {
    const id = snapshot.events[snapshot.events.length - 1]?.id ?? null;
    if (id === lastEventIdRef.current) return;
    lastEventIdRef.current = id;
    persist(EVENTS_KEY, snapshot.events.slice(-300));
  }, [snapshot.events]);

  const lastExperimentIdRef = useRef<string | null>(
    snapshot.experiments[0]?.id ?? null,
  );
  useEffect(() => {
    const id = snapshot.experiments[0]?.id ?? null;
    if (id === lastExperimentIdRef.current) return;
    lastExperimentIdRef.current = id;
    persist(EXPERIMENTS_KEY, snapshot.experiments.slice(0, 60));
  }, [snapshot.experiments]);

  // Restart the tick timer if the configured interval changes while running.
  useEffect(() => {
    if (engine.isRunning()) startTick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.simulation.tickIntervalMs]);

  useEffect(() => stopTick, [stopTick]);

  const value = useMemo<MonitoringContextValue>(
    () => ({
      snapshot,
      config,
      issues,
      scenarios: EXPERIMENT_SCENARIOS,
      start,
      stop,
      toggle,
      reset,
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
    }),
    [
      snapshot,
      config,
      issues,
      start,
      stop,
      toggle,
      reset,
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
