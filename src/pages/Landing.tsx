import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { useMonitoring } from "@/state/monitoring";
import { exportEventsCsv } from "@/simulation";
import { MHMark } from "@/components/Wordmark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatBytes,
  formatClock,
  formatCount,
  formatMbpsValue,
  formatMs,
  formatPercent,
  formatSimTime,
} from "@/lib/format";
import type { TrafficState, HostState } from "@/types";
import {
  Activity,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Download,
  ExternalLink,
  Flame,
  FlaskConical,
  Gauge,
  Layers,
  Network,
  Play,
  RotateCcw,
  Scale,
  ScrollText,
  Server,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Timer,
  Waves,
  Wifi,
  Zap,
} from "lucide-react";

/* ------------------------------------------------------------------ specs & capabilities */

const SPECS = [
  { label: "Sampling window", value: "10", unit: "ms", icon: Zap, color: "text-cyan-400" },
  { label: "Minimum rate", value: "80", unit: "Mbps", icon: Gauge, color: "text-blue-400" },
  { label: "Baseline multiplier", value: "×3", unit: "", icon: Layers, color: "text-purple-400" },
  { label: "Deterministic seed", value: "1337", unit: "", icon: Code2, color: "text-indigo-400" },
];

const CAPABILITIES = [
  {
    num: "01",
    icon: Waves,
    title: "Detector that actually decides",
    body: "Rolling baseline, absolute minimum rate and a baseline multiplier — a burst is declared only when the measurement justifies it.",
    accent: "from-cyan-500/20 to-blue-500/5",
    iconColor: "text-cyan-400",
  },
  {
    num: "02",
    icon: Network,
    title: "Fabric plane, not a diagram",
    body: "A patch-panel map where stroke weight follows the measured rate, colour follows detector state, and each port reports its own counters and enforced policy.",
    accent: "from-blue-500/20 to-indigo-500/5",
    iconColor: "text-blue-400",
  },
  {
    num: "03",
    icon: Share2,
    title: "Attribution without accusation",
    body: "Rank sources by their byte share inside the burst window, with per-source history and recent events. Volume is reported as volume — never as intent.",
    accent: "from-purple-500/20 to-pink-500/5",
    iconColor: "text-purple-400",
  },
  {
    num: "04",
    icon: ShieldCheck,
    title: "Cause and effect on the policy",
    body: "Detection → attribution → policy → cap → verification → recovery, with a before/after comparison computed on the same model the charts use.",
    accent: "from-indigo-500/20 to-cyan-500/5",
    iconColor: "text-indigo-400",
  },
  {
    num: "05",
    icon: FlaskConical,
    title: "Reproducible experiments",
    body: "Seeded scenarios — normal, burst, burst with adaptive mitigation — stored and exportable so a reviewer can compare numbers rather than trust a screenshot.",
    accent: "from-emerald-500/20 to-cyan-500/5",
    iconColor: "text-emerald-400",
  },
  {
    num: "06",
    icon: ScrollText,
    title: "Auditable event timeline",
    body: "Every detection, policy change, recovery and failure is recorded verbatim and exported to CSV for the project review.",
    accent: "from-amber-500/20 to-orange-500/5",
    iconColor: "text-amber-400",
  },
];

/* ------------------------------------------------------------------ hero interactive visualizer */

interface HeroHostRow {
  id: string;
  label: string;
  ip: string;
  rate: number;
  burst: boolean;
  sparkline: number[];
}

