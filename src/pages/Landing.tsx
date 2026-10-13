import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
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
import {
  Activity,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Code2,
  Cpu,
  Download,
  Flame,
  Gauge,
  Layers,
  Monitor,
  Network,
  OctagonAlert,
  Play,
  RotateCcw,
  Server,
  Share2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Timer,
  Waves,
  Wrench,
  Zap,
} from "lucide-react";

/* ------------------------------------------------------------------ specs */

const SPECS = [
  { label: "Sampling window", value: "10", unit: "ms", icon: Zap, color: "text-violet-400" },
  { label: "Minimum rate", value: "80", unit: "Mbps", icon: Gauge, color: "text-indigo-400" },
  { label: "Baseline multiplier", value: "×3", unit: "", icon: Layers, color: "text-fuchsia-400" },
  { label: "Deterministic seed", value: "1337", unit: "", icon: Code2, color: "text-amber-400" },
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

  const portYs = [56, 114, 172, 230];
  const switchCenterY = 143;

  return (
    <div className="relative w-full rounded-3xl border border-white/10 bg-[#0c0d16] p-5 shadow-[0_25px_60px_rgba(0,0,0,0.8),0_0_35px_rgba(141,84,255,0.12)] backdrop-blur-xl">
      {/* Decorative neon corner accents */}
      <div className="pointer-events-none absolute -top-px -left-px h-8 w-8 rounded-tl-3xl border-t border-l border-violet-500/60" />
      <div className="pointer-events-none absolute -bottom-px -right-px h-8 w-8 rounded-br-3xl border-b border-r border-fuchsia-500/60" />

      {/* Top Banner Alert Pill */}
      <div
        className={cn(
          "mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border px-3.5 py-2.5 transition-all duration-300",
          burstActive
            ? "border-rose-500/40 bg-rose-950/30 shadow-[0_0_20px_rgba(255,35,87,0.2)]"
            : "border-white/10 bg-white/5",
        )}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex size-7 items-center justify-center rounded-xl",
              burstActive
                ? "bg-rose-500 text-white shadow-[0_0_12px_rgba(255,35,87,0.7)] animate-pulse"
                : "bg-violet-500/20 text-violet-400",
            )}
          >
            <Zap className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-xs font-semibold tracking-wide",
                  burstActive ? "text-rose-300" : "text-white",
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
            <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-mono font-medium text-amber-300 shadow-[0_0_10px_rgba(252,187,0,0.2)]">
              cap 35 Mbps enforced
            </span>
          ) : (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-mono text-emerald-400">
              ● Unshaped (100% capacity)
            </span>
          )}
        </div>
      </div>

      {/* Main Network Flow Diagram */}
      <div className="relative grid grid-cols-1 items-center gap-4 lg:grid-cols-[165px_1fr_135px]">
        {/* Left Column: Live Detection Host Bank */}
        <div className="rounded-2xl border border-white/10 bg-[#090a10] p-2.5">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold tracking-wide text-white">
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
                    "flex items-center justify-between rounded-xl border px-2.5 py-1.5 transition-colors",
                    isHostBurst
                      ? "border-rose-500/40 bg-rose-950/25 shadow-[0_0_12px_rgba(255,35,87,0.2)]"
                      : "border-white/5 bg-white/[0.02] hover:border-white/10",
                  )}
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-white">{host.label}</span>
                      {isHostBurst && (
                        <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" />
                      )}
                    </div>
                    <div
                      className={cn(
                        "font-mono text-[10px] font-medium",
                        isHostBurst ? "text-rose-400 font-bold" : "text-slate-400",
                      )}
                    >
                      {host.rate.toFixed(1)} Mbps
                    </div>
                  </div>

                  {/* Sparkline curve */}
                  <svg className="h-4 w-9 overflow-visible" viewBox="0 0 36 14">
                    <polyline
                      fill="none"
                      stroke={isHostBurst ? "#ff2357" : "#a685ff"}
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
                <stop offset="0%" stopColor="#4f39f6" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#a685ff" stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="burst-cable-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#be123c" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#ff2357" stopOpacity="1" />
              </linearGradient>
              <linearGradient id="egress-cable-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#8d54ff" stopOpacity="0.8" />
                <stop offset="100%" stopColor={burstActive ? "#fcbb00" : "#a685ff"} stopOpacity="1" />
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
              const destY = switchCenterY - 30 + idx * 20;
              const pathD = `M 10 ${py} C 90 ${py}, 110 ${destY}, 165 ${destY}`;

              return (
                <g key={idx}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isBurstLine ? "#ff2357" : "#4f39f6"}
                    strokeWidth={isBurstLine ? 5 : 2}
                    strokeOpacity={isBurstLine ? 0.35 : 0.15}
                  />
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

            {/* Egress trunk cable from Switch to Destination */}
            <path
              d={`M 215 ${switchCenterY} L 370 ${switchCenterY}`}
              fill="none"
              stroke={burstActive ? "#fcbb00" : "#8d54ff"}
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
              <circle
                r="38"
                fill="none"
                stroke={burstActive ? "rgba(255,35,87,0.3)" : "rgba(141,84,255,0.25)"}
                strokeWidth="1.5"
                className="mbh-ring"
              />
              <polygon
                points="0,-32 27.7,-16 27.7,16 0,32 -27.7,16 -27.7,-16"
                className={cn(
                  "transition-colors duration-300",
                  burstActive
                    ? "fill-[#140810] stroke-rose-400"
                    : "fill-[#0e0a1a] stroke-violet-400",
                )}
                strokeWidth="2"
                style={{ filter: "url(#neon-glow)" }}
              />
              <polygon
                points="0,-24 20.8,-12 20.8,12 0,24 -20.8,12 -20.8,-12"
                fill="rgba(10,10,16,0.9)"
                stroke={burstActive ? "rgba(255,35,87,0.4)" : "rgba(141,84,255,0.35)"}
                strokeWidth="1"
              />
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
                className="font-mono fill-violet-300 text-[8.5px]"
              >
                10.0.0.1
              </text>
            </g>
          </svg>
        </div>

        {/* Right Column: Destination R1 Node */}
        <div className="rounded-2xl border border-white/10 bg-[#090a10] p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Destination
            </span>
            <span className="size-2 rounded-full bg-violet-400 animate-pulse" />
          </div>

          <div className="mt-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-white">R1</span>
              <span className="font-mono text-[10px] text-violet-300">10.0.0.10</span>
            </div>
            <div className="mt-1 text-[10.5px] text-slate-400">Egress Receiver</div>
          </div>

          {/* Queue pressure meter */}
          <div className="mt-3 border-t border-white/5 pt-2.5">
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-400">Queue pressure</span>
              <span className={burstActive ? "font-semibold text-rose-400" : "text-emerald-400"}>
                {burstActive ? "82% (peak)" : "14% (safe)"}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  burstActive
                    ? "w-[82%] bg-gradient-to-r from-amber-400 to-rose-500 shadow-[0_0_8px_rgba(255,35,87,0.7)]"
                    : "w-[14%] bg-gradient-to-r from-violet-400 to-emerald-400",
                )}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Controls Bar at Bottom of Visualizer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-400">Try live state:</span>
          <button
            type="button"
            onClick={onTriggerBurst}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all",
              burstActive
                ? "border-rose-500/50 bg-rose-500/20 text-rose-300 shadow-[0_0_12px_rgba(255,35,87,0.3)]"
                : "border-white/10 bg-white/5 text-slate-300 hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-white",
            )}
          >
            <Flame className="size-3.5 text-rose-400" />
            {burstActive ? "Burst Injected (H3 Active)" : "Simulate Microburst"}
          </button>
          {burstActive && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <RotateCcw className="size-3" />
              Reset
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10.5px] font-mono text-slate-400">
          <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#00d294] animate-ping" />
          <span>Real project telemetry pipeline</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ main page */

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const { snapshot, start, simulateBurst, reset } = useMonitoring();

  const primaryHref = isAuthenticated ? "/dashboard" : "/auth?returnTo=/dashboard";
  const primaryLabel = isAuthenticated ? "Open the console" : "Launch Console";

  const [heroBurstManual, setHeroBurstManual] = useState(false);
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

  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const filteredEvents = useMemo(() => {
    if (severityFilter === "all") return snapshot.events.slice(-6).reverse();
    return snapshot.events
      .filter((e) => e.severity === severityFilter)
      .slice(-6)
      .reverse();
  }, [snapshot.events, severityFilter]);

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <div className="dark min-h-screen star-canvas text-[#fafafa] selection:bg-violet-500/30 selection:text-white antialiased overflow-x-hidden">
      {/* ------------------------------------------------------------------
          A. FLOATING PILL NAVBAR (MATCHING SCREENSHOT 1 & 2)
      ------------------------------------------------------------------- */}
      <header className="fixed top-4 inset-x-0 z-50 mx-auto max-w-5xl px-4 pointer-events-none">
        <div className="floating-pill-nav pointer-events-auto flex items-center justify-between px-5 py-2.5 sm:px-6">
          {/* Logo & Brand */}
          <Link to="/" className="flex items-center gap-2.5 group">
            <MHMark className="size-7" active />
            <span className="text-[14px] font-bold tracking-tight text-white">
              Microburst<span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">Hunter</span>
            </span>
          </Link>

          {/* Section Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-[13px] font-medium text-slate-300">
            <a href="#features" className="hover:text-white transition-colors">
              Workflow
            </a>
            <a href="#architecture" className="hover:text-white transition-colors">
              Architecture
            </a>
            <a href="#comparison" className="hover:text-white transition-colors">
              Comparison
            </a>
            <a href="#detection" className="hover:text-white transition-colors">
              Detection
            </a>
            <a href="#experiments" className="hover:text-white transition-colors">
              Demo
            </a>
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center gap-3">
            <Link
              to="/auth"
              className="text-xs font-medium text-slate-300 hover:text-white transition-colors hidden sm:inline"
            >
              Log in
            </Link>

            <Link
              to={primaryHref}
              className="gradient-button text-white text-xs font-semibold px-4 py-2 gap-1.5 shadow-[0_0_20px_-3px_rgba(141,84,255,0.4)]"
            >
              <Sparkles className="size-3 text-amber-300" />
              <span>{primaryLabel}</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="relative pt-24">
        {/* ------------------------------------------------------------------
            B. HERO SECTION
        ------------------------------------------------------------------- */}
        <section className="relative min-h-[640px] pt-8 pb-20 lg:pt-14 lg:pb-28 overflow-hidden">
          {/* Ambient Radial Lights */}
          <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 size-[600px] rounded-full bg-violet-600/15 blur-[140px]" />
          <div className="pointer-events-none absolute top-1/3 -right-20 size-[450px] rounded-full bg-fuchsia-600/10 blur-[130px]" />

          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
              {/* Left Column */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="lg:col-span-6 xl:col-span-6"
              >
                {/* Eyebrow Pearl Badge */}
                <div className="pearl-badge px-3.5 py-1 text-xs gap-2 mb-6">
                  <span className="size-2 rounded-full bg-violet-400 shadow-[0_0_6px_#a685ff] animate-pulse" />
                  <span className="font-medium text-slate-200">Sub-millisecond data center network observability</span>
                </div>

                {/* Main Headline */}
                <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-[54px] leading-[1.08]">
                  Catch the burst <br />
                  <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-indigo-300 bg-clip-text text-transparent">
                    before the buffer does
                  </span>
                  <span className="text-violet-400 font-mono animate-pulse">.</span>
                </h1>

                {/* Description */}
                <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-slate-300">
                  MicroburstHunter detects, attributes and mitigates sub-millisecond traffic spikes
                  with real-time sliding-window analysis, adaptive rate-capping and reproducible experiments —
                  all in one deterministic telemetry model.
                </p>

                {/* CTAs */}
                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <Link
                    to={primaryHref}
                    className="gradient-button text-white text-sm font-semibold px-6 py-3.5 gap-2.5 shadow-[0_0_30px_rgba(141,84,255,0.4)] transition-transform hover:scale-[1.02]"
                  >
                    <Play className="size-4 fill-white" />
                    <span>{primaryLabel}</span>
                    <ArrowRight className="size-4" />
                  </Link>

                  <a
                    href="#detection"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 px-5 py-3.5 text-sm font-medium text-white backdrop-blur-md transition-all hover:border-violet-500/40"
                  >
                    <Code2 className="size-4 text-violet-400" />
                    <span>Detection Engine</span>
                  </a>
                </div>

                {/* Metrics & Specs Bar */}
                <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-white/10 pt-6">
                  {SPECS.map((spec) => (
                    <div
                      key={spec.label}
                      className="rounded-2xl border border-white/10 bg-[#0c0d16] p-3.5 backdrop-blur-md transition-all hover:border-violet-500/30"
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

              {/* Right Column: Visualizer */}
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
            C. 3 SIGNATURE CAPABILITY CARDS (SCREENSHOT 1 REFERENCE)
        ------------------------------------------------------------------- */}
        <section id="features" className="relative border-y border-white/10 bg-[#08080d]/80 py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <div className="pearl-badge px-3.5 py-1 text-xs text-violet-300 mb-3">
                MISSION-CRITICAL WORKFLOW
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Engineered for High-Velocity Switching Fabrics
              </h2>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                From sub-millisecond detection to per-source attribution and autonomous kernel mitigation.
              </p>
            </div>

            {/* 3 Cards Matching Screenshot 1 Layout & Appearance */}
            <div className="mt-14 grid gap-6 lg:grid-cols-3">
              {/* Card 1: Sub-Millisecond Detection */}
              <div className="saleshook-card p-8 flex flex-col justify-between">
                <div>
                  <div className="size-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <Wrench className="size-5 text-white" />
                  </div>

                  <h3 className="mt-6 text-xl font-bold text-white tracking-tight">
                    Sub-Millisecond Detection
                  </h3>
                  <p className="mt-2.5 text-sm text-slate-400 leading-relaxed">
                    From 10ms sliding windows to EWMA rolling baselines — declare bursts precisely with zero false positives.
                  </p>

                  <ul className="mt-6 space-y-3 text-sm text-slate-300">
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-violet-400 shrink-0" />
                      <span>10 ms deterministic sliding windows</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-violet-400 shrink-0" />
                      <span>Continuous EWMA baseline computation</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-violet-400 shrink-0" />
                      <span>Dual-persistence confirmation gate</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-violet-400 shrink-0" />
                      <span>SQLite-persisted event timeline</span>
                    </li>
                  </ul>
                </div>

                <div className="mt-8 pt-6 border-t border-white/5">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-sm text-violet-300">
                    ⚡ 90% faster than SNMP polling
                  </span>
                </div>
              </div>

              {/* Card 2: Real-Time Attribution (Featured with Signature Violet Glow) */}
              <div className="saleshook-card-featured p-8 flex flex-col justify-between">
                <div>
                  <div className="size-12 rounded-2xl bg-violet-500/20 border border-violet-500/40 flex items-center justify-center shadow-[0_0_15px_rgba(141,84,255,0.3)]">
                    <Briefcase className="size-5 text-violet-300" />
                  </div>

                  <h3 className="mt-6 text-xl font-bold text-white tracking-tight">
                    Attribution & Forensics
                  </h3>
                  <p className="mt-2.5 text-sm text-slate-300 leading-relaxed">
                    Per-source volume attribution inside the burst interval. Quantify offender throughput without misidentifying innocent flows.
                  </p>

                  <ul className="mt-6 space-y-3 text-sm text-slate-200">
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-fuchsia-400 shrink-0" />
                      <span>Byte-share ranking inside burst interval</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-fuchsia-400 shrink-0" />
                      <span>Deterministic host attribution (H1–H4)</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-fuchsia-400 shrink-0" />
                      <span>Instant offender isolation under 20ms</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-fuchsia-400 shrink-0" />
                      <span>Zero disruption to compliant senders</span>
                    </li>
                  </ul>
                </div>

                <div className="mt-8 pt-6 border-t border-violet-500/20">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-sm bg-gradient-to-r from-fuchsia-400 to-rose-400 bg-clip-text text-transparent">
                    🎯 3x higher isolation accuracy
                  </span>
                </div>
              </div>

              {/* Card 3: Adaptive Kernel Mitigation */}
              <div className="saleshook-card p-8 flex flex-col justify-between">
                <div>
                  <div className="size-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <Monitor className="size-5 text-white" />
                  </div>

                  <h3 className="mt-6 text-xl font-bold text-white tracking-tight">
                    Adaptive Kernel Mitigation
                  </h3>
                  <p className="mt-2.5 text-sm text-slate-400 leading-relaxed">
                    Autonomous Linux TC token-bucket rate limiting with flower classifiers, dry-run safety gating, and automatic recovery.
                  </p>

                  <ul className="mt-6 space-y-3 text-sm text-slate-300">
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-violet-400 shrink-0" />
                      <span>Microsecond HTB token-bucket enforcement</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-violet-400 shrink-0" />
                      <span>Mode A host-safe dry-run protection</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-violet-400 shrink-0" />
                      <span>Targeted throttles; zero collateral loss</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 text-violet-400 shrink-0" />
                      <span>Autonomous quiet-window recovery watchdog</span>
                    </li>
                  </ul>
                </div>

                <div className="mt-8 pt-6 border-t border-white/5">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-sm text-amber-300">
                    ✨ Active in under 2 ms
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            D. BEFORE VS. AFTER & ARCHITECTURE FLOW (SCREENSHOT 3 REFERENCE)
        ------------------------------------------------------------------- */}
        <section id="architecture" className="relative py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
              {/* Left Column: Before vs After Card Container */}
              <div className="lg:col-span-6">
                <div className="pearl-badge px-3.5 py-1 text-xs text-violet-300 mb-4">
                  BEFORE VS. AFTER
                </div>

                <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                  Adaptive mitigation vs. queue collapse
                </h2>

                <div className="mt-8 space-y-4">
                  {/* Top: Unmitigated Surge (Red Tint) */}
                  <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6 backdrop-blur-md">
                    <h3 className="text-base font-bold text-rose-400">
                      Unmitigated Buffer Exhaustion
                    </h3>
                    <ul className="mt-4 space-y-2.5 text-xs sm:text-sm text-slate-300 font-mono">
                      <li className="flex items-start gap-2">
                        <span className="text-rose-400 font-bold">&gt;</span>
                        <span>30–60 ms tail latency spikes across switch egress queues</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-rose-400 font-bold">&gt;</span>
                        <span>Indiscriminate tail drops hit innocent mice and elephant flows</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-rose-400 font-bold">&gt;</span>
                        <span>TCP timeouts, throughput collapse and severe SLA breaches</span>
                      </li>
                    </ul>
                  </div>

                  {/* Bottom: With MicroburstHunter (Violet Tint) */}
                  <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-6 backdrop-blur-md shadow-[0_0_30px_rgba(141,84,255,0.08)]">
                    <h3 className="text-base font-bold text-violet-400">
                      With MicroburstHunter
                    </h3>
                    <ul className="mt-4 space-y-2.5 text-xs sm:text-sm text-slate-200 font-mono">
                      <li className="flex items-start gap-2">
                        <span className="text-violet-400 font-bold">&gt;</span>
                        <span>Sub-20ms detection with sliding baseline qualification</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-violet-400 font-bold">&gt;</span>
                        <span>Targeted HTB rate-capping applied strictly to offending flow</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-violet-400 font-bold">&gt;</span>
                        <span>Zero innocent packet drops; compliant flows run full speed</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-violet-400 font-bold">&gt;</span>
                        <span>Automatic recovery after 3 consecutive quiet windows</span>
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="mt-8">
                  <Link
                    to={primaryHref}
                    className="gradient-button text-white text-xs font-semibold px-6 py-3 gap-2 shadow-[0_0_20px_rgba(141,84,255,0.35)]"
                  >
                    <span>Launch Live Console</span>
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              </div>

              {/* Right Column: Architectural Node Flow Diagram (Matching Screenshot 3) */}
              <div className="lg:col-span-6 flex justify-center">
                <div className="relative w-full max-w-md flex flex-col items-center">
                  {/* Top Node: Core Engine */}
                  <div className="gradient-button text-white text-xs font-semibold px-6 py-2.5 rounded-full shadow-[0_0_25px_rgba(141,84,255,0.5)] border border-violet-400/40">
                    <div className="flex items-center gap-2">
                      <MHMark className="size-4" active />
                      <span>MicroburstHunter Engine</span>
                    </div>
                  </div>

                  {/* SVG Connecting Curves */}
                  <svg className="w-full h-14 overflow-visible" viewBox="0 0 320 56">
                    <path
                      d="M 160 0 C 160 30, 80 20, 80 56"
                      fill="none"
                      stroke="#8d54ff"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      className="mbh-flow"
                    />
                    <path
                      d="M 160 0 C 160 30, 240 20, 240 56"
                      fill="none"
                      stroke="#8d54ff"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      className="mbh-flow"
                    />
                  </svg>

                  {/* Intermediate Row Nodes */}
                  <div className="grid grid-cols-2 gap-4 w-full">
                    <div className="rounded-xl border border-white/10 bg-[#0e0f17] p-3 text-center shadow-lg">
                      <div className="text-[10px] font-mono text-slate-400">DATABASE</div>
                      <div className="text-xs font-bold text-white mt-0.5">SQLite / Store</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#0e0f17] p-3 text-center shadow-lg">
                      <div className="text-[10px] font-mono text-slate-400">OFFLOAD</div>
                      <div className="text-xs font-bold text-violet-300 mt-0.5">Linux TC Engine</div>
                    </div>
                  </div>

                  {/* Downward Curve */}
                  <svg className="w-full h-10 overflow-visible" viewBox="0 0 320 40">
                    <path
                      d="M 80 0 C 80 25, 160 15, 160 40"
                      fill="none"
                      stroke="#8d54ff"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      className="mbh-flow"
                    />
                    <path
                      d="M 240 0 C 240 25, 160 15, 160 40"
                      fill="none"
                      stroke="#8d54ff"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      className="mbh-flow"
                    />
                  </svg>

                  {/* Middle Node: Ingress Telemetry & Detection */}
                  <div className="w-full rounded-2xl border border-white/10 bg-gradient-to-b from-[#141624] to-[#0c0d16] p-4 text-center shadow-xl">
                    <div className="flex items-center justify-center gap-2">
                      <Activity className="size-4 text-violet-400" />
                      <span className="text-sm font-bold text-white">10ms Sliding Telemetry</span>
                    </div>
                    <div className="mt-1 text-[11px] font-mono text-slate-400">
                      EWMA ROLLING BASELINE · PERSISTENCE GATE
                    </div>
                  </div>

                  {/* Downward Curve */}
                  <svg className="w-full h-10 overflow-visible" viewBox="0 0 320 40">
                    <path
                      d="M 160 0 L 160 40"
                      fill="none"
                      stroke="#8d54ff"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      className="mbh-flow"
                    />
                  </svg>

                  {/* Lower Node: Attribution & Mitigation */}
                  <div className="w-full rounded-2xl border border-violet-500/30 bg-gradient-to-b from-[#161226] to-[#0d0a17] p-4 text-center shadow-xl">
                    <div className="flex items-center justify-center gap-2">
                      <ShieldCheck className="size-4 text-rose-400" />
                      <span className="text-sm font-bold text-white">Attribution & Rate Cap</span>
                    </div>
                    <div className="mt-1 text-[11px] font-mono text-rose-300">
                      ≈ 20 MS DETECTION · HTB FLOW LIMITER
                    </div>
                  </div>

                  {/* Conduits to Hosts */}
                  <svg className="w-full h-12 overflow-visible" viewBox="0 0 320 48">
                    <path d="M 160 0 C 160 25, 40 20, 40 48" fill="none" stroke="#625fff" strokeWidth="1.5" strokeDasharray="3 3" className="mbh-flow" />
                    <path d="M 160 0 C 160 25, 120 20, 120 48" fill="none" stroke="#625fff" strokeWidth="1.5" strokeDasharray="3 3" className="mbh-flow" />
                    <path d="M 160 0 C 160 25, 200 20, 200 48" fill="none" stroke="#ff2357" strokeWidth="2" strokeDasharray="3 3" className="mbh-flow" />
                    <path d="M 160 0 C 160 25, 280 20, 280 48" fill="none" stroke="#625fff" strokeWidth="1.5" strokeDasharray="3 3" className="mbh-flow" />
                  </svg>

                  {/* Bottom Host Nodes */}
                  <div className="grid grid-cols-4 gap-2 w-full text-center">
                    <span className="rounded-full border border-white/10 bg-[#0e0f17] px-2.5 py-1 text-xs font-mono text-slate-300">Host H1</span>
                    <span className="rounded-full border border-white/10 bg-[#0e0f17] px-2.5 py-1 text-xs font-mono text-slate-300">Host H2</span>
                    <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-mono font-bold text-rose-300 shadow-[0_0_10px_rgba(255,35,87,0.3)]">H3 (Offender)</span>
                    <span className="rounded-full border border-white/10 bg-[#0e0f17] px-2.5 py-1 text-xs font-mono text-slate-300">Host H4</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            E. COMPARISON MATRIX TABLE (SCREENSHOT 2 REFERENCE)
        ------------------------------------------------------------------- */}
        <section id="comparison" className="relative border-y border-white/10 bg-[#08080d]/80 py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <div className="pearl-badge px-3.5 py-1 text-xs text-violet-300 mb-3">
                CAPABILITY MATRIX
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                MicroburstHunter is the platform that runs the whole process
              </h2>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                From raw packet capture to sliding-window attribution and kernel rate-capping.
              </p>
            </div>

            {/* Matrix Table Container */}
            <div className="mt-14 overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0a] shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs font-semibold">
                      <th className="p-4 sm:p-5 text-slate-400">Capability</th>
                      <th className="p-4 sm:p-5 bg-violet-950/25 text-violet-300 font-bold border-x border-violet-500/30 text-center">
                        MicroburstHunter
                      </th>
                      <th className="p-4 sm:p-5 text-slate-400 text-center">SNMP & Polling</th>
                      <th className="p-4 sm:p-5 text-slate-400 text-center">NetFlow / sFlow</th>
                      <th className="p-4 sm:p-5 text-slate-400 text-center">Buffer Tail Drops</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs font-mono">
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 sm:p-5 text-slate-200 font-sans font-medium">Detection under 20 milliseconds</td>
                      <td className="p-4 sm:p-5 bg-violet-950/20 border-x border-violet-500/20 text-center text-violet-400 font-bold text-base">●</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                      <td className="p-4 sm:p-5 text-slate-400 text-center">Rarely</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 sm:p-5 text-slate-200 font-sans font-medium">10ms high-resolution window analysis</td>
                      <td className="p-4 sm:p-5 bg-violet-950/20 border-x border-violet-500/20 text-center text-violet-400 font-bold text-base">●</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                      <td className="p-4 sm:p-5 text-slate-400 text-center">Sampled 1:1000</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 sm:p-5 text-slate-200 font-sans font-medium">Per-source byte share attribution</td>
                      <td className="p-4 sm:p-5 bg-violet-950/20 border-x border-violet-500/20 text-center text-violet-400 font-bold text-base">●</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                      <td className="p-4 sm:p-5 text-slate-400 text-center">Delayed</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 sm:p-5 text-slate-200 font-sans font-medium">Autonomous adaptive mitigation (Linux TC)</td>
                      <td className="p-4 sm:p-5 bg-violet-950/20 border-x border-violet-500/20 text-center text-violet-400 font-bold text-base">●</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                      <td className="p-4 sm:p-5 text-slate-400 text-center">Indiscriminate</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 sm:p-5 text-slate-200 font-sans font-medium">Protection of innocent flows (Zero collateral loss)</td>
                      <td className="p-4 sm:p-5 bg-violet-950/20 border-x border-violet-500/20 text-center text-violet-400 font-bold text-base">●</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 sm:p-5 text-slate-200 font-sans font-medium">Host-safe Mode A dry-run execution</td>
                      <td className="p-4 sm:p-5 bg-violet-950/20 border-x border-violet-500/20 text-center text-violet-400 font-bold text-base">●</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                      <td className="p-4 sm:p-5 text-slate-500 text-center">—</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 sm:p-5 text-slate-200 font-sans font-medium">Detection latency benchmark</td>
                      <td className="p-4 sm:p-5 bg-violet-950/20 border-x border-violet-500/20 text-center text-white font-bold">10 – 20 ms</td>
                      <td className="p-4 sm:p-5 text-slate-400 text-center">10 – 60 seconds</td>
                      <td className="p-4 sm:p-5 text-slate-400 text-center">1 – 5 minutes</td>
                      <td className="p-4 sm:p-5 text-slate-400 text-center">Reactive</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 sm:p-5 text-slate-200 font-sans font-medium">Telemetry overhead</td>
                      <td className="p-4 sm:p-5 bg-violet-950/20 border-x border-violet-500/20 text-center text-emerald-400 font-bold">Zero-copy</td>
                      <td className="p-4 sm:p-5 text-slate-400 text-center">High CPU Poll</td>
                      <td className="p-4 sm:p-5 text-slate-400 text-center">Flow Export Load</td>
                      <td className="p-4 sm:p-5 text-slate-400 text-center">Buffer Drop Loss</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Matrix Footer Note */}
              <div className="border-t border-white/5 bg-black/40 p-4 text-[11px] font-mono text-slate-500 text-center">
                Feature comparison MicroburstHunter vs. standard SNMP/sFlow and hardware buffer drop mechanisms based on data center testbed measurements.
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            F. DETECTION ENGINE & MATHEMATICAL FORMULATION
        ------------------------------------------------------------------- */}
        <section id="detection" className="relative py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-10">
              <div className="lg:col-span-6">
                <div className="pearl-badge px-3 py-1 text-xs text-violet-300 mb-3">
                  DETECTION ENGINE
                </div>
                <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                  A threshold that adapts, then persists.
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-slate-300">
                  Each window converts observed bytes into a rate and compares it against the higher
                  of the absolute minimum and the rolling baseline multiplied by the configured
                  factor. A burst is declared only after qualifying for consecutive persistence
                  windows — and ends only after sustained quiet.
                </p>

                {/* Mathematical Formula Terminal Box */}
                <div className="mt-7 rounded-2xl border border-white/10 bg-[#0c0d16] p-5 shadow-2xl backdrop-blur-md">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="size-2.5 rounded-full bg-rose-500" />
                      <div className="size-2.5 rounded-full bg-amber-500" />
                      <div className="size-2.5 rounded-full bg-emerald-500" />
                      <span className="ml-2 font-mono text-[11px] text-slate-400">
                        engine/detector.py
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-violet-400">Sub-RTT Formula</span>
                  </div>

                  <pre className="mt-4 overflow-x-auto font-mono text-xs sm:text-[12.5px] leading-6 text-slate-200">
                    <span className="text-violet-400">rateMbps</span> = bytes × 8 ÷ (windowMs ÷
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
                  <div className="rounded-xl border border-white/10 bg-[#0e0f18] p-2.5">
                    <div className="text-[10px] text-slate-400">EWMA ALPHA</div>
                    <div className="text-violet-400 font-bold">α = 0.1</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#0e0f18] p-2.5">
                    <div className="text-[10px] text-slate-400">PERSISTENCE</div>
                    <div className="text-fuchsia-400 font-bold">2 windows</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#0e0f18] p-2.5">
                    <div className="text-[10px] text-slate-400">RECOVERY</div>
                    <div className="text-emerald-400 font-bold">3 windows</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#0e0f18] p-2.5">
                    <div className="text-[10px] text-slate-400">WATCHDOG</div>
                    <div className="text-amber-400 font-bold">250 ms max</div>
                  </div>
                </div>
              </div>

              {/* Operational Rules */}
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
                    color: "text-violet-400",
                    border: "border-violet-500/20",
                    title: "No fabricated live status",
                    body: "The browser build executes simulated experiments in-memory and says so on every screen. Live raw capture requires the separate Python/Scapy backend running on Linux with CAP_NET_RAW.",
                  },
                  {
                    icon: Timer,
                    color: "text-fuchsia-400",
                    border: "border-fuchsia-500/20",
                    title: "Configurable, not universal",
                    body: "10 ms, 80 Mbps and ×3 are educational defaults chosen to make a microburst clearly visible on standard hardware — not an immutable physics constant.",
                  },
                ].map((note) => (
                  <div
                    key={note.title}
                    className={cn(
                      "rounded-2xl border bg-[#0c0d16] p-5 backdrop-blur-md transition-all hover:border-violet-500/30",
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
            G. PROMOTION CTA BANNER
        ------------------------------------------------------------------- */}
        <section className="relative py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="pearl-panel relative overflow-hidden rounded-3xl border border-violet-500/30 p-8 lg:p-14 shadow-[0_0_50px_rgba(141,84,255,0.18)]">
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

                <Link
                  to={primaryHref}
                  className="gradient-button text-white text-sm font-semibold px-8 py-4 gap-2.5 shadow-[0_0_30px_rgba(141,84,255,0.45)] transition-transform hover:scale-105 shrink-0"
                >
                  <span>{primaryLabel}</span>
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------------
          H. FOOTER
      ------------------------------------------------------------------- */}
      <footer className="border-t border-white/10 bg-[#050508] py-12 text-xs text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-12">
            <div className="md:col-span-5">
              <div className="flex items-center gap-2.5">
                <MHMark className="size-6" active />
                <span className="text-sm font-bold tracking-tight text-white">
                  Microburst<span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Hunter</span>
                </span>
              </div>
              <p className="mt-3 max-w-sm text-slate-400 leading-relaxed text-[12.5px]">
                Sub-millisecond software telemetry, sliding-window detection, source attribution,
                and adaptive traffic-control pipeline for high-speed networks.
              </p>
              <div className="mt-4 font-mono text-[11px] text-violet-400">
                Computer Networks Coursework · Academic Research Project
              </div>
            </div>

            <div className="md:col-span-3 space-y-2">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Navigation
              </div>
              <ul className="space-y-1.5 text-[12.5px]">
                <li><a href="#features" className="hover:text-white transition-colors">Workflow</a></li>
                <li><a href="#architecture" className="hover:text-white transition-colors">Architecture</a></li>
                <li><a href="#comparison" className="hover:text-white transition-colors">Comparison</a></li>
                <li><a href="#detection" className="hover:text-white transition-colors">Detection Engine</a></li>
                <li><Link to="/dashboard" className="hover:text-white transition-colors">Console</Link></li>
              </ul>
            </div>

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
                <code className="text-violet-300">mbh_ns_test</code>.
              </p>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/5 pt-6 text-[11px] font-mono text-slate-500">
            <span>© 2026 MicroburstHunter. Built as an instrument, not a dashboard.</span>
            <span>Deterministic seed 1337 · Sliding window 10 ms · EWMA α=0.1</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
