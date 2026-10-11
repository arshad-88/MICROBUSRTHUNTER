import { motion } from "framer-motion";
import { Link } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { MHMark } from "@/components/Wordmark";
import {
  Activity,
  ArrowRight,
  FlaskConical,
  Gauge,
  Network,
  ScrollText,
  ShieldCheck,
  Share2,
  Timer,
  Waves,
  Zap,
} from "lucide-react";

const CAPABILITIES = [
  {
    icon: Waves,
    title: "Detector that actually decides",
    body: "Rolling baseline, absolute minimum rate and a baseline multiplier combined with persistence, cooldown and recovery windows — a burst is declared only when the measurement justifies it.",
  },
  {
    icon: Network,
    title: "Fabric plane, not a diagram",
    body: "A patch-panel map where stroke weight follows the measured rate, colour follows detector state, and each port reports its own counters and enforced policy.",
  },
  {
    icon: Share2,
    title: "Attribution without accusation",
    body: "Rank sources by their byte share inside the burst window, with per-source history and recent events. Volume is reported as volume — never as intent.",
  },
  {
    icon: ShieldCheck,
    title: "Cause and effect on the policy",
    body: "Detection → attribution → policy → cap → verification → recovery, with a before/after comparison computed on the same model the charts use.",
  },
  {
    icon: FlaskConical,
    title: "Reproducible experiments",
    body: "Three seeded scenarios — normal, burst, burst with adaptive mitigation — stored and exportable so a reviewer can compare numbers rather than trust a screenshot.",
  },
  {
    icon: ScrollText,
    title: "Auditable event timeline",
    body: "Every detection, policy change, recovery and failure is recorded verbatim and exported to CSV for the project review.",
  },
];

const SPECS = [
  { label: "Sampling window", value: "10", unit: "ms" },
  { label: "Minimum rate", value: "80", unit: "Mbps" },
  { label: "Baseline multiplier", value: "×3", unit: "" },
  { label: "Deterministic seed", value: "1337", unit: "" },
];

