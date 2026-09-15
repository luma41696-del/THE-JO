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
import {
  availableDesignIds,
  availableSizeIds,
  imagesFor,
  sellableDesigns,
  gtinKind,
  hasOptions,
  isSoldIndividually,
  resolveSelection,
} from "@/lib/product";
import { storeSettings, type StoreSettings } from "@/data/site-content";
import type { Category, Locale, Product, ReviewSummary, ShippingClass } from "@/types";

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
 *
 * Two product types share this component, and the difference is not cosmetic:
 * a **simple** product has no colour, no size and nothing to resolve, so it
 * renders no option controls at all. Showing a one-entry size grid reading
 * "One size" is the worst of both — it looks like a choice, behaves like a
 * label, and adds a click to every purchase.
 */

export interface ProductDetailProps {
  product: Product;
  locale?: Locale;
  /** Computed from published reviews. Absent means "no reviews yet". */
  reviewSummary?: ReviewSummary | null;
  /** Root-first category ancestry, for the breadcrumb. */
  trail?: Category[];
  /** The product's shipping class, surfaced in the details table. */
  shippingClass?: ShippingClass | null;
  /**
   * Live store settings.
   *
   * Passed in rather than imported, because the page is the thing that can
   * read Firestore — a client component importing the static object would
   * quote last deploy's threshold next to a cart that charges today's.
   */
  settings?: StoreSettings;
}

