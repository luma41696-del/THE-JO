"use client";

import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { t } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { JoLottie } from "@/components/brand/JoLottie";
import type { Locale, Product } from "@/types";

/**
 * AI fitting room teaser.
 *
 * Rather than describing the feature, the section *is* a working slice of it:
 * the mannequin panel swaps garments live as you click the slot chips, and the
 * size recommendation recalculates. That is the whole pitch — see the look,
 * get the size — demonstrated in about four seconds without leaving the page.
 *
 * The full experience lives at `/fitting-room`; this shares its slot model so
 * the two never drift apart.
 */

type Slot = "top" | "bottom" | "outerwear" | "shoes";

const SLOT_LABELS: Record<Slot, Record<Locale, string>> = {
  outerwear: { en: "Outerwear", ar: "معطف" },
  top: { en: "Top", ar: "علوي" },
  bottom: { en: "Bottom", ar: "سفلي" },
  shoes: { en: "Shoes", ar: "حذاء" },
};

const SLOT_CATEGORY: Record<Slot, string> = {
  outerwear: "outerwear",
  top: "knitwear",
  bottom: "trousers",
  shoes: "footwear",
};

export function FittingRoomTeaser({
  products,
  locale = "en",
}: {
  products: Product[];
  locale?: Locale;
}) {
  const reduced = useReducedMotion();
  const rtl = locale === "ar";
  const [slot, setSlot] = useState<Slot>("outerwear");

  const options = products.filter((p) => p.categoryId === SLOT_CATEGORY[slot]);
  const [index, setIndex] = useState(0);
  const active = options[index % Math.max(options.length, 1)];

  // A real engine would combine the customer's fit profile with the garment's
  // `fit` block; this shows the shape of that output with the data we have.
  const recommendation = active?.fit
    ? active.fit.scale < 0
      ? { size: "M", note: rtl ? "يميل للضيق — اختر مقاساً أكبر" : "Runs small — size up" }
      : active.fit.scale > 0
        ? { size: "S", note: rtl ? "واسع — اختر مقاساً أصغر" : "Runs large — size down" }
        : { size: "M", note: rtl ? "مطابق للمقاس" : "True to size" }
    : null;

  return (
    <section className="bg-ink rounded-2xl relative overflow-hidden text-white">
      <div className="pointer-events-none absolute -end-20 -top-20 h-[30rem] w-[30rem] opacity-25">
        <JoLottie className="h-full w-full" fallbackColor="var(--color-violet-bright)" />
      </div>

      <div className="relative grid gap-10 p-7 md:p-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:p-16">
        {/* Copy */}
        <div className="flex flex-col justify-center">
          <p className="text-eyebrow font-display text-violet-bright mb-5 flex items-center gap-3 uppercase">
            <span className="bg-violet-bright inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
            {rtl ? "غرفة القياس الذكية" : "AI Fitting Room"}
          </p>

          <h2 className="font-display text-3xl font-semibold tracking-tight text-balance md:text-5xl">
            {rtl ? "جرّبها قبل أن تُشحن" : "See the whole look before it ships"}
          </h2>

          <p className="mt-5 max-w-md text-[0.9375rem] text-white/60 md:text-[1.0625rem]">
            {rtl
              ? "كوّني إطلالة كاملة، وشاهدي القطع معاً، واحصلي على المقاس المناسب من قياساتك — لا تخمين ولا إرجاع."
              : "Build a full outfit, see the pieces together, and get your size from your own measurements. No guessing, far fewer returns."}
          </p>

          <ul className="mt-8 space-y-3">
            {[
              { en: "Outfit preview across four slots", ar: "معاينة الإطلالة عبر أربع خانات" },
              { en: "Size from your measurements, not averages", ar: "مقاس من قياساتك لا من المتوسطات" },
              { en: "Recommended pieces that actually pair", ar: "قطع مقترحة تتناسق فعلاً" },
            ].map((item) => (
              <li key={item.en} className="flex items-start gap-3 text-[0.875rem] text-white/70">
                <span className="text-violet-bright mt-0.5" aria-hidden="true">
                  ✓
                </span>
                {item[locale]}
              </li>
            ))}
          </ul>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/fitting-room">
              <Button variant="violet" size="lg" magnetic>
                {rtl ? "ادخل غرفة القياس" : "Enter the fitting room"}
              </Button>
            </Link>
            <Link href="/help/sizing">
              <Button variant="ghost" size="lg" className="text-white hover:bg-white/10">
                {rtl ? "دليل المقاسات" : "Size guide"}
              </Button>
            </Link>
          </div>
        </div>

        {/* Live panel */}
        <div className="jo-glass-dark rounded-xl p-4 md:p-6">
          {/* Slot chips */}
          <div className="mb-4 flex flex-wrap gap-2">
            {(Object.keys(SLOT_LABELS) as Slot[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSlot(key);
                  setIndex(0);
                }}
                aria-pressed={slot === key}
                className={cn(
                  "rounded-pill cursor-pointer px-4 py-2 text-[0.75rem] transition-all duration-300",
                  slot === key
                    ? "bg-violet text-white"
                    : "bg-white/8 text-white/60 hover:bg-white/15 hover:text-white",
                )}
                data-cursor="hover"
              >
                {SLOT_LABELS[key][locale]}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-[1.3fr_1fr]">
            {/* Garment stage */}
            <div className="bg-paper-sunken rounded-lg relative aspect-[3/4] overflow-hidden">
              <AnimatePresence mode="wait">
                {active?.images[0] && (
                  <motion.div
                    key={active.id}
                    className="absolute inset-0"
                    initial={reduced ? undefined : { opacity: 0, scale: 1.04, filter: "blur(6px)" }}
                    animate={reduced ? undefined : { opacity: 1, scale: 1, filter: "blur(0px)" }}
                    exit={reduced ? undefined : { opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.45, ease: EASE.jo }}
                  >
                    <Image
                      src={active.images[0].url}
                      alt={active.images[0].alt}
                      fill
                      sizes="(max-width: 640px) 90vw, 26vw"
                      className="object-cover"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {options.length > 1 && (
                <button
                  type="button"
                  onClick={() => setIndex((i) => i + 1)}
                  className="jo-glass absolute end-3 bottom-3 rounded-pill cursor-pointer px-3.5 py-2 text-[0.6875rem] tracking-[0.12em] text-ink uppercase"
                  data-cursor="hover"
                >
                  {rtl ? "التالي" : "Swap"}
                </button>
              )}
            </div>

            {/* Fit readout */}
            <div className="flex flex-col gap-3">
              {active && (
                <div className="rounded-md bg-white/6 p-4">
                  <p className="text-[0.8125rem] font-medium text-white">
                    {t(active.title, locale)}
                  </p>
                  <p className="mt-1 text-[0.75rem] text-white/50">
                    {active.fit?.silhouette ?? "regular"} · {active.fit?.stretch ?? "none"}{" "}
                    {rtl ? "مرونة" : "stretch"}
                  </p>
                </div>
              )}

              {recommendation && (
                <motion.div
                  key={recommendation.size + (active?.id ?? "")}
                  className="rounded-md bg-violet/18 border border-violet/30 p-4"
                  initial={reduced ? undefined : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE.jo }}
                >
                  <p className="text-eyebrow text-violet-bright uppercase">
                    {rtl ? "مقاسك" : "Your size"}
                  </p>
                  <p className="font-display mt-1.5 text-3xl font-semibold text-white">
                    {recommendation.size}
                  </p>
                  <p className="mt-1 text-[0.75rem] text-white/60">{recommendation.note}</p>
                </motion.div>
              )}

              <div className="rounded-md mt-auto bg-white/6 p-4">
                <p className="text-[0.6875rem] tracking-[0.14em] text-white/40 uppercase">
                  {rtl ? "الإطلالة" : "This look"}
                </p>
                <p className="font-display mt-1 text-lg font-semibold tabular-nums text-white">
                  {options.length > 0 ? `${options.length}` : "0"}{" "}
                  <span className="text-[0.75rem] font-normal text-white/50">
                    {rtl ? "خيار متاح" : "options"}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
