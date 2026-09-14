"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";

import { EASE } from "@/lib/motion";
import { BLOB_WAVES, JO_CENTROID, JO_VIEWBOX } from "@/components/brand/paths";
import { useUI, type CursorMode } from "@/lib/store/ui";

/**
 * The JO cursor.
 *
 * The brand mark is a bubble with a detached dot. That maps onto a cursor
 * almost too neatly, so the design takes it literally:
 *
 *   - the **dot** is the real pointer. It tracks the mouse with zero lag, so
 *     precision is never sacrificed for style;
 *   - the **bubble** trails behind on a spring, morphing through its wave
 *     states. It is the personality; it is also never the thing you aim with.
 *
 * Elements opt into states declaratively:
 *
 *   <button data-cursor="hover">                 bubble swells, dot shrinks
 *   <a data-cursor="view" data-cursor-label="View">   label rides inside
 *   <input data-cursor="text">                   bubble becomes a caret bar
 *
 * Bailouts, all of them deliberate:
 *   - no pointer-fine device (touch, most tablets) → never mounts
 *   - `prefers-reduced-motion` → never mounts, OS cursor is restored by CSS
 *   - window blur / pointer leaves the document → fades out
 *
 * The OS cursor is only hidden once this component has actually mounted and
 * set `data-jo-cursor="on"` on `<html>`, so a JS failure can never leave a
 * visitor with no pointer at all.
 */

const SPRING = { stiffness: 420, damping: 34, mass: 0.55 } as const;
const DOT_SPRING = { stiffness: 1400, damping: 60, mass: 0.25 } as const;

/** Bubble size in px for each state. */
const SIZE: Record<CursorMode, number> = {
  default: 26,
  hover: 58,
  view: 84,
  drag: 66,
  text: 20,
  hidden: 0,
};

interface Ripple {
  id: number;
  x: number;
  y: number;
}

