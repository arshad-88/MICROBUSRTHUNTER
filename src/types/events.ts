/**
 * Event log record types for MicroburstHunter.
 *
 * The event log is the audit trail for the whole monitoring session: monitoring
 * lifecycle, burst detection, source ranking, mitigation policy changes,
 * recovery, experiments and errors. Records are persisted to localStorage and
 * exported to CSV verbatim.
 */

export type EventType =
  | "monitoring_started"
  | "monitoring_stopped"
  | "burst_detected"
  | "burst_ended"
  | "source_ranked"
  | "mitigation_activated"
  | "mitigation_adjusted"
  | "traffic_recovered"
  | "mitigation_removed"
  | "experiment_started"
  | "experiment_completed"
  | "mode_changed"
  | "policy_failed"
  | "error";

export type EventSeverity = "info" | "success" | "warning" | "critical";

export interface AppEvent {
  id: string;
  /** Wall-clock epoch ms. */
  timestamp: number;
  type: EventType;
  severity: EventSeverity;
  /** Relevant source IP, when the event concerns a flow. */
  sourceIp?: string;
  hostName?: string;
  /** Measured rate at the time of the event, when known. */
  rateMbps?: number;
  /** Short description of what triggered the event. */
  action: string;
  /** Result of the action / current outcome. */
  outcome: string;
  dataSource: "simulated" | "live";
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  monitoring_started: "Monitoring started",
  monitoring_stopped: "Monitoring stopped",
  burst_detected: "Burst detected",
  burst_ended: "Burst ended",
  source_ranked: "Source ranked",
  mitigation_activated: "Mitigation activated",
  mitigation_adjusted: "Mitigation adjusted",
  traffic_recovered: "Traffic recovered",
  mitigation_removed: "Mitigation removed",
  experiment_started: "Experiment started",
  experiment_completed: "Experiment completed",
  mode_changed: "Mode changed",
  policy_failed: "Policy failed",
  error: "Error",
};

export const EVENT_SEVERITY_ORDER: EventSeverity[] = [
  "info",
  "success",
  "warning",
  "critical",
];
