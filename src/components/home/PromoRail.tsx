"use client";

import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { countdownParts, pad2, t } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { BrandWave } from "@/components/brand/BrandWave";
import type { Banner, BannerTone, Locale } from "@/types";

/**
 * The campaign rail — the homepage advertising surface.
 *
 * One card shape drives every campaign type: a product launch, a flash offer, a
 * seasonal story, a feature announcement. Marketing controls slot, tone, span
 * and priority from Firestore, so a campaign can be swapped without a deploy
 * and without a designer.
 *
 * What keeps it from looking like an ad block:
 *  - a deliberate asymmetric grid (one wide card, two standard) rather than
 *    equal thirds;
 *  - tone-matched typography and imagery instead of a generic card chrome;
 *  - a live countdown on anything with an `endsAt`, which is the one piece of
 *    urgency that is factual rather than manufactured;
 *  - the campaign plate parallaxes inside its frame on hover, so the card feels
 *    like a window rather than a picture.
 */

const TONES: Record<
  BannerTone,
  { shell: string; eyebrow: string; title: string; body: string; button: "primary" | "secondary" | "brand" }
> = {
  ink: {
    shell: "bg-ink text-white",
    eyebrow: "text-brand-bright",
    title: "text-white",
    body: "text-white/60",
    button: "brand",
  },
  brand: {
    shell: "bg-brand text-white",
    eyebrow: "text-white/70",
    title: "text-white",
    body: "text-white/75",
    button: "secondary",
  },
  sand: {
    shell: "bg-sand text-ink",
    eyebrow: "text-brand-deep",
    title: "text-ink",
    body: "text-ink-muted",
    button: "primary",
  },
  paper: {
    shell: "bg-paper-raised text-ink border border-line",
    eyebrow: "text-brand",
    title: "text-ink",
    body: "text-ink-muted",
    button: "primary",
  },
};

export function PromoRail({ banners, locale = "en" }: { banners: Banner[]; locale?: Locale }) {
  if (banners.length === 0) return null;

  return (
    <div className="grid auto-rows-[minmax(20rem,auto)] gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-3">
      {banners.map((banner, index) => (
        <PromoCard
          key={banner.id}
          banner={banner}
          locale={locale}
          index={index}
          className={cn(banner.span === 2 && "md:col-span-2 xl:col-span-2")}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PromoCard({
  banner,
  locale,
  index,
  className,
}: {
  banner: Banner;
  locale: Locale;
  index: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const tone = TONES[banner.tone];
  const wide = banner.span === 2;
  const lines = t(banner.title, locale).split("\n");

  return (
    <motion.article
      className={cn(
        "rounded-xl group relative isolate flex flex-col justify-between overflow-hidden",
        "p-7 md:p-9",
        tone.shell,
        className,
      )}
      initial={reduced ? undefined : { opacity: 0, y: 28 }}
      whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: 0.6, ease: EASE.brand, delay: index * 0.08 }}
      whileHover={reduced ? undefined : { y: -4 }}
    >
      {/* Media plate — scales inside the frame on hover. */}
      {banner.media && (
        <motion.div
          className="absolute inset-0 -z-10"
          animate={{ scale: 1 }}
          whileHover={reduced ? undefined : { scale: 1.06 }}
          transition={{ duration: 0.8, ease: EASE.brand }}
        >
          <Image
            src={banner.media.url}
            alt=""
            fill
            sizes={wide ? "(max-width: 768px) 100vw, 66vw" : "(max-width: 768px) 100vw, 33vw"}
            className="object-cover opacity-70 transition-opacity duration-700 group-hover:opacity-90"
          />
          <div
            className={cn(
              "absolute inset-0",
              banner.tone === "ink" || banner.tone === "brand"
                ? "bg-gradient-to-t from-black/70 via-black/25 to-transparent"
                : "bg-gradient-to-t from-white/80 via-white/35 to-transparent",
            )}
          />
        </motion.div>
      )}

      {/* Brand ripple in the corner of feature announcements. */}
      {banner.tone === "paper" && (
        <div className="pointer-events-none absolute -end-10 -top-10 h-44 w-44 opacity-30">
          <BrandWave rings={3} color="var(--color-brand)" speed={10} />
        </div>
      )}

      <header className="relative">
        {banner.eyebrow && (
          <p className={cn("text-eyebrow font-display mb-4 uppercase", tone.eyebrow)}>
            {t(banner.eyebrow, locale)}
          </p>
        )}

        <h3
          className={cn(
            "font-display font-semibold tracking-tight text-balance",
            wide ? "text-3xl md:text-5xl" : "text-2xl md:text-3xl",
            tone.title,
          )}
        >
          {lines.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </h3>

        {banner.body && (
          <p className={cn("mt-3 max-w-sm text-[0.9375rem]", tone.body)}>{t(banner.body, locale)}</p>
        )}
      </header>

      <footer className="relative mt-8 flex flex-wrap items-center gap-4">
        {banner.cta && (
          <Link href={banner.cta.href}>
            <Button variant={tone.button} size={wide ? "lg" : "md"}>
              {t(banner.cta.label, locale)}
            </Button>
          </Link>
        )}
        {banner.endsAt && <Countdown endsAt={banner.endsAt} locale={locale} tone={banner.tone} />}
      </footer>
    </motion.article>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Live countdown.
 *
 * Renders nothing on the server and on the first client paint — a timestamp
 * formatted during SSR is wrong by the time it reaches the browser, and
 * reconciling that is a guaranteed hydration mismatch.
 */
function Countdown({
  endsAt,
  locale,
  tone,
}: {
  endsAt: number;
  locale: Locale;
  tone: BannerTone;
}) {
  const [parts, setParts] = useState<ReturnType<typeof countdownParts> | null>(null);

  useEffect(() => {
    const tick = () => setParts(countdownParts(endsAt));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  if (!parts || parts.expired) return null;

  const dark = tone === "ink" || tone === "brand";
  const units: [number, string][] = [
    [parts.days, locale === "ar" ? "ي" : "d"],
    [parts.hours, locale === "ar" ? "س" : "h"],
    [parts.minutes, locale === "ar" ? "د" : "m"],
    [parts.seconds, locale === "ar" ? "ث" : "s"],
  ];

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-pill px-4 py-2 tabular-nums",
        dark ? "bg-white/12 text-white" : "bg-ink/8 text-ink",
      )}
      aria-label={locale === "ar" ? "الوقت المتبقي" : "Time remaining"}
    >
      {units.map(([value, unit], index) => (
        <span key={unit} className="flex items-baseline gap-0.5">
          <span className="font-display text-[0.9375rem] font-semibold">{pad2(value)}</span>
          <span className="text-[0.625rem] opacity-60">{unit}</span>
          {index < units.length - 1 && <span className="ms-1 opacity-30">:</span>}
        </span>
      ))}
    </div>
  );
}
