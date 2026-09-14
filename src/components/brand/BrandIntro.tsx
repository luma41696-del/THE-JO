"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { EASE } from "@/lib/motion";
import { shouldPlayIntro, useUI } from "@/lib/store/ui";
import { AnimatedLogo } from "./AnimatedLogo";

/**
 * First-visit brand curtain.
 *
 * Rules that keep it a welcome rather than a toll booth:
 *  - once per session (sessionStorage), never on subsequent navigations;
 *  - ~1.6s total, and it lifts early if the page is already interactive;
 *  - skipped entirely under `prefers-reduced-motion`;
 *  - `aria-hidden` with focus never trapped, so assistive tech goes straight
 *    to the page underneath.
 *
 * It renders *above* the page rather than replacing it, so the LCP element is
 * already painted when the curtain lifts.
 */
export function BrandIntro() {
  const reduced = useReducedMotion();
  const finishIntro = useUI((s) => s.finishIntro);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (reduced || !shouldPlayIntro()) {
      finishIntro();
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      finishIntro();
    }, 1650);
    return () => clearTimeout(timer);
  }, [reduced, finishIntro]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          aria-hidden="true"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-paper"
          initial={{ opacity: 1 }}
          exit={{
            opacity: 0,
            // A slight upward lift makes the curtain feel like it is leaving
            // rather than dissolving.
            y: "-3%",
            transition: { duration: 0.6, ease: EASE.brand },
          }}
        >
          <motion.div
            className="flex flex-col items-center gap-6"
            exit={{ scale: 0.94, opacity: 0, transition: { duration: 0.4, ease: EASE.silk } }}
          >
            <AnimatedLogo className="h-24 w-24" alwaysWave title={null} />

            <motion.span
              className="font-display text-eyebrow text-smoke uppercase"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65, duration: 0.5, ease: EASE.brand }}
            >
              net sale · نت سيل
            </motion.span>

            {/* Progress hairline — gives the wait a visible end point. */}
            <motion.span
              className="h-px w-24 origin-left bg-brand"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.3, duration: 1.15, ease: EASE.silk }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
