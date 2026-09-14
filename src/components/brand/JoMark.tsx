import { cn } from "@/lib/utils";
import { BLOB, DOT, J_STEM, JO_VIEWBOX, O_RING, WEDGE } from "./paths";

export type MarkTone = "ink" | "light" | "violet" | "mono";

const TONES: Record<MarkTone, { blob: string; mono: string; dot: string }> = {
  /** Default — ink bubble, violet monogram. For light grounds. */
  ink: { blob: "var(--color-ink)", mono: "var(--color-violet)", dot: "var(--color-ink)" },
  /** For dark grounds — the bubble inverts, the monogram stays brand violet. */
  light: { blob: "#ffffff", mono: "var(--color-violet)", dot: "#ffffff" },
  /** Full violet bubble with a knocked-out monogram. Use on paper only. */
  violet: { blob: "var(--color-violet)", mono: "#ffffff", dot: "var(--color-violet)" },
  /** Single-colour, inherits `currentColor`. For dense UI and print. */
  mono: { blob: "currentColor", mono: "currentColor", dot: "currentColor" },
};

export interface JoMarkProps extends React.SVGProps<SVGSVGElement> {
  tone?: MarkTone;
  /** Rendered as the accessible name. Pass `null` for purely decorative use. */
  title?: string | null;
}

/**
 * The JO mark, drawn from vector data traced off the master artwork.
 *
 * Server-renderable with zero JS. Animated variants compose this file's paths
 * rather than duplicating them — see `AnimatedLogo`.
 */
export function JoMark({ tone = "ink", title = "THE JO", className, ...props }: JoMarkProps) {
  const c = TONES[tone];
  const decorative = title === null;

  return (
    <svg
      viewBox={JO_VIEWBOX}
      fill="none"
      className={cn("block h-8 w-8", className)}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
      {...props}
    >
      {!decorative && <title>{title}</title>}
      <path d={BLOB} fill={c.blob} />
      <path d={DOT} fill={c.dot} />
      <g fill={c.mono} opacity={tone === "mono" ? 0.45 : 1}>
        <path d={J_STEM} />
        <path d={O_RING} />
        <path d={WEDGE} />
      </g>
    </svg>
  );
}
