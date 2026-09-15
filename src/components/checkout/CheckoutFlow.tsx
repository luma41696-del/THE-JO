"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";
import { formatDeliveryWindow, formatPrice, t } from "@/lib/format";
import { priceCart, subtotalOf } from "@/lib/pricing";
import { zoneFor } from "@/lib/shipping";
import { evaluateOffer, findOfferByCode } from "@/lib/offers";
import { track } from "@/lib/analytics/track";
import { useCart } from "@/lib/store/cart";
import { useCoupon } from "@/lib/store/coupon";
import { useAuth } from "@/components/providers/AuthProvider";
import { getIdToken } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/Button";
import { AnimatedLogo } from "@/components/brand/AnimatedLogo";
import { BrandWave } from "@/components/brand/BrandWave";
import type {
  Address,
  Locale,
  Offer,
  PaymentMethod,
  ShippingClass,
  ShippingMethod,
  ShippingZone,
} from "@/types";

/**
 * Checkout.
 *
 * Three steps on one page rather than three routes: the customer can see how
 * far they have to go, the browser back button never drops them out of the
 * flow, and the summary stays pinned throughout.
 *
 * Money is never trusted from here. The client computes totals for display
 * only; `/api/checkout` re-reads prices from Firestore, re-validates the offer,
 * and writes the order. If the two disagree, the server wins and says so.
 *
 * Card details are deliberately *not* collected by these fields — the card step
 * hands off to a PSD2-compliant gateway element (Stripe/Checkout.com). Taking
 * raw PAN into your own React state is what turns a small store into a PCI-DSS
 * audit.
 */

type Step = 0 | 1 | 2;

const EMPTY_ADDRESS: Omit<Address, "id" | "isDefault"> = {
  fullName: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  countryCode: "JO",
};

