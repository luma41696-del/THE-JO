"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";
import { formatPrice, t } from "@/lib/format";
import { recommendSize, type BodyProfile } from "@/lib/fitting";
import { useCart } from "@/lib/store/cart";
import { useUI } from "@/lib/store/ui";
import { Button } from "@/components/ui/Button";
import { JoWave } from "@/components/brand/JoWave";
import type { Locale, OutfitSlot, Product } from "@/types";

/**
 * AI fitting room.
 *
 * Two jobs, deliberately kept on one screen:
 *
 *   1. **Compose a look.** Slots for outerwear / top / bottom / shoes /
 *      accessory. The stage stacks the chosen pieces so the combination can be
 *      judged as an outfit, which is the thing a grid of product cards can
 *      never show.
 *
 *   2. **Answer "will it fit".** The measurement panel feeds `recommendSize`,
 *      which compares the customer's body against each garment's measurement
 *      table and ease profile. It returns a confidence score, and below 0.6 the
 *      UI says "between sizes" instead of inventing certainty — a wrong
 *      confident answer costs a return, a hedged one costs nothing.
 *
 * The garment renders here are placeholders for a real try-on pipeline. The
 * data model (`Outfit`, `FitRecommendation`, `Product.fit`) is the real thing,
 * so swapping the stage for generated imagery is a component change, not a
 * rewrite.
 */

const SLOTS: { id: OutfitSlot; label: Record<Locale, string>; categories: string[] }[] = [
  { id: "outerwear", label: { en: "Outerwear", ar: "معطف" }, categories: ["outerwear"] },
  { id: "top", label: { en: "Top", ar: "علوي" }, categories: ["knitwear", "dresses"] },
  { id: "bottom", label: { en: "Bottom", ar: "سفلي" }, categories: ["trousers"] },
  { id: "shoes", label: { en: "Shoes", ar: "حذاء" }, categories: ["footwear"] },
  { id: "accessory", label: { en: "Accessory", ar: "إكسسوار" }, categories: ["bags"] },
];

