"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { BLOB_WAVES, DOT, MONOGRAM, NS_CENTROID, NS_VIEWBOX } from "./paths";
import type { MarkTone } from "./NetSaleMark";

/**
 * The animated net sale mark.
 *
 * Intro: the pebble inflates from nothing, the N fades up inside it, and the
 * dot drops in last — the dot landing is the beat that reads as "brand", so
 * nothing else moves while it happens.
 *
 * Hover: the pebble morphs through its wave states and a red ripple escapes it.
 * Both stop when the pointer leaves; a permanently animating logo in a navbar
 * is noise, not personality.
 *
 * Implementation notes:
 *  - The wave morph works because every path in `BLOB_WAVES` shares an
 *    identical command sequence, so Motion's string interpolation can walk the
 *    numbers pairwise. Re-tracing the artwork must preserve that.
 *  - Morph and intro live on *different* elements: an element with an object
 *    `animate` prop stops receiving variant labels from its parent, so the
 *    transform lives on a wrapping `<g>` and the `d` morph on the path inside.
 *  - Every animated path also carries a literal `d`. Without it Motion reads
 *    the start value off the DOM, gets nothing, and writes the string
 *    "undefined" into the attribute — the path silently disappears.
 *  - The N is knocked out of the pebble, so it is painted in the ground colour
 *    and must sit *above* the morphing pebble in paint order.
 */

const TONES: Record<MarkTone, { pebble: string; monogram: string; dot: string; ripple: string }> = {
  onLight: {
    pebble: "var(--color-brand)",
    monogram: "var(--color-paper)",
    dot: "var(--color-brand)",
    ripple: "var(--color-brand)",
  },
  onDark: {
    pebble: "var(--color-brand)",
    monogram: "var(--color-ink)",
    dot: "var(--color-brand)",
    ripple: "var(--color-brand-bright)",
  },
  solid: {
    pebble: "currentColor",
    monogram: "transparent",
    dot: "currentColor",
    ripple: "currentColor",
  },
};

/** Shared transform origin: the optical centre of the pebble. */
const ORIGIN = {
  transformBox: "view-box",
  transformOrigin: `${NS_CENTROID.x}px ${NS_CENTROID.y}px`,
} as const;

export interface AnimatedLogoProps {
  tone?: MarkTone;
  className?: string;
  /** Play the entrance. Turn off for a mark that is already on screen. */
  intro?: boolean;
  /** Seconds to wait before the entrance starts. */
  delay?: number;
  /** Wave continuously without hover. Reserve for hero and loading moments. */
  alwaysWave?: boolean;
  title?: string | null;
  onIntroComplete?: () => void;
}

export function AnimatedLogo({
  tone = "onLight",
  className,
  intro = true,
  delay = 0,
  alwaysWave = false,
  title = "net sale",
  onIntroComplete,
}: AnimatedLogoProps) {
  const reduced = useReducedMotion();
  const c = TONES[tone];

  const playIntro = intro && !reduced;
  const wave = alwaysWave && !reduced;

  const pebble: Variants = {
    hidden: { scale: 0.2, opacity: 0, rotate: -14 },
    show: {
      scale: 1,
      opacity: 1,
      rotate: 0,
      transition: { duration: 0.78, ease: EASE.spring, delay },
    },
    hover: { scale: 1.06, rotate: 3, transition: { duration: 0.5, ease: EASE.brand } },
  };

  const mono: Variants = {
    hidden: { scale: 0.5, opacity: 0 },
    show: {
      scale: 1,
      opacity: 1,
      transition: { duration: 0.5, ease: EASE.brand, delay: delay + 0.22 },
    },
    hover: { scale: 1.05, transition: { duration: 0.45, ease: EASE.brand } },
  };

  const dot: Variants = {
    // Enters from up-left so it reads as falling into place.
    hidden: { scale: 0, opacity: 0, x: -6, y: -8 },
    show: {
      scale: 1,
      opacity: 1,
      x: 0,
      y: 0,
      transition: { duration: 0.52, ease: EASE.spring, delay: delay + 0.46 },
    },
    hover: { scale: 1.35, transition: { duration: 0.4, ease: EASE.spring } },
  };

  const ripple: Variants = {
    hidden: { opacity: 0, scale: 1 },
    show: { opacity: 0, scale: 1 },
    hover: {
      opacity: [0, 0.45, 0],
      scale: [1, 1.5, 1.85],
      transition: { duration: 1.6, ease: EASE.brand, repeat: Infinity },
    },
  };

  const morph = {
    d: [BLOB_WAVES[0], BLOB_WAVES[1], BLOB_WAVES[2], BLOB_WAVES[3], BLOB_WAVES[0]],
  };

  return (
    <motion.svg
      viewBox={NS_VIEWBOX}
      fill="none"
      className={cn("block h-9 w-9 overflow-visible", className)}
      role={title === null ? "presentation" : "img"}
      aria-hidden={title === null || undefined}
      aria-label={title ?? undefined}
      initial={playIntro ? "hidden" : "show"}
      animate="show"
      whileHover={reduced ? undefined : "hover"}
      onAnimationComplete={(definition) => {
        if (definition === "show") onIntroComplete?.();
      }}
    >
      {title !== null && <title>{title}</title>}

      <motion.path
        d={BLOB_WAVES[0]}
        fill="none"
        stroke={c.ripple}
        strokeWidth={2}
        variants={ripple}
        style={ORIGIN}
      />

      <motion.g variants={pebble} style={ORIGIN}>
        <motion.path
          fill={c.pebble}
          d={BLOB_WAVES[0]}
          initial={{ d: BLOB_WAVES[0] }}
          animate={wave ? morph : { d: BLOB_WAVES[0] }}
          transition={
            wave
              ? {
                  d: {
                    duration: 9,
                    ease: "easeInOut",
                    repeat: Infinity,
                    // Hold the true logo shape a beat longer than the variants.
                    times: [0, 0.26, 0.5, 0.74, 1],
                  },
                }
              : undefined
          }
        />
      </motion.g>

      {/* Painted over the pebble, in the ground colour — the N is a hole. */}
      {tone !== "solid" && (
        <motion.g fill={c.monogram} variants={mono} style={ORIGIN}>
          {MONOGRAM.map((d) => (
            <path key={d.slice(0, 24)} d={d} />
          ))}
        </motion.g>
      )}

      <motion.path d={DOT} fill={c.dot} variants={dot} style={ORIGIN} />
    </motion.svg>
  );
}