export function CheckoutFlow({
  shippingMethods,
  shippingClasses = [],
  shippingZones = [],
  offers,
  categoryPaths = {},
  locale = "en",
}: {
  shippingMethods: ShippingMethod[];
  /** Surcharges and speed exclusions, so this quote matches the bag's. */
  shippingClasses?: ShippingClass[];
  /** Delivery zones, matched against the address as it is typed. */
  shippingZones?: ShippingZone[];
  offers: Offer[];
  /** Product id → category ancestry, for category-scoped coupons. */
  categoryPaths?: Record<string, string[]>;
  locale?: Locale;
}) {
  const reduced = useReducedMotion();
  const rtl = locale === "ar";
  const { user, profile } = useAuth();

  const items = useCart((s) => s.items);
  const clearCart = useCart((s) => s.clear);

  const [step, setStep] = useState<Step>(0);
  const [email, setEmail] = useState(profile?.email ?? user?.email ?? "");
  const [address, setAddress] = useState({ ...EMPTY_ADDRESS, fullName: profile?.displayName ?? "" });
  const [methodId, setMethodId] = useState(shippingMethods[0]?.id ?? "standard");
  const [payment, setPayment] = useState<PaymentMethod>("cod");
  /*
   * The coupon comes from the shared store, not from local state.
   *
   * This was `useState<string>("")` with no setter — a constant empty string.
   * The checkout therefore applied no coupon *ever*: a customer who entered a
   * code in the bag, saw the discount, and pressed "Proceed to checkout" was
   * quietly charged full price, and the only place the difference showed was
   * the final total they had already stopped reading.
   */
  const couponCode = useCoupon((s) => s.code);
  const clearCoupon = useCoupon((s) => s.clear);
  /** Survives re-renders and retries; cleared only after a successful order. */
  const idempotencyKey = useRef<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<{ reference: string; total: number } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const method = shippingMethods.find((m) => m.id === methodId) ?? null;

  /*
   * Resolved from the address as it is typed, not guessed beforehand. Before
   * a city is entered there is no zone and the customer sees the method's own
   * price — which is honest, and then refines the moment they tell us where
   * they are rather than surprising them at the last step.
   */
  const zone = useMemo(
    () => zoneFor(shippingZones, address),
    [shippingZones, address],
  );
  const offer = useMemo(
    () => (couponCode ? findOfferByCode(offers, couponCode) : null),
    [couponCode, offers],
  );

  /*
   * Evaluated with the same engine the bag and the server use, so the three
   * numbers agree. The per-user limit still cannot be checked here — it needs
   * redemption history the browser does not have — so the server may still
   * refuse, and that refusal is shown rather than swallowed.
   */
  const offerVerdict = useMemo(
    () =>
      offer
        ? evaluateOffer(offer, {
            items,
            subtotal: subtotalOf(items),
            currency: items[0]?.currency ?? "JOD",
            categoryPaths,
            uid: user?.uid ?? null,
          })
        : null,
    [offer, items, categoryPaths, user],
  );

  const totals = useMemo(
    () =>
      priceCart({
        items,
        shippingMethod: method,
        shippingZone: zone,
        // Shipping classes were missing here, so the checkout quoted a
        // different delivery price from the bag for any basket with a
        // surcharge — the customer saw one number and paid another.
        shippingClasses,
        offer,
        offerEvaluation: offerVerdict,
      }),
    [items, method, shippingClasses, zone, offer, offerVerdict],
  );

  function validateStep(current: Step) {
    const next: Record<string, string> = {};

    if (current === 0) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
        next.email = rtl ? "بريد إلكتروني غير صالح." : "Enter a valid email address.";
      }
      if (address.fullName.trim().length < 2) {
        next.fullName = rtl ? "أدخل الاسم الكامل." : "Enter your full name.";
      }
      // Deliberately permissive: phone formats vary and a strict regex rejects
      // more real customers than it catches typos.
      if (address.phone.replace(/\D/g, "").length < 8) {
        next.phone = rtl ? "أدخل رقم هاتف صالح." : "Enter a valid phone number.";
      }
      if (address.line1.trim().length < 4) {
        next.line1 = rtl ? "أدخل العنوان." : "Enter your street address.";
      }
      if (address.city.trim().length < 2) {
        next.city = rtl ? "أدخل المدينة." : "Enter your city.";
      }
      /*
       * A zone the shop does not serve stops the order here, at the address,
       * rather than at the pay button or — worse — after the money moved.
       */
      if (zone?.excluded) {
        next.city = rtl
          ? `لا نوصل إلى ${t(zone.name, locale)} حالياً.`
          : `We do not deliver to ${t(zone.name, locale)} yet.`;
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (!validateStep(step)) return;
    // The funnel's second step: reaching delivery means the bag survived the
    // first look at the total.
    if (step === 0) {
      track(
        "checkout_start",
        {
          value: totals.total,
          currency: totals.currency,
          quantity: items.reduce((sum, i) => sum + i.quantity, 0),
        },
        { uid: user?.uid ?? null },
      );
    }
    setStep((s) => Math.min(2, s + 1) as Step);
  }

  async function placeOrder() {
    setServerError(null);
    setSubmitting(true);

    /*
     * One key per attempt, held until the attempt succeeds.
     *
     * A retry after a network timeout resends the same key, so the server
     * returns the order it already created instead of creating a second one
     * and spending the customer's coupon twice. It is regenerated only after
     * a success, because a *new* order genuinely is a new attempt.
     */
    if (!idempotencyKey.current) {
      idempotencyKey.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          email,
          items: items.map((i) => ({
            productId: i.productId,
            colorId: i.colorId,
            sizeId: i.sizeId,
            /*
             * The chosen artwork. Without it the server re-resolves the line
             * with no design and refuses a product that has them — so a tee
             * sold with four embroideries could be added to the bag and never
             * bought.
             */
            ...(i.designId ? { designId: i.designId } : {}),
            quantity: i.quantity,
          })),
          shippingMethodId: methodId,
          offerCode: offer?.code ?? null,
          paymentMethod: payment,
          shippingAddress: address,
          // Recorded on the order so the dispatch notice is written in the
          // language the customer actually shopped in.
          locale,
          idempotencyKey: idempotencyKey.current,
        }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        reference?: string;
        total?: number;
        error?: string;
        reason?: string;
        duplicate?: boolean;
      };

      if (!response.ok || !data.ok || !data.reference) {
        throw new Error(data.error || "Checkout failed");
      }

      setPlaced({ reference: data.reference, total: data.total ?? totals.total });

      /*
       * The purchase, keyed on the order reference. `track` refuses a repeat
       * of the same reference, so a refreshed or shared confirmation cannot
       * add a sale that did not happen.
       */
      track(
        "purchase",
        {
          orderReference: data.reference,
          value: data.total ?? totals.total,
          currency: totals.currency,
          quantity: items.reduce((sum, i) => sum + i.quantity, 0),
          ...(offer ? { code: offer.code } : {}),
        },
        { uid: user?.uid ?? null },
      );

      clearCart();
      /*
       * The coupon and the idempotency key are released only on success.
       *
       * On failure both are kept: the customer may fix an address and retry,
       * and they should keep their discount — and the retry must reuse the
       * same key so a request that actually succeeded before the connection
       * dropped is recognised rather than placed a second time.
       */
      clearCoupon();
      idempotencyKey.current = null;
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : rtl
            ? "تعذّر إتمام الطلب."
            : "We could not place the order.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Confirmation                                                          */
  /* ---------------------------------------------------------------------- */

  if (placed) {
    return (
      <div className="ns-container pt-32 pb-24 md:pt-44">
        <motion.div
          className="mx-auto max-w-lg text-center"
          initial={reduced ? undefined : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE.brand }}
        >
          <div className="mx-auto h-32 w-32">
            <BrandWave rings={4} solidCore color="var(--color-brand)" speed={6} />
          </div>

          <h1 className="font-display text-ink mt-8 text-3xl font-semibold tracking-tight md:text-4xl">
            {rtl ? "تم استلام طلبك" : "Order confirmed"}
          </h1>

          <p className="text-ink-muted mt-4 text-[1.0625rem]">
            {rtl ? "رقم طلبك" : "Your order reference is"}{" "}
            <strong className="font-display text-ink tracking-wide">{placed.reference}</strong>
          </p>
          <p className="text-smoke mt-2 text-[0.9375rem]">
            {rtl
              ? `أرسلنا تأكيداً إلى ${email}. سنخبرك فور شحن الطلب.`
              : `We've emailed a confirmation to ${email}. You'll hear from us again the moment it ships.`}
          </p>

          <div className="bg-paper-raised border-line rounded-xl mt-8 border p-6 text-start">
            <div className="flex items-baseline justify-between">
              <span className="text-smoke text-[0.875rem]">{rtl ? "الإجمالي المدفوع" : "Total paid"}</span>
              <span className="font-display text-ink text-lg font-semibold tabular-nums">
                {formatPrice(placed.total, totals.currency, locale)}
              </span>
            </div>
            {method && (
              <div className="border-line mt-4 flex items-baseline justify-between border-t pt-4">
                <span className="text-smoke text-[0.875rem]">{rtl ? "التوصيل" : "Delivery"}</span>
                <span className="text-ink text-[0.875rem]">
                  {t(method.name, locale)} ·{" "}
                  {formatDeliveryWindow(method.minDays, method.maxDays, locale)}
                </span>
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={`/orders/${placed.reference}`}>
              <Button variant="brand" size="lg" magnetic>
                {rtl ? "تتبّع الطلب" : "Track your order"}
              </Button>
            </Link>
            <Link href="/shop">
              <Button variant="ghost" size="lg">
                {rtl ? "متابعة التسوّق" : "Continue shopping"}
              </Button>
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  Empty guard                                                           */
  /* ---------------------------------------------------------------------- */

  if (items.length === 0) {
    return (
      <div className="ns-container pt-32 pb-24 text-center md:pt-44">
        <h1 className="font-display text-ink text-2xl font-semibold">
          {rtl ? "حقيبتك فارغة" : "There is nothing to check out"}
        </h1>
        <Link href="/shop" className="mt-6 inline-block">
          <Button variant="primary" size="lg">
            {rtl ? "تسوّق الآن" : "Browse the collection"}
          </Button>
        </Link>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  Flow                                                                  */
  /* ---------------------------------------------------------------------- */

  const steps = [
    { label: rtl ? "التوصيل" : "Delivery" },
    { label: rtl ? "الشحن" : "Shipping" },
    { label: rtl ? "الدفع" : "Payment" },
  ];

  return (
    <div className="ns-container pt-28 pb-24 md:pt-40">
      <div className="mb-10 flex items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="net sale — home">
          <AnimatedLogo className="h-9 w-9" intro={false} title={null} />
          <span className="font-display text-ink text-[0.9375rem] font-semibold tracking-[0.16em] uppercase">
            net&nbsp;sale
          </span>
        </Link>
        <span className="text-mist flex items-center gap-2 text-[0.75rem]">
          <LockIcon />
          {rtl ? "اتصال مشفّر" : "Encrypted connection"}
        </span>
      </div>

      <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
        <div>
          {/* Progress */}
          <ol className="mb-10 flex items-center gap-3">
            {steps.map((item, index) => {
              const done = index < step;
              const current = index === step;
              return (
                <li key={item.label} className="flex flex-1 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => index < step && setStep(index as Step)}
                    disabled={index > step}
                    className={cn(
                      "flex items-center gap-2.5 text-[0.8125rem] transition-colors",
                      index < step && "cursor-pointer",
                      current ? "text-ink font-medium" : done ? "text-brand" : "text-mist",
                    )}
                    data-cursor={index < step ? "hover" : undefined}
                  >
                    <span
                      className={cn(
                        "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold",
                        current
                          ? "bg-ink text-white"
                          : done
                            ? "bg-brand text-white"
                            : "bg-paper-sunken text-mist",
                      )}
                    >
                      {done ? "✓" : index + 1}
                    </span>
                    <span className="hidden sm:inline">{item.label}</span>
                  </button>
                  {index < steps.length - 1 && (
                    <span
                      className={cn(
                        "h-px flex-1 transition-colors duration-500",
                        done ? "bg-brand" : "bg-line",
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={reduced ? undefined : { opacity: 0, x: 16 }}
              animate={reduced ? undefined : { opacity: 1, x: 0 }}
              exit={reduced ? undefined : { opacity: 0, x: -16 }}
              transition={transition.base}
            >
              {step === 0 && (
                <section aria-label="Delivery details">
                  <h2 className="font-display text-ink mb-6 text-xl font-semibold">
                    {rtl ? "بيانات التوصيل" : "Where is it going?"}
                  </h2>

                  <div className="grid gap-4">
                    <Field
                      id="email"
                      label={rtl ? "البريد الإلكتروني" : "Email"}
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={setEmail}
                      error={errors.email}
                      hint={rtl ? "لإرسال التأكيد والتتبّع." : "For your confirmation and tracking."}
                    />
                    <Field
                      id="fullName"
                      label={rtl ? "الاسم الكامل" : "Full name"}
                      autoComplete="name"
                      value={address.fullName}
                      onChange={(v) => setAddress({ ...address, fullName: v })}
                      error={errors.fullName}
                    />
                    <Field
                      id="phone"
                      label={rtl ? "رقم الهاتف" : "Phone"}
                      type="tel"
                      autoComplete="tel"
                      value={address.phone}
                      onChange={(v) => setAddress({ ...address, phone: v })}
                      error={errors.phone}
                      hint={rtl ? "يستخدمه المندوب عند التسليم." : "The courier uses this on delivery."}
                    />
                    <Field
                      id="line1"
                      label={rtl ? "العنوان" : "Street address"}
                      autoComplete="address-line1"
                      value={address.line1}
                      onChange={(v) => setAddress({ ...address, line1: v })}
                      error={errors.line1}
                    />
                    <Field
                      id="line2"
                      label={rtl ? "تفاصيل إضافية (اختياري)" : "Apartment, floor (optional)"}
                      autoComplete="address-line2"
                      value={address.line2 ?? ""}
                      onChange={(v) => setAddress({ ...address, line2: v })}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        id="city"
                        label={rtl ? "المدينة" : "City"}
                        autoComplete="address-level2"
                        value={address.city}
                        onChange={(v) => setAddress({ ...address, city: v })}
                        error={errors.city}
                      />
                      <Field
                        id="postalCode"
                        label={rtl ? "الرمز البريدي (اختياري)" : "Postal code (optional)"}
                        autoComplete="postal-code"
                        value={address.postalCode ?? ""}
                        onChange={(v) => setAddress({ ...address, postalCode: v })}
                      />
                    </div>
                  </div>
                </section>
              )}

              {step === 1 && (
                <section aria-label="Shipping method">
                  <h2 className="font-display text-ink mb-6 text-xl font-semibold">
                    {rtl ? "كيف نوصلها؟" : "How should it arrive?"}
                  </h2>

                  <div className="space-y-3">
                    {shippingMethods.map((option) => {
                      const free =
                        option.freeAbove !== undefined && totals.subtotal >= option.freeAbove;
                      return (
                        <label
                          key={option.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-4 rounded-lg border p-5 transition-all duration-200",
                            methodId === option.id
                              ? "border-brand bg-brand-veil shadow-lift"
                              : "border-line hover:border-ink/30",
                          )}
                        >
                          <input
                            type="radio"
                            name="shippingMethod"
                            checked={methodId === option.id}
                            onChange={() => setMethodId(option.id)}
                            className="accent-brand mt-1"
                          />
                          <span className="flex-1">
                            <span className="flex items-center justify-between gap-3">
                              <span className="text-ink font-display font-semibold">
                                {t(option.name, locale)}
                              </span>
                              <span className="text-ink font-medium tabular-nums">
                                {free || option.price === 0
                                  ? rtl
                                    ? "مجاني"
                                    : "Free"
                                  : formatPrice(option.price, totals.currency, locale)}
                              </span>
                            </span>
                            <span className="text-smoke mt-1 block text-[0.875rem]">
                              {formatDeliveryWindow(option.minDays, option.maxDays, locale)}
                              {option.description ? ` · ${t(option.description, locale)}` : ""}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              )}

              {step === 2 && (
                <section aria-label="Payment">
                  <h2 className="font-display text-ink mb-6 text-xl font-semibold">
                    {rtl ? "طريقة الدفع" : "How would you like to pay?"}
                  </h2>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        { id: "card", en: "Card", ar: "بطاقة", note: "Visa · Mastercard · mada" },
                        { id: "apple-pay", en: "Apple Pay", ar: "أبل باي", note: "One tap" },
                        // CliQ is Jordan's instant bank-transfer rail — far more
                        // widely used here than any card-on-file wallet.
                        { id: "cliq", en: "CliQ", ar: "كليك", note: "Instant bank transfer" },
                        { id: "cod", en: "Cash on delivery", ar: "الدفع عند الاستلام", note: rtl ? "ادفع عند استلام طلبك" : "Pay when your order arrives" },
                      ] as const
                    ).filter((option) => process.env.NODE_ENV !== "production" || option.id === "cod").map((option) => (
                      <label
                        key={option.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all duration-200",
                          payment === option.id
                            ? "border-brand bg-brand-veil shadow-lift"
                            : "border-line hover:border-ink/30",
                        )}
                      >
                        <input
                          type="radio"
                          name="payment"
                          checked={payment === option.id}
                          onChange={() => setPayment(option.id as PaymentMethod)}
                          className="accent-brand mt-0.5"
                        />
                        <span>
                          <span className="text-ink block text-[0.9375rem] font-medium">
                            {locale === "ar" ? option.ar : option.en}
                          </span>
                          <span className="text-smoke block text-[0.75rem]">{option.note}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  {/* Where the gateway element mounts. */}
                  {payment === "card" && (
                    <div className="border-line bg-paper-sunken rounded-lg mt-5 border border-dashed p-6 text-center">
                      <p className="text-smoke text-[0.875rem]">
                        {rtl
                          ? "يُحمَّل هنا عنصر بوابة الدفع الآمن."
                          : "The secure payment gateway element mounts here."}
                      </p>
                      <p className="text-mist mx-auto mt-2 max-w-sm text-[0.75rem]">
                        {rtl
                          ? "لا تُدخل بيانات البطاقة في حقول هذا الموقع — تُجمع داخل إطار البوابة وحدها."
                          : "Card details are never entered into this site's own fields — they are collected inside the gateway's iframe, which keeps the store out of PCI-DSS scope."}
                      </p>
                    </div>
                  )}

                  {serverError && (
                    <motion.p
                      role="alert"
                      className="bg-alert/10 text-alert rounded-md mt-5 p-4 text-[0.875rem]"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      {serverError}
                    </motion.p>
                  )}
                </section>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="border-line mt-10 flex items-center justify-between gap-4 border-t pt-6">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
                className="text-smoke hover:text-ink cursor-pointer text-[0.875rem] transition-colors"
                data-cursor="hover"
              >
                <span aria-hidden="true" className="rtl:rotate-180">
                  ←
                </span>{" "}
                {rtl ? "رجوع" : "Back"}
              </button>
            ) : (
              <Link href="/cart" className="text-smoke hover:text-ink text-[0.875rem] transition-colors">
                <span aria-hidden="true" className="rtl:rotate-180">
                  ←
                </span>{" "}
                {rtl ? "الحقيبة" : "Back to bag"}
              </Link>
            )}

            {step < 2 ? (
              <Button variant="primary" size="lg" onClick={goNext}>
                {rtl ? "متابعة" : "Continue"}
              </Button>
            ) : (
              <Button
                variant="brand"
                size="xl"
                magnetic
                loading={submitting}
                onClick={placeOrder}
                successLabel={rtl ? "تم" : "Placed"}
              >
                {rtl ? "تأكيد الطلب" : "Place order"} ·{" "}
                {formatPrice(totals.total, totals.currency, locale)}
              </Button>
            )}
          </div>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-32 lg:self-start">
          <div className="bg-paper-raised border-line rounded-xl border p-6">
            <h2 className="font-display text-ink mb-5 text-base font-semibold">
              {rtl ? "الطلب" : "Your order"}{" "}
              <span className="text-mist font-normal tabular-nums">({items.length})</span>
            </h2>

            <ul className="max-h-72 space-y-4 overflow-y-auto pe-1">
              {items.map((item) => (
                <li key={item.key} className="flex gap-3">
                  <div className="bg-paper-sunken rounded-sm relative h-20 w-15 shrink-0 overflow-hidden">
                    <Image src={item.image.url} alt="" fill sizes="60px" className="object-cover" />
                    <span className="bg-ink absolute end-0 top-0 grid h-5 min-w-5 place-items-center rounded-bs-sm px-1 text-[0.625rem] text-white tabular-nums">
                      {item.quantity}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-ink truncate text-[0.8125rem] font-medium">
                      {t(item.title, locale)}
                    </p>
                    <p className="text-smoke mt-0.5 text-[0.75rem]">
                      {[
                        t(item.colorName, locale),
                        item.sizeLabel,
                        item.designName && t(item.designName, locale),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="text-ink mt-1 text-[0.8125rem] tabular-nums">
                      {formatPrice(item.unitPrice * item.quantity, item.currency, locale)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <dl className="border-line mt-5 space-y-2 border-t pt-5 text-[0.875rem]">
              <div className="flex justify-between">
                <dt className="text-smoke">{rtl ? "المجموع الفرعي" : "Subtotal"}</dt>
                <dd className="text-ink tabular-nums">
                  {formatPrice(totals.subtotal, totals.currency, locale)}
                </dd>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-smoke">{rtl ? "الخصم" : "Discount"}</dt>
                  <dd className="text-mint tabular-nums">
                    −{formatPrice(totals.discount, totals.currency, locale)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-smoke">
                  {rtl ? "الشحن" : "Delivery"}
                  {/*
                    Naming the zone next to the number is the difference
                    between a surcharge and a surprise. A customer in Aqaba
                    paying more than a friend in Amman deserves to see why on
                    the line that charges them, not to find out from the
                    friend.
                  */}
                  {zone && (
                    <span className="text-mist ms-1.5 text-[0.75rem]">
                      · {t(zone.name, locale)}
                    </span>
                  )}
                </dt>
                <dd className="text-ink tabular-nums">
                  {totals.shipping === 0
                    ? rtl
                      ? "مجاني"
                      : "Free"
                    : formatPrice(totals.shipping, totals.currency, locale)}
                </dd>
              </div>

              {/* A zone the shop does not serve, said before payment. */}
              {zone?.excluded && (
                <p role="alert" className="text-alert text-[0.8125rem]">
                  {rtl
                    ? `لا نوصل إلى ${t(zone.name, locale)} حالياً. غيّر العنوان أو تواصل معنا.`
                    : `We do not deliver to ${t(zone.name, locale)} yet. Change the address or contact us.`}
                </p>
              )}
              <div className="flex justify-between">
                <dt className="text-smoke">{rtl ? "ضريبة ١٥٪" : "VAT (15%)"}</dt>
                <dd className="text-ink tabular-nums">
                  {formatPrice(totals.tax, totals.currency, locale)}
                </dd>
              </div>
              <div className="border-line flex items-baseline justify-between border-t pt-3">
                <dt className="font-display text-ink font-semibold">{rtl ? "الإجمالي" : "Total"}</dt>
                <dd className="font-display text-ink text-lg font-semibold tabular-nums">
                  {formatPrice(totals.total, totals.currency, locale)}
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-ink-muted mb-1.5 block text-[0.8125rem]">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(
          "bg-paper-raised text-ink rounded-md w-full border px-4 py-3 text-[0.9375rem] outline-none",
          "transition-colors duration-200",
          error ? "border-alert" : "border-line focus:border-brand",
        )}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-alert mt-1.5 text-[0.75rem]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-mist mt-1.5 text-[0.75rem]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.5" y="5" width="7" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.2 5V3.8a1.8 1.8 0 0 1 3.6 0V5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
