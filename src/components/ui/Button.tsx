"use client";

import { forwardRef, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";

/**
 * The house button.
 *
 * Four states that matter and are usually skipped: rest, press, loading,
 * success. A checkout CTA that jumps straight from "click" to "new page" feels
 * broken even when it is not — the 900ms success beat is what makes the
 * transaction feel completed rather than merely submitted.
 *
 * Press feedback is two things at once: a 2% scale compression (felt) and an
 * ink ripple from the exact click point (seen). Both are suppressed under
 * `prefers-reduced-motion`, where the button still changes state — it just
 * does it instantly.
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "brand"
  | "quiet"
  | "paper";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

const VARIANTS: Record<ButtonVariant, string> = {
  /** Ink fill. The default commit action. */
  primary: "bg-ink text-white hover:bg-ink-soft shadow-lift hover:shadow-float",
  /** Outlined. Secondary actions that still need presence. */
  secondary: "bg-paper-raised text-ink border border-line hover:border-ink/30 shadow-lift",
  /** No chrome until hover. Tertiary. */
  ghost: "bg-transparent text-ink hover:bg-ink/5",
  /** Brand brand. Reserved for checkout and the single primary CTA on a page. */
  brand: "bg-brand text-white hover:bg-brand-deep shadow-brand",
  /**
   * Paper fill on a dark ground — a hero photograph, the footer, the
   * fitting-room stage. The brand red is the one thing that does *not* work
   * over an arbitrary photograph: it fights whatever is behind it, and on a
   * dark image it stops reading as a button at all.
   */
  paper: "bg-paper text-ink hover:bg-white shadow-float",
  /** Text-only, inline. */
  quiet: "bg-transparent text-smoke hover:text-ink underline-offset-4 hover:underline",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[0.8125rem] gap-1.5",
  md: "h-11 px-5 sm:px-6 text-sm gap-2",
  /*
   * Horizontal padding is narrower on small screens. These labels are
   * uppercase with letter-spacing, so "Proceed to checkout" is ~244px of text
   * before any padding; at `px-8` it could not fit inside a summary card on a
   * 375px phone, and because the button never wraps it pushed the page wider
   * instead of shrinking. The pill keeps its shape — it just stops reserving
   * desktop padding on a device that has none to spare.
   */
  lg: "h-13 px-6 sm:px-8 text-[0.9375rem] gap-2.5",
  xl: "h-15 px-7 sm:px-10 text-base gap-3",
};

export interface ButtonProps extends Omit<React.ComponentPropsWithoutRef<"button">, "onAnimationStart" | "onDragStart" | "onDragEnd" | "onDrag"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Show a tick and hold it before returning to rest. */
  success?: boolean;
  successLabel?: ReactNode;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Drift toward the pointer on hover. For hero CTAs only — it is loud. */
  magnetic?: boolean;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    success = false,
    successLabel,
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    magnetic = false,
    className,
    children,
    disabled,
    onPointerDown,
    onPointerMove,
    onPointerLeave,
    ...props
  },
  forwardedRef,
) {
  const reduced = useReducedMotion();
  const localRef = useRef<HTMLButtonElement>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const rippleId = useRef(0);

  const busy = loading || success;
  const isDisabled = disabled || busy;

  const setRefs = (node: HTMLButtonElement | null) => {
    localRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    if (reduced || isDisabled) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const id = rippleId.current++;
    setRipples((r) => [
      ...r,
      { id, x: event.clientX - rect.left, y: event.clientY - rect.top },
    ]);
    setTimeout(() => setRipples((r) => r.filter((item) => item.id !== id)), 600);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    onPointerMove?.(event);
    if (!magnetic || reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    // Capped at 6px: enough to feel alive, not enough to miss the click.
    setOffset({
      x: ((event.clientX - rect.left) / rect.width - 0.5) * 12,
      y: ((event.clientY - rect.top) / rect.height - 0.5) * 8,
    });
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLButtonElement>) => {
    onPointerLeave?.(event);
    if (magnetic) setOffset({ x: 0, y: 0 });
  };

  return (
    <motion.button
      ref={setRefs}
      type="button"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "font-display relative inline-flex cursor-pointer items-center justify-center overflow-hidden",
        "rounded-pill font-semibold tracking-[0.06em] uppercase whitespace-nowrap",
        "transition-colors duration-300 select-none",
        "disabled:cursor-not-allowed disabled:opacity-55",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      animate={magnetic && !reduced ? { x: offset.x, y: offset.y } : undefined}
      whileHover={reduced || isDisabled ? undefined : { scale: 1.02 }}
      whileTap={reduced || isDisabled ? undefined : { scale: 0.97 }}
      transition={transition.pop}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      data-cursor="hover"
      {...props}
    >
      {/* Press ripples, clipped by the button's own overflow. */}
      <AnimatePresence>
        {ripples.map((ripple) => (
          <motion.span
            key={ripple.id}
            className="pointer-events-none absolute rounded-full bg-current"
            style={{ left: ripple.x, top: ripple.y }}
            initial={{ width: 0, height: 0, opacity: 0.28, x: "-50%", y: "-50%" }}
            animate={{ width: 420, height: 420, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: EASE.brand }}
          />
        ))}
      </AnimatePresence>

      {/* Content swaps between idle / loading / success without resizing the
          button — the width is owned by the widest state, so nothing jumps. */}
      <AnimatePresence mode="wait" initial={false}>
        {success ? (
          <motion.span
            key="success"
            className="relative flex items-center gap-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24, ease: EASE.spring }}
          >
            <CheckMark />
            {successLabel ?? "Done"}
          </motion.span>
        ) : loading ? (
          <motion.span
            key="loading"
            className="relative flex items-center gap-2.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <Spinner />
            <span className="opacity-80">Working</span>
          </motion.span>
        ) : (
          <motion.span
            key="idle"
            className="relative flex items-center gap-[inherit]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {leadingIcon}
            {children}
            {trailingIcon}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
});

function Spinner() {
  return (
    <span
      className="block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
  );
}

/** Stroke-drawn tick — reads as "completed", where a static glyph reads as "static". */
function CheckMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <motion.path
        d="M3 8.5L6.5 12L13 4.5"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.36, ease: EASE.brand }}
      />
    </svg>
  );
}
