/**
 * MicroburstHunter wordmark.
 *
 * The symbol is a microburst in miniature: a flat baseline that spikes briefly
 * and returns. It is drawn as vectors (no raster text) so it stays crisp at
 * every size and can be recoloured by network state.
 */
import { cn } from "@/lib/utils";

export function MHMark({
  className,
  active = true,
}: {
  className?: string;
  active?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      role="img"
      aria-label="MicroburstHunter"
    >
      <defs>
        <linearGradient id="mhmark-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1a0b2e" />
          <stop offset="100%" stopColor="#0d0e17" />
        </linearGradient>
      </defs>
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="8"
        fill="url(#mhmark-bg)"
        className="stroke-violet-500/40"
        strokeWidth="1.2"
      />
      <path
        d="M6.5 22.5 H11.5 L14.6 11 L17.6 22.5 H25.5"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-violet-400"
      />
      <circle
        cx="14.6"
        cy="11"
        r="2.2"
        className={cn("fill-rose-500", active && "animate-pulse")}
      />
      <path
        d="M6.5 26.5 H25.5"
        strokeWidth="1"
        strokeLinecap="round"
        className="stroke-white/20"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("leading-none", className)}>
      <span className="block text-[14px] font-bold tracking-tight text-white">
        Microburst<span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">Hunter</span>
      </span>
      <span className="label-caps mt-1 block text-[10px] text-slate-400 tracking-wider">
        FABRIC CONSOLE
      </span>
    </span>
  );
}