function HeroFabric() {
  const ports = [
    { y: 66, label: "H1", burst: false },
    { y: 150, label: "H2", burst: false },
    { y: 234, label: "H3", burst: true },
  ];
  const hex = `300,${150 - 46} ${300 + 39.8},${150 - 23} ${300 + 39.8},${150 + 23} 300,${150 + 46} ${300 - 39.8},${150 + 23} ${300 - 39.8},${150 - 23}`;
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-[oklch(0.145_0.014_262)] panel-edge">
      <div className="fabric-grid-fine">
        <svg viewBox="0 0 520 320" className="h-auto w-full" role="img" aria-label="Fabric plane with one source emitting a microburst">
          <defs>
            <linearGradient id="hero-burst" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--chart-5)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--burst)" stopOpacity="1" />
            </linearGradient>
          </defs>

          <text x="34" y="30" className="label-caps fill-muted-foreground/50 text-[9px]">
            source bank
          </text>
          <text x="300" y="82" textAnchor="middle" className="label-caps fill-muted-foreground/50 text-[9px]">
            aggregation
          </text>
          <text x="440" y="90" textAnchor="middle" className="label-caps fill-muted-foreground/50 text-[9px]">
            destination
          </text>

          {ports.map((port) => {
            const d = `M 150 ${port.y} C 210 ${port.y}, 226 ${150}, 260.2 ${150}`;
            return (
              <g key={port.label}>
                <path d={d} fill="none" strokeWidth={1} className="stroke-border/70" />
                <path
                  d={d}
                  fill="none"
                  strokeWidth={port.burst ? 3.4 : 2}
                  strokeLinecap="round"
                  className={port.burst ? "stroke-burst mbh-flow" : "stroke-primary/80 mbh-flow"}
                  style={{ animationDuration: port.burst ? "0.7s" : "1.4s" }}
                />
              </g>
            );
          })}

          {/* uplink */}
          <path d="M 339.8 150 L 388 150" fill="none" strokeWidth={7} className="stroke-border/70" />
          <path
            d="M 339.8 150 L 388 150"
            fill="none"
            strokeWidth={4}
            strokeLinecap="round"
            className="stroke-warning mbh-flow"
          />

          {/* source ports */}
          {ports.map((port) => (
            <g key={`p-${port.label}`}>
              <rect
                x={40}
                y={port.y - 22}
                width={110}
                height={44}
                rx={3}
                className="fill-surface stroke-border"
                strokeWidth={1}
              />
              <rect
                x={40}
                y={port.y - 22}
                width={3}
                height={44}
                rx={1.5}
                className={port.burst ? "fill-burst" : "fill-primary"}
              />
              <text x={52} y={port.y - 4} className="fill-foreground text-[11px] font-semibold">
                {port.label}
              </text>
              <text
                x={52}
                y={port.y + 10}
                className={
                  port.burst
                    ? "data-mono fill-burst text-[9px]"
                    : "data-mono fill-muted-foreground text-[9px]"
                }
              >
                {port.burst ? "214.6 Mbps" : port.label === "H1" ? "18.2 Mbps" : "14.4 Mbps"}
              </text>
            </g>
          ))}

          {/* switch */}
          <polygon points={hex} className="fill-surface stroke-border" strokeWidth={1.2} />
          <polygon
            points="300,118 327.7,134 327.7,166 300,182 272.3,166 272.3,134"
            className="fill-none stroke-border/70"
            strokeWidth={1}
          />
          <text x={300} y={146} textAnchor="middle" className="fill-foreground text-[12px] font-semibold">
            S1
          </text>
          <text x={300} y={160} textAnchor="middle" className="data-mono fill-muted-foreground text-[8px]">
            10.0.0.1
          </text>

          {/* destination */}
          <rect x={388} y={112} width={104} height={76} rx={3} className="fill-surface stroke-border" strokeWidth={1.2} />
          <rect x={388} y={112} width={104} height={16} rx={3} className="fill-surface-2" />
          <text x={396} y={135} className="fill-foreground text-[11px] font-semibold">
            R1
          </text>
          <text x={396} y={148} className="data-mono fill-muted-foreground text-[8px]">
            10.0.0.10
          </text>
          <rect x={396} y={158} width={88} height={4} rx={2} className="fill-muted/70" />
          <rect x={396} y={158} width={72} height={4} rx={2} className="fill-burst" />
          <text x={396} y={178} className="data-mono fill-muted-foreground text-[8px]">
            queue pressure
          </text>
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-2.5">
        <span className="flex items-center gap-2">
          <Zap className="size-3.5 text-burst" />
          <span className="label-caps text-burst">microburst detected</span>
        </span>
        <span className="data-mono text-[10.5px] text-muted-foreground">
          H3 · 10.0.1.13 · 214.6 Mbps vs 96.0 Mbps threshold
        </span>
        <span className="label-caps ml-auto rounded-sm border border-warning/40 bg-warning/[0.08] px-2 py-[3px] text-warning">
          cap 35 Mbps enforced
        </span>
      </div>
    </div>
  );
}

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const primaryHref = isAuthenticated ? "/dashboard" : "/auth?returnTo=/dashboard";
  const primaryLabel = isAuthenticated ? "Open the console" : "Launch the console";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1180px] items-center gap-4 px-4 py-3 lg:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <MHMark className="size-7" active />
            <span className="text-[13px] font-semibold tracking-tight">
              Microburst<span className="text-primary">Hunter</span>
            </span>
          </Link>
          <nav className="ml-4 hidden items-center gap-6 text-[11.5px] text-muted-foreground md:flex">
            <a href="#capabilities" className="transition-colors hover:text-foreground">
              Capabilities
            </a>
            <a href="#detection" className="transition-colors hover:text-foreground">
              Detection
            </a>
            <a href="#experiments" className="transition-colors hover:text-foreground">
              Experiments
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="label-caps hidden rounded-sm border border-border bg-surface px-2 py-[5px] text-muted-foreground lg:inline">
              Computer Networks coursework
            </span>
            <Button asChild size="sm" className="gap-1.5 rounded-sm">
              <Link to={primaryHref}>
                {primaryLabel}
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* ------------------------------- hero ------------------------------- */}
        <section className="mx-auto max-w-[1180px] px-4 pb-14 pt-12 lg:px-6 lg:pb-20 lg:pt-16">
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-14">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
            >
              <span className="flex items-center gap-2">
                <span className="h-[2px] w-6 bg-primary" />
                <span className="label-caps text-muted-foreground">
                  microburst observability
                </span>
              </span>
              <h1 className="mt-5 text-[38px] font-semibold leading-[1.08] tracking-tight lg:text-[50px]">
                Catch the burst
                <br />
                before the buffer does.
              </h1>
              <p className="mt-5 max-w-xl text-[13.5px] leading-6 text-muted-foreground">
                MicroburstHunter is a network operations console for sub-millisecond traffic
                spikes: a real detection algorithm, source attribution inside the burst window,
                adaptive rate-cap policy with before/after verification, and reproducible
                experiments — all driven by one deterministic traffic model.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button asChild className="gap-1.5 rounded-sm">
                  <Link to={primaryHref}>
                    {primaryLabel}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="rounded-sm">
                  <a href="#detection">Read the detection engine</a>
                </Button>
              </div>

              <dl className="mt-9 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-6 sm:grid-cols-4">
                {SPECS.map((spec) => (
                  <div key={spec.label}>
                    <dt className="label-caps text-muted-foreground/70">{spec.label}</dt>
                    <dd className="readout mt-1.5 text-[19px] font-semibold text-foreground">
                      {spec.value}
                      {spec.unit && (
                        <span className="data-mono ml-1 text-[10.5px] font-normal text-muted-foreground">
                          {spec.unit}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.08 }}
            >
              <HeroFabric />
              <p className="mt-3 text-[10.5px] leading-4 text-muted-foreground/70">
                Same visual language as the console: stroke weight is the measured rate, coral is a
                detector-declared burst, amber is an enforced cap.
              </p>
            </motion.div>
          </div>
        </section>

        {/* --------------------------- capabilities --------------------------- */}
        <section id="capabilities" className="border-y border-border bg-surface/40 py-14 lg:py-16">
          <div className="mx-auto max-w-[1180px] px-4 lg:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <span className="flex items-center gap-2">
                  <span className="h-[2px] w-6 bg-primary" />
                  <span className="label-caps text-muted-foreground">capabilities</span>
                </span>
                <h2 className="mt-3 text-[26px] font-semibold tracking-tight">
                  Built as an instrument, not a dashboard
                </h2>
              </div>
              <p className="max-w-md text-[12px] leading-5 text-muted-foreground">
                Detection, attribution and mitigation run as real code against a shared state, so
                every panel agrees with every other panel.
              </p>
            </div>

            <div className="mt-9 grid gap-0 border border-border sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((item, i) => (
                <motion.article
                  key={item.title}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.3, delay: (i % 3) * 0.05 }}
                  className="border-b border-border px-5 py-6 last:border-b-0 sm:border-r lg:[&:nth-child(3n)]:border-r-0 lg:[&:nth-child(4)]:border-b-0 lg:[&:nth-child(5)]:border-b-0 lg:[&:nth-child(6)]:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <item.icon className="size-4 text-primary" />
                    <span className="data-mono text-[10px] text-muted-foreground/50">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="mt-4 text-[13.5px] font-medium tracking-tight">{item.title}</h3>
                  <p className="mt-2 text-[11.5px] leading-5 text-muted-foreground">{item.body}</p>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------------- detection ---------------------------- */}
        <section id="detection" className="mx-auto max-w-[1180px] px-4 py-14 lg:px-6 lg:py-16">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
            <div>
              <span className="flex items-center gap-2">
                <span className="h-[2px] w-6 bg-primary" />
                <span className="label-caps text-muted-foreground">detection engine</span>
              </span>
              <h2 className="mt-3 text-[26px] font-semibold tracking-tight">
                A threshold that adapts, then persists
              </h2>
              <p className="mt-4 text-[12.5px] leading-6 text-muted-foreground">
                Each window converts observed bytes into a rate and compares it against the higher
                of the absolute minimum and the rolling baseline multiplied by the configured
                factor. A burst is declared only after the qualifying condition persists for the
                configured number of windows — and only ends after sustained quiet.
              </p>

              <div className="mt-6 rounded-md border border-border bg-[oklch(0.145_0.014_262)] px-4 py-4">
                <pre className="data-mono overflow-x-auto text-[11px] leading-6 text-muted-foreground">
{`rateMbps  = bytes × 8 ÷ (windowMs ÷ 1000) ÷ 1,000,000
threshold = max(minRate, baseline × multiplier)
burst     = rate > threshold for persistence windows
recovery  = rate ≤ threshold for recovery windows`}
                </pre>
              </div>
            </div>

            <div className="space-y-3">
              {[
                {
                  icon: Gauge,
                  title: "Queue congestion is not measured",
                  body: "A rate spike is a rate measurement. Switch-buffer occupancy is a separate metric, and the console never presents the two as the same thing.",
                },
                {
                  icon: Activity,
                  title: "No fabricated live status",
                  body: "The browser build reports simulated data only and says so on every screen. Real capture requires the Python/Scapy backend.",
                },
                {
                  icon: Timer,
                  title: "Configurable, not universal",
                  body: "10 ms, 80 Mbps and ×3 are educational defaults chosen to make a microburst visible — not a universal definition of the phenomenon.",
                },
              ].map((note) => (
                <div
                  key={note.title}
                  className="rounded-md border border-border bg-surface px-4 py-3.5 panel-edge"
                >
                  <p className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
                    <note.icon className="size-3.5 text-warning" />
                    {note.title}
                  </p>
                  <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">{note.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------- experiments --------------------------- */}
        <section id="experiments" className="border-y border-border bg-surface/40 py-14 lg:py-16">
          <div className="mx-auto max-w-[1180px] px-4 lg:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <span className="flex items-center gap-2">
                  <span className="h-[2px] w-6 bg-primary" />
                  <span className="label-caps text-muted-foreground">review flow</span>
                </span>
                <h2 className="mt-3 text-[26px] font-semibold tracking-tight">
                  Three runs, one seed, comparable numbers
                </h2>
              </div>
              <p className="max-w-md text-[12px] leading-5 text-muted-foreground">
                Walk into the review with the normal case, the burst case and the mitigated burst
                side by side — exportable as CSV.
              </p>
            </div>

            <div className="mt-9 grid gap-4 md:grid-cols-3">
              {[
                {
                  id: "01",
                  title: "Normal traffic",
                  body: "Steady multi-source load with no burst. Establishes baseline rate, modelled latency and near-zero drops.",
                  tone: "text-primary",
                },
                {
                  id: "02",
                  title: "Burst, no mitigation",
                  body: "A reproducible microburst fires from the configured host. The detector declares it and traffic stays uncapped.",
                  tone: "text-burst",
                },
                {
                  id: "03",
                  title: "Burst + adaptive mitigation",
                  body: "The identical burst, but the policy caps the offending flow once detection completes. Compare peak, drops and latency.",
                  tone: "text-warning",
                },
              ].map((scenario) => (
                <div
                  key={scenario.id}
                  className="rounded-md border border-border bg-background/60 px-5 py-5 panel-edge"
                >
                  <span className={`data-mono text-[11px] ${scenario.tone}`}>{scenario.id}</span>
                  <h3 className="mt-3 text-[14px] font-medium tracking-tight">{scenario.title}</h3>
                  <p className="mt-2 text-[11.5px] leading-5 text-muted-foreground">
                    {scenario.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* -------------------------------- cta ------------------------------- */}
        <section className="mx-auto max-w-[1180px] px-4 py-16 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-md border border-border bg-surface px-6 py-8 panel-edge">
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight">
                Open the operations console
              </h2>
              <p className="mt-2 max-w-xl text-[12px] leading-5 text-muted-foreground">
                Start monitoring, inject a reproducible burst and watch the fabric plane, the
                detector, the source ranking and the mitigation policy respond together.
              </p>
            </div>
            <Button asChild size="lg" className="gap-1.5 rounded-sm">
              <Link to={primaryHref}>
                {primaryLabel}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-5 lg:px-6">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-2">
          <span className="label-caps text-muted-foreground/60">
            MicroburstHunter · Computer Networks coursework
          </span>
          <span className="text-[10.5px] text-muted-foreground/70">
            Simulated measurements in the browser · live capture and Linux{" "}
            <code className="text-muted-foreground">tc</code> shaping live in the separate Python
            backend
          </span>
        </div>
      </footer>
    </div>
  );
}
