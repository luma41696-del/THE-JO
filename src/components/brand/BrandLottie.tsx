"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { LottieRefCurrentProps } from "lottie-react";

import { cn } from "@/lib/utils";
import { BrandWave } from "./BrandWave";

/**
 * Lottie player for `public/lottie/net-sale-wave.json`.
 *
 * That file is generated from the same traced vectors as the rest of the brand
 * (see `scripts/generate-brand.mjs`): the pebble morphs through its wave states
 * while red ripple rings expand out of it.
 *
 * Cost control, because a Lottie player is ~60KB of JS:
 *  - the player and the JSON are both fetched lazily, only once the component
 *    scrolls into view;
 *  - `BrandWave` renders in the meantime and permanently replaces it under
 *    `prefers-reduced-motion`, so nothing is downloaded that will not play.
 */

export interface BrandLottieProps {
  className?: string;
  loop?: boolean;
  /** Start paused and play on hover — used by the fitting-room teaser. */
  playOnHover?: boolean;
  /** Fallback while loading and under reduced motion. */
  fallbackColor?: string;
}

type LottieModule = typeof import("lottie-react");

export function BrandLottie({
  className,
  loop = true,
  playOnHover = false,
  fallbackColor = "var(--color-brand)",
}: BrandLottieProps) {
  const reduced = useReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<LottieRefCurrentProps>(null);

  const [inView, setInView] = useState(false);
  const [Lottie, setLottie] = useState<LottieModule["default"] | null>(null);
  const [data, setData] = useState<object | null>(null);

  // Only start loading once the element is actually about to be seen.
  useEffect(() => {
    const node = hostRef.current;
    if (!node || reduced) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (!inView || reduced) return;
    let cancelled = false;

    void (async () => {
      try {
        const [mod, json] = await Promise.all([
          import("lottie-react"),
          fetch("/lottie/net-sale-wave.json").then((r) => {
            if (!r.ok) throw new Error(`lottie ${r.status}`);
            return r.json();
          }),
        ]);
        if (cancelled) return;
        setLottie(() => mod.default);
        setData(json);
      } catch {
        // Leave `BrandWave` in place — it is a complete substitute, not a spinner.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inView, reduced]);

  const ready = Lottie && data && !reduced;

  return (
    <div
      ref={hostRef}
      className={cn("relative", className)}
      aria-hidden="true"
      onMouseEnter={playOnHover ? () => lottieRef.current?.play() : undefined}
      onMouseLeave={playOnHover ? () => lottieRef.current?.pause() : undefined}
    >
      {ready ? (
        <Lottie
          lottieRef={lottieRef}
          animationData={data}
          loop={loop}
          autoplay={!playOnHover}
          className="h-full w-full"
          rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }}
        />
      ) : (
        <BrandWave solidCore rings={3} color={fallbackColor} className="h-full w-full" />
      )}
    </div>
  );
}
