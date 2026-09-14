"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { BLOB_WAVES, DOT, J_STEM, JO_CENTROID, JO_VIEWBOX, O_RING, WEDGE } from "./paths";
import type { MarkTone } from "./JoMark";

/**
 * The animated JO mark.
 *
 * Intro: the bubble inflates from nothing, the monogram fades up behind it,
 * and the dot drops in last — the dot landing is the beat that reads as
 * "brand", so nothing else moves while it happens.
 *
 * Hover: the bubble morphs through its wave states and a violet ripple escapes
 * it. Both stop when the pointer leaves; a permanently animating logo in a
 * navbar is noise, not personality.
 *
 * Implementation notes:
 *  - The wave morph works because every path in `BLOB_WAVES` shares an
 *    identical command sequence, so Motion's string interpolation can walk the
 *    numbers pairwise. Re-tracing the artwork must preserve that.
 *  - Morph and intro live on *different* elements: an element with an object
 *    `animate` prop stops receiving variant labels from its parent, so the
 *    transform lives on a wrapping `<g>` and the `d` morph on the path inside.
 *  - Transforms use `transform-box: view-box` with an explicit origin so every
 *    part scales about the same point rather than about its own bounding box.
 */

const TONES: Record<MarkTone, { blob: string; mono: string; dot: string; ripple: string }> = {
  ink: {
    blob: "var(--color-ink)",
    mono: "var(--color-violet)",
    dot: "var(--color-ink)",
    ripple: "var(--color-violet)",
  },
  light: {
    blob: "#ffffff",
    mono: "var(--color-violet)",
    dot: "#ffffff",
    ripple: "var(--color-violet-bright)",
  },
  violet: {
    blob: "var(--color-violet)",
    mono: "#ffffff",
    dot: "var(--color-violet)",
    ripple: "var(--color-violet)",
  },
  mono: {
    blob: "currentColor",
    mono: "currentColor",
    dot: "currentColor",
    ripple: "currentColor",
  },
};

/** Shared transform origin: the optical centre of the bubble. */
const ORIGIN = {
  transformBox: "view-box",
  transformOrigin: `${JO_CENTROID.x}px ${JO_CENTROID.y}px`,
} as const;

/** The dot pivots about itself, not about the bubble. */
const DOT_ORIGIN = {
  transformBox: "view-box",
  transformOrigin: "98.2px 93.2px",
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
  tone = "ink",
  className,
  intro = true,
  delay = 0,
  alwaysWave = false,
  title = "THE JO",
  onIntroComplete,
}: AnimatedLogoProps) {
  const reduced = useReducedMotion();
  const c = TONES[tone];

  const playIntro = intro && !reduced;
  const wave = alwaysWave && !reduced;

  const bubble: Variants = {
    hidden: { scale: 0.2, opacity: 0, rotate: -14 },
    show: {
      scale: 1,
      opacity: 1,
      rotate: 0,
      transition: { duration: 0.78, ease: EASE.spring, delay },
    },
    hover: { scale: 1.06, rotate: 3, transition: { duration: 0.5, ease: EASE.jo } },
  };

  const mono: Variants = {
    hidden: { scale: 0.5, opacity: 0 },
    show: {
      scale: 1,
      opacity: 1,
      transition: { duration: 0.5, ease: EASE.jo, delay: delay + 0.22 },
    },
    hover: { scale: 1.05, transition: { duration: 0.45, ease: EASE.jo } },
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
      transition: { duration: 1.6, ease: EASE.jo, repeat: Infinity },
    },
  };

  const morph = {
    d: [BLOB_WAVES[0], BLOB_WAVES[1], BLOB_WAVES[2], BLOB_WAVES[3], BLOB_WAVES[0]],
  };

  return (
    <motion.svg
      viewBox={JO_VIEWBOX}
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

      <motion.g variants={bubble} style={ORIGIN}>
        <motion.path
          fill={c.blob}
          // The literal `d` matters: it is what the server renders, and it is
          // the value Motion reads as the morph's starting point. Without it
          // the first keyframe interpolates from `undefined`.
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

      <motion.g
        fill={c.mono}
        variants={mono}
        style={ORIGIN}
        opacity={tone === "mono" ? 0.45 : 1}
      >
        <path d={J_STEM} />
        <path d={O_RING} />
        <path d={WEDGE} />
      </motion.g>

      <motion.path d={DOT} fill={c.dot} variants={dot} style={DOT_ORIGIN} />
    </motion.svg>
  );
}
