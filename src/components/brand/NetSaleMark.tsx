import { cn } from "@/lib/utils";
import { BLOB, DOT, MONOGRAM, NS_VIEWBOX } from "./paths";

/**
 * Tone names the **ground the mark sits on**, not the mark's own colour.
 *
 * That is the whole trick of this logo: the N is knocked *out* of the pebble,
 * so it has to be painted in whatever is behind it. Naming the prop after the
 * mark would invite `tone="light"` on a dark panel, which is exactly the
 * mistake that fills the N with the wrong colour and turns it into a blob.
 */
export type MarkTone = "onLight" | "onDark" | "solid";

const TONES: Record<MarkTone, { pebble: string; monogram: string; dot: string }> = {
  /** On the cream page ground. The default. */
  onLight: {
    pebble: "var(--color-brand)",
    monogram: "var(--color-paper)",
    dot: "var(--color-brand)",
  },
  /** On an ink panel — footer, auth aside, the fitting-room stage. */
  onDark: {
    pebble: "var(--color-brand)",
    monogram: "var(--color-ink)",
    dot: "var(--color-brand)",
  },
  /** Single colour from `currentColor`, for dense UI, print and favicons. */
  solid: { pebble: "currentColor", monogram: "transparent", dot: "currentColor" },
};

export interface NetSaleMarkProps extends React.SVGProps<SVGSVGElement> {
  tone?: MarkTone;
  /** Rendered as the accessible name. Pass `null` for decorative use. */
  title?: string | null;
}

/**
 * The net sale mark, drawn from vector data traced off the master artwork.
 *
 * Server-renderable with zero JS. Animated variants compose these same paths
 * rather than duplicating them — see `AnimatedLogo`.
 */
export function NetSaleMark({
  tone = "onLight",
  title = "net sale",
  className,
  ...props
}: NetSaleMarkProps) {
  const c = TONES[tone];
  const decorative = title === null;

  return (
    <svg
      viewBox={NS_VIEWBOX}
      fill="none"
      className={cn("block h-8 w-8", className)}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
      {...props}
    >
      {!decorative && <title>{title}</title>}
      <path d={BLOB} fill={c.pebble} />
      <path d={DOT} fill={c.dot} />
      {/* `solid` leaves the N transparent so the mark reads as one silhouette
          when it is stamped in a single colour. */}
      {tone !== "solid" &&
        MONOGRAM.map((d) => <path key={d.slice(0, 24)} d={d} fill={c.monogram} />)}
    </svg>
  );
}
