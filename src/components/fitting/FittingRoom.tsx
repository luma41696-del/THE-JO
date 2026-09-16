"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { transition } from "@/lib/motion";
import { formatPrice, t } from "@/lib/format";
import { recommendSize, type BodyProfile } from "@/lib/fitting";
import { avatarFromProfile } from "@/lib/fitting/avatar";
import { SKIP_TEXT, isBuyable, suggestLook, type SkipReason } from "@/lib/fitting/suggest";
import { hasDesigns, resolveSelection } from "@/lib/product";
import { getIdToken } from "@/lib/firebase/auth";
import { ApiError, errorMessage, readJson } from "@/lib/errors";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCart } from "@/lib/store/cart";
import { useUI } from "@/lib/store/ui";
import { Button } from "@/components/ui/Button";
import { BrandWave } from "@/components/brand/BrandWave";
import { AvatarStage, type StageGarment } from "./AvatarStage";
import { BodyPanel } from "./BodyPanel";
import type {
  FitProfile,
  Locale,
  Outfit,
  OutfitSlot,
  OutfitSlotItem,
  Product,
  Season,
} from "@/types";

/**
 * The fitting room.
 *
 * Three jobs on one screen, and the order matters:
 *
 *   1. **See it on a body that is yours.** `AvatarStage` lathes a figure from
 *      the customer's own measurements and dresses it with garments cut to the
 *      ease their silhouette implies. It is a parametric mannequin, not a
 *      reconstruction of a photograph, and the page says exactly that where
 *      the figure is — see FITTING-ROOM.md for what would be required to go
 *      further, and what it would cost.
 *
 *   2. **Answer "will it fit".** `recommendSize` scores each size against the
 *      body and returns one of four outcomes. It is rendered in its own panel,
 *      deliberately away from the figure: a number that comes from a
 *      measurement table must not look like a property of a render.
 *
 *   3. **Buy the look.** Size, colour and stock resolve to a real variant
 *      before anything reaches the bag, and a piece that cannot be added says
 *      so by name instead of quietly vanishing from the order.
 */

const SLOTS: { id: OutfitSlot; label: Record<Locale, string>; categories: string[] }[] = [
  /*
   * Slots are matched against a product's whole `categoryPath`, not its leaf
   * `categoryId`.
   *
   * Matching the leaf worked until products moved into subcategories: a pair
   * of trousers filed under `trousers-wide` stopped matching `["trousers"]`,
   * and the bottom slot simply had nothing in it. No error — just an empty
   * picker that looked like the shop had no trousers.
   */
  { id: "outerwear", label: { en: "Outerwear", ar: "معطف" }, categories: ["outerwear"] },
  { id: "top", label: { en: "Top", ar: "علوي" }, categories: ["knitwear", "dresses"] },
  { id: "bottom", label: { en: "Bottom", ar: "سفلي" }, categories: ["trousers"] },
  { id: "shoes", label: { en: "Shoes", ar: "حذاء" }, categories: ["footwear"] },
  { id: "accessory", label: { en: "Accessory", ar: "إكسسوار" }, categories: ["bags"] },
];

const SEASONS: { id: Season | "any"; en: string; ar: string }[] = [
  { id: "any", en: "Any season", ar: "كل المواسم" },
  { id: "winter", en: "Winter", ar: "الشتاء" },
  { id: "spring", en: "Spring", ar: "الربيع" },
  { id: "summer", en: "Summer", ar: "الصيف" },
  { id: "autumn", en: "Autumn", ar: "الخريف" },
];

/** Root-first ancestry, falling back to the leaf for pre-tree products. */
const pathOf = (product: Product) =>
  product.categoryPath?.length ? product.categoryPath : [product.categoryId];

