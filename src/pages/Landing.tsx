import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  FlaskConical,
  Network,
  ScrollText,
  ShieldCheck,
  Share2,
  Waves,
  Zap,
} from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: Network,
    title: "Interactive topology",
    body: "An SVG data-center fabric where every host and link derives its state from the same window data as the charts.",
  },
  {
    icon: Waves,
    title: "Microburst detection",
    body: "A real detection algorithm: rolling baseline, absolute minimum rate and baseline multiplier, persistence and cooldown.",
  },
  {
    icon: Share2,
    title: "Source contribution",
    body: "Rank the sources responsible for a burst by measured byte share — without mislabelling legitimate bulk traffic as malicious.",
  },
  {
    icon: ShieldCheck,
    title: "Adaptive mitigation",
    body: "A rate cap applied inside the traffic model, with before/after comparison, recovery and maximum-duration safety.",
  },
  {
    icon: FlaskConical,
    title: "Reproducible experiments",
    body: "Three seeded scenarios — normal, burst, burst-with-mitigation — with exportable results and honest reporting.",
  },
  {
    icon: ScrollText,
    title: "Auditable event log",
    body: "Every detection, policy change and recovery is recorded and exportable to CSV for the project review.",
  },
];

const SCENARIOS = [
  {
    tag: "Experiment 1",
    title: "Normal traffic",
    body: "Steady multi-source load, no burst. Establishes baseline rate, latency and drop behaviour.",
  },
  {
    tag: "Experiment 2",
    title: "Burst, no mitigation",
    body: "A reproducible microburst fires; the detector records it and traffic stays uncapped.",
  },
  {
    tag: "Experiment 3",
    title: "Burst + mitigation",
    body: "The same burst as Experiment 2, but the adaptive policy caps the offending flow.",
  },
];

