/**
 * Network topology and live node/link state for MicroburstHunter.
 *
 * The topology is a small, fixed virtual data-center fabric used both by the
 * deterministic traffic simulator and (via the separate Python backend) by live
 * capture. Every node and link value shown in the UI derives from this state,
 * so the diagram, charts and tables never disagree.
 */

export type HostRole = "source" | "switch" | "receiver" | "controller";

/** Traffic classification for a node or link. */
export type TrafficState = "idle" | "normal" | "burst" | "mitigated";

/** Static definition of a topology node. */
export interface TopologyNode {
  id: string;
  /** Short display name, e.g. "H3". */
  name: string;
  /** Descriptive role label, e.g. "Burst source". */
  label: string;
  ip: string;
  role: HostRole;
  /** Center coordinates inside the 900x520 SVG viewBox. */
  x: number;
  y: number;
  /** Whether the node can originate traffic (sources only). */
  transmits: boolean;
}

/** Static definition of a topology link. */
export interface TopologyLink {
  id: string;
  from: string;
  to: string;
  /** Nominal link capacity in Mbps (used for utilization + queue model). */
  capacityMbps: number;
  /** Monitoring/control link (drawn dashed, carries no user traffic). */
  control?: boolean;
}

/** Live node state merged onto its static definition. */
export interface HostState extends TopologyNode {
  rateMbps: number;
  packets: number;
  bytes: number;
  /** Share of the current burst (0-100). 0 when no burst is active. */
  contributionPct: number;
  state: TrafficState;
  /** Active rate cap in Mbps, or null when unrestricted. */
  rateCapMbps: number | null;
}

/** Live link state merged onto its static definition. */
export interface LinkState extends TopologyLink {
  rateMbps: number;
  /** 0-1 fraction of capacity in use. */
  utilization: number;
  state: TrafficState;
}

/** The selectable source used for the manual "Simulate Burst" control. */
export interface SourceOption {
  id: string;
  name: string;
  ip: string;
}
