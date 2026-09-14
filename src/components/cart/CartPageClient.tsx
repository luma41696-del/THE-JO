"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";
import { formatDeliveryWindow, formatPrice, t } from "@/lib/format";
import { priceCart } from "@/lib/pricing";
import { useCart, useCartHydrated } from "@/lib/store/cart";
import { Button } from "@/components/ui/Button";
import { ProductRail } from "@/components/product/ProductRail";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BrandWave } from "@/components/brand/BrandWave";
import type { Locale, Offer, Product, ShippingMethod } from "@/types";

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
  offers,
  suggestions,
  locale = "en",
}: {
  shippingMethods: ShippingMethod[];
  offers: Offer[];
  suggestions: Product[];
  locale?: Locale;
}) {
  const router = useLocalizedRouter();
  const rtl = locale === "ar";

  const items = useCart((s) => s.items);
  const setQuantity = useCart((s) => s.setQuantity);
  const remove = useCart((s) => s.remove);
  const hydrated = useCartHydrated();

  const [methodId, setMethodId] = useState(shippingMethods[0]?.id ?? "standard");
  const [code, setCode] = useState("");
  const [appliedOffer, setAppliedOffer] = useState<Offer | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const method = shippingMethods.find((m) => m.id === methodId) ?? null;
  const totals = useMemo(
    () => priceCart({ items, shippingMethod: method, offer: appliedOffer }),
    [items, method, appliedOffer],
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
      <div className="ns-container grid gap-10 pb-24 lg:grid-cols-[1.6fr_1fr]">
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
      <div className="ns-container grid gap-10 pb-20 lg:grid-cols-[1.6fr_1fr] lg:gap-16">
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
                          <p className="text-smoke mt-1 text-[0.8125rem]">
                            {t(item.colorName, locale)} · {rtl ? "مقاس" : "Size"} {item.sizeLabel}
                          </p>
                          <p className="text-mist mt-1 text-[0.75rem]">SKU {item.sku}</p>
                        </div>

                        <span className="text-ink shrink-0 text-[0.9375rem] font-medium tabular-nums">
                          {formatPrice(item.unitPrice * item.quantity, item.currency, locale)}
                        </span>
                      </div>

                      <div className="mt-auto flex items-center justify-between gap-4 pt-4">
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
                {shippingMethods.map((option) => {
                  const free = option.freeAbove !== undefined && totals.subtotal >= option.freeAbove;
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
                            {free || option.price === 0
                              ? rtl
                                ? "مجاني"
                                : "Free"
                              : formatPrice(option.price, totals.currency, locale)}
                          </span>
                        </span>
                        <span className="text-smoke mt-0.5 block text-[0.75rem]">
                          {formatDeliveryWindow(option.minDays, option.maxDays, locale)}
                          {option.description ? ` · ${t(option.description, locale)}` : ""}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
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