export function ProductDetail({
  product,
  locale = "en",
  trail = [],
  shippingClass = null,
  reviewSummary = null,
  settings = storeSettings,
}: ProductDetailProps) {
  const reduced = useReducedMotion();
  const rtl = locale === "ar";

  const variable = hasOptions(product);

  /*
   * Open on something that can actually be bought.
   *
   * Defaulting to `colors[0]` lands on a sold-out permutation often enough to
   * matter — the first colour in a merchandising order is usually the most
   * popular one, which is exactly the one that sells out first. Arriving at a
   * disabled button with no explanation is the worst first frame a product
   * page can have.
   */
  const designs = useMemo(() => sellableDesigns(product), [product]);

  const firstBuyable = useMemo(() => {
    const blank = { colorId: "", sizeId: null as string | null, designId: "" };
    if (!variable) return blank;

    // Same reasoning one axis out: open on an artwork that is actually in
    // stock, so the page does not greet a customer with a disabled button.
    const stockedDesigns = availableDesignIds(product);
    const designId = stockedDesigns[0] ?? designs[0]?.id ?? "";

    for (const color of product.colors) {
      const sizes = availableSizeIds(product, color.id, designId);
      if (sizes.length > 0) {
        return { colorId: color.id, sizeId: sizes.length === 1 ? sizes[0]! : null, designId };
      }
    }
    return { colorId: product.colors[0]?.id ?? "", sizeId: null as string | null, designId };
  }, [product, variable, designs]);

  const [colorId, setColorId] = useState(firstBuyable.colorId);
  const [sizeId, setSizeId] = useState<string | null>(firstBuyable.sizeId);
  const [designId, setDesignId] = useState(firstBuyable.designId);
  const [quantity, setQuantity] = useState(1);
  const [sizeError, setSizeError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [activeImage, setActiveImage] = useState(0);

  /** The trade item currently selected: SKU, GTIN, price, stock and cap. */
  const selection = useMemo(
    () => resolveSelection(product, colorId, sizeId ?? "", designId),
    [product, colorId, sizeId, designId],
  );

  /** Sizes with stock in the chosen colour — everything else greys out. */
  const inStockSizes = useMemo(
    () => (variable ? new Set(availableSizeIds(product, colorId, designId)) : new Set<string>()),
    [product, colorId, variable, designId],
  );

  /** Artworks with stock somewhere — the rest render dimmed, not hidden. */
  const inStockDesigns = useMemo(
    () => new Set(availableDesignIds(product)),
    [product],
  );

  const add = useCart((s) => s.add);
  const openCart = useUI((s) => s.openCart);
  const toggleWish = useWishlist((s) => s.toggle);
  const wished = useWishlist((s) => s.has(product.id));

  /*
   * The gallery follows the artwork first and the colour second: a customer
   * who taps an embroidery expects to see that embroidery, and a design with
   * its own shots falls back to the product's when it has none.
   */
  const gallery = useMemo(
    () => imagesFor(product, designId, colorId),
    [product, designId, colorId],
  );

  const color = product.colors.find((c) => c.id === colorId);
  const design = designs.find((d) => d.id === designId);
  const size = product.sizes.find((s) => s.id === sizeId);
  const image = gallery[Math.min(activeImage, gallery.length - 1)];

  async function handleAdd() {
    if (variable && !sizeId) {
      setSizeError(true);
      document.getElementById("size-rail")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (!selection.buyable) return;

    setAdding(true);
    // A beat of deliberate latency: an instant state flip reads as a glitch,
    // and this is where a real stock check would happen.
    await new Promise((resolve) => setTimeout(resolve, 420));
    add({ product, colorId, sizeId: sizeId ?? "", designId, quantity });
    setAdding(false);
    setAdded(true);
    setTimeout(() => {
      setAdded(false);
      openCart();
    }, 900);
  }

  // Never leave the stepper above a cap that just moved under it.
  const cap = Math.max(1, selection.cap.max);
  const qty = Math.min(quantity, cap);

  return (
    <div className="ns-container pt-28 pb-16 md:pt-40 md:pb-24">
      <nav
        aria-label="Breadcrumb"
        className="text-mist ns-no-scrollbar mb-6 flex items-center gap-2 overflow-x-auto text-[0.75rem]"
      >
        <Link href="/shop" className="hover:text-ink transition-colors">
          {rtl ? "المتجر" : "Shop"}
        </Link>
        {trail.map((crumb) => (
          <span key={crumb.id} className="flex items-center gap-2">
            <span aria-hidden="true">/</span>
            <Link
              href={`/shop?category=${crumb.id}`}
              className="hover:text-ink whitespace-nowrap transition-colors"
            >
              {t(crumb.name, locale)}
            </Link>
          </span>
        ))}
        <span aria-hidden="true">/</span>
        <span className="text-ink-muted truncate">{t(product.title, locale)}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        {/* Both columns carry `min-w-0`: a grid item's default
            `min-width: auto` lets its content dictate the track width, and a
            single unbreakable row then widens the whole page. */}
        {/* ---------------------------------------------------------------- */}
        {/* Gallery                                                          */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex min-w-0 flex-col-reverse gap-4 md:flex-row md:gap-5">
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
        <div className="min-w-0 lg:sticky lg:top-32 lg:self-start">
          <h1 className="font-display text-ink text-3xl font-semibold tracking-tight text-balance md:text-4xl">
            {t(product.title, locale)}
          </h1>

          {product.subtitle && (
            <p className="text-smoke mt-2 text-[0.9375rem]">{t(product.subtitle, locale)}</p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-4">
            {/* The variant's price, not the parent's — a size that costs more
                must say so before the bag, not after. */}
            <Price
              value={selection.price}
              compareAt={selection.compareAtPrice}
              currency={product.currency}
              locale={locale}
              size="lg"
            />
            {/*
              The *real* rating, from published reviews — and nothing at all
              when there are none. The demo catalogue ships a `rating` field
              ("4.8 from 214") that no customer ever wrote; showing it is a
              fabricated review count, and a shopper who clicks through to find
              zero reviews has learned the shop makes things up.
            */}
            {reviewSummary && reviewSummary.count > 0 && (
              <a
                href="#reviews"
                className="text-smoke hover:text-ink flex items-center gap-1.5 text-[0.8125rem] transition-colors"
                data-cursor="hover"
              >
                <span className="text-brand">★</span>
                <span className="tabular-nums">{reviewSummary.average.toFixed(1)}</span>
                <span className="text-mist">({reviewSummary.count})</span>
              </a>
            )}
          </div>

          {/*
            Design — thumbnails, above colour.

            Above it on purpose: the artwork is the thing a customer is
            choosing between when a shop sells one garment with four
            embroideries, and the colour row underneath answers "in which
            shade". Reversing them makes the page ask the smaller question
            first.
          */}
          {designs.length > 0 && (
            <fieldset className="mt-8">
              <legend className="text-eyebrow font-display text-mist mb-3 uppercase">
                {rtl ? "التصميم" : "Design"}
                <span className="text-ink ms-2 normal-case tracking-normal">
                  {design ? t(design.name, locale) : ""}
                </span>
              </legend>

              <div className="ns-no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
                {designs.map((option) => {
                  const depleted = !inStockDesigns.has(option.id);
                  const selected = designId === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setDesignId(option.id);
                        setActiveImage(0);
                        // The chosen size may not be cut for this artwork.
                        const next = availableSizeIds(product, colorId, option.id);
                        if (sizeId && !next.includes(sizeId)) setSizeId(null);
                      }}
                      aria-pressed={selected}
                      title={t(option.name, locale)}
                      className={cn(
                        "rounded-md relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden transition-all duration-300",
                        "ring-offset-paper ring-offset-2",
                        selected ? "ring-ink ring-2" : "ring-ink/12 hover:ring-ink/35 ring-1",
                        // Selectable but visibly depleted, like the colours.
                        depleted && "opacity-35",
                      )}
                      data-cursor="hover"
                    >
                      <Image
                        src={option.thumbnail.url}
                        alt={t(option.name, locale)}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                      <span className="sr-only">
                        {t(option.name, locale)}
                        {depleted ? (rtl ? " — نفدت الكمية" : " — sold out") : ""}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* A surcharge is stated where it is chosen, not at the total. */}
              {design?.priceDelta ? (
                <p className="text-smoke mt-2 text-[0.8125rem]">
                  {design.priceDelta > 0
                    ? rtl
                      ? `يضيف ${formatPrice(design.priceDelta, product.currency, locale)} للسعر`
                      : `Adds ${formatPrice(design.priceDelta, product.currency, locale)}`
                    : rtl
                      ? `يخصم ${formatPrice(Math.abs(design.priceDelta), product.currency, locale)}`
                      : `Saves ${formatPrice(Math.abs(design.priceDelta), product.currency, locale)}`}
                </p>
              ) : null}
            </fieldset>
          )}

          {/* Colour — variable products only */}
          {variable && (
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
                      // The chosen size may not exist in the new colour.
                      const next = availableSizeIds(product, option.id, designId);
                      if (sizeId && !next.includes(sizeId)) setSizeId(null);
                    }}
                    aria-pressed={colorId === option.id}
                    aria-label={
                      availableSizeIds(product, option.id, designId).length === 0
                        ? `${t(option.name, locale)} — ${rtl ? "نفدت الكمية" : "sold out"}`
                        : t(option.name, locale)
                    }
                    title={t(option.name, locale)}
                    className={cn(
                      "h-9 w-9 cursor-pointer rounded-full transition-all duration-300",
                      "ring-offset-paper ring-offset-2",
                      colorId === option.id ? "ring-ink ring-2" : "ring-ink/12 hover:ring-ink/35 ring-1",
                      // A colour with nothing left stays selectable — the
                      // customer may want to see it — but reads as depleted.
                      availableSizeIds(product, option.id, designId).length === 0 && "opacity-35",
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

          {/* Size — variable products only */}
          {variable && (
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
              {product.sizes.map((option) => {
                const soldOut = !inStockSizes.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={soldOut}
                    onClick={() => {
                      setSizeId(option.id);
                      setSizeError(false);
                      setQuantity(1);
                    }}
                    aria-pressed={sizeId === option.id}
                    aria-label={
                      soldOut
                        ? `${option.label} — ${rtl ? "نفدت الكمية" : "sold out"}`
                        : option.label
                    }
                    className={cn(
                      "min-w-13 rounded-sm border px-4 py-2.5 text-[0.875rem] transition-all duration-200",
                      sizeId === option.id
                        ? "border-ink bg-ink text-white"
                        : "border-line text-ink hover:border-ink/45",
                      sizeError && !sizeId && "border-alert",
                      // Struck through rather than merely dimmed: dimming alone
                      // reads as "not selected" and gets clicked anyway.
                      soldOut &&
                        "text-mist border-line/60 cursor-not-allowed line-through hover:border-line/60",
                    )}
                    data-cursor={soldOut ? undefined : "hover"}
                  >
                    {option.label}
                  </button>
                );
              })}
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
          )}

          {/* ------------------------------------------------------------ */}
          {/* Quantity + availability                                      */}
          {/* ------------------------------------------------------------ */}
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            {/*
              A stepper appears only when more than one unit can be bought.
              A "1 – 1" control on a sold-individually product is a dead
              control that invites a click and then refuses it.
            */}
            {cap > 1 && selection.buyable && (
              <div className="border-line inline-flex items-center rounded-pill border">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                  aria-label={rtl ? "إنقاص الكمية" : "Decrease quantity"}
                  className="text-ink grid h-11 w-11 place-items-center rounded-pill text-lg transition-colors disabled:opacity-30"
                  data-cursor="hover"
                >
                  −
                </button>
                <span
                  aria-live="polite"
                  className="text-ink w-9 text-center text-[0.9375rem] font-medium tabular-nums"
                >
                  {qty}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(cap, q + 1))}
                  disabled={qty >= cap}
                  aria-label={rtl ? "زيادة الكمية" : "Increase quantity"}
                  className="text-ink grid h-11 w-11 place-items-center rounded-pill text-lg transition-colors disabled:opacity-30"
                  data-cursor="hover"
                >
                  +
                </button>
              </div>
            )}

            {/*
              Two different sentences for two different facts. A merchant cap is
              a policy and is stated as one; low stock is a scarcity claim and
              is only shown when it is actually true — under five units left.
              Dressing a policy up as scarcity is the oldest dark pattern in
              retail, and customers learn to disbelieve every number after it.
            */}
            {/* A per-order cap belongs to the product, so it is stated before
                a size is chosen. Waiting until the selection resolves hides
                the one rule most likely to change what the customer does —
                and discovering "limit 1" only after picking a size is exactly
                the kind of surprise that loses the sale. */}
            {isSoldIndividually(product) ? (
              <p className="text-ink bg-paper-sunken rounded-pill px-3.5 py-1.5 text-[0.8125rem]">
                {rtl ? "قطعة واحدة لكل طلب" : "Limit 1 per order"}
              </p>
            ) : product.maxPerOrder !== undefined && product.maxPerOrder > 0 ? (
              <p className="text-ink bg-paper-sunken rounded-pill px-3.5 py-1.5 text-[0.8125rem]">
                {rtl
                  ? `بحد أقصى ${product.maxPerOrder} لكل طلب`
                  : `Limit ${product.maxPerOrder} per order`}
              </p>
            ) : selection.buyable && selection.stock > 0 && selection.stock < 5 ? (
              <p className="text-alert text-[0.8125rem] font-medium">
                {rtl ? `بقيت ${selection.stock} قطع فقط` : `Only ${selection.stock} left`}
              </p>
            ) : null}

            {variable && sizeId && !selection.buyable && (
              <p className="text-mist text-[0.8125rem]">
                {rtl ? "هذا المقاس نفد حالياً." : "This size is sold out."}
              </p>
            )}
            {!variable && !selection.buyable && (
              <p className="text-mist text-[0.8125rem]">
                {rtl ? "نفدت الكمية حالياً." : "Out of stock."}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center gap-3">
            <Button
              variant="brand"
              size="lg"
              fullWidth
              magnetic
              loading={adding}
              success={added}
              successLabel={rtl ? "أُضيفت" : "Added"}
              disabled={(!variable || Boolean(sizeId)) && !selection.buyable}
              onClick={handleAdd}
            >
              {!variable && !selection.buyable ? (
                rtl ? (
                  "نفدت الكمية"
                ) : (
                  "Out of stock"
                )
              ) : (
                <>
                  {rtl ? "أضف إلى الحقيبة" : "Add to bag"}
                  <span className="hidden sm:inline">
                    {" · "}
                    {formatPrice(selection.price * qty, product.currency, locale)}
                  </span>
                </>
              )}
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

          {/*
            Service promises, placed under the CTA where hesitation happens —
            and composed from the store's real settings rather than written as
            prose. All three used to be hard-coded strings: the threshold was
            stated in three files that could disagree with the shipping rate,
            the returns window claimed 30 days against a 14-day policy, and
            "Secure checkout with 3-D Secure" described a card gateway the shop
            does not have. A promise the checkout cannot keep is worse than no
            promise, because the customer only finds out at the door.
          */}
          <ul className="border-line mt-6 grid gap-2.5 border-t pt-6">
            {[
              {
                en: `Free delivery over ${settings.freeShippingThreshold} JOD`,
                ar: `توصيل مجاني فوق ${settings.freeShippingThreshold} ديناراً`,
              },
              {
                en: `Returns within ${settings.returnWindowDays} days`,
                ar: `إرجاع خلال ${settings.returnWindowDays} يوماً`,
              },
              { en: "Pay on delivery", ar: "الدفع عند الاستلام" },
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

            <dl className="border-line mt-6 divide-y divide-[var(--color-line)] border-t">
              {(product.details ?? []).map((detail) => (
                <div key={detail.label.en} className="flex justify-between gap-6 py-3">
                  <dt className="text-mist text-[0.8125rem]">{t(detail.label, locale)}</dt>
                  <dd className="text-ink text-end text-[0.8125rem]">{t(detail.value, locale)}</dd>
                </div>
              ))}

              {/*
                Identifiers for the *selected* trade item, and only once one
                exists. On a variable product the SKU and GTIN change with the
                size, so before a size is picked there is no answer — and
                printing the parent style code under a "SKU" label would name
                something that cannot be ordered. A row that appears when the
                customer chooses is better than a row that is quietly wrong.
              */}
              {(!variable || Boolean(selection.variant)) && (
                <div className="flex justify-between gap-6 py-3">
                  <dt className="text-mist text-[0.8125rem]">{rtl ? "رمز المنتج" : "SKU"}</dt>
                  <dd className="text-ink text-end font-mono text-[0.8125rem] tabular-nums">
                    {selection.sku}
                  </dd>
                </div>
              )}

              {selection.gtin && (
                <div className="flex justify-between gap-6 py-3">
                  <dt className="text-mist text-[0.8125rem]">{gtinKind(selection.gtin)}</dt>
                  <dd className="text-ink text-end font-mono text-[0.8125rem] tabular-nums">
                    {selection.gtin}
                  </dd>
                </div>
              )}

              {shippingClass && (
                <div className="flex justify-between gap-6 py-3">
                  <dt className="text-mist text-[0.8125rem]">{rtl ? "فئة الشحن" : "Shipping"}</dt>
                  <dd className="text-ink text-end text-[0.8125rem]">
                    {t(shippingClass.name, locale)}
                    {shippingClass.excludedSpeeds.includes("same-day") && (
                      <span className="text-mist block text-[0.75rem]">
                        {rtl ? "غير متاح في نفس اليوم" : "Not eligible for same-day"}
                      </span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
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
