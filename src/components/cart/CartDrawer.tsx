"use client";

import { useEffect, useMemo } from "react";
import Image from "next/image";
import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";
import { formatPrice, t } from "@/lib/format";
import { amountToFreeShipping, freeShippingProgress, subtotalOf } from "@/lib/pricing";
import { useCart, useCartHydrated } from "@/lib/store/cart";
import { useUI } from "@/lib/store/ui";
import { Button } from "@/components/ui/Button";
import { BrandWave } from "@/components/brand/BrandWave";
import { demoShippingMethods } from "@/data/demo";
import type { Locale } from "@/types";

/**
 * Mini cart.
 *
 * Opens on every add — the alternative, a silent counter increment, leaves the
 * customer unsure whether the click registered. It closes on route change, on
 * Escape, and on backdrop click, and it locks body scroll while open.
 *
 * The free-shipping meter at the top is the highest-leverage element here:
 * showing the remaining amount to a threshold reliably lifts average order
 * value, and it is honest — it names a real number, not a vague nudge.
 */

export function CartDrawer({ locale = "en" }: { locale?: Locale }) {
  const router = useLocalizedRouter();
  const pathname = usePathname();
  const open = useUI((s) => s.cartOpen);
  const closeCart = useUI((s) => s.closeCart);

  const items = useCart((s) => s.items);
  const setQuantity = useCart((s) => s.setQuantity);
  const remove = useCart((s) => s.remove);
  const hydrated = useCartHydrated();

  const subtotal = useMemo(() => subtotalOf(items), [items]);
  const standard = demoShippingMethods.find((m) => m.id === "standard");
  const remaining = amountToFreeShipping(subtotal, standard);
  const progress = freeShippingProgress(subtotal, standard);
  const currency = items[0]?.currency ?? "JOD";
  const rtl = locale === "ar";

  // Escape closes, and body scroll is locked while the panel owns the screen.
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCart();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, closeCart]);

  // A drawer that survives a route change is the classic commerce SPA bug.
  useEffect(() => {
    closeCart();
  }, [pathname, closeCart]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[150]" role="dialog" aria-modal="true" aria-label="Shopping bag">
          <motion.button
            type="button"
            className="bg-ink/30 absolute inset-0 backdrop-blur-[3px]"
            onClick={closeCart}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
            aria-label={rtl ? "إغلاق" : "Close bag"}
          />

          <motion.aside
            className={cn(
              "bg-paper absolute inset-y-0 flex w-full max-w-[27rem] flex-col shadow-hover",
              rtl ? "start-0 rounded-e-2xl" : "end-0 rounded-s-2xl",
            )}
            initial={{ x: rtl ? "-100%" : "100%" }}
            animate={{ x: 0 }}
            exit={{ x: rtl ? "-100%" : "100%" }}
            transition={transition.drawer}
          >
            {/* Header */}
            <header className="border-line flex items-center justify-between border-b px-6 py-5">
              <div>
                <h2 className="font-display text-ink text-lg font-semibold tracking-tight">
                  {rtl ? "الحقيبة" : "Your bag"}
                </h2>
                <p className="text-smoke mt-0.5 text-[0.8125rem] tabular-nums">
                  {items.length} {rtl ? "قطعة" : items.length === 1 ? "item" : "items"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeCart}
                className="text-ink hover:bg-ink/6 grid h-9 w-9 cursor-pointer place-items-center rounded-full transition-colors"
                aria-label={rtl ? "إغلاق" : "Close"}
                data-cursor="hover"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="m4.5 4.5 9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            {/* Free-shipping meter */}
            {hydrated && items.length > 0 && standard?.freeAbove && (
              <div className="border-line bg-brand-veil border-b px-6 py-4">
                <p className="text-ink-muted text-[0.8125rem]">
                  {remaining > 0 ? (
                    <>
                      {rtl ? "أضف " : "Add "}
                      <strong className="text-brand font-semibold tabular-nums">
                        {formatPrice(remaining, currency, locale)}
                      </strong>
                      {rtl ? " للحصول على شحن مجاني" : " more for free express shipping"}
                    </>
                  ) : (
                    <span className="text-mint font-medium">
                      {rtl ? "✓ الشحن السريع مجاني" : "✓ Free express shipping unlocked"}
                    </span>
                  )}
                </p>
                <div className="bg-brand/12 mt-2.5 h-1 overflow-hidden rounded-full">
                  <motion.div
                    className={cn("h-full rounded-full", remaining > 0 ? "bg-brand" : "bg-mint")}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: progress }}
                    style={{ transformOrigin: rtl ? "right" : "left" }}
                    transition={{ duration: 0.7, ease: EASE.brand }}
                  />
                </div>
              </div>
            )}

            {/* Lines */}
            <div className="ns-no-scrollbar flex-1 overflow-y-auto px-6">
              {!hydrated ? (
                <div className="space-y-4 py-6">
                  {[0, 1].map((i) => (
                    <div key={i} className="flex gap-4">
                      <div className="ns-shimmer rounded-md h-28 w-21" />
                      <div className="flex-1 space-y-2 pt-2">
                        <div className="ns-shimmer h-3 w-2/3 rounded-xs" />
                        <div className="ns-shimmer h-3 w-1/3 rounded-xs" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : items.length === 0 ? (
                <EmptyBag locale={locale} onClose={closeCart} />
              ) : (
                <ul className="divide-line divide-y">
                  <AnimatePresence initial={false}>
                    {items.map((item) => (
                      <motion.li
                        key={item.key}
                        layout
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                        transition={transition.base}
                        className="overflow-hidden"
                      >
                        <div className="flex gap-4 py-5">
                          <Link
                            href={`/product/${item.slug}`}
                            onClick={closeCart}
                            className="bg-paper-sunken rounded-md relative h-28 w-21 shrink-0 overflow-hidden"
                          >
                            <Image
                              src={item.image.url}
                              alt={item.image.alt}
                              fill
                              sizes="84px"
                              className="object-cover"
                            />
                          </Link>

                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <Link
                                  href={`/product/${item.slug}`}
                                  onClick={closeCart}
                                  className="text-ink ns-underline block truncate text-[0.875rem] font-medium"
                                >
                                  {t(item.title, locale)}
                                </Link>
                                {/* Simple products carry no colour or size.
                                    Printing " · " around two empty strings
                                    leaves a stray separator under the title. */}
                                {(item.sizeLabel ||
                                  item.designName ||
                                  t(item.colorName, locale)) && (
                                  <p className="text-smoke mt-1 truncate text-[0.75rem]">
                                    {[
                                      item.designName && t(item.designName, locale),
                                      t(item.colorName, locale),
                                      item.sizeLabel,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => remove(item.key)}
                                className="text-mist hover:text-alert -mt-1 shrink-0 cursor-pointer p-1 transition-colors"
                                aria-label={`${rtl ? "إزالة" : "Remove"} ${t(item.title, locale)}`}
                                data-cursor="hover"
                              >
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                                  <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                                </svg>
                              </button>
                            </div>

                            <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                              <QuantityStepper
                                value={item.quantity}
                                max={item.maxQuantity}
                                reason={item.maxReason}
                                onChange={(next) => setQuantity(item.key, next)}
                                locale={locale}
                              />
                              <span className="text-ink text-[0.875rem] font-medium tabular-nums">
                                {formatPrice(item.unitPrice * item.quantity, item.currency, locale)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>

            {/* Footer */}
            {hydrated && items.length > 0 && (
              <motion.footer
                className="border-line bg-paper-raised border-t px-6 py-5"
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.12, ...transition.base }}
              >
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-ink-muted text-sm">{rtl ? "المجموع الفرعي" : "Subtotal"}</span>
                  <motion.span
                    key={subtotal}
                    className="font-display text-ink text-lg font-semibold tabular-nums"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: EASE.brand }}
                  >
                    {formatPrice(subtotal, currency, locale)}
                  </motion.span>
                </div>
                <p className="text-mist mb-4 text-[0.75rem]">
                  {rtl
                    ? "تُحتسب الضريبة والشحن عند الدفع."
                    : "Tax and shipping calculated at checkout."}
                </p>

                <Button
                  variant="brand"
                  size="lg"
                  fullWidth
                  magnetic
                  onClick={() => {
                    closeCart();
                    router.push("/checkout");
                  }}
                >
                  {rtl ? "إتمام الشراء" : "Checkout"}
                </Button>

                <button
                  type="button"
                  onClick={closeCart}
                  className="text-smoke hover:text-ink mt-3 w-full cursor-pointer text-center text-[0.8125rem] transition-colors"
                  data-cursor="hover"
                >
                  {rtl ? "متابعة التسوّق" : "Continue shopping"}
                </button>
              </motion.footer>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Quantity stepper.
 *
 * A "+" that stops responding is indistinguishable from a broken button, so
 * the reason for the ceiling is printed under the control the moment it is
 * reached — and the two reasons are worded differently on purpose. A merchant
 * cap is a policy ("Limit 1 per order"); low stock is a claim about the world
 * ("Only 1 left") and is only ever shown when it is true.
 */
function QuantityStepper({
  value,
  max,
  reason,
  onChange,
  locale,
}: {
  value: number;
  max: number;
  reason?: "stock" | "per-order";
  onChange: (next: number) => void;
  locale: Locale;
}) {
  const rtl = locale === "ar";
  const atCeiling = value >= max;

  return (
    <div className="flex flex-col gap-1">
      <div className="border-line inline-flex items-center rounded-pill border">
        <StepButton
          onClick={() => onChange(value - 1)}
          disabled={value <= 1}
          label={rtl ? "إنقاص" : "Decrease quantity"}
        >
          −
        </StepButton>
        <motion.span
          key={value}
          className="text-ink w-8 text-center text-[0.8125rem] font-medium tabular-nums"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.18, ease: EASE.spring }}
        >
          {value}
        </motion.span>
        <StepButton
          onClick={() => onChange(value + 1)}
          disabled={atCeiling}
          label={rtl ? "زيادة" : "Increase quantity"}
        >
          +
        </StepButton>
      </div>

      {atCeiling && (
        <p className="text-mist text-[0.6875rem]" aria-live="polite">
          {reason === "per-order"
            ? max === 1
              ? rtl
                ? "قطعة واحدة لكل طلب"
                : "Limit 1 per order"
              : rtl
                ? `بحد أقصى ${max} لكل طلب`
                : `Limit ${max} per order`
            : rtl
              ? `بقي ${max} في المخزون`
              : `Only ${max} in stock`}
        </p>
      )}
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
        "grid h-8 w-8 cursor-pointer place-items-center rounded-full text-sm transition-colors",
        "text-ink-muted hover:bg-ink hover:text-white",
        "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-muted",
      )}
      data-cursor="hover"
    >
      {children}
    </button>
  );
}

function EmptyBag({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const rtl = locale === "ar";
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-28 w-28 opacity-70">
        <BrandWave rings={3} solidCore={false} color="var(--color-brand)" speed={7} />
      </div>
      <h3 className="font-display text-ink mt-6 text-lg font-semibold">
        {rtl ? "حقيبتك فارغة" : "Your bag is empty"}
      </h3>
      <p className="text-smoke mt-2 max-w-[22ch] text-[0.875rem]">
        {rtl
          ? "ابدئي من الوافد الجديد، أو دعي غرفة القياس تقترح عليك."
          : "Start with new arrivals, or let the fitting room suggest something."}
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Link href="/shop" onClick={onClose}>
          <Button variant="primary" size="md">
            {rtl ? "تسوّق الآن" : "Shop new in"}
          </Button>
        </Link>
        <Link href="/fitting-room" onClick={onClose}>
          <Button variant="ghost" size="md">
            {rtl ? "غرفة القياس" : "Open fitting room"}
          </Button>
        </Link>
      </div>
    </div>
  );
}
