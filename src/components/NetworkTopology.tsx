import { cn } from "@/lib/utils";
import { formatMbpsValue, formatPercent } from "@/lib/format";
import type { HostState, LinkState, TrafficState } from "@/types";

/**
 * SIGNATURE CYBER FABRIC PLANE
 * ---------------------------------------------------------------------------
 * A glowing, high-tech holographic network topology display modeled on
 * datacenter edge switching:
 * - Central neon hexagonal aggregation switch S1 (10.0.0.1) with network hub core
 * - High-speed glowing fiber optic conduits with real-time animated data pulses
 * - Modular cyber server blades (H1-H4) with glowing throughput gauges
 * - Datacenter core termination sink (R1) with uplink absorption meters
 * - Real-time telemetry sentinel controller (M1)
 */

const VIEW_W = 1000;
const VIEW_H = 570;

const PORT_W = 206;
const PORT_H = 84;
const PORT_X = 142; // centre of source column
const PORT_TOP = 52;
const PORT_GAP = 110;

const SW = { x: 566, y: 254, r: 68 };
const RX = { x: 884, y: 254, w: 160, h: 96 };
const MON = { x: 566, y: 480, w: 184, h: 58 };

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 })
    .map((_, i) => {
      const a = ((-90 + 60 * i) * Math.PI) / 180;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(" ");
}

/** Cubic curve path from source port to switch ingress face */
function fanPath(fromX: number, fromY: number, toX: number, toY: number): string {
  return `M ${fromX} ${fromY} C ${fromX + 104} ${fromY}, ${toX - 74} ${toY}, ${toX} ${toY}`;
}

export interface NetworkTopologyProps {
  hosts: HostState[];
  links: LinkState[];
  running: boolean;
  selectedNodeId: string | null;
  selectedLinkId: string | null;
  onSelectNode: (id: string) => void;
  onSelectLink: (id: string) => void;
}

export function NetworkTopology({
  hosts,
  links,
  running,
  selectedNodeId,
  selectedLinkId,
  onSelectNode,
  onSelectLink,
}: NetworkTopologyProps) {
  const sources = hosts.filter((h) => h.role === "source");
  const agg = hosts.find((h) => h.role === "switch") ?? null;
  const dest = hosts.find((h) => h.role === "receiver") ?? null;
  const monitor = hosts.find((h) => h.role === "controller") ?? null;

  const sourceY = new Map(sources.map((h, i) => [h.id, PORT_TOP + i * PORT_GAP + PORT_H / 2]));
  const ingressY = sources.map((_, i) =>
    sources.length > 1
      ? SW.y - SW.r * 0.5 + (i * (SW.r * 1.0)) / (sources.length - 1)
      : SW.y,
  );
  const ingressX = SW.x - (SW.r * Math.sqrt(3)) / 2;

  const uplink = links.find((l) => l.id === "s1-r1") ?? null;
  const control = links.find((l) => l.control) ?? null;
  const uplinkStroke = uplink ? 3 + Math.min(7, uplink.utilization * 7) : 3;
  const uplinkState: TrafficState = uplink?.state ?? "idle";
  const uplinkActive = Boolean(uplink && uplink.rateMbps > 0.5 && running);

  const hasSelection = Boolean(selectedNodeId || selectedLinkId);
  const linkEmphasis = (link: LinkState) => {
    if (!hasSelection) return 1;
    if (selectedLinkId === link.id) return 1;
    if (selectedNodeId && (link.from === selectedNodeId || link.to === selectedNodeId)) return 1;
    return 0.25;
  };

  const burstActive = hosts.some((h) => h.state === "burst");
  const burstNode = hosts.find((h) => h.state === "burst") ?? null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#07070a] shadow-[0_10px_30px_rgba(0,0,0,0.7)]">
      {/* Background Datacenter Room Translucent Overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-10 mix-blend-screen"
        style={{ backgroundImage: "url('/server-room-bg.jpg')" }}
      />
      <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-t from-[#07070a] via-[#090b14]/90 to-[#07070a]" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-violet-950/20 via-transparent to-transparent" />

      {/* SVG Fabric Plane */}
      <div className="relative z-10 w-full">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full select-none"
          role="group"
          aria-label="Interactive cyber data-centre fabric: sources, aggregation switch, destination and monitor"
        >
          <defs>
            {/* Holographic Cyber Grid */}
            <pattern id="cyber-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(141, 84, 255, 0.05)" strokeWidth="0.8" />
              <circle cx="0" cy="0" r="1" fill="rgba(141, 84, 255, 0.2)" />
            </pattern>

            {/* Neon Glow Filters */}
            <filter id="glow-cyan" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <filter id="glow-burst" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="5.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <filter id="glow-amber" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Switch Energy Radial Glow */}
            <radialGradient id="switch-energy-radial" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#8d54ff" stopOpacity="0.35" />
              <stop offset="65%" stopColor="#4f39f6" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#2f0d68" stopOpacity="0" />
            </radialGradient>

            <radialGradient id="switch-burst-radial" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ff2357" stopOpacity="0.5" />
              <stop offset="70%" stopColor="#fb2c36" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#be123c" stopOpacity="0" />
            </radialGradient>

            {/* Chassis Gradients */}
            <linearGradient id="blade-chassis" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0d0e17" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#06070b" stopOpacity="0.98" />
            </linearGradient>

            <linearGradient id="meter-cyan" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#625fff" />
              <stop offset="100%" stopColor="#a685ff" />
            </linearGradient>

            <linearGradient id="meter-burst" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#e11d48" />
              <stop offset="100%" stopColor="#ff2357" />
            </linearGradient>

            <linearGradient id="meter-amber" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#d97706" />
              <stop offset="100%" stopColor="#fcbb00" />
            </linearGradient>

            <linearGradient id="uplink-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#8d54ff" stopOpacity="0.85" />
              <stop offset="50%" stopColor="#a685ff" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#c4b4ff" stopOpacity="0.85" />
            </linearGradient>
          </defs>

          {/* Background Tech Grid Layer */}
          <rect width={VIEW_W} height={VIEW_H} fill="url(#cyber-grid)" />

          {/* Section Section Header Labels (Holographic Cyber Header) */}
          <g opacity={0.65}>
            <text x={PORT_X - PORT_W / 2} y={28} className="fill-cyan-400 font-mono text-[10px] tracking-widest uppercase">
              // SOURCE HOST BLADES
            </text>
            <text x={SW.x} y={SW.y - SW.r - 28} textAnchor="middle" className="fill-cyan-400 font-mono text-[10px] tracking-widest uppercase">
              // AGGREGATION FABRIC
            </text>
            <text x={RX.x} y={RX.y - RX.h / 2 - 20} textAnchor="middle" className="fill-cyan-400 font-mono text-[10px] tracking-widest uppercase">
              // CORE SINK TERMINAL
            </text>
          </g>

          {/* ----------------------------------------------------------------
              1. FIBER CONDUITS & GLOWING DATA FLOWS
          ----------------------------------------------------------------- */}
          {/* ----------------------------------------------------------------
              1. FIBER CONDUITS & DYNAMIC REAL PACKET STREAM
              Packets sent in direct ratio of throughput (higher rate/burst = more packets)
          ----------------------------------------------------------------- */}
          {sources.map((host, i) => {
            const link = links.find((l) => l.from === host.id);
            if (!link) return null;
            const y1 = sourceY.get(host.id)!;
            const y2 = ingressY[i];
            const d = fanPath(PORT_X + PORT_W / 2, y1, ingressX, y2);
            const isBurst = host.state === "burst";
            const isMitigated = host.state === "mitigated";
            const rate = host.rateMbps;
            const flowing = running && rate > 0.2;
            const selected = selectedLinkId === link.id;

            // Colors & Filters based on traffic state
            const packetColor = isBurst ? "#ff2357" : isMitigated ? "#fcbb00" : "#00e5ff";
            const filterUrl = isBurst ? "url(#glow-burst)" : isMitigated ? "url(#glow-amber)" : "url(#glow-cyan)";

            // Dynamic packet count and velocity in direct proportion to captured / simulated data rate:
            let packetCount = 0;
            let animDur = 1.6;
            if (flowing) {
              if (isBurst) {
                // Microburst overload: high-frequency dense torrent of packets
                packetCount = Math.min(22, Math.max(14, Math.round(rate / 3.8)));
                animDur = 0.72; // Ultra-fast surge
              } else if (isMitigated) {
                // Throttled under TC rate-limit: sparse paced packet stream
                packetCount = Math.max(3, Math.min(6, Math.round(rate / 8)));
                animDur = 2.1; // Paced velocity
              } else {
                // Nominal traffic: proportional scaling from 3 to 14 packets based on rate
                packetCount = Math.max(3, Math.min(14, Math.round(rate / 5)));
                animDur = Math.max(1.0, 2.0 - (rate / 90));
              }
            }

            return (
              <g key={`flow-${host.id}`} opacity={linkEmphasis(link)}>
                {/* Subtle Fiber Waveguide Track (replacing heavy static solid line) */}
                <path
                  d={d}
                  fill="none"
                  stroke={selected ? "#00e5ff" : "#131a2e"}
                  strokeWidth={selected ? 2 : 1}
                  strokeDasharray={selected ? undefined : "3 4"}
                  opacity={selected ? 0.9 : 0.45}
                  className="transition-colors"
                />

                {/* Faint ambient energy aura when active or selected */}
                {(flowing || selected) && (
                  <path
                    d={d}
                    fill="none"
                    stroke={packetColor}
                    strokeWidth={selected ? 2 : 1}
                    opacity={isBurst ? 0.35 : selected ? 0.4 : 0.15}
                    filter={filterUrl}
                  />
                )}

                {/* Real Dynamic Data Packets Stream — Sent in ratio of captured data */}
                {flowing &&
                  Array.from({ length: packetCount }, (_, pIdx) => {
                    const delay = (pIdx * animDur) / packetCount;
                    return (
                      <g key={`pkt-${host.id}-${packetCount}-${pIdx}`}>
                        <animateMotion
                          dur={`${animDur.toFixed(2)}s`}
                          begin={`${delay.toFixed(2)}s`}
                          repeatCount="indefinite"
                          rotate="auto"
                          path={d}
                        />
                        {/* Streamlined Packet Capsule */}
                        <rect
                          x={isBurst ? -7 : -5}
                          y={isBurst ? -3 : -2.2}
                          width={isBurst ? 14 : 10}
                          height={isBurst ? 6 : 4.4}
                          rx={2.2}
                          fill={packetColor}
                          filter={filterUrl}
                        />
                        {/* High-Intensity Packet Payload Core */}
                        <rect
                          x={isBurst ? -3.5 : -2}
                          y={isBurst ? -1.5 : -1}
                          width={isBurst ? 7 : 4}
                          height={isBurst ? 3 : 2}
                          rx={1}
                          fill="#ffffff"
                          opacity={0.95}
                        />
                        {/* Trailing Tail Particle */}
                        <circle cx={-7} cy={0} r={1.2} fill={packetColor} opacity={0.6} />
                      </g>
                    );
                  })}

                {/* Clickable Hit Target */}
                <path
                  d={d}
                  fill="none"
                  strokeWidth={20}
                  className="cursor-pointer stroke-transparent"
                  role="button"
                  tabIndex={0}
                  aria-label={`Link ${host.name} to aggregation switch`}
                  onClick={() => onSelectLink(link.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectLink(link.id);
                    }
                  }}
                />

                {/* Tooltip on Selection */}
                {selected && (
                  <g transform={`translate(${(PORT_X + PORT_W / 2 + ingressX) / 2 - 50}, ${(y1 + y2) / 2 - 28})`}>
                    <rect
                      width={140}
                      height={42}
                      rx={6}
                      fill="#060e20"
                      stroke="#00e5ff"
                      strokeWidth={1.2}
                      filter="url(#glow-cyan)"
                    />
                    <text x={10} y={16} fill="#94a3b8" className="font-mono text-[9px]">
                      {host.name} → S1 (Flow)
                    </text>
                    <text x={10} y={32} fill="#38bdf8" className="font-mono text-[11px] font-bold">
                      {formatMbpsValue(host.rateMbps)} Mbps · {formatPercent(Math.min(150, (host.rateMbps / Math.max(1, link.capacityMbps)) * 100), 0)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* ----------------------------------------------------------------
              2. UPLINK TRUNK (S1 → R1 DESTINATION)
              Dynamic Multi-Packet Highway proportional to total aggregated rate
          ----------------------------------------------------------------- */}
          {uplink && (() => {
            const trunkD = `M ${SW.x + (SW.r * Math.sqrt(3)) / 2} ${SW.y} L ${RX.x - RX.w / 2} ${RX.y}`;
            const uplinkRate = uplink.rateMbps;
            const trunkFlowing = running && uplinkRate > 0.5;
            const isTrunkBurst = burstActive || uplinkRate > 120;

            // Proportional packet density for trunk backbone:
            let trunkPacketCount = 0;
            let trunkDur = 1.3;
            if (trunkFlowing) {
              if (isTrunkBurst) {
                trunkPacketCount = 24;
                trunkDur = 0.65;
              } else {
                trunkPacketCount = Math.max(6, Math.min(18, Math.round(uplinkRate / 8)));
                trunkDur = Math.max(0.85, 1.8 - (uplinkRate / 180));
              }
            }

            return (
              <g opacity={linkEmphasis(uplink)}>
                {/* Subtle Trunk Conduit Conduit Track */}
                <path
                  d={trunkD}
                  fill="none"
                  stroke="#121a30"
                  strokeWidth={6}
                  strokeDasharray="4 6"
                  opacity={0.4}
                />
                {/* Active illuminated trunk core track */}
                <path
                  d={trunkD}
                  fill="none"
                  stroke={isTrunkBurst ? "#ff2357" : "url(#uplink-flow)"}
                  strokeWidth={uplinkStroke}
                  strokeLinecap="round"
                  filter={isTrunkBurst ? "url(#glow-burst)" : "url(#glow-cyan)"}
                  opacity={trunkFlowing ? (isTrunkBurst ? 0.65 : 0.4) : 0.15}
                />

                {/* Animated Dynamic Trunk Packets Stream */}
                {trunkFlowing &&
                  Array.from({ length: trunkPacketCount }, (_, pIdx) => {
                    const delay = (pIdx * trunkDur) / trunkPacketCount;
                    const pColor = isTrunkBurst ? "#ff2357" : "#00e5ff";
                    const pFilter = isTrunkBurst ? "url(#glow-burst)" : "url(#glow-cyan)";
                    return (
                      <g key={`trunk-pkt-${trunkPacketCount}-${pIdx}`}>
                        <animateMotion
                          dur={`${trunkDur.toFixed(2)}s`}
                          begin={`${delay.toFixed(2)}s`}
                          repeatCount="indefinite"
                          rotate="auto"
                          path={trunkD}
                        />
                        <rect
                          x={-6}
                          y={-3}
                          width={12}
                          height={6}
                          rx={2.5}
                          fill={pColor}
                          filter={pFilter}
                        />
                        <rect
                          x={-3}
                          y={-1.5}
                          width={6}
                          height={3}
                          rx={1.2}
                          fill="#ffffff"
                          opacity={0.95}
                        />
                      </g>
                    );
                  })}

                {/* Click target */}
                <path
                  d={trunkD}
                  fill="none"
                  strokeWidth={22}
                  className="cursor-pointer stroke-transparent"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectLink(uplink.id)}
                />

                {/* Trunk Capacity Readout Pill */}
                <g transform={`translate(${(SW.x + RX.x) / 2 - 58}, ${SW.y - 20})`}>
                  <rect
                    width={116}
                    height={22}
                    rx={4}
                    fill="#060e20"
                    stroke={isTrunkBurst ? "#ff2357" : "#1e293b"}
                    strokeWidth={1}
                    filter={isTrunkBurst ? "url(#glow-burst)" : undefined}
                  />
                  <text
                    x={58}
                    y={15}
                    textAnchor="middle"
                    fill={isTrunkBurst ? "#ff2357" : "#38bdf8"}
                    className="font-mono text-[10px] font-medium"
                  >
                    {formatMbpsValue(uplink.rateMbps)} Mbps ({formatPercent(uplink.utilization * 100, 0)})
                  </text>
                </g>
              </g>
            );
          })()}

          {/* ----------------------------------------------------------------
              3. TELEMETRY CONTROL LINK (S1 ↔ M1 MONITOR)
          ----------------------------------------------------------------- */}
          {control && monitor && (
            <g>
              <path
                d={`M ${SW.x} ${SW.y + SW.r} L ${MON.x} ${MON.y - MON.h / 2}`}
                fill="none"
                stroke="#0284c7"
                strokeWidth={1.5}
                strokeDasharray="4 6"
                opacity={running ? 0.75 : 0.25}
              />
              {running && (
                <circle r={3} fill="#00e5ff" filter="url(#glow-cyan)">
                  <animateMotion
                    dur="2.2s"
                    repeatCount="indefinite"
                    path={`M ${SW.x} ${SW.y + SW.r} L ${MON.x} ${MON.y - MON.h / 2}`}
                  />
                </circle>
              )}
            </g>
          )}

          {/* ----------------------------------------------------------------
              4. SOURCE HOST NODES (H1 - H4 CYBER SERVER BLADES)
          ----------------------------------------------------------------- */}
          {sources.map((host) => {
            const y = sourceY.get(host.id)!;
            const selected = selectedNodeId === host.id;
            const x = PORT_X - PORT_W / 2;
            const top = y - PORT_H / 2;
            const isBurst = host.state === "burst";
            const isMitigated = host.state === "mitigated";
            const isNormal = host.state === "normal";

            // Visual Styling Parameters
            const borderColor = isBurst
              ? "#f43f5e"
              : isMitigated
                ? "#f59e0b"
                : selected
                  ? "#00e5ff"
                  : "#1e293b";
            const accentColor = isBurst ? "#f43f5e" : isMitigated ? "#f59e0b" : isNormal ? "#00e5ff" : "#475569";
            const rateBarWidth = Math.max(0, Math.min(100, (host.rateMbps / 100) * 100));

            return (
              <g
                key={host.id}
                transform={`translate(${x}, ${top})`}
                className="cursor-pointer transition-all duration-200 group hover:brightness-110"
                role="button"
                tabIndex={0}
                onClick={() => onSelectNode(host.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectNode(host.id);
                  }
                }}
              >
                {/* Active Burst Ambient Glow Halo */}
                {isBurst && (
                  <rect
                    x={-4}
                    y={-4}
                    width={PORT_W + 8}
                    height={PORT_H + 8}
                    rx={10}
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth={2}
                    filter="url(#glow-burst)"
                    opacity={0.85}
                  />
                )}

                {/* Card Chassis Plate */}
                <rect
                  width={PORT_W}
                  height={PORT_H}
                  rx={8}
                  fill="url(#blade-chassis)"
                  stroke={borderColor}
                  strokeWidth={selected || isBurst ? 2 : 1}
                  filter={selected ? "url(#glow-cyan)" : undefined}
                  className="transition-all duration-200 group-hover:stroke-cyan-400/80"
                />

                {/* Left Colored Status Accent Bar */}
                <rect
                  x={0}
                  y={0}
                  width={4}
                  height={PORT_H}
                  rx={2}
                  fill={accentColor}
                  filter={isBurst ? "url(#glow-burst)" : undefined}
                />

                {/* Server Icon Glyph (Mini Rack Slots) */}
                <g transform="translate(14, 14)">
                  <rect width={16} height={14} rx={2} fill="#0d1b38" stroke={accentColor} strokeWidth={1} />
                  <line x1={3} y1={5} x2={9} y2={5} stroke="#38bdf8" strokeWidth={1} />
                  <line x1={3} y1={9} x2={9} y2={9} stroke="#38bdf8" strokeWidth={1} />
                  <circle cx={13} cy={5} r={1} fill={accentColor} />
                  <circle cx={13} cy={9} r={1} fill={accentColor} />
                </g>

                {/* Host Name & IP */}
                <text x={36} y={22} fill="#ffffff" className="font-sans text-[13px] font-bold tracking-tight">
                  {host.name}
                </text>
                <text x={36} y={34} fill="#64748b" className="font-mono text-[9.5px]">
                  {host.ip}
                </text>

                {/* Status Badge (Top Right) */}
                <g transform={`translate(${PORT_W - 12}, 16)`}>
                  <rect
                    x={-62}
                    y={-4}
                    width={62}
                    height={16}
                    rx={4}
                    fill={isBurst ? "rgba(244,63,94,0.18)" : isMitigated ? "rgba(245,158,11,0.18)" : "rgba(14,165,233,0.12)"}
                    stroke={accentColor}
                    strokeWidth={0.8}
                  />
                  <text
                    x={-31}
                    y={8}
                    textAnchor="middle"
                    fill={accentColor}
                    className="font-mono text-[8px] font-bold uppercase tracking-wider"
                  >
                    {isBurst ? "BURST" : isMitigated ? "CAPPED" : isNormal ? "ACTIVE" : "STANDBY"}
                  </text>
                </g>

                {/* Dynamic Throughput Meter Track */}
                <g transform="translate(14, 46)">
                  {/* Gauge background */}
                  <rect width={PORT_W - 28} height={5} rx={2.5} fill="#0d1b38" />
                  {/* Gauge Fill Bar */}
                  <rect
                    width={Math.max(2, ((PORT_W - 28) * rateBarWidth) / 100)}
                    height={5}
                    rx={2.5}
                    fill={isBurst ? "url(#meter-burst)" : isMitigated ? "url(#meter-amber)" : "url(#meter-cyan)"}
                    filter={isBurst ? "url(#glow-burst)" : undefined}
                  />
                </g>

                {/* Live Speed Readout & Contribution Share */}
                <text
                  x={14}
                  y={68}
                  fill={isBurst ? "#f43f5e" : "#00e5ff"}
                  className="font-mono text-[13px] font-bold tracking-tight"
                >
                  {running ? `${formatMbpsValue(host.rateMbps)} Mbps` : "0.0 Mbps"}
                </text>

                <text
                  x={PORT_W - 14}
                  y={68}
                  textAnchor="end"
                  fill="#94a3b8"
                  className="font-mono text-[9px]"
                >
                  {host.rateCapMbps !== null
                    ? `Cap: ${host.rateCapMbps.toFixed(0)}M`
                    : host.contributionPct > 0
                      ? `${formatPercent(host.contributionPct, 0)} share`
                      : "100M link"}
                </text>

                {/* Right Egress Port Connector */}
                <circle
                  cx={PORT_W}
                  cy={PORT_H / 2}
                  r={3}
                  fill="#060e20"
                  stroke={accentColor}
                  strokeWidth={1.5}
                  filter={isBurst ? "url(#glow-burst)" : undefined}
                />
              </g>
            );
          })}

          {/* ----------------------------------------------------------------
              5. CENTRAL AGGREGATION SWITCH S1 (MATCHING ATTACHED IMAGE)
          ----------------------------------------------------------------- */}
          {agg && (
            <g
              transform={`translate(${SW.x}, ${SW.y})`}
              className="cursor-pointer transition-all duration-200 hover:brightness-125 group"
              role="button"
              tabIndex={0}
              aria-label={`${agg.name}, ${agg.label}, ${agg.ip}`}
              onClick={() => onSelectNode(agg.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectNode(agg.id);
                }
              }}
            >
              {/* Radial Energy Halo Aura */}
              <circle
                r={SW.r * 1.75}
                fill={burstActive ? "url(#switch-burst-radial)" : "url(#switch-energy-radial)"}
              />

              {/* Rotating Outer Tech Hexagon Ring */}
              <polygon
                points={hexPoints(0, 0, SW.r + 10)}
                fill="none"
                stroke={burstActive ? "#f43f5e" : "#00e5ff"}
                strokeWidth={1.2}
                strokeDasharray="14 6"
                opacity={0.7}
              >
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0"
                  to="360"
                  dur="24s"
                  repeatCount="indefinite"
                />
              </polygon>

              {/* Main Glowing Hexagonal Switch Body */}
              <polygon
                points={hexPoints(0, 0, SW.r)}
                fill="#07122b"
                stroke={burstActive ? "#f43f5e" : "#00e5ff"}
                strokeWidth={selectedNodeId === agg.id ? 3 : 2.2}
                filter={burstActive ? "url(#glow-burst)" : "url(#glow-cyan)"}
              />

              {/* Inner Concentric Hexagon */}
              <polygon
                points={hexPoints(0, 0, SW.r - 12)}
                fill="#050d22"
                stroke={burstActive ? "#f43f5e" : "#0284c7"}
                strokeWidth={1}
                opacity={0.8}
              />

              {/* Center Network Hub Icon (Interconnected Nodes in Triangle - Matching User Image) */}
              <g transform="translate(0, -14)">
                {/* Connector Lines */}
                <line x1={0} y1={-14} x2={-12} y2={4} stroke="#38bdf8" strokeWidth={1.8} />
                <line x1={0} y1={-14} x2={12} y2={4} stroke="#38bdf8" strokeWidth={1.8} />
                <line x1={-12} y1={4} x2={12} y2={4} stroke="#38bdf8" strokeWidth={1.8} />

                {/* Center Core Dot */}
                <circle cx={0} cy={-2} r={2} fill="#ffffff" />

                {/* Apex Node */}
                <circle cx={0} cy={-14} r={4.5} fill="#00e5ff" stroke="#ffffff" strokeWidth={1.5} filter="url(#glow-cyan)" />
                {/* Bottom Left Node */}
                <circle cx={-12} cy={4} r={4.5} fill="#00e5ff" stroke="#ffffff" strokeWidth={1.5} filter="url(#glow-cyan)" />
                {/* Bottom Right Node */}
                <circle cx={12} cy={4} r={4.5} fill="#00e5ff" stroke="#ffffff" strokeWidth={1.5} filter="url(#glow-cyan)" />
              </g>

              {/* Bold Futuristic Labels: "S1" and "10.0.0.1" */}
              <text
                y={18}
                textAnchor="middle"
                fill="#ffffff"
                className="font-sans text-[16px] font-black tracking-wider"
              >
                {agg.name}
              </text>
              <text
                y={32}
                textAnchor="middle"
                fill="#38bdf8"
                className="font-mono text-[11px] font-semibold tracking-tight"
              >
                {agg.ip}
              </text>

              {/* Ingress Port Connection Pins (Glowing Dots) */}
              {sources.map((s, i) => (
                <circle
                  key={s.id}
                  cx={-SW.r + 6}
                  cy={ingressY[i] - SW.y}
                  r={2.5}
                  fill={s.state === "burst" ? "#f43f5e" : "#00e5ff"}
                  filter={s.state === "burst" ? "url(#glow-burst)" : undefined}
                />
              ))}
            </g>
          )}

          {/* ----------------------------------------------------------------
              6. DESTINATION SINK TERMINAL (R1 CORE)
          ----------------------------------------------------------------- */}
          {dest && (
            <g
              transform={`translate(${RX.x - RX.w / 2}, ${RX.y - RX.h / 2})`}
              className="cursor-pointer transition-all duration-200 hover:brightness-110 group"
              role="button"
              tabIndex={0}
              aria-label={`${dest.name}, ${dest.label}, ${dest.ip}`}
              onClick={() => onSelectNode(dest.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectNode(dest.id);
                }
              }}
            >
              {/* Outer Shell */}
              <rect
                width={RX.w}
                height={RX.h}
                rx={8}
                fill="url(#blade-chassis)"
                stroke={selectedNodeId === dest.id ? "#00e5ff" : "#1e293b"}
                strokeWidth={selectedNodeId === dest.id ? 2 : 1.2}
                filter={selectedNodeId === dest.id ? "url(#glow-cyan)" : undefined}
                className="transition-all duration-200 group-hover:stroke-cyan-400/80"
              />

              {/* Header Bar */}
              <rect x={0} y={0} width={RX.w} height={26} rx={8} fill="#0d1b38" />

              {/* Core Cylinder Stack Icon */}
              <g transform="translate(12, 7)">
                <ellipse cx={8} cy={3} rx={6} ry={2.2} fill="none" stroke="#38bdf8" strokeWidth={1} />
                <path d="M 2 3 L 2 9 A 6 2.2 0 0 0 14 9 L 14 3" fill="none" stroke="#38bdf8" strokeWidth={1} />
              </g>

              <text x={32} y={17} fill="#ffffff" className="font-sans text-[12px] font-bold">
                {dest.name} Core Sink
              </text>
              <text x={12} y={44} fill="#64748b" className="font-mono text-[10px]">
                {dest.ip}
              </text>

              {/* Absorption Bandwidth Bar */}
              <g transform="translate(12, 54)">
                <rect width={RX.w - 24} height={5} rx={2.5} fill="#0d1b38" />
                {uplink && (
                  <rect
                    width={Math.max(2, Math.min(RX.w - 24, (RX.w - 24) * uplink.utilization))}
                    height={5}
                    rx={2.5}
                    fill="url(#meter-cyan)"
                  />
                )}
              </g>

              {/* Ingress Throughput Readout */}
              <text x={12} y={78} fill="#00e5ff" className="font-mono text-[13px] font-bold">
                {running && uplink ? `${formatMbpsValue(uplink.rateMbps)} Mbps` : "0.0 Mbps"}
              </text>
              <text x={RX.w - 12} y={78} textAnchor="end" fill="#64748b" className="font-mono text-[9px]">
                1,000M Uplink
              </text>
            </g>
          )}

          {/* ----------------------------------------------------------------
              7. TELEMETRY CONTROLLER (M1 SENTINEL WATCHDOG)
          ----------------------------------------------------------------- */}
          {monitor && (
            <g
              transform={`translate(${MON.x - MON.w / 2}, ${MON.y - MON.h / 2})`}
              className="cursor-pointer transition-all duration-200 hover:brightness-110 group"
              role="button"
              tabIndex={0}
              aria-label={`${monitor.name}, ${monitor.label}`}
              onClick={() => onSelectNode(monitor.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectNode(monitor.id);
                }
              }}
            >
              <rect
                width={MON.w}
                height={MON.h}
                rx={8}
                fill="url(#blade-chassis)"
                stroke={selectedNodeId === monitor.id ? "#00e5ff" : "#1e293b"}
                strokeWidth={selectedNodeId === monitor.id ? 2 : 1}
              />

              {/* Sentinel Shield Icon */}
              <g transform="translate(14, 18)">
                <path d="M 0 0 L 10 0 L 10 7 C 10 11, 5 14, 0 16 C -5 14, -10 11, -10 7 L -10 0 Z" fill="#0284c7" fillOpacity={0.25} stroke="#00e5ff" strokeWidth={1.2} />
              </g>

              <text x={38} y={26} fill="#ffffff" className="font-sans text-[12px] font-bold">
                {monitor.name} Sentinel Policy
              </text>
              <text x={38} y={42} fill={running ? "#10b981" : "#64748b"} className="font-mono text-[9.5px]">
                {running ? "● SAMPLING (10ms sliding)" : "○ STANDBY"}
              </text>
            </g>
          )}

          {/* Active Burst Hotspot Alert Marker */}
          {burstNode && sourceY.has(burstNode.id) && (
            <g transform={`translate(${PORT_X + PORT_W / 2 + 14}, ${sourceY.get(burstNode.id)!})`}>
              <circle r={6} fill="#f43f5e" filter="url(#glow-burst)" />
              <circle r={12} fill="none" stroke="#f43f5e" strokeWidth={1.5} opacity={0.6}>
                <animate attributeName="r" from="6" to="18" dur="1s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.9" to="0" dur="1s" repeatCount="indefinite" />
              </circle>
            </g>
          )}
        </svg>
      </div>

      {/* Cyberpunk Footer Legend */}
      <Legend />
    </div>
  );
}

function Legend() {
  const items = [
    { label: "Nominal Flow", dot: "bg-cyan-400 shadow-[0_0_8px_rgba(0,229,255,0.7)]" },
    { label: "Burst Overload", dot: "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.9)] animate-pulse" },
    { label: "Rate Limited", dot: "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]" },
    { label: "Standby", dot: "bg-slate-600" },
  ];

  return (
    <div className="relative z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-white/10 bg-[#040816]/95 px-5 py-2.5 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
        {items.map((item) => (
          <span key={item.label} className="flex items-center gap-2 font-mono text-xs text-slate-300">
            <span className={cn("size-2 rounded-full", item.dot)} />
            <span className="font-medium text-slate-200">{item.label}</span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 font-mono text-[11px] text-cyan-400/90">
        <span className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#00e5ff] animate-ping" />
        <span>Live Packet Transmission Pipeline</span>
      </div>
    </div>
  );
}
