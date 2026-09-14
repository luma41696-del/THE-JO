"use client";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { BLOB_WAVES, NS_CENTROID, NS_VIEWBOX } from "./paths";

/**
 * Decorative ripple field built from the logo silhouette.
 *
 * The same geometry as the Lottie, rendered as inline SVG — roughly 1KB of DOM
 * against ~21KB of JSON plus a player, so this is the default for ambient
 * moments (hero backdrop, section dividers, empty states) and the Lottie is
 * reserved for hero-scale set pieces where its extra fidelity earns its cost.
 *
 * Always `aria-hidden`: it carries no information.
 */

export interface BrandWaveProps {
  /** How many concentric rings. Three reads as a ripple; more reads as noise. */
  rings?: number;
  className?: string;
  color?: string;
  /** Seconds per full cycle. Slower is more expensive-looking. */
  speed?: number;
  /** Fill the innermost shape rather than stroking it. */
  solidCore?: boolean;
}

export function BrandWave({
  rings = 3,
  className,
  color = "var(--color-brand)",
  speed = 9,
  solidCore = false,
}: BrandWaveProps) {
  const reduced = useReducedMotion();

  return (
    <svg
      viewBox={NS_VIEWBOX}
      fill="none"
      aria-hidden="true"
      className={cn("pointer-events-none block h-full w-full overflow-visible", className)}
    >
      {solidCore && (
        <motion.path
          fill={color}
          d={BLOB_WAVES[0]}
          initial={{ d: BLOB_WAVES[0] }}
          animate={
            reduced
              ? undefined
              : { d: [BLOB_WAVES[0], BLOB_WAVES[1], BLOB_WAVES[2], BLOB_WAVES[3], BLOB_WAVES[0]] }
          }
          transition={{ duration: speed, ease: "easeInOut", repeat: Infinity }}
          style={{
            transformBox: "view-box",
            transformOrigin: `${NS_CENTROID.x}px ${NS_CENTROID.y}px`,
          }}
        />
      )}

      {Array.from({ length: rings }).map((_, index) => {
        // Each ring starts where the previous one is halfway out, so the field
        // reads as one continuous expansion rather than separate pulses.
        const delay = (speed / rings) * index * 0.5;
        const shape = BLOB_WAVES[index % BLOB_WAVES.length];

        return (
          <motion.path
            key={index}
            d={shape}
            stroke={color}
            strokeWidth={1.4}
            fill="none"
            style={{
              transformBox: "view-box",
              transformOrigin: `${NS_CENTROID.x}px ${NS_CENTROID.y}px`,
            }}
            initial={{ scale: 1, opacity: 0 }}
            animate={
              reduced
                ? { scale: 1 + index * 0.25, opacity: 0.18 }
                : {
                    scale: [1, 1.9 + index * 0.2],
                    opacity: [0.42 - index * 0.08, 0],
                    rotate: index % 2 === 0 ? [0, 10] : [0, -10],
                  }
            }
            transition={
              reduced
                ? undefined
                : { duration: speed * 0.75, ease: "easeOut", repeat: Infinity, delay }
            }
          />
        );
      })}
    </svg>
  );
}
