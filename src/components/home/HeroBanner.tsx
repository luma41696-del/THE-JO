"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Link } from "@/components/ui/Link";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { t } from "@/lib/format";
import type { Banner, BannerTextPosition, Locale, SlotDisplay } from "@/types";

/**
 * The homepage hero, driven entirely by banner documents.
 *
 * This replaced a hand-built section whose headline, artwork and product cards
 * were all in the source. Changing the shop's first screen meant a deploy, and
 * turning it off was not possible at all.
 *
 * Three things it is careful about:
 *
 *  - **Off means off.** With no live banner it renders a compact page heading
 *    and nothing else — no reserved space, and emphatically not the old
 *    "Built to be worn for a decade" copy, which is gone from the codebase
 *    rather than kept as a fallback. A fallback would mean hiding the hero
 *    silently republished last season's slogan.
 *  - **The page keeps an `h1`.** A homepage with no top-level heading is a
 *    real accessibility and SEO regression, so the heading survives the banner
 *    being switched off; it just stops being a billboard.
 *  - **Art direction, not resizing.** A wide hero crop is useless on a phone,
 *    so a separate portrait image is served under `md` — the same reason a
 *    magazine does not print its cover sideways.
 */

export interface HeroBannerProps {
  banners: Banner[];
  locale?: Locale;
  display?: SlotDisplay;
  /** Seconds per slide when there is more than one. */
  interval?: number;
  /** Shown as the page heading when no banner is live. */
  fallbackHeading: string;
}

/** Tailwind placement for each of the seven text positions. */
const PLACEMENT: Record<BannerTextPosition, string> = {
  "start-top": "items-start justify-start text-start",
  "start-middle": "items-center justify-start text-start",
  "start-bottom": "items-end justify-start text-start",
  "center-middle": "items-center justify-center text-center",
  "end-top": "items-start justify-end text-end",
  "end-middle": "items-center justify-end text-end",
  "end-bottom": "items-end justify-end text-end",
};

export function HeroBanner({
  banners,
  locale = "en",
  display = "single",
  interval = 6,
  fallbackHeading,
}: HeroBannerProps) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);

  const slides = display === "carousel" ? banners : banners.slice(0, 1);
  const count = slides.length;

  const advance = useCallback(
    (step: number) => setIndex((i) => (count === 0 ? 0 : (i + step + count) % count)),
    [count],
  );

  /*
   * Auto-advance stops under `prefers-reduced-motion`. A carousel that moves
   * on its own is the canonical vestibular trigger, and WCAG 2.2.2 requires a
   * way to stop it — honouring the OS setting is that way.
   */
  useEffect(() => {
    if (count < 2 || reduced) return;
    const id = window.setInterval(() => advance(1), Math.max(3, interval) * 1000);
    return () => window.clearInterval(id);
  }, [count, interval, reduced, advance]);

  /*
   * No live banner: a heading, and straight on to the content.
   *
   * `sr-only` would be the wrong call — a page whose only h1 is invisible
   * reads as an empty page to a sighted visitor too. It is small and quiet
   * instead, and takes a single line rather than a hole where the hero was.
   */
  if (count === 0) {
    return (
      <section className="ns-container pt-28 pb-6 md:pt-36 md:pb-8">
        <h1 className="font-display text-ink text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          {fallbackHeading}
        </h1>
      </section>
    );
  }

  const banner = slides[Math.min(index, count - 1)]!;
  const position = banner.textPosition ?? "start-middle";
  const dark = banner.textTone !== "dark";
  const scrim = banner.scrim ?? 0.35;

  return (
    <section className="ns-container pt-24 md:pt-32" aria-roledescription={count > 1 ? "carousel" : undefined}>
      <div className="rounded-xl relative isolate overflow-hidden">
        {/* Aspect ratio differs by breakpoint because the artwork does. */}
        <div className="relative aspect-[4/5] w-full sm:aspect-[16/10] lg:aspect-[21/9]">
          <AnimatePresence mode="sync">
            <motion.div
              key={banner.id}
              className="absolute inset-0"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduced ? undefined : { opacity: 0 }}
              transition={{ duration: 0.6, ease: EASE.brand }}
            >
              {banner.media && (
                <Image
                  src={banner.media.url}
                  alt={banner.media.alt}
                  fill
                  // The first hero is the largest paint on the page; every
                  // later slide is not, and preloading them all would cost the
                  // one metric this component is judged on.
                  priority={index === 0}
                  sizes="100vw"
                  className={cn(
                    "object-cover",
                    banner.mediaMobile ? "hidden sm:block" : undefined,
                  )}
                />
              )}
              {banner.mediaMobile && (
                <Image
                  src={banner.mediaMobile.url}
                  alt={banner.mediaMobile.alt}
                  fill
                  priority={index === 0}
                  sizes="100vw"
                  className="object-cover sm:hidden"
                />
              )}

              {/*
                A scrim, not a filter on the image: a photograph chosen for a
                bright sky will swallow white text without one, and how much is
                needed is a property of that image, so the merchant sets it.
              */}
              <div
                aria-hidden="true"
                className={cn(
                  "absolute inset-0",
                  dark
                    ? "bg-gradient-to-t from-ink via-ink/40 to-transparent"
                    : "bg-gradient-to-t from-white via-white/40 to-transparent",
                )}
                style={{ opacity: scrim }}
              />
            </motion.div>
          </AnimatePresence>

          <div
            className={cn(
              "absolute inset-0 flex p-6 md:p-12 lg:p-16",
              PLACEMENT[position],
            )}
          >
            <motion.div
              key={`${banner.id}-copy`}
              className="max-w-xl"
              initial={reduced ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE.brand, delay: 0.1 }}
            >
              {banner.eyebrow && (
                <p
                  className={cn(
                    "text-eyebrow mb-3 uppercase",
                    dark ? "text-white/80" : "text-ink/70",
                  )}
                >
                  {t(banner.eyebrow, locale)}
                </p>
              )}

              <h1
                className={cn(
                  // `whitespace-pre-line` so a line break the merchant typed
                  // in the admin is the line break they get on the page.
                  "font-display text-3xl font-semibold tracking-tight text-balance whitespace-pre-line md:text-5xl lg:text-6xl",
                  dark ? "text-white" : "text-ink",
                )}
              >
                {t(banner.title, locale)}
              </h1>

              {banner.body && (
                <p
                  className={cn(
                    "mt-4 max-w-md text-pretty md:text-[1.0625rem]",
                    dark ? "text-white/85" : "text-ink-muted",
                  )}
                >
                  {t(banner.body, locale)}
                </p>
              )}

              {banner.cta && (
                <div className="mt-7">
                  <Link href={banner.cta.href}>
                    <Button variant={dark ? "paper" : "brand"} size="lg" magnetic>
                      {t(banner.cta.label, locale)}
                    </Button>
                  </Link>
                </div>
              )}
            </motion.div>
          </div>
        </div>

        {count > 1 && (
          <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-2">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`${locale === "ar" ? "الشريحة" : "Slide"} ${i + 1}`}
                aria-current={i === index}
                className={cn(
                  // A 32px hit area around an 8px dot: the dot is the affordance,
                  // the padding is what makes it tappable.
                  "grid h-8 w-8 cursor-pointer place-items-center",
                )}
                data-cursor="hover"
              >
                <span
                  className={cn(
                    "block h-2 rounded-full transition-all duration-300",
                    i === index ? "w-6 bg-white" : "w-2 bg-white/50",
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