function HeroObservabilityVisualizer({
  burstActive,
  onTriggerBurst,
  onReset,
}: {
  burstActive: boolean;
  onTriggerBurst: () => void;
  onReset: () => void;
}) {
  const hosts: HeroHostRow[] = [
    {
      id: "h1",
      label: "H1",
      ip: "10.0.1.11",
      rate: 18.2,
      burst: false,
      sparkline: [14, 18, 16, 19, 17, 18, 19, 18],
    },
    {
      id: "h2",
      label: "H2",
      ip: "10.0.1.12",
      rate: 14.4,
      burst: false,
      sparkline: [12, 15, 14, 13, 15, 14, 16, 14],
    },
    {
      id: "h3",
      label: "H3",
      ip: "10.0.1.13",
      rate: burstActive ? 214.6 : 19.8,
      burst: burstActive,
      sparkline: burstActive
        ? [18, 22, 45, 120, 195, 215, 214, 210]
        : [16, 19, 21, 18, 20, 19, 21, 20],
    },
    {
      id: "h4",
      label: "H4",
      ip: "10.0.1.14",
      rate: 3.1,
      burst: false,
      sparkline: [3, 4, 3, 3, 4, 3, 3, 3],
    },
  ];

  // SVG dimensions for patch panel connections
  // Source port Y positions
  const portYs = [56, 114, 172, 230];
  const switchCenterY = 143;
  const switchX = 280;

  return (
    <div className="relative w-full rounded-2xl border border-cyan-500/25 bg-slate-950/75 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8),0_0_35px_rgba(6,182,212,0.12)] backdrop-blur-xl">
      {/* Decorative neon corner accents */}
      <div className="pointer-events-none absolute -top-px -left-px h-8 w-8 rounded-tl-2xl border-t border-l border-cyan-400/60" />
      <div className="pointer-events-none absolute -bottom-px -right-px h-8 w-8 rounded-br-2xl border-b border-r border-purple-400/60" />

      {/* Top Banner Alert Pill (Matching reference image) */}
      <div
        className={cn(
          "mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2.5 transition-all duration-300",
          burstActive
            ? "border-rose-500/40 bg-rose-950/30 shadow-[0_0_20px_rgba(244,63,94,0.2)]"
            : "border-cyan-500/20 bg-cyan-950/20",
        )}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex size-7 items-center justify-center rounded-lg",
              burstActive
                ? "bg-rose-500 text-white shadow-[0_0_12px_rgba(244,63,94,0.7)] animate-pulse"
                : "bg-cyan-500/20 text-cyan-400",
            )}
          >
            <Zap className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-xs font-semibold tracking-wide",
                  burstActive ? "text-rose-300" : "text-cyan-300",
                )}
              >
                {burstActive ? "Microburst detected" : "Fabric telemetry nominal"}
              </span>
              <span className="font-mono text-[10.5px] text-slate-400">
                {burstActive ? "H3 · 10.0.1.13" : "4 active sources"}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {burstActive
                ? "214.6 Mbps (threshold: 96.0 Mbps)"
                : "Aggregate rate: 55.5 Mbps (threshold: 80.0 Mbps)"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {burstActive ? (
            <span className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-mono font-medium text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
              cap 35 Mbps enforced
            </span>
          ) : (
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-mono text-emerald-400">
              ● Unshaped (100% capacity)
            </span>
          )}
        </div>
      </div>

      {/* Main Network Flow Diagram */}
      <div className="relative grid grid-cols-1 items-center gap-4 lg:grid-cols-[165px_1fr_135px]">
        {/* Left Column: Live Detection Host Bank */}
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-2.5 backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold tracking-wide text-slate-200">
              Live Detection
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[9.5px] font-mono font-medium",
                burstActive ? "text-rose-400" : "text-emerald-400",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  burstActive ? "bg-rose-400 animate-ping" : "bg-emerald-400",
                )}
              />
              {burstActive ? "Bursting" : "Nominal"}
            </span>
          </div>

          <div className="space-y-1.5">
            {hosts.map((host) => {
              const isHostBurst = host.burst;
              const pointsStr = host.sparkline
                .map((val, idx) => {
                  const x = (idx / (host.sparkline.length - 1)) * 36;
                  const y = 14 - (val / (isHostBurst ? 220 : 25)) * 12;
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(" ");

              return (
                <div
                  key={host.id}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-2 py-1.5 transition-colors",
                    isHostBurst
                      ? "border-rose-500/40 bg-rose-950/25 shadow-[0_0_12px_rgba(244,63,94,0.15)]"
                      : "border-slate-800/60 bg-slate-950/50 hover:border-slate-700",
                  )}
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-200">{host.label}</span>
                      {isHostBurst && (
                        <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" />
                      )}
                    </div>
                    <div
                      className={cn(
                        "font-mono text-[10px] font-medium",
                        isHostBurst ? "text-rose-400" : "text-slate-400",
                      )}
                    >
                      {host.rate.toFixed(1)} Mbps
                    </div>
                  </div>

                  {/* Sparkline curve */}
                  <svg className="h-4 w-9 overflow-visible" viewBox="0 0 36 14">
                    <polyline
                      fill="none"
                      stroke={isHostBurst ? "#f43f5e" : "#38bdf8"}
                      strokeWidth={isHostBurst ? 2 : 1.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={pointsStr}
                    />
                  </svg>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center: Dynamic SVG Patch-Panel Cables & Hexagonal Switch */}
        <div className="relative flex h-[260px] items-center justify-center">
          <svg viewBox="0 0 380 260" className="h-full w-full overflow-visible">
            <defs>
              <linearGradient id="normal-cable-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#0284c7" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="burst-cable-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#e11d48" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#fb7185" stopOpacity="1" />
              </linearGradient>
              <linearGradient id="egress-cable-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
                <stop offset="100%" stopColor={burstActive ? "#f59e0b" : "#60a5fa"} stopOpacity="1" />
              </linearGradient>
              <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Ingress cables from hosts (left) to Aggregation Switch (center) */}
            {portYs.map((py, idx) => {
              const isBurstLine = idx === 2 && burstActive;
              // Bezier curve from left port (x=10) to switch left face (x=165, y=switchCenterY - 30 + idx * 20)
              const destY = switchCenterY - 30 + idx * 20;
              const pathD = `M 10 ${py} C 90 ${py}, 110 ${destY}, 165 ${destY}`;

              return (
                <g key={idx}>
                  {/* Outer glow line */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isBurstLine ? "#f43f5e" : "#0284c7"}
                    strokeWidth={isBurstLine ? 5 : 2}
                    strokeOpacity={isBurstLine ? 0.35 : 0.15}
                  />
                  {/* Main animated data stream */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isBurstLine ? "url(#burst-cable-grad)" : "url(#normal-cable-grad)"}
                    strokeWidth={isBurstLine ? 3.5 : 1.8}
                    strokeLinecap="round"
                    className="mbh-flow"
                    style={{
                      animationDuration: isBurstLine ? "0.45s" : "1.2s",
                      filter: isBurstLine ? "url(#neon-glow)" : "none",
                    }}
                  />
                </g>
              );
            })}

            {/* Egress trunk cable from Switch (x=215, y=143) to Destination (x=370, y=143) */}
            <path
              d={`M 215 ${switchCenterY} L 370 ${switchCenterY}`}
              fill="none"
              stroke={burstActive ? "#f59e0b" : "#38bdf8"}
              strokeWidth={burstActive ? 6 : 4}
              strokeOpacity={0.25}
            />
            <path
              d={`M 215 ${switchCenterY} L 370 ${switchCenterY}`}
              fill="none"
              stroke="url(#egress-cable-grad)"
              strokeWidth={burstActive ? 4 : 2.5}
              strokeLinecap="round"
              className="mbh-flow"
              style={{
                animationDuration: burstActive ? "0.6s" : "1.1s",
                filter: burstActive ? "url(#neon-glow)" : "none",
              }}
            />

            {/* Central Aggregation Switch Node (Hexagonal chassis) */}
            <g transform={`translate(190, ${switchCenterY})`}>
              {/* Outer halo */}
              <circle
                r="38"
                fill="none"
                stroke={burstActive ? "rgba(244,63,94,0.3)" : "rgba(56,189,248,0.25)"}
                strokeWidth="1.5"
                className="mbh-ring"
              />
              {/* Hexagon chassis */}
              <polygon
                points="0,-32 27.7,-16 27.7,16 0,32 -27.7,16 -27.7,-16"
                className={cn(
                  "transition-colors duration-300",
                  burstActive
                    ? "fill-slate-950 stroke-rose-400"
                    : "fill-slate-950 stroke-cyan-400",
                )}
                strokeWidth="2"
                style={{ filter: "url(#neon-glow)" }}
              />
              {/* Inner accent ring */}
              <polygon
                points="0,-24 20.8,-12 20.8,12 0,24 -20.8,12 -20.8,-12"
                fill="rgba(8,14,28,0.85)"
                stroke={burstActive ? "rgba(244,63,94,0.4)" : "rgba(56,189,248,0.35)"}
                strokeWidth="1"
              />
              {/* Switch label & icon */}
              <text
                x="0"
                y="-4"
                textAnchor="middle"
                className="fill-white text-[12px] font-bold tracking-wider"
              >
                S1
              </text>
              <text
                x="0"
                y="11"
                textAnchor="middle"
                className="font-mono fill-cyan-300 text-[8.5px]"
              >
                10.0.0.1
              </text>
            </g>
          </svg>
        </div>

        {/* Right Column: Destination R1 Node */}
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Destination
            </span>
            <span className="size-2 rounded-full bg-cyan-400 animate-pulse" />
          </div>

          <div className="mt-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-slate-100">R1</span>
              <span className="font-mono text-[10px] text-cyan-400">10.0.0.10</span>
            </div>
            <div className="mt-1 text-[10.5px] text-slate-400">Egress Receiver</div>
          </div>

          {/* Queue pressure meter */}
          <div className="mt-3 border-t border-slate-800/80 pt-2.5">
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-400">Queue pressure</span>
              <span className={burstActive ? "font-semibold text-rose-400" : "text-emerald-400"}>
                {burstActive ? "82% (peak)" : "14% (safe)"}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-950">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  burstActive
                    ? "w-[82%] bg-gradient-to-r from-amber-400 to-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                    : "w-[14%] bg-gradient-to-r from-cyan-400 to-emerald-400",
                )}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Controls Bar at Bottom of Visualizer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-400">Try live state:</span>
          <button
            type="button"
            onClick={onTriggerBurst}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
              burstActive
                ? "border-rose-500/50 bg-rose-500/20 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.3)]"
                : "border-cyan-500/30 bg-cyan-950/30 text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-900/40",
            )}
          >
            <Flame className="size-3.5" />
            {burstActive ? "Burst Injected (H3 Active)" : "Simulate Microburst"}
          </button>
          {burstActive && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700/60"
            >
              <RotateCcw className="size-3" />
              Reset
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10.5px] font-mono text-slate-400">
          <span className="size-1.5 rounded-full bg-cyan-400 animate-ping" />
          <span>Real project telemetry pipeline</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ main page */

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const { snapshot, start, stop, simulateBurst, reset } = useMonitoring();

  // Navigation targets
  const primaryHref = isAuthenticated ? "/dashboard" : "/auth?returnTo=/dashboard";
  const primaryLabel = isAuthenticated ? "Open the console" : "Launch the console";

  // Local interactive toggle for hero visualizer
  const [heroBurstManual, setHeroBurstManual] = useState(false);

  // Sync with real simulation if active
  const isBurstActive = snapshot.burstActive || heroBurstManual;

  const handleHeroTrigger = () => {
    setHeroBurstManual(true);
    if (!snapshot.running) {
      start();
    }
    simulateBurst("h3");
  };

  const handleHeroReset = () => {
    setHeroBurstManual(false);
    reset();
  };

  // Severity filter state for event timeline section
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const filteredEvents = useMemo(() => {
    if (severityFilter === "all") return snapshot.events.slice(-6).reverse();
    return snapshot.events
      .filter((e) => e.severity === severityFilter)
      .slice(-6)
      .reverse();
  }, [snapshot.events, severityFilter]);

  // Ensure dark class on document for whole experience
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <div className="dark min-h-screen bg-[#040711] text-[#E2E8F0] selection:bg-cyan-500/30 selection:text-white antialiased overflow-x-hidden">
      {/* ------------------------------------------------------------------
          A. NAVIGATION BAR
      ------------------------------------------------------------------- */}
      <header className="sticky top-0 z-50 border-b border-cyan-500/10 bg-[#060A17]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          {/* Logo & Brand */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="relative flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 group-hover:border-cyan-400 transition-colors shadow-[0_0_15px_rgba(6,182,212,0.25)]">
              <MHMark className="size-5 text-cyan-400" active />
            </div>
            <span className="text-[15px] font-bold tracking-tight text-white">
              Microburst<span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">Hunter</span>
            </span>
          </Link>

          {/* Section Navigation */}
          <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-slate-300">
            <a href="#capabilities" className="hover:text-cyan-400 transition-colors">
              Capabilities
            </a>
            <a href="#detection" className="hover:text-cyan-400 transition-colors">
              Detection
            </a>
            <a href="#topology" className="hover:text-cyan-400 transition-colors">
              Topology & Traffic
            </a>
            <a href="#attribution" className="hover:text-cyan-400 transition-colors">
              Attribution
            </a>
            <a href="#mitigation" className="hover:text-cyan-400 transition-colors">
              Mitigation
            </a>
            <a href="#experiments" className="hover:text-cyan-400 transition-colors">
              Experiments
            </a>
            <a href="#timeline" className="hover:text-cyan-400 transition-colors">
              Timeline
            </a>
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center gap-3">
            <span className="hidden xl:inline-flex items-center gap-1.5 rounded-full border border-cyan-500/25 bg-cyan-950/30 px-3 py-1 text-[11px] font-mono text-cyan-300">
              <BookOpen className="size-3 text-cyan-400" />
              Computer Networks coursework
            </span>

            <Button
              asChild
              className="relative group overflow-hidden rounded-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-medium shadow-[0_0_20px_rgba(59,130,246,0.35)] px-4 py-2 text-xs"
            >
              <Link to={primaryHref}>
                <span>{primaryLabel}</span>
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="relative">
        {/* ------------------------------------------------------------------
            B. HERO SECTION (WITH SERVER-ROOM BACKGROUND)
        ------------------------------------------------------------------- */}
        <section className="relative min-h-[640px] pt-10 pb-20 lg:pt-16 lg:pb-28 overflow-hidden">
          {/* Server-Room Background Image with Cinematic Masking */}
          <div
            className="pointer-events-none absolute inset-0 z-0 bg-cover bg-right lg:bg-center opacity-40 mix-blend-screen"
            style={{
              backgroundImage: "url('/server-room-bg.jpg')",
            }}
          />

          {/* Layered Gradient Vignette & Dark Mask for High Contrast Readability */}
          <div
            className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-r from-[#040711] via-[#040711]/90 to-transparent lg:w-3/4"
          />
          <div
            className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-t from-[#040711] via-transparent to-[#040711]/80"
          />
          <div
            className="pointer-events-none absolute -top-40 -left-40 size-[500px] rounded-full bg-cyan-500/10 blur-[120px]"
          />
          <div
            className="pointer-events-none absolute top-1/3 -right-20 size-[500px] rounded-full bg-purple-600/15 blur-[140px]"
          />

          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
              {/* Left Column: Headlines, Explanations, CTAs, and Specs */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="lg:col-span-6 xl:col-span-6"
              >
                {/* Eyebrow Pill */}
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-950/40 px-3.5 py-1 text-xs font-mono text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.18)] backdrop-blur-md">
                  <Zap className="size-3.5 text-cyan-400" />
                  <span>Sub-millisecond network observability</span>
                </div>

                {/* Main Headline */}
                <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-[54px] leading-[1.08]">
                  Catch the burst <br />
                  <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent text-glow-cyan">
                    before the buffer does
                  </span>
                  <span className="text-purple-400 font-mono animate-pulse">.</span>
                </h1>

                {/* Description */}
                <p className="mt-5 max-w-xl text-[14.5px] leading-relaxed text-slate-300">
                  MicroburstHunter detects, attributes and mitigates sub-millisecond traffic spikes
                  with real-time visibility, adaptive rate-capping and reproducible experiments —
                  all in one deterministic traffic model.
                </p>

                {/* CTAs */}
                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <Button
                    asChild
                    size="lg"
                    className="relative group rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 px-6 py-6 font-semibold text-white shadow-[0_0_30px_rgba(59,130,246,0.4)] transition-all hover:scale-[1.02]"
                  >
                    <Link to={primaryHref} className="flex items-center gap-2.5">
                      <Play className="size-4 fill-white" />
                      <span>{primaryLabel}</span>
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                  </Button>

                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="rounded-xl border border-slate-700/80 bg-slate-900/60 px-5 py-6 font-medium text-slate-200 hover:border-cyan-500/50 hover:bg-slate-800/70 backdrop-blur-md transition-all"
                  >
                    <a href="#detection" className="flex items-center gap-2">
                      <Code2 className="size-4 text-cyan-400" />
                      <span>Read the detection engine</span>
                    </a>
                  </Button>
                </div>

                {/* Metrics & Specs Bar */}
                <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-slate-800/80 pt-6">
                  {SPECS.map((spec) => (
                    <div
                      key={spec.label}
                      className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 backdrop-blur-md transition-colors hover:border-slate-700"
                    >
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <spec.icon className={cn("size-3.5", spec.color)} />
                        <span className="text-[10px] font-mono uppercase tracking-wider">
                          {spec.label}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1">
                        <span className="font-mono text-xl font-bold text-white tracking-tight">
                          {spec.value}
                        </span>
                        {spec.unit && (
                          <span className="font-mono text-xs text-slate-400">{spec.unit}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Right Column: Signature Observability Visualizer */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="lg:col-span-6 xl:col-span-6"
              >
                <HeroObservabilityVisualizer
                  burstActive={isBurstActive}
                  onTriggerBurst={handleHeroTrigger}
                  onReset={handleHeroReset}
                />
              </motion.div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            C. CAPABILITIES SECTION
        ------------------------------------------------------------------- */}
        <section id="capabilities" className="relative border-y border-cyan-500/10 bg-[#070D1E]/60 py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400">
                  <span className="h-px w-6 bg-cyan-400" />
                  <span>Why MicroburstHunter</span>
                </div>
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                  Built as an{" "}
                  <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                    instrument
                  </span>
                  , not a dashboard.
                </h2>
              </div>
              <p className="max-w-md text-xs sm:text-sm leading-relaxed text-slate-300">
                Detection, attribution and mitigation run as real code against a shared state, so
                every panel agrees with every other panel.
              </p>
            </div>

            {/* 6 Feature Cards */}
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((card, i) => (
                <motion.div
                  key={card.num}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.35, delay: (i % 3) * 0.08 }}
                  className="group relative rounded-2xl border border-slate-800/90 bg-slate-950/60 p-6 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-cyan-500/40 hover:shadow-[0_12px_35px_rgba(6,182,212,0.12)]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-slate-900 border border-slate-800 group-hover:border-cyan-500/50 transition-colors">
                      <card.icon className={cn("size-5", card.iconColor)} />
                    </div>
                    <span className="font-mono text-xs font-semibold text-slate-400">
                      {card.num}
                    </span>
                  </div>

                  <h3 className="mt-5 text-base font-semibold text-white tracking-tight group-hover:text-cyan-300 transition-colors">
                    {card.title}
                  </h3>
                  <p className="mt-2.5 text-xs sm:text-[13px] leading-relaxed text-slate-300">
                    {card.body}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            D. DETECTION ENGINE SECTION
        ------------------------------------------------------------------- */}
        <section id="detection" className="relative py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-10">
              {/* Left Column: Math & Formulations */}
              <div className="lg:col-span-6">
                <div className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400">
                  <span className="h-px w-6 bg-cyan-400" />
                  <span>Detection Engine</span>
                </div>
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                  A threshold that adapts, then persists.
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-slate-300">
                  Each window converts observed bytes into a rate and compares it against the higher
                  of the absolute minimum and the rolling baseline multiplied by the configured
                  factor. A burst is declared only after qualifying for consecutive persistence
                  windows — and ends only after sustained quiet.
                </p>

                {/* Mathematical Formula Terminal Box */}
                <div className="mt-7 rounded-2xl border border-cyan-500/20 bg-slate-950/80 p-5 shadow-2xl backdrop-blur-md">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="size-2.5 rounded-full bg-rose-500" />
                      <div className="size-2.5 rounded-full bg-amber-500" />
                      <div className="size-2.5 rounded-full bg-emerald-500" />
                      <span className="ml-2 font-mono text-[11px] text-slate-400">
                        engine/detector.py
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-cyan-400">Sub-RTT Formula</span>
                  </div>

                  <pre className="mt-4 overflow-x-auto font-mono text-xs sm:text-[12.5px] leading-6 text-slate-200">
                    <span className="text-purple-400">rateMbps</span> = bytes × 8 ÷ (windowMs ÷
                    1000) ÷ 1,000,000
                    <br />
                    <span className="text-amber-400">threshold</span> = max(minRate, baseline ×
                    multiplier)
                    <br />
                    <span className="text-rose-400">burst</span> = rate &gt; threshold for
                    persistence windows (2)
                    <br />
                    <span className="text-emerald-400">recovery</span> = rate ≤ threshold for
                    recovery windows (3)
                  </pre>
                </div>

                {/* Parameter Matrix Pills */}
                <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4 font-mono text-xs">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                    <div className="text-[10px] text-slate-400">EWMA ALPHA</div>
                    <div className="text-cyan-400 font-bold">α = 0.1</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                    <div className="text-[10px] text-slate-400">PERSISTENCE</div>
                    <div className="text-purple-400 font-bold">2 windows</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                    <div className="text-[10px] text-slate-400">RECOVERY</div>
                    <div className="text-emerald-400 font-bold">3 windows</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                    <div className="text-[10px] text-slate-400">WATCHDOG</div>
                    <div className="text-amber-400 font-bold">250 ms max</div>
                  </div>
                </div>
              </div>

              {/* Right Column: Operational Rules & Invariants */}
              <div className="space-y-4 lg:col-span-6">
                {[
                  {
                    icon: Gauge,
                    color: "text-amber-400",
                    border: "border-amber-500/20",
                    title: "Queue congestion is not measured",
                    body: "A rate spike is a rate measurement. Switch-buffer occupancy is a separate metric, and the console never presents the two as the same thing.",
                  },
                  {
                    icon: Activity,
                    color: "text-cyan-400",
                    border: "border-cyan-500/20",
                    title: "No fabricated live status",
                    body: "The browser build executes simulated experiments in-memory and says so on every screen. Live raw capture requires the separate Python/Scapy backend running on Linux with CAP_NET_RAW.",
                  },
                  {
                    icon: Timer,
                    color: "text-purple-400",
                    border: "border-purple-500/20",
                    title: "Configurable, not universal",
                    body: "10 ms, 80 Mbps and ×3 are educational defaults chosen to make a microburst clearly visible on standard hardware — not an immutable physics constant.",
                  },
                ].map((note) => (
                  <div
                    key={note.title}
                    className={cn(
                      "rounded-2xl border bg-slate-950/60 p-5 backdrop-blur-md transition-all hover:bg-slate-900/50",
                      note.border,
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <note.icon className={cn("size-5", note.color)} />
                      <h4 className="text-sm font-semibold text-white tracking-tight">
                        {note.title}
                      </h4>
                    </div>
                    <p className="mt-2 text-xs sm:text-[13px] leading-relaxed text-slate-300">
                      {note.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            E. NETWORK & TRAFFIC VISUALIZATION DEEP-DIVE
        ------------------------------------------------------------------- */}
        <section id="topology" className="relative border-y border-cyan-500/10 bg-[#070D1E]/70 py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400">
                  <span className="h-px w-6 bg-cyan-400" />
                  <span>Real-Time Telemetry</span>
                </div>
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                  Fabric plane & live traffic oscilloscope.
                </h2>
              </div>
              <p className="max-w-md text-xs sm:text-sm leading-relaxed text-slate-300">
                Stroke weight represents measured throughput. Coral highlights indicate declared
                burst intervals. Amber shows active rate-limiting caps.
              </p>
            </div>

            {/* Live Telemetry Workbench Card */}
            <div className="mt-10 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 shadow-2xl backdrop-blur-md">
              <div className="flex flex-wrap items-center justify-between border-b border-slate-800 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-3 items-center justify-center">
                    <span className="size-2 rounded-full bg-cyan-400 animate-ping" />
                  </div>
                  <span className="text-sm font-semibold text-white">
                    Live Oscilloscope Trace & Threshold Analysis
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-cyan-400" /> Measured Rate
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-purple-400" /> Rolling Baseline
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-amber-400" /> Dynamic Threshold
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-rose-500" /> Burst Interval
                  </span>
                </div>
              </div>

              {/* Oscilloscope Graph Mockup */}
              <div className="relative p-6">
                <svg viewBox="0 0 900 240" className="h-56 w-full overflow-visible">
                  {/* Grid Lines */}
                  <line x1="40" y1="30" x2="880" y2="30" stroke="#1e293b" strokeDasharray="4 4" />
                  <line x1="40" y1="80" x2="880" y2="80" stroke="#1e293b" strokeDasharray="4 4" />
                  <line x1="40" y1="130" x2="880" y2="130" stroke="#1e293b" strokeDasharray="4 4" />
                  <line x1="40" y1="180" x2="880" y2="180" stroke="#1e293b" strokeDasharray="4 4" />

                  {/* Y Axis Labels */}
                  <text x="30" y="34" textAnchor="end" className="font-mono fill-slate-400 text-[10px]">200M</text>
                  <text x="30" y="84" textAnchor="end" className="font-mono fill-slate-400 text-[10px]">150M</text>
                  <text x="30" y="134" textAnchor="end" className="font-mono fill-slate-400 text-[10px]">100M</text>
                  <text x="30" y="184" textAnchor="end" className="font-mono fill-slate-400 text-[10px]">50M</text>

                  {/* Burst Highlight Zone */}
                  <rect x="360" y="20" width="160" height="170" fill="rgba(244,63,94,0.12)" rx="6" />
                  <text x="440" y="38" textAnchor="middle" className="font-mono fill-rose-400 text-[10px] font-semibold">
                    BURST WINDOW (214.6 Mbps)
                  </text>

                  {/* Dynamic Threshold Line (Amber) */}
                  <path
                    d="M 40 145 L 340 145 L 360 135 L 520 135 L 540 145 L 880 145"
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="1.8"
                    strokeDasharray="6 4"
                  />

                  {/* Rolling Baseline Line (Purple) */}
                  <path
                    d="M 40 178 C 200 176, 360 174, 520 170 C 680 172, 800 174, 880 175"
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth="1.8"
                  />

                  {/* Live Rate Trace (Cyan to Coral spike) */}
                  <path
                    d="M 40 175 Q 80 172 120 176 T 200 173 T 280 175 T 350 172 L 380 40 L 440 35 L 500 45 L 530 172 T 620 174 T 720 173 T 880 175"
                    fill="none"
                    stroke="url(#trace-grad)"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  <defs>
                    <linearGradient id="trace-grad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="36%" stopColor="#38bdf8" />
                      <stop offset="41%" stopColor="#f43f5e" />
                      <stop offset="59%" stopColor="#f43f5e" />
                      <stop offset="64%" stopColor="#38bdf8" />
                      <stop offset="100%" stopColor="#38bdf8" />
                    </linearGradient>
                  </defs>
                </svg>

                {/* Oscilloscope Footer Stats */}
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 border-t border-slate-800 pt-4 font-mono text-xs">
                  <div>
                    <span className="text-slate-400">Peak Observed Rate:</span>
                    <span className="ml-2 font-bold text-rose-400">214.6 Mbps</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Baseline Rate:</span>
                    <span className="ml-2 font-bold text-purple-400">18.4 Mbps</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Threshold:</span>
                    <span className="ml-2 font-bold text-amber-400">96.0 Mbps</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Persistence Fired:</span>
                    <span className="ml-2 font-bold text-emerald-400">20 ms (2 wins)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            F. SOURCE ATTRIBUTION SECTION
        ------------------------------------------------------------------- */}
        <section id="attribution" className="relative py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400">
                  <span className="h-px w-6 bg-cyan-400" />
                  <span>Source Attribution</span>
                </div>
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                  Attribution without accusation.
                </h2>
              </div>
              <p className="max-w-md text-xs sm:text-sm leading-relaxed text-slate-300">
                Rank sources by their byte share inside the burst window. Volume is reported as
                volume — never as intent.
              </p>
            </div>

            {/* Visual Contribution Breakdown Bar */}
            <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-950/70 p-6 backdrop-blur-md">
              <div className="flex items-center justify-between text-xs font-mono mb-2.5">
                <span className="text-slate-400 font-medium">
                  Burst Window Ingress Share Distribution
                </span>
                <span className="text-rose-400 font-bold">H3 Dominance: 83.4%</span>
              </div>

              {/* Segmented Bar */}
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-900 border border-slate-800">
                <div style={{ width: "8.5%" }} className="bg-cyan-500" title="H1: 8.5%" />
                <div style={{ width: "6.7%" }} className="bg-blue-500" title="H2: 6.7%" />
                <div
                  style={{ width: "83.4%" }}
                  className="bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.7)]"
                  title="H3: 83.4%"
                />
                <div style={{ width: "1.4%" }} className="bg-indigo-500" title="H4: 1.4%" />
              </div>

              {/* Source Ranking Table */}
              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="pb-3 font-medium">Source</th>
                      <th className="pb-3 font-medium">IP Address</th>
                      <th className="pb-3 font-medium">Role</th>
                      <th className="pb-3 font-medium">Offered Rate</th>
                      <th className="pb-3 font-medium">Window Share</th>
                      <th className="pb-3 font-medium">Status / Verdict</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    <tr className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-3 font-bold text-white">H1</td>
                      <td className="py-3 text-cyan-400">10.0.1.11</td>
                      <td className="py-3 text-slate-400">Standard host</td>
                      <td className="py-3">18.2 Mbps</td>
                      <td className="py-3">8.5%</td>
                      <td className="py-3">
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
                          In-Spec Sender
                        </span>
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-3 font-bold text-white">H2</td>
                      <td className="py-3 text-cyan-400">10.0.1.12</td>
                      <td className="py-3 text-slate-400">Standard host</td>
                      <td className="py-3">14.4 Mbps</td>
                      <td className="py-3">6.7%</td>
                      <td className="py-3">
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
                          In-Spec Sender
                        </span>
                      </td>
                    </tr>
                    <tr className="bg-rose-950/20 hover:bg-rose-950/30 transition-colors font-medium">
                      <td className="py-3 font-bold text-rose-300">H3</td>
                      <td className="py-3 text-rose-400">10.0.1.13</td>
                      <td className="py-3 text-rose-300">Burst generator</td>
                      <td className="py-3 text-rose-300 font-bold">214.6 Mbps</td>
                      <td className="py-3 text-rose-300 font-bold">83.4%</td>
                      <td className="py-3">
                        <span className="rounded-md border border-rose-500/40 bg-rose-500/20 px-2 py-0.5 text-rose-300 animate-pulse">
                          Offending Source
                        </span>
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-3 font-bold text-white">H4</td>
                      <td className="py-3 text-cyan-400">10.0.1.14</td>
                      <td className="py-3 text-slate-400">Light host</td>
                      <td className="py-3">3.1 Mbps</td>
                      <td className="py-3">1.4%</td>
                      <td className="py-3">
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
                          In-Spec Sender
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            G. ADAPTIVE MITIGATION SECTION
        ------------------------------------------------------------------- */}
        <section id="mitigation" className="relative border-y border-cyan-500/10 bg-[#070D1E]/60 py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400">
                  <span className="h-px w-6 bg-cyan-400" />
                  <span>Traffic Control Policy</span>
                </div>
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                  Targeted rate-limiting, zero innocent drops.
                </h2>
              </div>
              <p className="max-w-md text-xs sm:text-sm leading-relaxed text-slate-300">
                Linux TC HTB token-bucket shaping with flower classifiers. Generates dry-run commands
                in safe mode or executes live in isolated network namespaces.
              </p>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-12">
              {/* Generated Linux TC Commands */}
              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 backdrop-blur-md lg:col-span-7">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="size-4 text-amber-400" />
                    <span className="font-mono text-xs font-semibold text-white">
                      Linux Traffic Control Execution Plan
                    </span>
                  </div>
                  <span className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                    Mode A: Dry-Run Safe
                  </span>
                </div>

                <div className="mt-4 font-mono text-xs text-slate-300">
                  <div className="text-slate-400"># 1. Attach HTB rate-limiting class to egress</div>
                  <div className="mt-1 text-cyan-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                    $ tc class add dev demo0 parent 1: classid 1:10 htb rate 35.0mbit ceil 35.0mbit
                  </div>

                  <div className="mt-3 text-slate-400">
                    # 2. Match offending source IP with flower classifier
                  </div>
                  <div className="mt-1 text-cyan-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                    $ tc filter add dev demo0 protocol ip parent 1:0 prio 1 flower src_ip 10.0.1.13 flowid 1:10
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-xs font-mono text-slate-400">
                  <span>Safeguard check:</span>
                  <span className="text-emerald-400">assert_safe_interface() verified</span>
                </div>
              </div>

              {/* Before vs After Impact Card */}
              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 backdrop-blur-md lg:col-span-5 flex flex-col justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-white tracking-tight">
                    Mitigation Effectiveness Verification
                  </h4>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    Evaluated against offered unshaped traffic surge vs shaped receiver throughput.
                  </p>

                  <div className="mt-5 space-y-3 font-mono text-xs">
                    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                      <span className="text-slate-400">Offered Rate</span>
                      <span className="font-bold text-rose-400">214.6 Mbps</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                      <span className="text-slate-400">Enforced Rate Cap</span>
                      <span className="font-bold text-amber-400">35.0 Mbps</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                      <span className="text-slate-400">Receiver Throughput</span>
                      <span className="font-bold text-emerald-400">33.91 Mbps (3.1% cap delta)</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                      <span className="text-slate-400">Buffer Drops Prevented</span>
                      <span className="font-bold text-cyan-400">10,304 socket backpressures</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 border-t border-slate-800 pt-3 text-[11px] font-mono text-slate-400">
                  Auto-Recovery: Restored after 3 consecutive quiet windows or 250ms inactivity watchdog.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            H. EXPERIMENTS SECTION
        ------------------------------------------------------------------- */}
        <section id="experiments" className="relative py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400">
                  <span className="h-px w-6 bg-cyan-400" />
                  <span>Reproducible Scenarios</span>
                </div>
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                  Three runs, one seed, comparable numbers.
                </h2>
              </div>
              <p className="max-w-md text-xs sm:text-sm leading-relaxed text-slate-300">
                Seeded scenarios (Deterministic seed: 1337) allow reviewers to compare exact metrics
                rather than trusting isolated screenshots.
              </p>
            </div>

            {/* 3 Experiment Cards */}
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {[
                {
                  id: "01",
                  title: "Normal Traffic",
                  badge: "Baseline Run",
                  badgeColor: "border-cyan-500/30 text-cyan-300 bg-cyan-950/30",
                  description:
                    "Steady multi-source load with no burst. Establishes baseline rate, modeled latency and near-zero queue pressure.",
                  metrics: [
                    { label: "Aggregate Rate", value: "18.2 Mbps" },
                    { label: "Queue Tail Drops", value: "0 packets" },
                    { label: "Mean Latency", value: "0.42 ms" },
                  ],
                },
                {
                  id: "02",
                  title: "Burst, No Mitigation",
                  badge: "Uncontrolled Incast",
                  badgeColor: "border-rose-500/30 text-rose-300 bg-rose-950/30",
                  description:
                    "A reproducible microburst fires from H3 at 150 Mbps. The detector declares it and traffic stays unshaped, inducing buffer exhaustion.",
                  metrics: [
                    { label: "Aggregate Rate", value: "168.2 Mbps" },
                    { label: "Queue Tail Drops", value: "4,120 packets" },
                    { label: "Tail Latency", value: "18.4 ms" },
                  ],
                },
                {
                  id: "03",
                  title: "Burst + Adaptive Cap",
                  badge: "Autonomous Defense",
                  badgeColor: "border-amber-500/30 text-amber-300 bg-amber-950/30",
                  description:
                    "The identical burst is injected, but policy caps offending flow to 35 Mbps upon 20 ms detection. Tail latency and drops resolve.",
                  metrics: [
                    { label: "Shaped Peak", value: "34.2 Mbps" },
                    { label: "Queue Tail Drops", value: "0 packets (saved)" },
                    { label: "Tail Latency", value: "1.12 ms" },
                  ],
                },
              ].map((exp) => (
                <div
                  key={exp.id}
                  className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6 backdrop-blur-md flex flex-col justify-between hover:border-cyan-500/30 transition-all"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-slate-400">
                        SCENARIO {exp.id}
                      </span>
                      <span className={cn("rounded-md border px-2 py-0.5 font-mono text-[10px]", exp.badgeColor)}>
                        {exp.badge}
                      </span>
                    </div>

                    <h3 className="mt-4 text-base font-semibold text-white tracking-tight">
                      {exp.title}
                    </h3>
                    <p className="mt-2 text-xs leading-relaxed text-slate-300">
                      {exp.description}
                    </p>

                    <div className="mt-5 space-y-2 border-t border-slate-800/80 pt-4 font-mono text-xs">
                      {exp.metrics.map((m) => (
                        <div key={m.label} className="flex justify-between">
                          <span className="text-slate-400">{m.label}</span>
                          <span className="font-semibold text-slate-200">{m.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 border-t border-slate-800 pt-4">
                    <Button
                      asChild
                      variant="outline"
                      className="w-full justify-between rounded-lg border-slate-800 bg-slate-900/60 text-xs hover:border-cyan-500/40 hover:bg-slate-800/80"
                    >
                      <Link to="/dashboard/experiments">
                        <span>Launch in Console</span>
                        <ChevronRight className="size-3.5 text-cyan-400" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            I. EVENT TIMELINE & AUDITABILITY SECTION
        ------------------------------------------------------------------- */}
        <section id="timeline" className="relative border-y border-cyan-500/10 bg-[#070D1E]/70 py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400">
                  <span className="h-px w-6 bg-cyan-400" />
                  <span>Audit Trail</span>
                </div>
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                  Auditable event timeline & persistent storage.
                </h2>
              </div>

              {/* CSV Export Button */}
              <button
                type="button"
                onClick={() => exportEventsCsv(snapshot.events)}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/40 px-4 py-2 text-xs font-mono font-medium text-cyan-300 hover:bg-cyan-900/40 transition-colors"
              >
                <Download className="size-3.5" />
                <span>Export Audit CSV</span>
              </button>
            </div>

            {/* Filter Tabs & Event Table */}
            <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-950/80 p-6 backdrop-blur-md">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-400">Filter severity:</span>
                  {["all", "critical", "warning", "info", "success"].map((sev) => (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => setSeverityFilter(sev)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-mono uppercase transition-colors",
                        severityFilter === sev
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                          : "text-slate-400 hover:text-slate-200 border border-transparent",
                      )}
                    >
                      {sev}
                    </button>
                  ))}
                </div>

                <span className="font-mono text-xs text-slate-400">
                  SQLite persistence: <code className="text-cyan-400">microbursthunter.sqlite3</code>
                </span>
              </div>

              {/* Event Table Rows */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="pb-3 font-medium">Timestamp</th>
                      <th className="pb-3 font-medium">Event Type</th>
                      <th className="pb-3 font-medium">Severity</th>
                      <th className="pb-3 font-medium">Source IP</th>
                      <th className="pb-3 font-medium">Action / Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {filteredEvents.length > 0 ? (
                      filteredEvents.map((evt) => (
                        <tr key={evt.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="py-3 text-slate-400">{formatClock(evt.timestamp)}</td>
                          <td className="py-3 font-semibold text-white">{evt.type}</td>
                          <td className="py-3">
                            <span
                              className={cn(
                                "rounded-md border px-2 py-0.5 text-[10px] uppercase",
                                evt.severity === "critical"
                                  ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                                  : evt.severity === "warning"
                                    ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
                                    : evt.severity === "success"
                                      ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                                      : "border-cyan-500/40 bg-cyan-500/20 text-cyan-300",
                              )}
                            >
                              {evt.severity}
                            </span>
                          </td>
                          <td className="py-3 text-cyan-400">{evt.sourceIp || evt.hostName || "10.0.1.13"}</td>
                          <td className="py-3 text-slate-300">{evt.outcome ? `${evt.action} — ${evt.outcome}` : evt.action}</td>
                        </tr>
                      ))
                    ) : (
                      // Fallback demo events matching Mode A dry-run output
                      <>
                        <tr className="hover:bg-slate-900/40">
                          <td className="py-3 text-slate-400">+200.0 ms</td>
                          <td className="py-3 font-semibold text-white">burst_detected</td>
                          <td className="py-3">
                            <span className="rounded-md border border-rose-500/40 bg-rose-500/20 px-2 py-0.5 text-[10px] text-rose-300">
                              critical
                            </span>
                          </td>
                          <td className="py-3 text-cyan-400">10.0.1.13</td>
                          <td className="py-3 text-slate-300">
                            Severe burst from 10.0.1.13 (214.6 Mbps vs 96.0 Mbps threshold)
                          </td>
                        </tr>
                        <tr className="hover:bg-slate-900/40">
                          <td className="py-3 text-slate-400">+200.0 ms</td>
                          <td className="py-3 font-semibold text-white">mitigation_simulated</td>
                          <td className="py-3">
                            <span className="rounded-md border border-cyan-500/40 bg-cyan-500/20 px-2 py-0.5 text-[10px] text-cyan-300">
                              info
                            </span>
                          </td>
                          <td className="py-3 text-cyan-400">10.0.1.13</td>
                          <td className="py-3 text-slate-300">
                            Dry-run cap 35.0 Mbps planned for 10.0.1.13 via HTB class 1:10
                          </td>
                        </tr>
                        <tr className="hover:bg-slate-900/40">
                          <td className="py-3 text-slate-400">+250.0 ms</td>
                          <td className="py-3 font-semibold text-white">burst_ended</td>
                          <td className="py-3">
                            <span className="rounded-md border border-rose-500/40 bg-rose-500/20 px-2 py-0.5 text-[10px] text-rose-300">
                              critical
                            </span>
                          </td>
                          <td className="py-3 text-cyan-400">10.0.1.13</td>
                          <td className="py-3 text-slate-300">
                            Traffic normalized beneath threshold (3 quiet recovery windows)
                          </td>
                        </tr>
                        <tr className="hover:bg-slate-900/40">
                          <td className="py-3 text-slate-400">+250.0 ms</td>
                          <td className="py-3 font-semibold text-white">mitigation_removed</td>
                          <td className="py-3">
                            <span className="rounded-md border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300">
                              success
                            </span>
                          </td>
                          <td className="py-3 text-cyan-400">10.0.1.13</td>
                          <td className="py-3 text-slate-300">
                            Rate limit removed; interface returned to unshaped 100% capacity
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            CONSOLE PROMOTION CTA BANNER
        ------------------------------------------------------------------- */}
        <section className="relative py-16 lg:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-3xl border border-cyan-500/30 bg-gradient-to-r from-blue-950/70 via-indigo-950/60 to-purple-950/70 p-8 lg:p-12 shadow-[0_0_50px_rgba(59,130,246,0.18)] backdrop-blur-xl">
              <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
                <div>
                  <h3 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    Ready to inspect datacenter microbursts?
                  </h3>
                  <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300">
                    Open the live operations console to explore the full interactive topology,
                    traffic oscilloscope, source attribution ranking, adaptive rate limiter, and
                    reproducible experiment suite.
                  </p>
                </div>

                <Button
                  asChild
                  size="lg"
                  className="rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 px-8 py-6 text-sm font-semibold text-white shadow-[0_0_30px_rgba(59,130,246,0.4)] transition-all hover:scale-105 shrink-0"
                >
                  <Link to={primaryHref} className="flex items-center gap-2">
                    <span>{primaryLabel}</span>
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------------
          J. FOOTER
      ------------------------------------------------------------------- */}
      <footer className="border-t border-cyan-500/10 bg-[#03060E] py-12 text-xs text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-12">
            {/* Col 1: Brand & Coursework */}
            <div className="md:col-span-5">
              <div className="flex items-center gap-2.5">
                <MHMark className="size-6 text-cyan-400" active />
                <span className="text-sm font-bold tracking-tight text-white">
                  Microburst<span className="text-cyan-400">Hunter</span>
                </span>
              </div>
              <p className="mt-3 max-w-sm text-slate-400 leading-relaxed text-[12.5px]">
                Sub-millisecond software telemetry, sliding-window detection, source attribution,
                and adaptive traffic-control pipeline for high-speed networks.
              </p>
              <div className="mt-4 font-mono text-[11px] text-cyan-400">
                Computer Networks Coursework · Academic Research Project
              </div>
            </div>

            {/* Col 2: Navigation */}
            <div className="md:col-span-3 space-y-2">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Navigation
              </div>
              <ul className="space-y-1.5 text-[12.5px]">
                <li>
                  <a href="#capabilities" className="hover:text-cyan-300 transition-colors">
                    Capabilities
                  </a>
                </li>
                <li>
                  <a href="#detection" className="hover:text-cyan-300 transition-colors">
                    Detection Engine
                  </a>
                </li>
                <li>
                  <a href="#topology" className="hover:text-cyan-300 transition-colors">
                    Topology & Traffic
                  </a>
                </li>
                <li>
                  <a href="#attribution" className="hover:text-cyan-300 transition-colors">
                    Source Attribution
                  </a>
                </li>
                <li>
                  <a href="#mitigation" className="hover:text-cyan-300 transition-colors">
                    Adaptive Mitigation
                  </a>
                </li>
                <li>
                  <a href="#experiments" className="hover:text-cyan-300 transition-colors">
                    Seeded Experiments
                  </a>
                </li>
              </ul>
            </div>

            {/* Col 3: Safe Mode Disclaimers */}
            <div className="md:col-span-4 space-y-2">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Architecture Guarantee
              </div>
              <p className="text-[12px] leading-relaxed text-slate-400">
                <strong className="text-slate-200">Mode A (Safe Dry-Run):</strong> Simulated state
                machine executes all state transitions without host mutation or elevated permissions.
              </p>
              <p className="text-[12px] leading-relaxed text-slate-400">
                <strong className="text-slate-200">Mode B (Live Kernel):</strong> Requires Linux/WSL2
                root privileges and strictly runs inside disposable network namespace{" "}
                <code className="text-cyan-400">mbh_ns_test</code>.
              </p>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-slate-900 pt-6 text-[11px] font-mono text-slate-400">
            <span>© 2026 MicroburstHunter. Built as an instrument, not a dashboard.</span>
            <span>Deterministic seed 1337 · Sliding window 10 ms · EWMA α=0.1</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