function HeroDiagram() {
  const nodes = [
    { x: 60, y: 50, label: "H1" },
    { x: 60, y: 130, label: "H2" },
    { x: 60, y: 210, label: "H3" },
    { x: 210, y: 130, label: "S1" },
    { x: 350, y: 130, label: "R1" },
  ];
  return (
    <div className="noc-grid rounded-xl border border-border bg-[oklch(0.14_0.02_255)] p-2">
      <svg viewBox="0 0 420 260" className="h-auto w-full">
        {[
          ["M 60 50 L 210 130", "stroke-info/50"],
          ["M 60 130 L 210 130", "stroke-info/50"],
          ["M 60 210 L 210 130", "stroke-burst"],
          ["M 210 130 L 350 130", "stroke-warning"],
        ].map(([d, cls], i) => (
          <path key={i} d={d} fill="none" strokeWidth={2} className={cls} />
        ))}
        <path d="M 60 210 L 210 130" fill="none" strokeWidth={2} className="stroke-burst mbh-flow" />
        {nodes.map((n) => (
          <g key={n.label}>
            <circle
              cx={n.x}
              cy={n.y}
              r={22}
              className={
                n.label === "H3"
                  ? "fill-burst/15 stroke-burst"
                  : "fill-card stroke-border"
              }
              strokeWidth={1.5}
            />
            <text
              x={n.x}
              y={n.y + 4}
              textAnchor="middle"
              className="fill-foreground text-[11px] font-semibold"
            >
              {n.label}
            </text>
          </g>
        ))}
        <circle r={3} className="fill-burst">
          <animateMotion dur="1.1s" repeatCount="indefinite" path="M 60 210 L 210 130" />
        </circle>
        <circle r={3} className="fill-warning">
          <animateMotion dur="1.4s" repeatCount="indefinite" path="M 210 130 L 350 130" />
        </circle>
      </svg>
    </div>
  );
}

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const primaryHref = isAuthenticated ? "/dashboard" : "/auth?returnTo=/dashboard";
  const primaryLabel = isAuthenticated ? "Open console" : "Launch the console";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary/10">
              <Network className="size-4 text-primary" />
            </span>
            <span className="text-sm font-bold tracking-tight">MicroburstHunter</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#capabilities" className="hover:text-foreground">Capabilities</a>
            <a href="#detection" className="hover:text-foreground">Detection</a>
            <a href="#experiments" className="hover:text-foreground">Experiments</a>
          </nav>
          <Button asChild size="sm" className="gap-1.5">
            <Link to={primaryHref}>
              {primaryLabel}
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 lg:grid-cols-2 lg:py-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              <Activity className="size-3.5 text-primary" />
              Computer Networks course project · working prototype
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight lg:text-5xl">
              Detect and mitigate{" "}
              <span className="text-primary">microbursts</span> in data-center networks
            </h1>
            <p className="mt-5 max-w-xl text-muted-foreground">
              MicroburstHunter is a network operations console for detecting sub-millisecond traffic
              spikes, ranking the sources responsible and applying adaptive rate limits — with a
              reproducible simulator, experiment comparison and a separate Python/Scapy toolkit for
              real capture and Linux <code className="text-foreground/90">tc</code> shaping.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild className="gap-1.5">
                <Link to={primaryHref}>
                  {primaryLabel}
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href="#detection">See the detection engine</a>
              </Button>
            </div>
            <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-border pt-6 text-sm">
              <div>
                <dt className="text-muted-foreground">Window</dt>
                <dd className="mt-0.5 text-lg font-semibold">10 ms</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Min rate</dt>
                <dd className="mt-0.5 text-lg font-semibold">80 Mbps</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Baseline ×</dt>
                <dd className="mt-0.5 text-lg font-semibold">3×</dd>
              </div>
            </dl>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <HeroDiagram />
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Burst traffic (red) on H3 triggers detection and a mitigation cap on the uplink (amber).
            </p>
          </motion.div>
        </section>

        <section id="capabilities" className="border-y border-border bg-card/40 py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold tracking-tight">What the console does</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Not a static dashboard: the detection, ranking and mitigation run as real code against
              a shared simulation state.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35 }}
                  className="rounded-lg border border-border bg-card p-5"
                >
                  <feature.icon className="size-5 text-primary" />
                  <h3 className="mt-3 text-sm font-semibold tracking-tight">{feature.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{feature.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section id="detection" className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">A real detection algorithm</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Each sampling window collects bytes and converts them to a rate. A burst is declared
                only when the measured rate exceeds both the absolute minimum and the rolling
                baseline multiplied by the configured factor, and persists for several consecutive
                windows. Recovery and cooldown rules end the event.
              </p>
              <div className="mt-6 rounded-lg border border-border bg-[oklch(0.15_0.02_255)] p-4 font-mono text-xs text-muted-foreground">
                rateMbps = bytes × 8 ÷ (windowMs / 1000) ÷ 1,000,000
                <br />
                <span className="text-primary">threshold</span> = max(minRate, baseline × multiplier)
                <br />
                <span className="text-burst">burst</span> = rate &gt; threshold for{" "}
                persistence windows
              </div>
            </div>
            <div className="space-y-3">
              {[
                ["Queue congestion is not measured", "A rate spike alone does not prove switch-buffer overflow; the console separates detected bursts from simulated drops."],
                ["No fake live status", "The browser build reports simulated data only. Real capture requires the Python backend."],
                ["Configurable, not universal", "10 ms / 80 Mbps / 3× are educational defaults, not a universal definition of a microburst."],
              ].map(([title, body]) => (
                <div key={title} className="rounded-lg border border-border bg-card p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Zap className="size-4 text-warning" />
                    {title}
                  </p>
                  <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="experiments" className="border-y border-border bg-card/40 py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold tracking-tight">Three reproducible scenarios</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Identical generator settings and PRNG seed per scenario, so results are comparable and
              exportable for the project review.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {SCENARIOS.map((scenario) => (
                <div key={scenario.tag} className="rounded-lg border border-border bg-card p-5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                    {scenario.tag}
                  </span>
                  <h3 className="mt-2 text-base font-semibold tracking-tight">{scenario.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{scenario.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight">Open the operations console</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              Sign in, start monitoring, inject a burst and watch the detector, topology and
              mitigation respond together.
            </p>
            <Button asChild size="lg" className="mt-6 gap-1.5">
              <Link to={primaryHref}>
                {primaryLabel}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
          <span>MicroburstHunter — prototype for a Computer Networks course project.</span>
          <span>Simulated measurements only · live capture lives in the Python backend.</span>
        </div>
      </footer>
    </div>
  );
}
