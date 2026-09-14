import type { Transition, Variants } from "motion/react";

/**
 * THE JO — motion system.
 *
 * Three rules the whole site obeys:
 *  1. One house curve. `EASE.jo` is used for anything that moves in space.
 *     Bounce is reserved for deliberate play (the cart bump, the mark intro).
 *  2. Distance scales with surface size. A chip travels 6px, a card 16px, a
 *     section 28px. Nothing slides further than it is tall.
 *  3. Nothing exceeds 700ms except decorative ambient loops.
 */

export const EASE = {
  /** Confident settle, no overshoot. The default for transform + layout. */
  jo: [0.22, 1, 0.36, 1] as const,
  /** Material-standard. Opacity, colour, blur. */
  silk: [0.4, 0, 0.2, 1] as const,
  /** Light overshoot. Success ticks, cart badge, add-to-bag. */
  spring: [0.34, 1.56, 0.64, 1] as const,
} satisfies Record<string, readonly [number, number, number, number]>;

export const DURATION = {
  instant: 0.12,
  quick: 0.22,
  base: 0.38,
  slow: 0.6,
  ambient: 9,
} as const;

export const transition = {
  base: { duration: DURATION.base, ease: EASE.jo },
  quick: { duration: DURATION.quick, ease: EASE.silk },
  slow: { duration: DURATION.slow, ease: EASE.jo },
  /** Physical spring for drag, drawers and anything the finger controls. */
  drawer: { type: "spring", stiffness: 380, damping: 40, mass: 0.9 },
  pop: { type: "spring", stiffness: 520, damping: 22, mass: 0.6 },
} satisfies Record<string, Transition>;

/* -------------------------------------------------------------------------- */
/*  Reusable variants                                                         */
/* -------------------------------------------------------------------------- */

/** Section reveal on scroll. Pair with `whileInView` + `viewport.once`. */
export const reveal: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: transition.slow },
};

/** Card-scale reveal — shorter travel than a full section. */
export const revealCard: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: transition.base },
};

/**
 * Parent for staggered children. `delayChildren` gives the eye a beat to land
 * on the heading before the grid starts populating.
 */
export const stagger = (stepSeconds = 0.07, delay = 0.05): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: stepSeconds, delayChildren: delay },
  },
});

/** Editorial line-by-line headline entrance. Each line is clipped by a mask. */
export const lineMask: Variants = {
  hidden: { y: "110%" },
  show: { y: "0%", transition: { duration: 0.75, ease: EASE.jo } },
};

/** Drawer / side panel. `x` is set by the caller to respect RTL. */
export const panel = (fromX: number): Variants => ({
  hidden: { x: fromX, opacity: 0.4 },
  show: { x: 0, opacity: 1, transition: transition.drawer },
  exit: { x: fromX, opacity: 0.2, transition: { duration: 0.28, ease: EASE.silk } },
});

export const backdrop: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.25, ease: EASE.silk } },
  exit: { opacity: 0, transition: { duration: 0.2, ease: EASE.silk } },
};

/** Crossfade for switching product galleries / tab panels. */
export const swap: Variants = {
  hidden: { opacity: 0, scale: 1.02 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: EASE.jo } },
  exit: { opacity: 0, scale: 0.99, transition: { duration: 0.2, ease: EASE.silk } },
};

/* -------------------------------------------------------------------------- */
/*  Shared viewport config                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fires slightly before the element is fully on screen so the animation is
 * already settling by the time the user's eye arrives.
 */
export const viewportOnce = { once: true, margin: "-12% 0px -8% 0px" } as const;

/* -------------------------------------------------------------------------- */
/*  Press feedback                                                            */
/* -------------------------------------------------------------------------- */

/** The house tap feel: a small, fast compression that releases with spring. */
export const press = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.97 },
  transition: transition.pop,
} as const;

/** A softer press for large surfaces (cards, banners) where 2% reads as huge. */
export const pressSoft = {
  whileHover: { scale: 1.008 },
  whileTap: { scale: 0.994 },
  transition: transition.pop,
} as const;
