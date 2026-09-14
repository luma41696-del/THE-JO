"use client";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export interface MarqueeProps {
  items: string[];
  /** Pixels per second. Below ~30 reads as broken, above ~60 as frantic. */
  speed?: number;
  className?: string;
  separator?: string;
  reverse?: boolean;
}

/**
 * Infinite marquee.
 *
 * The track is duplicated once and translated by exactly −50%, which is what
 * makes the loop seamless regardless of content width. Duration is derived
 * from item count so adding a message slows the belt instead of speeding it up.
 *
 * Under `prefers-reduced-motion` it becomes a static, horizontally scrollable
 * row — the messages stay readable, they simply stop moving on their own.
 */
export function Marquee({
  items,
  speed = 40,
  className,
  separator = "·",
  reverse = false,
}: MarqueeProps) {
  const reduced = useReducedMotion();
  if (items.length === 0) return null;

  const track = [...items, ...items];
  // Rough character-width estimate is enough: the loop is seamless either way,
  // this only sets the pace.
  const estimatedWidth = items.join(separator).length * 9;
  const duration = Math.max(12, estimatedWidth / speed);

  if (reduced) {
    return (
      <div className={cn("ns-no-scrollbar overflow-x-auto", className)}>
        <div className="flex w-max items-center gap-6 px-4">
          {items.map((item, index) => (
            <span key={index} className="whitespace-nowrap">
              {item}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("ns-edge-fade overflow-hidden", className)}>
      <motion.div
        className="flex w-max items-center gap-6"
        animate={{ x: reverse ? ["-50%", "0%"] : ["0%", "-50%"] }}
        transition={{ duration, ease: "linear", repeat: Infinity }}
      >
        {track.map((item, index) => (
          <span key={index} className="flex items-center gap-6 whitespace-nowrap">
            {item}
            <span aria-hidden="true" className="opacity-40">
              {separator}
            </span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}
