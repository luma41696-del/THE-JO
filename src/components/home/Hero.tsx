"use client";

import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { formatPrice, t } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { BrandLottie } from "@/components/brand/BrandLottie";
import { AnimatedLogo } from "@/components/brand/AnimatedLogo";
import type { Banner, Locale, Product } from "@/types";

/**
 * Homepage hero.
 *
 * Structure: an editorial headline on the left, a floating "control panel" of
 * live product cards on the right. The panel is the reference's right-hand rail
 * reinterpreted — instead of a static sidebar it is a stack of real, shoppable
 * cards that parallax at different rates, so the first screen is merchandising
 * rather than decoration.
 *
 * Motion budget: the headline masks in line by line, the panel cards settle on
 * a stagger, and the whole right column drifts on scroll. Nothing loops except
 * the brand ripple, which sits at 13% opacity behind everything.
 */

export interface HeroProps {
  banner?: Banner | null;
  products: Product[];
  locale?: Locale;
}

export function Hero({ banner, products, locale = "en" }: HeroProps) {
  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const rtl = locale === "ar";

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const panelY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : -90]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 40]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, reduced ? 1 : 0.25]);

  const headline = (banner ? t(banner.title, locale) : "Built to be worn\nfor a decade").split("\n");
  const featured = products.slice(0, 3);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden pt-32 pb-16 md:pt-44 md:pb-28"
      aria-labelledby="hero-heading"
    >
      {/* Ambient brand field. Kept under 6% so it reads as paper texture rather
          than as a shape competing with the headline for attention. */}
      <div className="pointer-events-none absolute -top-32 start-[-18%] h-[30rem] w-[30rem] opacity-[0.05] md:opacity-[0.06]">
        <BrandLottie className="h-full w-full" />
      </div>
      <div className="bg-brand-mist/40 pointer-events-none absolute end-[-20%] top-[10%] h-[46rem] w-[46rem] rounded-full blur-3xl" />

      <div className="ns-container relative">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
          {/* Copy */}
          <motion.div style={{ y: copyY, opacity: fade }}>
            {banner?.eyebrow && (
              <motion.p
                className="text-eyebrow font-display text-brand mb-6 flex items-center gap-3 uppercase"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.5, ease: EASE.brand }}
              >
                <span className="bg-brand inline-block h-1.5 w-1.5 rounded-full" />
                {t(banner.eyebrow, locale)}
              </motion.p>
            )}

            <h1 id="hero-heading" className="text-hero font-display text-ink">
              {headline.map((line, index) => (
                <span key={index} className="block overflow-hidden">
                  <motion.span
                    className="block"
                    initial={reduced ? undefined : { y: "110%" }}
                    animate={reduced ? undefined : { y: "0%" }}
                    transition={{ delay: 0.1 + index * 0.1, duration: 0.85, ease: EASE.brand }}
                  >
                    {line}
                  </motion.span>
                </span>
              ))}
            </h1>

            {/* `dir="rtl"` is needed for correct bidi shaping, but it also makes
                `start` mean "right". `w-fit` keeps the line where the LTR
                column expects it while the glyphs stay correctly ordered. */}
            {/* The counter-script accent line. In English it is the Arabic
                tagline; in Arabic it is the English one. Showing Arabic under an
                Arabic headline would just be the same sentence twice — the point
                of the line is that the brand speaks both. */}
            <motion.p
              lang={rtl ? "en" : "ar"}
              dir={rtl ? "ltr" : "rtl"}
              className={cn(
                "text-smoke mt-5 w-fit text-xl md:text-2xl",
                rtl ? "font-display tracking-tight" : "font-arabic",
              )}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              {rtl ? "Made to be kept" : "ملابس تُصنع لتبقى"}
            </motion.p>

            {banner?.body && (
              <motion.p
                className="text-ink-muted mt-7 max-w-lg text-pretty md:text-[1.0625rem]"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.42, duration: 0.6, ease: EASE.brand }}
              >
                {t(banner.body, locale)}
              </motion.p>
            )}

            <motion.div
              className="mt-10 flex flex-wrap items-center gap-3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.6, ease: EASE.brand }}
            >
              <Link href={banner?.cta?.href ?? "/shop"}>
                <Button variant="primary" size="lg" magnetic>
                  {banner?.cta ? t(banner.cta.label, locale) : rtl ? "تسوّق الآن" : "Shop the collection"}
                </Button>
              </Link>
              <Link href="/fitting-room">
                <Button variant="secondary" size="lg" leadingIcon={<SparkIcon />}>
                  {rtl ? "غرفة القياس" : "Try it on"}
                </Button>
              </Link>
            </motion.div>

            {/* Trust row — specific numbers, not adjectives. */}
            <motion.dl
              className="mt-12 flex flex-wrap gap-x-10 gap-y-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.75, duration: 0.6 }}
            >
              {[
                { value: "4.8★", label: rtl ? "من ٢٬٤٠٠ تقييم" : "from 2,400 reviews" },
                { value: "48h", label: rtl ? "شحن سريع" : "express delivery" },
                { value: "30d", label: rtl ? "إرجاع مجاني" : "free returns" },
              ].map((stat) => (
                <div key={stat.value}>
                  <dt className="font-display text-ink text-xl font-semibold tabular-nums">
                    {stat.value}
                  </dt>
                  <dd className="text-mist mt-0.5 text-[0.75rem] tracking-wide">{stat.label}</dd>
                </div>
              ))}
            </motion.dl>
          </motion.div>

          {/* Floating product panel */}
          <motion.div className="relative" style={{ y: panelY }}>
            <div className="relative mx-auto max-w-md lg:max-w-none">
              {/* Campaign plate behind the cards */}
              {banner?.media && (
                <motion.div
                  className="rounded-2xl relative aspect-[4/3] overflow-hidden"
                  initial={{ opacity: 0, scale: 0.94, rotate: -2 }}
                  animate={{ opacity: 1, scale: 1, rotate: -1.5 }}
                  transition={{ delay: 0.2, duration: 0.9, ease: EASE.brand }}
                >
                  <Image
                    src={banner.media.url}
                    alt={banner.media.alt}
                    fill
                    priority
                    sizes="(max-width: 1024px) 90vw, 44vw"
                    className="object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-6">
                    <AnimatedLogo tone="onDark" className="h-12 w-12" intro={false} alwaysWave title={null} />
                    <span className="font-display text-[0.625rem] tracking-[0.2em] text-white/70 uppercase">
                      {rtl ? "أتلييه الشتاء ٠١" : "Winter Atelier 01"}
                    </span>
                  </div>
                </motion.div>
              )}

              {/* Live product cards, offset over the plate */}
              <div className="relative -mt-16 flex gap-4 ps-6 pe-2 md:-mt-20">
                {featured.map((product, index) => (
                  <HeroProductCard
                    key={product.id}
                    product={product}
                    locale={locale}
                    index={index}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function HeroProductCard({
  product,
  locale,
  index,
}: {
  product: Product;
  locale: Locale;
  index: number;
}) {
  const image = product.images[0];
  if (!image) return null;

  return (
    <motion.div
      className="min-w-0 flex-1"
      initial={{ opacity: 0, y: 40, rotate: index === 1 ? 0 : index === 0 ? -3 : 3 }}
      animate={{ opacity: 1, y: index === 1 ? -18 : 0, rotate: index === 1 ? 0 : index === 0 ? -2 : 2 }}
      transition={{ delay: 0.45 + index * 0.12, duration: 0.8, ease: EASE.brand }}
      whileHover={{ y: index === 1 ? -30 : -12, rotate: 0, transition: { duration: 0.4 } }}
    >
      <Link
        href={`/product/${product.slug}`}
        className="block"
        data-cursor="view"
        data-cursor-label={locale === "ar" ? "عرض" : "View"}
      >
        <div className="ns-glass rounded-lg shadow-float overflow-hidden p-1.5">
          <div className="bg-paper-sunken rounded-md relative aspect-[3/4] overflow-hidden">
            <Image
              src={image.url}
              alt={image.alt}
              fill
              sizes="(max-width: 768px) 30vw, 15vw"
              className="object-cover"
            />
          </div>
          <div className="px-2 pt-2.5 pb-1.5">
            <p className="text-ink truncate text-[0.75rem] font-medium">{t(product.title, locale)}</p>
            <p className="text-brand mt-0.5 text-[0.75rem] font-semibold tabular-nums">
              {formatPrice(product.price, product.currency, locale)}
            </p>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function SparkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5 9.4 6l4.6 1.4L9.4 8.9 8 13.5 6.6 8.9 2 7.4 6.6 6 8 1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
