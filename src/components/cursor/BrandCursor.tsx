"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

import { EASE } from "@/lib/motion";
import { BLOB_WAVES, NS_CENTROID, NS_VIEWBOX } from "@/components/brand/paths";
import { useUI, type CursorMode } from "@/lib/store/ui";

/**
 * The net sale cursor.
 *
 * One dot. It *is* the pointer — it tracks the mouse on a stiff spring, so
 * precision is never traded for style, and there is nothing trailing behind it
 * to drag the eye away from what is being aimed at.
 *
 * It used to carry a second element: a pebble from the brand mark that lagged
 * on a soft spring and morphed through four wave states on a seven-second
 * loop. That was the personality, and it was also a shape in permanent motion
 * in the corner of every visitor's eye. This is the quieter reading of the
 * same idea — the mark shows up on click instead, where it is a response to
 * something the visitor did rather than ambient movement.
 *
 * States, declared by the element rather than guessed at:
 *
 *   <button data-cursor="hover">                      the dot doubles
 *   <a data-cursor="view" data-cursor-label="View">   a label rides under it
 *   <input data-cursor="text">                        the dot becomes a caret
 *
 * Bailouts, all deliberate:
 *   - no pointer-fine device (touch, most tablets) → never mounts
 *   - `prefers-reduced-motion` → never mounts, OS cursor is restored by CSS
 *   - window blur / pointer leaves the document → fades out
 *
 * The OS cursor is only hidden once this component has actually mounted and
 * set `data-ns-cursor="on"` on `<html>`, so a JS failure can never leave a
 * visitor with no pointer at all.
 */

/**
 * Stiff and light: with nothing trailing, this spring is the whole feel of the
 * cursor, and anything softer reads as lag rather than as character.
 */
const DOT_SPRING = { stiffness: 1400, damping: 60, mass: 0.25 } as const;

/**
 * Dot diameter in px per state.
 *
 * `hover` is exactly double `default` — a change big enough to notice in
 * peripheral vision, small enough that it never covers the thing it is
 * pointing at. `view` sits between the two because it carries a label.
 */
const DOT_SIZE: Record<CursorMode, number> = {
  default: 8,
  hover: 16,
  view: 12,
  drag: 16,
  text: 2,
  hidden: 0,
};

/** The caret's height, when the dot becomes a text bar. */
const CARET_HEIGHT = 26;

interface Ripple {
  id: number;
  x: number;
  y: number;
}

export function BrandCursor() {
  const reduced = useReducedMotion();
  const mode = useUI((s) => s.cursorMode);
  const label = useUI((s) => s.cursorLabel);
  const setCursor = useUI((s) => s.setCursor);

  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleId = useRef(0);

  // Raw pointer position; the spring below derives everything from it.
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
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
    document.documentElement.setAttribute("data-ns-cursor", "on");
    return () => document.documentElement.removeAttribute("data-ns-cursor");
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

  const isText = mode === "text";
  const size = DOT_SIZE[mode];
  const width = isText ? 2 : size;
  const height = isText ? CARET_HEIGHT : size;
  const showLabel = Boolean(label) && (mode === "view" || mode === "drag");

  return (
    <div className="pointer-events-none fixed inset-0 z-[300] hidden md:block" aria-hidden="true">
      {/* Click ripples — the logo silhouette, expanding from the click point.
          The one place the mark still appears, and it is a response to
          something the visitor did rather than ambient movement. */}
      <AnimatePresence>
        {ripples.map((ripple) => (
          <motion.svg
            key={ripple.id}
            viewBox={NS_VIEWBOX}
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
            transition={{ duration: 0.7, ease: EASE.brand }}
          >
            <path
              d={BLOB_WAVES[0]}
              stroke="var(--color-brand)"
              strokeWidth={2}
              fill="none"
              style={{
                transformBox: "view-box",
                transformOrigin: `${NS_CENTROID.x}px ${NS_CENTROID.y}px`,
              }}
            />
          </motion.svg>
        ))}
      </AnimatePresence>

      {/* The dot — the whole cursor. */}
      <motion.div
        className="absolute top-0 left-0"
        style={{ x: dotX, y: dotY }}
        animate={{ opacity: visible && mode !== "hidden" ? 1 : 0 }}
        transition={{ duration: 0.2, ease: EASE.silk }}
      >
        <motion.span
          className="bg-brand absolute block rounded-full"
          animate={{
            width,
            height,
            marginLeft: -width / 2,
            marginTop: -height / 2,
            // A press is the only thing that moves it off its own size.
            scale: pressed ? 0.75 : 1,
            borderRadius: isText ? 1 : size,
          }}
          transition={{ duration: 0.22, ease: EASE.brand }}
          style={{
            /*
             * A hairline of white around the dot.
             *
             * Without it the cursor disappears over the brand colour itself —
             * a brand-filled button, the announcement bar, a sale badge — and
             * a pointer that vanishes on the shop's own call-to-action is the
             * one place it must not. Invisible against paper, where the ring
             * and the background are the same colour.
             */
            boxShadow: "0 0 0 1.5px rgba(255,255,255,0.7)",
          }}
        />

        {/*
          The label, under the dot rather than inside a shape.
          Centred horizontally so it reads the same in both directions — an
          offset to one side would sit on the wrong side of the pointer in
          Arabic, and flipping it per locale is a lot of machinery for a chip.
        */}
        <AnimatePresence>
          {showLabel && (
            <motion.span
              key={label}
              className="bg-ink absolute rounded-pill px-2.5 py-1 text-[0.5625rem] font-semibold tracking-[0.16em] whitespace-nowrap text-white uppercase"
              style={{ left: 0, top: 16, translateX: "-50%" }}
              initial={{ opacity: 0, y: -4, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.85 }}
              transition={{ duration: 0.2, ease: EASE.brand }}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