export function FittingRoom({
  products,
  initialSlug,
  locale = "en",
  providerConfigured = false,
  providerMissing = [],
}: {
  products: Product[];
  initialSlug?: string;
  locale?: Locale;
  providerConfigured?: boolean;
  providerMissing?: string[];
}) {
  const reduced = useReducedMotion();
  const rtl = locale === "ar";

  const add = useCart((s) => s.add);
  const openCart = useUI((s) => s.openCart);
  const uid = useAuth().user?.uid ?? null;

  const [activeSlot, setActiveSlot] = useState<OutfitSlot>("top");
  const [outfit, setOutfit] = useState<Partial<Record<OutfitSlot, Product>>>(() => {
    const seeded = initialSlug ? products.find((p) => p.slug === initialSlug) : undefined;
    if (!seeded) return {};
    // Match the ancestry, so a product under `trousers-wide` still finds the
    // bottom slot.
    const slot = SLOTS.find((s) => s.categories.some((c) => pathOf(seeded).includes(c)));
    return slot ? { [slot.id]: seeded } : {};
  });

  /** Chosen colourway per slot. Empty means "the product's first colour". */
  const [colourway, setColourway] = useState<Partial<Record<OutfitSlot, string>>>({});

  const [profile, setProfile] = useState<FitProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [view, setView] = useState<"figure" | "flat">("figure");

  const [savedOutfits, setSavedOutfits] = useState<Outfit[]>([]);
  const [savingLook, setSavingLook] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);

  const [added, setAdded] = useState(false);
  const [addFailures, setAddFailures] = useState<{ title: string; why: string }[]>([]);

  const [budget, setBudget] = useState("");
  const [season, setSeason] = useState<Season | "any">("any");
  const [skipped, setSkipped] = useState<{ slot: OutfitSlot; reason: SkipReason }[]>([]);

  /* ---- the customer's own data -------------------------------------- */

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setProfileLoading(true);

    void (async () => {
      try {
        const token = await getIdToken().catch(() => null);
        const response = await fetch("/api/fitting/profile", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await response.json()) as {
          ok?: boolean;
          fitProfile?: FitProfile | null;
          outfits?: Outfit[];
        };
        if (cancelled || !data.ok) return;
        // Only adopt a saved profile over what is on screen — someone who
        // started moving sliders before the fetch landed keeps their edits.
        setProfile((current) => current ?? data.fitProfile ?? null);
        setSavedOutfits(data.outfits ?? []);
      } catch {
        // A failed read is not worth an error banner: the panel works, it
        // just starts empty. The save path reports its own failures.
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  /** Null until there is a height. No measurements, no figure — by design. */
  const avatar = useMemo(() => avatarFromProfile(profile), [profile]);

  const body = useMemo<BodyProfile>(
    () => ({
      heightCm: profile?.heightCm,
      chestCm: profile?.chestCm,
      waistCm: profile?.waistCm,
      hipCm: profile?.hipCm,
      preferredFit: profile?.preferredFit,
    }),
    [profile],
  );

  /* ---- the look ------------------------------------------------------ */

  const slotConfig = SLOTS.find((s) => s.id === activeSlot)!;
  const options = useMemo(
    () => products.filter((p) => slotConfig.categories.some((c) => pathOf(p).includes(c))),
    [products, slotConfig],
  );

  /*
   * Memoised on `outfit` rather than rebuilt every render: this array feeds the
   * 3D stage, and a fresh identity on every keystroke would re-lathe every
   * garment in the scene for a change that never touched them.
   */
  const chosen = useMemo(
    () => Object.entries(outfit).filter(([, p]) => Boolean(p)) as [OutfitSlot, Product][],
    [outfit],
  );

  const colourIdFor = (slot: OutfitSlot, product: Product) =>
    colourway[slot] ?? product.colors[0]?.id ?? "";

  const lookTotal = chosen.reduce((sum, [, product]) => sum + product.price, 0);
  const currency = chosen[0]?.[1].currency ?? "JOD";

  /** Size advice for every piece currently in the look. */
  const recommendations = useMemo(
    () => chosen.map(([slot, product]) => ({ slot, product, fit: recommendSize(product, body) })),
    [chosen, body],
  );

  const stageGarments = useMemo<StageGarment[]>(
    () =>
      recommendations.map(({ slot, product, fit }) => {
        const colourId = colourway[slot] ?? product.colors[0]?.id;
        const colour = product.colors.find((c) => c.id === colourId) ?? product.colors[0];

        /*
         * The recommended size's own table drives the geometry, so what is on
         * the figure is the size the panel names. Passing nothing when there
         * is no size to name is the point: the piece then falls back to the
         * silhouette's ease rather than borrowing another size's numbers.
         */
        const size = product.sizes.find((s) => s.id === fit.recommendedSizeId);

        return {
          id: `${slot}:${product.id}:${colour?.id ?? ""}:${size?.id ?? ""}`,
          categoryPath: pathOf(product),
          colour: colour?.hex ?? "#1B1717",
          silhouette: product.fit?.silhouette ?? "regular",
          measurements: size?.measurements,
        };
      }),
    [recommendations, colourway],
  );

  function pick(product: Product) {
    setAddFailures([]);
    setOutfit((current) => {
      const clearing = current[activeSlot]?.id === product.id;
      return { ...current, [activeSlot]: clearing ? undefined : product };
    });
    // A colourway belongs to the piece that was in the slot, not the slot.
    setColourway((current) => ({ ...current, [activeSlot]: undefined }));
  }

  function buildLook() {
    setAddFailures([]);
    const parsed = Number(budget);
    const result = suggestLook({
      products,
      slots: SLOTS,
      body,
      locked: outfit,
      budget: budget !== "" && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
      season,
    });
    setOutfit(result.items);
    setSkipped(result.skipped);

    /*
     * Drop the colourway of any slot whose piece changed.
     *
     * A colour id belongs to one product. Left in place across a swap it would
     * be looked up on the new piece, find nothing, and resolve to no variant —
     * so a perfectly available garment would be reported as sold out while the
     * figure quietly wore a different colour from the one the chip showed.
     */
    setColourway((current) => {
      const kept: Partial<Record<OutfitSlot, string>> = {};
      for (const slot of Object.keys(current) as OutfitSlot[]) {
        if (outfit[slot]?.id === result.items[slot]?.id) kept[slot] = current[slot];
      }
      return kept;
    });
  }

  /* ---- bag ----------------------------------------------------------- */

  function addLookToBag() {
    const failures: { title: string; why: string }[] = [];
    let addedAny = false;

    for (const { slot, product, fit } of recommendations) {
      const title = t(product.title, locale);

      // No size fits this body — adding one anyway is how a fitting room
      // becomes a returns department.
      if (fit.outcome === "no-size") {
        failures.push({
          title,
          why: rtl ? "لا يوجد مقاس مناسب" : "no size fits your measurements",
        });
        continue;
      }

      const colorId = colourIdFor(slot, product);
      const sizeId = fit.recommendedSizeId || product.sizes[0]?.id || "";

      /*
       * A piece sold with several artworks needs one chosen, and the fitting
       * room has no picker for it — the figure shows silhouette, not
       * embroidery. Sending the customer to the product page is the honest
       * answer; adding a design nobody chose would put the wrong garment in
       * the bag, and letting `add` refuse would report "sold out", which is
       * simply untrue.
       */
      if (hasDesigns(product)) {
        failures.push({
          title,
          why: rtl ? "اختر التصميم من صفحة المنتج" : "choose a design on its product page",
        });
        continue;
      }

      // `add` returns null when the variant is unbuyable. The old code
      // ignored that and showed "Added" regardless.
      const line = add({ product, colorId, sizeId, quantity: 1 });
      if (line) addedAny = true;
      else failures.push({ title, why: rtl ? "نفد هذا الخيار" : "that variant is sold out" });
    }

    setAddFailures(failures);

    if (addedAny) {
      setAdded(true);
      window.setTimeout(() => {
        setAdded(false);
        openCart();
      }, 900);
    }
  }

  async function saveLook() {
    if (!uid || chosen.length === 0) return;
    setSavingLook(true);
    setLookError(null);

    const items: Partial<Record<OutfitSlot, OutfitSlotItem>> = {};
    for (const { slot, product, fit } of recommendations) {
      const image = product.images[0];
      if (!image) continue;
      items[slot] = {
        productId: product.id,
        slug: product.slug,
        title: product.title,
        image,
        colorId: colourIdFor(slot, product),
        sizeId: fit.recommendedSizeId,
        price: product.price,
      };
    }

    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/fitting/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ outfit: { items } }),
      });
      const data = await readJson<{ ok?: boolean; id?: string; error?: string }>(response);
      if (!data.id) throw new ApiError("");

      setSavedOutfits((current) => [
        { id: data.id!, uid, items, createdAt: Date.now() },
        ...current,
      ]);
    } catch (error) {
      setLookError(
        errorMessage(error, locale, {
          en: "This look could not be saved.",
          ar: "تعذّر حفظ هذه الإطلالة.",
        }),
      );
    } finally {
      setSavingLook(false);
    }
  }

  async function deleteLook(id: string) {
    // Removed from the list first: the request is idempotent, and a look that
    // lingers on screen after "delete" is worse than one that reappears on a
    // reload if the write genuinely failed — which the banner then says.
    setSavedOutfits((current) => current.filter((saved) => saved.id !== id));
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch(`/api/fitting/profile?outfit=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      await readJson(response);
    } catch (error) {
      setLookError(
        errorMessage(error, locale, {
          en: "That look could not be deleted.",
          ar: "تعذّر حذف الإطلالة.",
        }),
      );
    }
  }

  /** Put a saved look back on the figure, as far as the catalogue allows. */
  function restoreLook(saved: Outfit) {
    const restored: Partial<Record<OutfitSlot, Product>> = {};
    const colours: Partial<Record<OutfitSlot, string>> = {};
    let missing = 0;

    for (const [slot, item] of Object.entries(saved.items) as [OutfitSlot, OutfitSlotItem][]) {
      const product = products.find((p) => p.id === item.productId);
      // A piece that has since been withdrawn is reported, not silently
      // dropped — a look that quietly loses its coat looks like a bug.
      if (!product) {
        missing += 1;
        continue;
      }
      restored[slot] = product;
      colours[slot] = item.colorId;
    }

    setOutfit(restored);
    setColourway(colours);
    setSkipped([]);
    setLookError(
      missing > 0
        ? rtl
          ? `${missing} من قطع هذه الإطلالة لم تعد متوفرة.`
          : `${missing} piece${missing === 1 ? "" : "s"} from this look ${missing === 1 ? "is" : "are"} no longer available.`
        : null,
    );
  }

  /* ------------------------------------------------------------------ */

  return (
    <div className="ns-container pb-24">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
        {/* ================================================================ */}
        {/* Stage                                                            */}
        {/* ================================================================ */}
        <div className="bg-ink rounded-2xl relative overflow-hidden">
          <div className="pointer-events-none absolute -end-16 -top-16 h-96 w-96 opacity-25">
            <BrandWave rings={4} color="var(--color-brand-bright)" speed={13} />
          </div>

          <div className="relative flex h-full flex-col p-6 md:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-eyebrow text-brand-bright flex items-center gap-2 uppercase">
                  <span className="bg-brand-bright h-1.5 w-1.5 animate-pulse rounded-full" />
                  {rtl ? "غرفة القياس" : "Fitting room"}
                </p>
                <h2 className="font-display mt-2 text-xl font-semibold text-white">
                  {rtl ? "إطلالتك" : "Your look"}
                </h2>
              </div>

              <div className="flex items-center gap-3">
                {avatar && (
                  <div
                    className="rounded-pill flex bg-white/10 p-0.5"
                    role="group"
                    aria-label={rtl ? "طريقة العرض" : "View"}
                  >
                    {(
                      [
                        { id: "figure", en: "Figure", ar: "مجسم" },
                        { id: "flat", en: "Pieces", ar: "قطع" },
                      ] as const
                    ).map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setView(mode.id)}
                        aria-pressed={view === mode.id}
                        className={cn(
                          "rounded-pill cursor-pointer px-3 py-1.5 text-[0.75rem] transition-colors",
                          view === mode.id ? "text-ink bg-white" : "text-white/60 hover:text-white",
                        )}
                        data-cursor="hover"
                      >
                        {rtl ? mode.ar : mode.en}
                      </button>
                    ))}
                  </div>
                )}

                {chosen.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setOutfit({});
                      setColourway({});
                      setSkipped([]);
                      setAddFailures([]);
                    }}
                    className="cursor-pointer text-[0.75rem] text-white/50 transition-colors hover:text-white"
                    data-cursor="hover"
                  >
                    {rtl ? "إفراغ" : "Clear"}
                  </button>
                )}
              </div>
            </div>

            {/* ---- The figure, or the pieces ------------------------- */}
            <div className="relative mt-6 flex-1">
              {avatar && view === "figure" ? (
                <>
                  {/*
                    A definite height, not `h-full`. The stage is absolutely
                    positioned inside this box, so whatever is set here is
                    exactly what the renderer gets — and the viewport cap keeps
                    the figure on screen in one piece on a phone.
                  */}
                  <AvatarStage
                    params={avatar}
                    garments={stageGarments}
                    locale={locale}
                    className="h-[min(34rem,68vh)] w-full"
                  />
                  {/*
                    On the stage itself, not in a footnote. The figure is built
                    from typed measurements; it is not a reconstruction of
                    anybody's photograph, and nobody should have to guess that.
                  */}
                  <p className="mt-2 text-center text-[0.6875rem] text-white/45">
                    {rtl
                      ? "مجسم مبني على قياساتك — وليس صورتك."
                      : "A figure built from your measurements — not from your photo."}
                  </p>
                </>
              ) : (
                <>
                  {!avatar && (
                    <p className="rounded-md mb-4 bg-white/8 px-3.5 py-2.5 text-[0.8125rem] text-white/70">
                      {profileLoading
                        ? rtl
                          ? "تُحمّل قياساتك…"
                          : "Loading your measurements…"
                        : rtl
                          ? "أضف طولك في لوحة القياسات ليُبنى المجسم."
                          : "Add your height in the measurements panel and the figure appears here."}
                    </p>
                  )}

                  {chosen.length === 0 ? (
                    <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                      <div className="h-24 w-24 opacity-50">
                        <BrandWave rings={3} color="#ffffff" speed={7} />
                      </div>
                      <p className="mt-5 max-w-[24ch] text-[0.9375rem] text-white/50">
                        {rtl
                          ? "اختر قطعة لبدء تكوين إطلالتك."
                          : "Pick a piece to start building the look."}
                      </p>
                    </div>
                  ) : (
                    <div className="grid min-h-72 grid-cols-2 gap-3 sm:grid-cols-3">
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
                            <span className="rounded-pill absolute start-2 top-2 bg-black/45 px-2.5 py-1 text-[0.625rem] tracking-[0.1em] text-white/85 uppercase backdrop-blur-sm">
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
                </>
              )}
            </div>

            {/* ---- Colourways --------------------------------------- */}
            {chosen.length > 0 && (
              <div className="mt-5 space-y-3">
                {chosen.map(([slot, product]) => {
                  if (product.colors.length < 2) return null;
                  const selected = colourIdFor(slot, product);
                  const fit = recommendations.find((r) => r.slot === slot)?.fit;
                  const sizeId = fit?.recommendedSizeId ?? product.sizes[0]?.id ?? "";

                  return (
                    <div key={slot} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 truncate text-[0.6875rem] tracking-[0.08em] text-white/40 uppercase">
                        {SLOTS.find((s) => s.id === slot)?.label[locale]}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {product.colors.map((colour) => {
                          /*
                           * Availability is per colour *and* size. A swatch
                           * that changes the figure but cannot be bought in
                           * the recommended size is a trap, so it is marked
                           * rather than silently offered.
                           */
                          const sellable = resolveSelection(product, colour.id, sizeId).buyable;
                          const active = selected === colour.id;
                          return (
                            <button
                              key={colour.id}
                              type="button"
                              onClick={() =>
                                setColourway((c) => ({ ...c, [slot]: colour.id }))
                              }
                              aria-pressed={active}
                              title={`${t(colour.name, locale)}${
                                sellable ? "" : rtl ? " — غير متوفر" : " — unavailable"
                              }`}
                              className={cn(
                                "relative h-6 w-6 cursor-pointer rounded-full transition-transform",
                                active
                                  ? "ring-brand-bright scale-110 ring-2 ring-offset-2 ring-offset-black"
                                  : "hover:scale-105",
                              )}
                              style={{
                                background: colour.hexSecondary
                                  ? `linear-gradient(135deg, ${colour.hex} 50%, ${colour.hexSecondary} 50%)`
                                  : colour.hex,
                              }}
                              data-cursor="hover"
                            >
                              <span className="sr-only">{t(colour.name, locale)}</span>
                              {!sellable && (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-0 grid place-items-center text-[0.75rem] text-white mix-blend-difference"
                                >
                                  ⁄
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ---- Look summary ------------------------------------- */}
            {chosen.length > 0 && (
              <motion.div
                className="ns-glass-dark rounded-xl mt-6 p-5"
                initial={reduced ? undefined : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={transition.base}
              >
                <div className="flex flex-wrap items-end justify-between gap-4">
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

                  <div className="flex flex-wrap items-center gap-3">
                    {uid && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={savingLook}
                        onClick={saveLook}
                        className="text-white/70 hover:text-white"
                      >
                        {rtl ? "احفظ الإطلالة" : "Save look"}
                      </Button>
                    )}
                    <Button
                      variant="brand"
                      size="lg"
                      magnetic
                      success={added}
                      successLabel={rtl ? "أُضيفت" : "Added"}
                      onClick={addLookToBag}
                    >
                      {rtl ? "أضف الإطلالة" : "Add the look"}
                    </Button>
                  </div>
                </div>

                {/* What did not make it into the bag, and why. */}
                {addFailures.length > 0 && (
                  <ul role="alert" className="mt-4 space-y-1 border-t border-white/10 pt-3">
                    {addFailures.map((failure) => (
                      <li key={failure.title} className="text-[0.8125rem] text-white/70">
                        <span className="text-white">{failure.title}</span> —{" "}
                        {failure.why}
                      </li>
                    ))}
                  </ul>
                )}

                {lookError && (
                  <p role="alert" className="mt-3 text-[0.8125rem] text-white/70">
                    {lookError}
                  </p>
                )}
              </motion.div>
            )}
          </div>
        </div>

        {/* ================================================================ */}
        {/* Controls                                                         */}
        {/* ================================================================ */}
        <div className="flex flex-col gap-5">
          {/* Slot tabs */}
          <div
            className="ns-no-scrollbar flex gap-2 overflow-x-auto"
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
                        active ? "border-ink bg-brand-bright" : "border-paper bg-brand",
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* ---- Sizes: its own panel, never part of the render ------- */}
          {recommendations.length > 0 && (
            <div className="bg-brand-veil rounded-xl p-5">
              <h3 className="text-eyebrow text-brand mb-1 uppercase">
                {rtl ? "المقاسات المقترحة" : "Your sizes"}
              </h3>
              <p className="text-smoke mb-3 text-[0.75rem]">
                {rtl
                  ? "محسوبة من جدول قياسات كل قطعة — لا من المجسم."
                  : "Calculated from each piece's measurement table — not from the figure."}
              </p>

              <ul className="space-y-3">
                {recommendations.map(({ slot, product, fit }) => {
                  const size = product.sizes.find((s) => s.id === fit.recommendedSizeId);
                  const chip = {
                    recommended: {
                      text: size?.label ?? "—",
                      className: "bg-brand text-white",
                    },
                    between: {
                      text: rtl ? "بين مقاسين" : "Between sizes",
                      className: "bg-sand text-ink",
                    },
                    "no-size": {
                      text: rtl ? "لا مقاس مناسب" : "No size fits",
                      className: "bg-alert/12 text-alert",
                    },
                    unmeasured: {
                      text: rtl ? "غير محدد" : "Not enough data",
                      className: "bg-paper-sunken text-smoke",
                    },
                  }[fit.outcome];

                  return (
                    <li key={slot}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-ink min-w-0 flex-1 truncate text-[0.8125rem]">
                          {t(product.title, locale)}
                        </span>
                        <span
                          className={cn(
                            "rounded-xs shrink-0 px-2 py-1 text-[0.75rem] font-semibold",
                            chip.className,
                          )}
                        >
                          {chip.text}
                        </span>
                      </div>
                      {/*
                        The reason sits under the piece it belongs to. Showing
                        only the first piece's rationale, as this did before,
                        attached one garment's explanation to all five.
                      */}
                      <p className="text-smoke mt-1 text-[0.75rem]">
                        {t(fit.rationale, locale)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* ---- Measurements, photo and consent --------------------- */}
          <div className="bg-paper-raised border-line rounded-xl border p-5">
            <BodyPanel
              profile={profile}
              onChange={setProfile}
              locale={locale}
              providerConfigured={providerConfigured}
              providerMissing={providerMissing}
              // Whatever is on the figure right now — the top if there is
              // one, since that is the piece a try-on is usually about.
              tryOnProductId={
                (outfit.top ?? outfit.outerwear ?? outfit.bottom ?? outfit.shoes)?.id ?? null
              }
            />
          </div>

          {/* ---- Suggestions ----------------------------------------- */}
          <div className="bg-paper-raised border-line rounded-xl border p-5">
            <h3 className="font-display text-ink text-[1.0625rem] font-semibold">
              {rtl ? "اقترح إطلالة" : "Suggest a look"}
            </h3>
            <p className="text-smoke mt-1 text-[0.8125rem]">
              {rtl
                ? "من القطع المتوفرة فعلاً، ضمن ميزانيتك، وبالمقاسات التي تناسبك."
                : "Only from pieces actually in stock, inside your budget, in sizes that fit you."}
            </p>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="text-ink-muted mb-1.5 block text-[0.8125rem]">
                  {rtl ? "الموسم" : "Season"}
                </span>
                <select
                  value={season}
                  onChange={(e) => setSeason(e.target.value as Season | "any")}
                  className="border-line bg-paper text-ink rounded-md w-full border px-3 py-2 text-[0.875rem]"
                >
                  {SEASONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {rtl ? option.ar : option.en}
                    </option>
                  ))}
                </select>
              </label>

              <label className="min-w-0 flex-1">
                <span className="text-ink-muted mb-1.5 block text-[0.8125rem]">
                  {rtl ? `الميزانية (${currency})` : `Budget (${currency})`}
                </span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder={rtl ? "بلا حد" : "No limit"}
                  className="border-line bg-paper text-ink rounded-md w-full border px-3 py-2 text-[0.875rem] tabular-nums"
                />
              </label>
            </div>

            <Button variant="secondary" size="sm" className="mt-4" onClick={buildLook}>
              {chosen.length > 0
                ? rtl
                  ? "أكمل الإطلالة"
                  : "Complete the look"
                : rtl
                  ? "ابنِ لي إطلالة"
                  : "Build me a look"}
            </Button>

            {/* Every slot it could not fill, and the actual reason. */}
            {skipped.length > 0 && (
              <ul className="text-smoke mt-3 space-y-1 text-[0.8125rem]">
                {skipped.map((entry) => (
                  <li key={entry.slot}>
                    {SLOTS.find((s) => s.id === entry.slot)?.label[locale]} —{" "}
                    {SKIP_TEXT[entry.reason][locale]}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- Saved looks ----------------------------------------- */}
          {savedOutfits.length > 0 && (
            <div className="bg-paper-raised border-line rounded-xl border p-5">
              <h3 className="font-display text-ink mb-3 text-[1.0625rem] font-semibold">
                {rtl ? "إطلالاتك المحفوظة" : "Your saved looks"}
              </h3>
              <ul className="space-y-2">
                {savedOutfits.map((saved) => {
                  const pieces = Object.values(saved.items).filter(Boolean) as OutfitSlotItem[];
                  return (
                    <li key={saved.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => restoreLook(saved)}
                        className="border-line hover:border-brand rounded-lg flex min-w-0 flex-1 cursor-pointer items-center gap-3 border p-2 text-start transition-colors"
                        data-cursor="hover"
                      >
                        <span className="flex -space-x-2">
                          {pieces.slice(0, 4).map((piece) => (
                            <span
                              key={piece.productId}
                              className="border-paper bg-paper-sunken relative h-10 w-10 overflow-hidden rounded-full border-2"
                            >
                              <Image
                                src={piece.image.url}
                                alt=""
                                fill
                                sizes="40px"
                                className="object-cover"
                              />
                            </span>
                          ))}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-ink block truncate text-[0.8125rem]">
                            {pieces.length} {rtl ? "قطعة" : pieces.length === 1 ? "piece" : "pieces"}
                          </span>
                          <span className="text-mist block text-[0.75rem] tabular-nums">
                            {formatPrice(
                              pieces.reduce((sum, piece) => sum + piece.price, 0),
                              currency,
                              locale,
                            )}
                          </span>
                        </span>
                        <span className="text-brand shrink-0 text-[0.75rem]">
                          {rtl ? "ارتدِها" : "Wear it"}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void deleteLook(saved.id)}
                        aria-label={rtl ? "احذف هذه الإطلالة" : "Delete this look"}
                        className="text-mist hover:text-alert grid h-8 w-8 shrink-0 cursor-pointer place-items-center transition-colors"
                        data-cursor="hover"
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* ---- Options for the active slot -------------------------- */}
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
                const sellable = isBuyable(product);
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => pick(product)}
                    disabled={!sellable && !selected}
                    aria-pressed={selected}
                    className={cn(
                      "rounded-lg group relative overflow-hidden text-start transition-all duration-300",
                      "ring-offset-paper ring-offset-2",
                      selected
                        ? "ring-brand ring-2"
                        : "ring-transparent hover:ring-line-strong ring-1",
                      sellable || selected ? "cursor-pointer" : "cursor-not-allowed opacity-55",
                    )}
                    data-cursor={sellable || selected ? "hover" : undefined}
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
                      {!sellable && (
                        <span className="rounded-pill absolute start-2 top-2 bg-black/70 px-2 py-0.5 text-[0.625rem] tracking-[0.08em] text-white uppercase">
                          {rtl ? "نفد" : "Sold out"}
                        </span>
                      )}
                      {selected && (
                        <motion.span
                          className="bg-brand absolute end-2 top-2 grid h-6 w-6 place-items-center rounded-full text-[0.75rem] text-white"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={transition.base}
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