export function JoCursor() {
  const reduced = useReducedMotion();
  const mode = useUI((s) => s.cursorMode);
  const label = useUI((s) => s.cursorLabel);
  const setCursor = useUI((s) => s.setCursor);

  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleId = useRef(0);

  // Raw pointer position; the springs below derive everything else from it.
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const bubbleX = useSpring(x, SPRING);
  const bubbleY = useSpring(y, SPRING);
  const dotX = useSpring(x, DOT_SPRING);
  const dotY = useSpring(y, DOT_SPRING);

  /* --- capability gate --------------------------------------------------- */
  useEffect(() => {
    if (reduced) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => setEnabled(fine.matches);
    apply();
    fine.addEventListener("change", apply);
    return () => fine.removeEventListener("change", apply);
  }, [reduced]);

  useEffect(() => {
    if (!enabled) return;
    document.documentElement.setAttribute("data-jo-cursor", "on");
    return () => document.documentElement.removeAttribute("data-jo-cursor");
  }, [enabled]);

  /* --- pointer tracking -------------------------------------------------- */
  const resolveMode = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;

      const declared = target.closest<HTMLElement>("[data-cursor]");
      if (declared) {
        const next = (declared.dataset.cursor as CursorMode) || "hover";
        setCursor(next, declared.dataset.cursorLabel ?? null);
        return;
      }

      // Sensible defaults so most of the site needs no annotation at all.
      if (target.closest("a, button, [role='button'], summary, label[for]")) {
        setCursor("hover");
        return;
      }
      if (target.closest("input:not([type='checkbox']):not([type='radio']), textarea")) {
        setCursor("text");
        return;
      }
      setCursor("default");
    },
    [setCursor],
  );

  useEffect(() => {
    if (!enabled) return;

    const onMove = (event: PointerEvent) => {
      x.set(event.clientX);
      y.set(event.clientY);
      if (!visible) setVisible(true);
      resolveMode(event.target);
    };

    const onDown = (event: PointerEvent) => {
      setPressed(true);
      const id = rippleId.current++;
      setRipples((r) => [...r, { id, x: event.clientX, y: event.clientY }]);
      // Matches the ripple's own exit duration.
      setTimeout(() => setRipples((r) => r.filter((item) => item.id !== id)), 700);
    };

    const onUp = () => setPressed(false);
    const onLeave = () => setVisible(false);
    const onEnter = () => setVisible(true);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("pointerenter", onEnter);
    window.addEventListener("blur", onLeave);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("pointerenter", onEnter);
      window.removeEventListener("blur", onLeave);
    };
  }, [enabled, resolveMode, visible, x, y]);

  if (!enabled) return null;

  const size = SIZE[mode];
  const isText = mode === "text";
  const showLabel = Boolean(label) && (mode === "view" || mode === "drag");

  return (
    <div className="pointer-events-none fixed inset-0 z-[300] hidden md:block" aria-hidden="true">
      {/* Click ripples — the logo silhouette, expanding from the click point. */}
      <AnimatePresence>
        {ripples.map((ripple) => (
          <motion.svg
            key={ripple.id}
            viewBox={JO_VIEWBOX}
            fill="none"
            className="absolute"
            style={{
              left: ripple.x,
              top: ripple.y,
              width: 120,
              height: 120,
              marginLeft: -60,
              marginTop: -60,
            }}
            initial={{ opacity: 0.5, scale: 0.15 }}
            animate={{ opacity: 0, scale: 1.1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: EASE.jo }}
          >
            <path
              d={BLOB_WAVES[0]}
              stroke="var(--color-violet)"
              strokeWidth={2}
              fill="none"
              style={{
                transformBox: "view-box",
                transformOrigin: `${JO_CENTROID.x}px ${JO_CENTROID.y}px`,
              }}
            />
          </motion.svg>
        ))}
      </AnimatePresence>

      {/* The bubble — trails, morphs, carries the label. */}
      <motion.div
        className="absolute top-0 left-0 flex items-center justify-center"
        style={{ x: bubbleX, y: bubbleY }}
        animate={{ opacity: visible && mode !== "hidden" ? 1 : 0 }}
        transition={{ duration: 0.2, ease: EASE.silk }}
      >
        <motion.div
          className="flex items-center justify-center"
          animate={{
            width: isText ? 2 : size,
            height: isText ? 26 : size,
            scale: pressed ? 0.82 : 1,
          }}
          transition={{ duration: 0.34, ease: EASE.jo }}
          style={{ marginLeft: isText ? -1 : -size / 2, marginTop: isText ? -13 : -size / 2 }}
        >
          {isText ? (
            <span className="h-full w-full rounded-full bg-violet" />
          ) : (
            <motion.svg
              viewBox={JO_VIEWBOX}
              fill="none"
              className="h-full w-full overflow-visible"
            >
              <motion.path
                d={BLOB_WAVES[0]}
                initial={{ d: BLOB_WAVES[0] }}
                animate={{
                  d: [BLOB_WAVES[0], BLOB_WAVES[1], BLOB_WAVES[2], BLOB_WAVES[3], BLOB_WAVES[0]],
                }}
                transition={{ duration: 7, ease: "easeInOut", repeat: Infinity }}
                fill={
                  mode === "view" || mode === "drag"
                    ? "var(--color-violet)"
                    : "var(--color-ink)"
                }
                fillOpacity={mode === "default" ? 0.14 : 1}
                stroke={mode === "default" ? "var(--color-ink)" : "none"}
                strokeWidth={mode === "default" ? 1.6 : 0}
                strokeOpacity={0.35}
              />
            </motion.svg>
          )}

          <AnimatePresence>
            {showLabel && (
              <motion.span
                key={label}
                className="font-display absolute text-[0.625rem] font-semibold tracking-[0.18em] text-white uppercase"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.22, ease: EASE.jo }}
              >
                {label}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>

      {/* The dot — the actual pointer. Never lags, never grows large enough to
          obscure what is underneath it. */}
      <motion.span
        className="absolute top-0 left-0 rounded-full bg-violet"
        style={{ x: dotX, y: dotY }}
        animate={{
          width: mode === "view" ? 0 : 6,
          height: mode === "view" ? 0 : 6,
          opacity: visible && mode !== "hidden" ? 1 : 0,
          marginLeft: mode === "view" ? 0 : -3,
          marginTop: mode === "view" ? 0 : -3,
        }}
        transition={{ duration: 0.25, ease: EASE.jo }}
      />
    </div>
  );
}