export function FittingRoom({
  products,
  initialSlug,
  locale = "en",
}: {
  products: Product[];
  initialSlug?: string;
  locale?: Locale;
}) {
  const reduced = useReducedMotion();
  const rtl = locale === "ar";

  const add = useCart((s) => s.add);
  const openCart = useUI((s) => s.openCart);

  const [activeSlot, setActiveSlot] = useState<OutfitSlot>("top");
  const [outfit, setOutfit] = useState<Partial<Record<OutfitSlot, Product>>>(() => {
    const seeded = initialSlug ? products.find((p) => p.slug === initialSlug) : undefined;
    if (!seeded) return {};
    const slot = SLOTS.find((s) => s.categories.includes(seeded.categoryId));
    return slot ? { [slot.id]: seeded } : {};
  });

  const [body, setBody] = useState<BodyProfile>({
    heightCm: 172,
    chestCm: 94,
    waistCm: 78,
    hipCm: 100,
    preferredFit: "regular",
  });
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const slotConfig = SLOTS.find((s) => s.id === activeSlot)!;
  const options = useMemo(
    () => products.filter((p) => slotConfig.categories.includes(p.categoryId)),
    [products, slotConfig],
  );

  const chosen = Object.entries(outfit).filter(([, p]) => Boolean(p)) as [OutfitSlot, Product][];
  const lookTotal = chosen.reduce((sum, [, product]) => sum + product.price, 0);
  const currency = chosen[0]?.[1].currency ?? "JOD";

  /** Size advice for every piece currently in the look. */
  const recommendations = useMemo(
    () => chosen.map(([slot, product]) => ({ slot, product, fit: recommendSize(product, body) })),
    [chosen, body],
  );

  function pick(product: Product) {
    setOutfit((current) => ({
      ...current,
      // Tapping the chosen piece again clears the slot.
      [activeSlot]: current[activeSlot]?.id === product.id ? undefined : product,
    }));
  }

  async function addLookToBag() {
    setAdding(true);
    await new Promise((r) => setTimeout(r, 450));

    for (const { product, fit } of recommendations) {
      const colorId = product.colors[0]?.id;
      const sizeId = fit.recommendedSizeId ?? product.sizes[0]?.id;
      if (colorId && sizeId) add({ product, colorId, sizeId, quantity: 1 });
    }

    setAdding(false);
    setAdded(true);
    setTimeout(() => {
      setAdded(false);
      openCart();
    }, 900);
  }

  return (
    <div className="jo-container pb-24">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
        {/* ------------------------------------------------------------------ */}
        {/* Stage                                                              */}
        {/* ------------------------------------------------------------------ */}
        <div className="bg-ink rounded-2xl relative overflow-hidden">
          <div className="pointer-events-none absolute -end-16 -top-16 h-96 w-96 opacity-25">
            <JoWave rings={4} color="var(--color-violet-bright)" speed={13} />
          </div>

          <div className="relative flex h-full flex-col p-6 md:p-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-eyebrow font-display text-violet-bright flex items-center gap-2 uppercase">
                  <span className="bg-violet-bright h-1.5 w-1.5 animate-pulse rounded-full" />
                  {rtl ? "غرفة القياس" : "Fitting room"}
                </p>
                <h2 className="font-display mt-2 text-xl font-semibold text-white">
                  {rtl ? "إطلالتك" : "Your look"}
                </h2>
              </div>

              {chosen.length > 0 && (
                <button
                  type="button"
                  onClick={() => setOutfit({})}
                  className="cursor-pointer text-[0.75rem] text-white/50 transition-colors hover:text-white"
                  data-cursor="hover"
                >
                  {rtl ? "إفراغ" : "Clear"}
                </button>
              )}
            </div>

            {/* Garment stack */}
            <div className="relative mt-6 flex-1">
              {chosen.length === 0 ? (
                <div className="flex h-full min-h-80 flex-col items-center justify-center text-center">
                  <div className="h-24 w-24 opacity-50">
                    <JoWave rings={3} color="#ffffff" speed={7} />
                  </div>
                  <p className="mt-5 max-w-[24ch] text-[0.9375rem] text-white/50">
                    {rtl
                      ? "اختر قطعة من اليمين لبدء تكوين إطلالتك."
                      : "Pick a piece to start building the look."}
                  </p>
                </div>
              ) : (
                <div className="grid min-h-80 grid-cols-2 gap-3 sm:grid-cols-3">
                  <AnimatePresence mode="popLayout">
                    {chosen.map(([slot, product], index) => (
                      <motion.div
                        key={slot}
                        layout
                        initial={reduced ? undefined : { opacity: 0, y: 24, scale: 0.94 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ ...transition.base, delay: index * 0.04 }}
                        className={cn(
                          "rounded-lg relative overflow-hidden bg-white/5",
                          // The hero piece of the look gets the bigger tile.
                          slot === "outerwear" || slot === "top" ? "row-span-2" : "",
                        )}
                      >
                        {product.images[0] && (
                          <Image
                            src={product.images[0].url}
                            alt={product.images[0].alt}
                            fill
                            sizes="(max-width: 1024px) 45vw, 18vw"
                            className="object-cover"
                          />
                        )}
                        <span className="absolute start-2 top-2 rounded-pill bg-black/45 px-2.5 py-1 text-[0.625rem] tracking-[0.1em] text-white/85 uppercase backdrop-blur-sm">
                          {SLOTS.find((s) => s.id === slot)?.label[locale]}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOutfit((c) => ({ ...c, [slot]: undefined }))}
                          aria-label={`Remove ${t(product.title, locale)}`}
                          className="absolute end-2 top-2 grid h-6 w-6 cursor-pointer place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                          data-cursor="hover"
                        >
                          <span aria-hidden="true" className="text-[0.75rem]">
                            ×
                          </span>
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Look summary */}
            {chosen.length > 0 && (
              <motion.div
                className="jo-glass-dark rounded-xl mt-6 p-5"
                initial={reduced ? undefined : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={transition.base}
              >
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[0.6875rem] tracking-[0.14em] text-white/40 uppercase">
                      {rtl ? "إجمالي الإطلالة" : "Look total"}
                    </p>
                    <p className="font-display mt-1 text-2xl font-semibold text-white tabular-nums">
                      {formatPrice(lookTotal, currency, locale)}
                    </p>
                    <p className="mt-0.5 text-[0.75rem] text-white/40">
                      {chosen.length} {rtl ? "قطعة" : chosen.length === 1 ? "piece" : "pieces"}
                    </p>
                  </div>

                  <Button
                    variant="violet"
                    size="lg"
                    magnetic
                    loading={adding}
                    success={added}
                    successLabel={rtl ? "أُضيفت" : "Added"}
                    onClick={addLookToBag}
                  >
                    {rtl ? "أضف الإطلالة" : "Add the look"}
                  </Button>
                </div>
              </motion.div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Controls                                                           */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex flex-col gap-5">
          {/* Slot tabs */}
          <div
            className="jo-no-scrollbar flex gap-2 overflow-x-auto"
            role="tablist"
            aria-label={rtl ? "خانات الإطلالة" : "Outfit slots"}
          >
            {SLOTS.map((slot) => {
              const filled = Boolean(outfit[slot.id]);
              const active = activeSlot === slot.id;
              return (
                <button
                  key={slot.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveSlot(slot.id)}
                  className={cn(
                    "rounded-pill relative shrink-0 cursor-pointer border px-4 py-2.5 text-[0.8125rem] transition-all duration-300",
                    active
                      ? "border-ink bg-ink text-white"
                      : "border-line text-ink-muted hover:border-ink/40 bg-paper-raised",
                  )}
                  data-cursor="hover"
                >
                  {slot.label[locale]}
                  {filled && (
                    <span
                      className={cn(
                        "absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2",
                        active ? "border-ink bg-violet-bright" : "border-paper bg-violet",
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Measurements */}
          <div className="bg-paper-raised border-line rounded-xl border">
            <button
              type="button"
              onClick={() => setShowMeasurements((v) => !v)}
              aria-expanded={showMeasurements}
              className="flex w-full cursor-pointer items-center justify-between gap-4 p-5 text-start"
              data-cursor="hover"
            >
              <span>
                <span className="font-display text-ink block text-[0.9375rem] font-semibold">
                  {rtl ? "قياساتك" : "Your measurements"}
                </span>
                <span className="text-smoke mt-0.5 block text-[0.8125rem]">
                  {body.heightCm}cm · {rtl ? "صدر" : "chest"} {body.chestCm} ·{" "}
                  {rtl ? "خصر" : "waist"} {body.waistCm}
                </span>
              </span>
              <motion.span
                animate={{ rotate: showMeasurements ? 180 : 0 }}
                transition={{ duration: 0.3, ease: EASE.jo }}
                className="text-mist"
                aria-hidden="true"
              >
                ▾
              </motion.span>
            </button>

            <AnimatePresence initial={false}>
              {showMeasurements && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={transition.base}
                  className="overflow-hidden"
                >
                  <div className="border-line grid gap-5 border-t p-5">
                    <Slider
                      label={rtl ? "الطول" : "Height"}
                      unit="cm"
                      min={145}
                      max={205}
                      value={body.heightCm ?? 172}
                      onChange={(v) => setBody({ ...body, heightCm: v })}
                    />
                    <Slider
                      label={rtl ? "محيط الصدر" : "Chest"}
                      unit="cm"
                      min={75}
                      max={130}
                      value={body.chestCm ?? 94}
                      onChange={(v) => setBody({ ...body, chestCm: v })}
                    />
                    <Slider
                      label={rtl ? "محيط الخصر" : "Waist"}
                      unit="cm"
                      min={60}
                      max={125}
                      value={body.waistCm ?? 78}
                      onChange={(v) => setBody({ ...body, waistCm: v })}
                    />
                    <Slider
                      label={rtl ? "محيط الورك" : "Hip"}
                      unit="cm"
                      min={80}
                      max={135}
                      value={body.hipCm ?? 100}
                      onChange={(v) => setBody({ ...body, hipCm: v })}
                    />

                    <div>
                      <span className="text-eyebrow font-display text-mist mb-2 block uppercase">
                        {rtl ? "القَصّة المفضلة" : "Preferred fit"}
                      </span>
                      <div className="flex gap-2">
                        {(["slim", "regular", "relaxed"] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setBody({ ...body, preferredFit: option })}
                            aria-pressed={body.preferredFit === option}
                            className={cn(
                              "rounded-pill flex-1 cursor-pointer border px-3 py-2 text-[0.75rem] capitalize transition-all",
                              body.preferredFit === option
                                ? "border-ink bg-ink text-white"
                                : "border-line text-ink-muted hover:border-ink/40",
                            )}
                            data-cursor="hover"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>

                    <p className="text-mist text-[0.75rem]">
                      {rtl
                        ? "تُستخدم القياسات لحساب المقاس فقط، ولا تُشارك مع أي طرف."
                        : "Measurements are used to calculate your size and are never shared. Sign in to save them to your account."}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Fit readout for the current look */}
          {recommendations.length > 0 && (
            <div className="bg-violet-veil rounded-xl p-5">
              <h3 className="text-eyebrow font-display text-violet mb-3 uppercase">
                {rtl ? "المقاسات المقترحة" : "Your sizes"}
              </h3>
              <ul className="space-y-2.5">
                {recommendations.map(({ slot, product, fit }) => {
                  const size = product.sizes.find((s) => s.id === fit.recommendedSizeId);
                  const unsure = fit.confidence < 0.6;
                  return (
                    <li key={slot} className="flex items-center justify-between gap-3">
                      <span className="text-ink min-w-0 flex-1 truncate text-[0.8125rem]">
                        {t(product.title, locale)}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className={cn(
                            "rounded-xs px-2 py-1 text-[0.75rem] font-semibold",
                            unsure ? "bg-sand text-ink" : "bg-violet text-white",
                          )}
                        >
                          {unsure
                            ? rtl
                              ? "بين مقاسين"
                              : "Between sizes"
                            : (size?.label ?? "—")}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-smoke mt-3 text-[0.75rem]">
                {t(recommendations[0]!.fit.rationale, locale)}
              </p>
            </div>
          )}

          {/* Options for the active slot */}
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display text-ink text-[0.9375rem] font-semibold">
                {rtl ? "اختر" : "Choose"} {slotConfig.label[locale].toLowerCase()}
              </h3>
              <span className="text-mist text-[0.75rem] tabular-nums">
                {options.length} {rtl ? "خيار" : "options"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {options.map((product) => {
                const selected = outfit[activeSlot]?.id === product.id;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => pick(product)}
                    aria-pressed={selected}
                    className={cn(
                      "rounded-lg group relative cursor-pointer overflow-hidden text-start transition-all duration-300",
                      "ring-offset-paper ring-offset-2",
                      selected ? "ring-violet ring-2" : "ring-transparent hover:ring-line-strong ring-1",
                    )}
                    data-cursor="hover"
                  >
                    <div className="bg-paper-sunken relative aspect-[3/4]">
                      {product.images[0] && (
                        <Image
                          src={product.images[0].url}
                          alt=""
                          fill
                          sizes="(max-width: 640px) 45vw, 15vw"
                          className="object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                      )}
                      {selected && (
                        <motion.span
                          className="bg-violet absolute end-2 top-2 grid h-6 w-6 place-items-center rounded-full text-[0.75rem] text-white"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ duration: 0.3, ease: EASE.spring }}
                        >
                          ✓
                        </motion.span>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-ink truncate text-[0.75rem] font-medium">
                        {t(product.title, locale)}
                      </p>
                      <p className="text-smoke mt-0.5 text-[0.75rem] tabular-nums">
                        {formatPrice(product.price, product.currency, locale)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {options.length === 0 && (
              <p className="border-line text-smoke rounded-lg border border-dashed py-10 text-center text-[0.875rem]">
                {rtl ? "لا توجد خيارات في هذه الخانة بعد." : "Nothing in this slot yet."}
              </p>
            )}
          </div>

          <p className="text-mist text-center text-[0.75rem]">
            {rtl ? "تفضّل الشراء المباشر؟ " : "Prefer to browse normally? "}
            <Link href="/shop" className="text-ink underline underline-offset-2">
              {rtl ? "تصفّح المجموعة" : "Shop the collection"}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Slider({
  label,
  unit,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = `fit-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className="mb-2 flex items-baseline justify-between">
        <span className="text-ink-muted text-[0.8125rem]">{label}</span>
        <span className="font-display text-ink text-[0.875rem] font-semibold tabular-nums">
          {value}
          <span className="text-mist ms-0.5 text-[0.75rem] font-normal">{unit}</span>
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-violet bg-line h-1 w-full cursor-pointer appearance-none rounded-full"
        style={{
          background: `linear-gradient(to right, var(--color-violet) ${
            ((value - min) / (max - min)) * 100
          }%, var(--color-line) ${((value - min) / (max - min)) * 100}%)`,
        }}
      />
    </div>
  );
}
