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
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7"
        className="fill-surface stroke-border"
        strokeWidth="1"
      />
      <path
        d="M6.5 22.5 H11.5 L14.6 11 L17.6 22.5 H25.5"
        fill="none"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary"
      />
      <circle
        cx="14.6"
        cy="11"
        r="2.1"
        className={cn("fill-burst", active && "mbh-pulse")}
      />
      <path
        d="M6.5 26.5 H25.5"
        strokeWidth="1"
        strokeLinecap="round"
        className="stroke-muted-foreground/40"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("leading-none", className)}>
      <span className="block text-[13px] font-semibold tracking-tight text-sidebar-accent-foreground">
        Microburst<span className="text-primary">Hunter</span>
      </span>
      <span className="label-caps mt-1 block text-muted-foreground">
        Fabric console
      </span>
    </span>
  );
}
