"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";
import { formatPrice, t } from "@/lib/format";
import { useCart } from "@/lib/store/cart";
import { useUI } from "@/lib/store/ui";
import { useWishlist } from "@/lib/store/wishlist";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Price } from "@/components/ui/Price";
import type { Locale, Product } from "@/types";

/**
 * Product detail.
 *
 * The whole page is one decision — which variant, and does it fit — so the
 * layout puts the gallery and the buy column side by side and keeps the buy
 * column sticky on desktop. Nothing that answers "will this fit me" is behind
 * a tab: fit notes, the model's size, and the size guide are all inline.
 *
 * Size must be chosen before adding. Rather than disabling the button (which
 * gives no reason), the button stays live and scrolls focus to the size rail
 * with an inline prompt — an error you can act on beats a control you cannot.
 */

export function ProductDetail({ product, locale = "en" }: { product: Product; locale?: Locale }) {
  const reduced = useReducedMotion();
  const rtl = locale === "ar";

  const [colorId, setColorId] = useState(product.colors[0]?.id ?? "");
  const [sizeId, setSizeId] = useState<string | null>(
    product.sizes.length === 1 ? (product.sizes[0]?.id ?? null) : null,
  );
  const [sizeError, setSizeError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [activeImage, setActiveImage] = useState(0);

  const add = useCart((s) => s.add);
  const openCart = useUI((s) => s.openCart);
  const toggleWish = useWishlist((s) => s.toggle);
  const wished = useWishlist((s) => s.has(product.id));

  const gallery = useMemo(() => {
    const forColor = product.images.filter((i) => i.colorId === colorId);
    return forColor.length > 0 ? forColor : product.images;
  }, [product.images, colorId]);

  const color = product.colors.find((c) => c.id === colorId);
  const size = product.sizes.find((s) => s.id === sizeId);
  const image = gallery[Math.min(activeImage, gallery.length - 1)];

  async function handleAdd() {
    if (!sizeId) {
      setSizeError(true);
      document.getElementById("size-rail")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    setAdding(true);
    // A beat of deliberate latency: an instant state flip reads as a glitch,
    // and this is where a real stock check would happen.
    await new Promise((resolve) => setTimeout(resolve, 420));
    add({ product, colorId, sizeId, quantity: 1 });
    setAdding(false);
    setAdded(true);
    setTimeout(() => {
      setAdded(false);
      openCart();
    }, 900);
  }

  return (
    <div className="ns-container pt-28 pb-16 md:pt-40 md:pb-24">
      <nav aria-label="Breadcrumb" className="text-mist mb-6 flex items-center gap-2 text-[0.75rem]">
        <Link href="/shop" className="hover:text-ink transition-colors">
          {rtl ? "المتجر" : "Shop"}
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/shop?category=${product.categoryId}`} className="hover:text-ink transition-colors">
          {product.categoryId}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-ink-muted">{t(product.title, locale)}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        {/* ---------------------------------------------------------------- */}
        {/* Gallery                                                          */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex flex-col-reverse gap-4 md:flex-row md:gap-5">
          {gallery.length > 1 && (
            <div className="ns-no-scrollbar flex gap-3 overflow-x-auto md:flex-col md:overflow-visible">
              {gallery.map((shot, index) => (
                <button
                  key={shot.url}
                  type="button"
                  onClick={() => setActiveImage(index)}
                  aria-label={`View image ${index + 1}`}
                  aria-current={index === activeImage}
                  className={cn(
                    "rounded-md bg-paper-sunken relative h-24 w-19 shrink-0 cursor-pointer overflow-hidden",
                    "ring-offset-paper ring-offset-2 transition-all duration-300",
                    index === activeImage ? "ring-ink ring-2" : "ring-transparent hover:ring-line-strong ring-1",
                  )}
                  data-cursor="hover"
                >
                  <Image src={shot.url} alt="" fill sizes="76px" className="object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="bg-paper-sunken rounded-xl relative aspect-[3/4] flex-1 overflow-hidden">
            <AnimatePresence mode="wait">
              {image && (
                <motion.div
                  key={image.url}
                  className="absolute inset-0"
                  initial={reduced ? undefined : { opacity: 0, scale: 1.03 }}
                  animate={reduced ? undefined : { opacity: 1, scale: 1 }}
                  exit={reduced ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.4, ease: EASE.brand }}
                >
                  <Image
                    src={image.url}
                    alt={image.alt}
                    fill
                    priority
                    sizes="(max-width: 1024px) 92vw, 48vw"
                    className="object-cover"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {product.badges.length > 0 && (
              <div className="absolute start-4 top-4 flex flex-col items-start gap-2">
                {product.badges.map((badge) => (
                  <Badge key={badge} badge={badge} locale={locale} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Buy column                                                       */}
        {/* ---------------------------------------------------------------- */}
        <div className="lg:sticky lg:top-32 lg:self-start">
          <h1 className="font-display text-ink text-3xl font-semibold tracking-tight text-balance md:text-4xl">
            {t(product.title, locale)}
          </h1>

          {product.subtitle && (
            <p className="text-smoke mt-2 text-[0.9375rem]">{t(product.subtitle, locale)}</p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Price
              value={product.price}
              compareAt={product.compareAtPrice}
              currency={product.currency}
              locale={locale}
              size="lg"
            />
            {product.rating && (
              <span className="text-smoke flex items-center gap-1.5 text-[0.8125rem]">
                <span className="text-brand">★</span>
                <span className="tabular-nums">{product.rating.average.toFixed(1)}</span>
                <span className="text-mist">({product.rating.count})</span>
              </span>
            )}
          </div>

          {/* Colour */}
          {product.colors.length > 0 && (
            <fieldset className="mt-8">
              <legend className="text-eyebrow font-display text-mist mb-3 uppercase">
                {rtl ? "اللون" : "Colour"}
                <span className="text-ink ms-2 normal-case tracking-normal">
                  {color ? t(color.name, locale) : ""}
                </span>
              </legend>
              <div className="flex flex-wrap gap-2.5">
                {product.colors.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setColorId(option.id);
                      setActiveImage(0);
                    }}
                    aria-pressed={colorId === option.id}
                    aria-label={t(option.name, locale)}
                    title={t(option.name, locale)}
                    className={cn(
                      "h-9 w-9 cursor-pointer rounded-full transition-all duration-300",
                      "ring-offset-paper ring-offset-2",
                      colorId === option.id ? "ring-ink ring-2" : "ring-ink/12 hover:ring-ink/35 ring-1",
                    )}
                    style={{
                      background: option.hexSecondary
                        ? `linear-gradient(135deg, ${option.hex} 50%, ${option.hexSecondary} 50%)`
                        : option.hex,
                    }}
                    data-cursor="hover"
                  />
                ))}
              </div>
            </fieldset>
          )}

          {/* Size */}
          <fieldset id="size-rail" className="mt-8 scroll-mt-32">
            <legend className="mb-3 flex w-full items-center justify-between">
              <span className="text-eyebrow font-display text-mist uppercase">
                {rtl ? "المقاس" : "Size"}
                {size && <span className="text-ink ms-2 normal-case tracking-normal">{size.label}</span>}
              </span>
              <Link
                href="/help/sizing"
                className="text-smoke hover:text-ink text-[0.75rem] underline-offset-4 transition-colors hover:underline"
              >
                {rtl ? "دليل المقاسات" : "Size guide"}
              </Link>
            </legend>

            <div className="flex flex-wrap gap-2">
              {product.sizes.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setSizeId(option.id);
                    setSizeError(false);
                  }}
                  aria-pressed={sizeId === option.id}
                  className={cn(
                    "min-w-13 cursor-pointer rounded-sm border px-4 py-2.5 text-[0.875rem] transition-all duration-200",
                    sizeId === option.id
                      ? "border-ink bg-ink text-white"
                      : "border-line text-ink hover:border-ink/45",
                    sizeError && !sizeId && "border-alert",
                  )}
                  data-cursor="hover"
                >
                  {option.label}
                </button>
              ))}
            </div>

            <AnimatePresence>
              {sizeError && !sizeId && (
                <motion.p
                  role="alert"
                  className="text-alert mt-3 text-[0.8125rem]"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {rtl ? "اختر مقاساً للمتابعة." : "Choose a size to continue."}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Fit intelligence — the thing that actually reduces returns. */}
            {product.fit && (
              <div className="bg-brand-veil rounded-md mt-4 p-4">
                <p className="text-ink text-[0.8125rem]">
                  <strong className="font-medium">
                    {product.fit.scale === 0
                      ? rtl
                        ? "مطابق للمقاس."
                        : "True to size."
                      : product.fit.scale < 0
                        ? rtl
                          ? "يميل للضيق — اختر مقاساً أكبر."
                          : "Runs small — consider sizing up."
                        : rtl
                          ? "واسع — اختر مقاساً أصغر."
                          : "Runs large — consider sizing down."}
                  </strong>{" "}
                  {product.fit.modelHeightCm && product.fit.modelWearsSizeId && (
                    <span className="text-smoke">
                      {rtl ? "العارضة بطول" : "Model is"} {product.fit.modelHeightCm}cm{" "}
                      {rtl ? "وترتدي" : "and wears a"}{" "}
                      {product.sizes.find((s) => s.id === product.fit?.modelWearsSizeId)?.label}.
                    </span>
                  )}
                </p>
                <Link
                  href={`/fitting-room?product=${product.slug}`}
                  className="text-brand mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium"
                  data-cursor="hover"
                >
                  {rtl ? "جرّبها في غرفة القياس" : "Try it in the fitting room"}
                  <span aria-hidden="true" className="rtl:rotate-180">
                    →
                  </span>
                </Link>
              </div>
            )}
          </fieldset>

          {/* Actions */}
          <div className="mt-8 flex items-center gap-3">
            <Button
              variant="brand"
              size="lg"
              fullWidth
              magnetic
              loading={adding}
              success={added}
              successLabel={rtl ? "أُضيفت" : "Added"}
              onClick={handleAdd}
            >
              {rtl ? "أضف إلى الحقيبة" : "Add to bag"} ·{" "}
              {formatPrice(product.price, product.currency, locale)}
            </Button>

            <button
              type="button"
              onClick={() => toggleWish(product.id)}
              aria-pressed={wished}
              aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
              className={cn(
                "grid h-13 w-13 shrink-0 cursor-pointer place-items-center rounded-full border transition-all duration-300",
                wished ? "border-brand bg-brand-mist text-brand" : "border-line text-ink hover:border-ink/40",
              )}
              data-cursor="hover"
            >
              <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M10 16.5s-6.5-4-6.5-8.3A3.7 3.7 0 0 1 10 6.2a3.7 3.7 0 0 1 6.5 2c0 4.3-6.5 8.3-6.5 8.3Z"
                  fill={wished ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          {/* Service promises — placed under the CTA where hesitation happens. */}
          <ul className="border-line mt-6 grid gap-2.5 border-t pt-6">
            {[
              { en: "Free express delivery over 75 JOD", ar: "توصيل سريع مجاني فوق ٧٥ ديناراً" },
              { en: "Free returns within 30 days", ar: "إرجاع مجاني خلال ٣٠ يوماً" },
              { en: "Secure checkout with 3-D Secure", ar: "دفع آمن بحماية 3-D Secure" },
            ].map((item) => (
              <li key={item.en} className="text-smoke flex items-center gap-2.5 text-[0.8125rem]">
                <span className="text-mint" aria-hidden="true">
                  ✓
                </span>
                {item[locale]}
              </li>
            ))}
          </ul>

          {/* Description + details */}
          <div className="mt-8">
            <p className="text-ink-muted text-[0.9375rem] leading-relaxed text-pretty">
              {t(product.description, locale)}
            </p>

            {product.details && product.details.length > 0 && (
              <dl className="border-line mt-6 divide-y divide-[var(--color-line)] border-t">
                {product.details.map((detail) => (
                  <div key={detail.label.en} className="flex justify-between gap-6 py-3">
                    <dt className="text-mist text-[0.8125rem]">{t(detail.label, locale)}</dt>
                    <dd className="text-ink text-end text-[0.8125rem]">{t(detail.value, locale)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Sticky mobile buy bar — appears once the main CTA scrolls out of view. */
export function StickyBuyBar({ product, locale = "en" }: { product: Product; locale?: Locale }) {
  const rtl = locale === "ar";
  return (
    <motion.div
      className="ns-glass fixed inset-x-0 bottom-0 z-[100] flex items-center justify-between gap-4 px-5 py-3 lg:hidden"
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      transition={transition.drawer}
    >
      <div className="min-w-0">
        <p className="text-ink truncate text-[0.8125rem] font-medium">{t(product.title, locale)}</p>
        <Price value={product.price} compareAt={product.compareAtPrice} size="sm" />
      </div>
      <Button
        variant="brand"
        size="md"
        onClick={() => document.getElementById("size-rail")?.scrollIntoView({ behavior: "smooth" })}
      >
        {rtl ? "أضف" : "Add"}
      </Button>
    </motion.div>
  );
}
