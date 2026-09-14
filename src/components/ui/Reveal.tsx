"use client";

import type { ElementType, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, viewportOnce } from "@/lib/motion";

export interface RevealProps {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  /** Seconds. Use `index * 0.06` for a hand-rolled stagger. */
  delay?: number;
  /** Travel distance in px. Keep it under the element's own height. */
  distance?: number;
  direction?: "up" | "down" | "left" | "right";
  /** Clip the child to its box so it wipes in instead of floating in. */
  mask?: boolean;
}

/**
 * Scroll reveal.
 *
 * Fires once, slightly before the element is fully on screen, so the animation
 * is already settling as the eye arrives. Under `prefers-reduced-motion` the
 * child renders in its final state with no wrapper animation at all — the
 * content is never gated behind a transition that will not run.
 */
export function Reveal({
  children,
  className,
  as = "div",
  delay = 0,
  distance = 24,
  direction = "up",
  mask = false,
}: RevealProps) {
  const reduced = useReducedMotion();
  const MotionTag = motion[as as keyof typeof motion] as typeof motion.div;

  if (reduced) {
    const Tag = as as ElementType;
    return <Tag className={className}>{children}</Tag>;
  }

  const axis = direction === "left" || direction === "right" ? "x" : "y";
  const sign = direction === "down" || direction === "right" ? -1 : 1;

  const inner = (
    <MotionTag
      className={cn(mask ? undefined : className)}
      initial={{ opacity: 0, [axis]: distance * sign }}
      whileInView={{ opacity: 1, [axis]: 0 }}
      viewport={viewportOnce}
      transition={{ duration: 0.62, ease: EASE.jo, delay }}
    >
      {children}
    </MotionTag>
  );

  // A masked reveal needs an overflow-hidden parent, otherwise the child is
  // visible above the fold before it animates.
  return mask ? <span className={cn("block overflow-hidden", className)}>{inner}</span> : inner;
}

export interface StaggerProps {
  children: ReactNode;
  className?: string;
  step?: number;
  delay?: number;
}

/** Parent that staggers any `Reveal`-like children using motion variants. */
export function Stagger({ children, className, step = 0.07, delay = 0.04 }: StaggerProps) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={viewportOnce}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: step, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** Child of `Stagger`. Inherits timing from the parent rather than a delay prop. */
export function StaggerItem({
  children,
  className,
  distance = 18,
}: {
  children: ReactNode;
  className?: string;
  distance?: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: distance },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE.jo } },
      }}
    >
      {children}
    </motion.div>
  );
}
