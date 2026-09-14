"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";
import { formatDeliveryWindow, formatPrice, t } from "@/lib/format";
import { priceCart, subtotalOf } from "@/lib/pricing";
import { classesInCart, quoteShipping } from "@/lib/shipping";
import { useCart, useCartHydrated } from "@/lib/store/cart";
import { Button } from "@/components/ui/Button";
import { ProductRail } from "@/components/product/ProductRail";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BrandWave } from "@/components/brand/BrandWave";
import { CrossSellShelf } from "@/components/cart/CrossSellShelf";
import type {
  Locale,
  Offer,
  Product,
  ShippingClass,
  ShippingMethod,
} from "@/types";

/**
 * Full cart page.
 *
 * Same data as the drawer, but with room for the things the drawer cannot fit:
 * a promo-code field, a shipping-method choice that updates the total live, and
 * a recommendation rail. The order summary is sticky on desktop so the total is
 * on screen while lines are edited — a total you have to scroll to find is a
 * total customers stop trusting.
 */

export function CartPageClient({
  shippingMethods,
  shippingClasses = [],
  offers,
  suggestions,
  crossSell = { edges: {}, targets: [] },
  locale = "en",
}: {
  shippingMethods: ShippingMethod[];
  shippingClasses?: ShippingClass[];
  offers: Offer[];
  suggestions: Product[];
  /** Cross-sell edges plus the products those edges point at. */
  crossSell?: { edges: Record<string, string[]>; targets: Product[] };
  locale?: Locale;
}) {
  const router = useLocalizedRouter();
  const rtl = locale === "ar";

  const items = useCart((s) => s.items);
  const setQuantity = useCart((s) => s.setQuantity);
  const remove = useCart((s) => s.remove);

  /*
   * Walk the bag, follow each line's cross-sell edges, and keep the first
   * unique target for each. Order follows the bag rather than the catalogue,
   * so the suggestion tied to what was added most recently comes first — that
   * is the item still in the customer's head.
   */
  const crossSellProducts = useMemo(() => {
    const inBag = new Set(items.map((i) => i.productId));
    const seen = new Set<string>();
    const out: Product[] = [];

    for (const item of items) {
      for (const id of crossSell.edges[item.productId] ?? []) {
        if (inBag.has(id) || seen.has(id)) continue;
        const target = crossSell.targets.find((p) => p.id === id);
        if (!target) continue;
        seen.add(id);
        out.push(target);
      }
    }
    return out;
  }, [items, crossSell]);
  const hydrated = useCartHydrated();

  const [methodId, setMethodId] = useState(shippingMethods[0]?.id ?? "standard");
  const [code, setCode] = useState("");
  const [appliedOffer, setAppliedOffer] = useState<Offer | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  /*
   * Quote every method against this basket, then drop the ones its contents
   * forbid. Hiding an unusable option beats showing one that fails at the
   * door — but the reason is surfaced below the list rather than swallowed,
   * so "where did same-day go?" has an answer on screen.
   */
  const quotes = useMemo(
    () => shippingMethods.map((m) => quoteShipping(m, items, shippingClasses, subtotalOf(items))),
    [shippingMethods, items, shippingClasses],
  );
  const usableQuotes = useMemo(() => quotes.filter((q) => !q.unavailableReason), [quotes]);
  const blockedQuotes = useMemo(() => quotes.filter((q) => q.unavailableReason), [quotes]);
  const blockingClasses = useMemo(
    () =>
      classesInCart(items, shippingClasses).filter((c) =>
        blockedQuotes.some((q) => c.excludedSpeeds.includes(q.method.speed)),
      ),
    [items, shippingClasses, blockedQuotes],
  );

  const method =
    usableQuotes.find((q) => q.method.id === methodId)?.method ??
    usableQuotes[0]?.method ??
    null;

  const totals = useMemo(
    () => priceCart({ items, shippingMethod: method, shippingClasses, offer: appliedOffer }),
    [items, method, shippingClasses, appliedOffer],
  );

  async function applyCode() {
    setCodeError(null);
    setCheckingCode(true);
    // Client-side validation is for the message only — the server re-validates
    // and re-applies the discount when the order is created.
    await new Promise((r) => setTimeout(r, 350));

    const match = offers.find((o) => o.code.toLowerCase() === code.trim().toLowerCase());
    if (!match) {
      setCodeError(rtl ? "رمز غير صالح أو منتهٍ." : "That code is not valid or has expired.");
    } else if (match.minSubtotal && totals.subtotal < match.minSubtotal) {
      setCodeError(
        rtl
          ? `الحد الأدنى ${formatPrice(match.minSubtotal, totals.currency, locale)}.`
          : `Minimum spend of ${formatPrice(match.minSubtotal, totals.currency, locale)} applies.`,
      );
    } else {
      setAppliedOffer(match);
      setCode("");
    }
    setCheckingCode(false);
  }

  if (!mounted || !hydrated) {
    return (
      <div className="ns-container grid min-w-0 gap-10 pb-24 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <div className="space-y-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-5">
              <div className="ns-shimmer rounded-lg h-40 w-30" />
              <div className="flex-1 space-y-3 pt-2">
                <div className="ns-shimmer h-4 w-1/2 rounded-xs" />
                <div className="ns-shimmer h-3 w-1/3 rounded-xs" />
              </div>
            </div>
          ))}
        </div>
        <div className="ns-shimmer rounded-xl h-80" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="ns-container pb-24">
        <div className="border-line rounded-xl flex flex-col items-center border border-dashed py-20 text-center">
          <div className="h-28 w-28 opacity-70">
            <BrandWave rings={3} color="var(--color-brand)" speed={8} />
          </div>
          <h2 className="font-display text-ink mt-6 text-xl font-semibold">
            {rtl ? "حقيبتك فارغة" : "Your bag is empty"}
          </h2>
          <p className="text-smoke mt-2 max-w-sm text-[0.9375rem]">
            {rtl
              ? "ابدأ من الوافد الجديد، أو دع غرفة القياس تقترح عليك."
              : "Start with new arrivals, or let the fitting room put a look together."}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/shop">
              <Button variant="primary" size="lg" magnetic>
                {rtl ? "تسوّق الآن" : "Shop new in"}
              </Button>
            </Link>
            <Link href="/fitting-room">
              <Button variant="secondary" size="lg">
                {rtl ? "غرفة القياس" : "Fitting room"}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* `min-w-0` on both columns: a grid item defaults to
          `min-width: auto`, so the widest thing inside — here the checkout
          button — would otherwise set the track width and widen the page. */}
      <div className="ns-container grid min-w-0 gap-10 pb-20 lg:grid-cols-[1.6fr_1fr] lg:gap-16 [&>*]:min-w-0">
        {/* Lines */}
        <div>
          <ul className="divide-line divide-y border-y border-[var(--color-line)]">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.li
                  key={item.key}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={transition.base}
                  className="overflow-hidden"
                >
                  <div className="flex gap-5 py-6">
                    <Link
                      href={`/product/${item.slug}`}
                      className="bg-paper-sunken rounded-md relative h-40 w-30 shrink-0 overflow-hidden"
                      data-cursor="view"
                      data-cursor-label={rtl ? "عرض" : "View"}
                    >
                      <Image
                        src={item.image.url}
                        alt={item.image.alt}
                        fill
                        sizes="120px"
                        className="object-cover"
                      />
                    </Link>

                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <Link
                            href={`/product/${item.slug}`}
                            className="text-ink ns-underline text-[0.9375rem] font-medium"
                          >
                            {t(item.title, locale)}
                          </Link>
                          {/* A simple product has neither, and an empty
                              " · Size " reads as a rendering bug. */}
                          {(item.sizeLabel || t(item.colorName, locale)) && (
                            <p className="text-smoke mt-1 text-[0.8125rem]">
                              {[
                                t(item.colorName, locale),
                                item.sizeLabel && `${rtl ? "مقاس" : "Size"} ${item.sizeLabel}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                          {/*
                            Each identifier is atomic. The page-wide
                            `overflow-wrap: break-word` that stops long strings
                            widening the layout will happily split a 13-digit
                            GTIN across two lines, and half a barcode read back
                            to support is worse than a line that wraps early.
                            They wrap *between* the two, never inside either.
                          */}
                          <p className="text-mist mt-1 flex flex-wrap gap-x-2 text-[0.75rem] tabular-nums">
                            <span className="whitespace-nowrap">SKU {item.sku}</span>
                            {item.gtin && (
                              <span className="whitespace-nowrap">· GTIN {item.gtin}</span>
                            )}
                          </p>
                        </div>

                        <span className="text-ink shrink-0 text-[0.9375rem] font-medium tabular-nums">
                          {formatPrice(item.unitPrice * item.quantity, item.currency, locale)}
                        </span>
                      </div>

                      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-4">
                        <div className="flex flex-col gap-1">
                          <div className="border-line inline-flex items-center rounded-pill border">
                            <StepButton
                              onClick={() => setQuantity(item.key, item.quantity - 1)}
                              disabled={item.quantity <= 1}
                              label={rtl ? "إنقاص" : "Decrease"}
                            >
                              −
                            </StepButton>
                            <span className="text-ink w-9 text-center text-[0.875rem] tabular-nums">
                              {item.quantity}
                            </span>
                            <StepButton
                              onClick={() => setQuantity(item.key, item.quantity + 1)}
                              disabled={item.quantity >= item.maxQuantity}
                              label={rtl ? "زيادة" : "Increase"}
                            >
                              +
                            </StepButton>
                          </div>

                          {item.quantity >= item.maxQuantity && (
                            <p className="text-mist text-[0.6875rem]" aria-live="polite">
                              {item.maxReason === "per-order"
                                ? item.maxQuantity === 1
                                  ? rtl
                                    ? "قطعة واحدة لكل طلب"
                                    : "Limit 1 per order"
                                  : rtl
                                    ? `بحد أقصى ${item.maxQuantity} لكل طلب`
                                    : `Limit ${item.maxQuantity} per order`
                                : rtl
                                  ? `بقي ${item.maxQuantity} في المخزون`
                                  : `Only ${item.maxQuantity} in stock`}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => remove(item.key)}
                          className="text-smoke hover:text-alert cursor-pointer text-[0.8125rem] underline-offset-4 transition-colors hover:underline"
                          data-cursor="hover"
                        >
                          {rtl ? "إزالة" : "Remove"}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          <Link
            href="/shop"
            className="text-smoke hover:text-ink mt-6 inline-flex items-center gap-2 text-[0.875rem] transition-colors"
            data-cursor="hover"
          >
            <span aria-hidden="true" className="rtl:rotate-180">
              ←
            </span>
            {rtl ? "متابعة التسوّق" : "Continue shopping"}
          </Link>

          {/* Complements, under the lines rather than beside the total: the
              summary column is where the customer goes to leave, and putting
              a new decision in front of the checkout button costs orders. */}
          {hydrated && crossSellProducts.length > 0 && (
            <CrossSellShelf
              products={crossSellProducts}
              inBag={items.map((i) => i.productId)}
              locale={locale}
              className="mt-8"
            />
          )}
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-32 lg:self-start">
          <div className="bg-paper-raised border-line rounded-xl shadow-lift border p-6 md:p-7">
            <h2 className="font-display text-ink text-lg font-semibold">
              {rtl ? "الملخص" : "Order summary"}
            </h2>

            {/* Shipping method */}
            <fieldset className="mt-6">
              <legend className="text-eyebrow font-display text-mist mb-3 uppercase">
                {rtl ? "الشحن" : "Delivery"}
              </legend>
              <div className="space-y-2">
                {usableQuotes.map((quote) => {
                  const option = quote.method;
                  return (
                    <label
                      key={option.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-md border p-3.5 transition-all duration-200",
                        methodId === option.id
                          ? "border-brand bg-brand-veil"
                          : "border-line hover:border-ink/30",
                      )}
                    >
                      <input
                        type="radio"
                        name="shipping"
                        value={option.id}
                        checked={methodId === option.id}
                        onChange={() => setMethodId(option.id)}
                        className="accent-brand mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-ink text-[0.875rem] font-medium">
                            {t(option.name, locale)}
                          </span>
                          <span className="text-ink text-[0.8125rem] tabular-nums">
                            {quote.total === 0
                              ? rtl
                                ? "مجاني"
                                : "Free"
                              : formatPrice(quote.total, totals.currency, locale)}
                          </span>
                        </span>
                        <span className="text-smoke mt-0.5 block text-[0.75rem]">
                          {formatDeliveryWindow(option.minDays, option.maxDays, locale)}
                          {option.description ? ` · ${t(option.description, locale)}` : ""}
                        </span>
                        {/* Name the surcharge rather than folding it silently
                            into the price — an unexplained number at checkout
                            is where carts get abandoned. */}
                        {quote.surcharge > 0 && !quote.freeApplied && (
                          <span className="text-mist mt-0.5 block text-[0.75rem]">
                            {rtl ? "يشمل رسوم مناولة " : "Includes "}
                            {formatPrice(quote.surcharge, totals.currency, locale)}
                            {rtl ? "" : " handling"}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>

              {/* A missing option is a question. Answer it here rather than
                  leaving the customer to wonder whether the site is broken. */}
              {blockedQuotes.length > 0 && blockingClasses.length > 0 && (
                <p className="text-mist mt-3 text-[0.75rem]">
                  {rtl
                    ? `${blockedQuotes
                        .map((q) => t(q.method.name, locale))
                        .join(" و")} غير متاح لأن حقيبتك تحتوي على صنف ${blockingClasses
                        .map((c) => t(c.name, locale))
                        .join(" و")}.`
                    : `${blockedQuotes
                        .map((q) => t(q.method.name, locale))
                        .join(" and ")} is unavailable because your bag contains a ${blockingClasses
                        .map((c) => t(c.name, locale).toLowerCase())
                        .join(" and ")} item.`}
                </p>
              )}
            </fieldset>

            {/* Promo code */}
            <div className="mt-6">
              {appliedOffer ? (
                <motion.div
                  className="bg-mint/10 rounded-md flex items-center justify-between gap-3 p-3.5"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <span className="text-mint text-[0.8125rem] font-medium">
                    {appliedOffer.code} · {t(appliedOffer.title, locale)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAppliedOffer(null)}
                    className="text-smoke hover:text-ink cursor-pointer text-[0.75rem]"
                    data-cursor="hover"
                  >
                    {rtl ? "إزالة" : "Remove"}
                  </button>
                </motion.div>
              ) : (
                <>
                  <label htmlFor="promo" className="text-eyebrow font-display text-mist mb-2 block uppercase">
                    {rtl ? "رمز الخصم" : "Promo code"}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="promo"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value);
                        setCodeError(null);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && applyCode()}
                      placeholder={rtl ? "أدخل الرمز" : "Enter code"}
                      className={cn(
                        "rounded-pill text-ink placeholder:text-mist min-w-0 flex-1 border px-4 py-2.5 text-[0.875rem] outline-none transition-colors",
                        codeError ? "border-alert" : "border-line focus:border-brand",
                      )}
                    />
                    <Button
                      variant="secondary"
                      size="md"
                      loading={checkingCode}
                      onClick={applyCode}
                      disabled={!code.trim()}
                    >
                      {rtl ? "تطبيق" : "Apply"}
                    </Button>
                  </div>
                  {codeError && (
                    <p role="alert" className="text-alert mt-2 text-[0.75rem]">
                      {codeError}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Totals */}
            <dl className="border-line mt-6 space-y-2.5 border-t pt-5 text-[0.875rem]">
              <Row label={rtl ? "المجموع الفرعي" : "Subtotal"} value={totals.subtotal} currency={totals.currency} locale={locale} />
              {totals.discount > 0 && (
                <Row
                  label={rtl ? "الخصم" : "Discount"}
                  value={-totals.discount}
                  currency={totals.currency}
                  locale={locale}
                  tone="mint"
                />
              )}
              <Row
                label={rtl ? "الشحن" : "Delivery"}
                value={totals.shipping}
                currency={totals.currency}
                locale={locale}
                freeLabel={rtl ? "مجاني" : "Free"}
              />
              <Row label={rtl ? "ضريبة القيمة المضافة ١٥٪" : "VAT (15%)"} value={totals.tax} currency={totals.currency} locale={locale} />

              <div className="border-line flex items-baseline justify-between border-t pt-4">
                <dt className="font-display text-ink text-base font-semibold">
                  {rtl ? "الإجمالي" : "Total"}
                </dt>
                <motion.dd
                  key={totals.total}
                  className="font-display text-ink text-xl font-semibold tabular-nums"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: EASE.brand }}
                >
                  {formatPrice(totals.total, totals.currency, locale)}
                </motion.dd>
              </div>
            </dl>

            <Button
              variant="brand"
              size="lg"
              fullWidth
              magnetic
              className="mt-6"
              onClick={() => router.push("/checkout")}
            >
              {rtl ? "إتمام الشراء" : "Proceed to checkout"}
            </Button>

            <p className="text-mist mt-3 text-center text-[0.75rem]">
              {rtl ? "دفع آمن · إرجاع خلال ٣٠ يوماً" : "Secure checkout · 30-day returns"}
            </p>
          </div>
        </aside>
      </div>

      {suggestions.length > 0 && (
        <section className="ns-container pb-24">
          <SectionHeading
            locale={locale}
            eyebrow={rtl ? "يناسب ما في حقيبتك" : "Goes with your bag"}
            title={rtl ? "قد يعجبك أيضاً" : "You may also like"}
          />
          <ProductRail products={suggestions} locale={locale} />
        </section>
      )}
    </>
  );
}

function Row({
  label,
  value,
  currency,
  locale,
  tone,
  freeLabel,
}: {
  label: string;
  value: number;
  currency: Parameters<typeof formatPrice>[1];
  locale: Locale;
  tone?: "mint";
  freeLabel?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-smoke">{label}</dt>
      <dd className={cn("tabular-nums", tone === "mint" ? "text-mint" : "text-ink")}>
        {value === 0 && freeLabel ? freeLabel : formatPrice(value, currency, locale)}
      </dd>
    </div>
  );
}

function StepButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "text-ink-muted grid h-9 w-9 cursor-pointer place-items-center rounded-full transition-colors",
        "hover:bg-ink hover:text-white",
        "disabled:hover:text-ink-muted disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
      )}
      data-cursor="hover"
    >
      {children}
    </button>
  );
}
