import type { Locale, Localized, PaymentMethod } from "@/types";

/**
 * Which ways a customer may pay.
 *
 * One list, read by the checkout UI and by `/api/checkout`. It was two: the
 * client filtered its radio buttons on `NODE_ENV` and the server refused
 * non-COD on `NODE_ENV` separately. Both were correct, and that is the problem
 * — the rule that decides whether money can be taken was written twice, and
 * the day someone enables a gateway they have to find both.
 *
 * A method is enabled only when the integration behind it actually exists.
 * Rendering a card option that cannot charge a card is not a preview of a
 * feature; it is a checkout that fails at the last step, which is the most
 * expensive place in the shop to fail.
 */

export interface PaymentOption {
  id: PaymentMethod;
  name: Localized;
  note: Localized;
  /**
   * Why this is not available, when it is not. Shown to nobody by default —
   * it exists so the admin and this file agree on the reason, rather than the
   * option simply vanishing with no explanation for the next developer.
   */
  blockedBy?: string;
}

/**
 * Every method the shop could offer, with the ones that work marked.
 *
 * Order matters: this is the order they render, and cash on delivery leads
 * because it is the one that works.
 */
const CATALOGUE: (PaymentOption & { enabled: boolean })[] = [
  {
    id: "cod",
    name: { en: "Cash on delivery", ar: "الدفع عند الاستلام" },
    note: { en: "Pay when your order arrives", ar: "ادفع عند استلام طلبك" },
    enabled: true,
  },
  {
    id: "card",
    name: { en: "Card", ar: "بطاقة" },
    note: { en: "Visa · Mastercard", ar: "فيزا · ماستركارد" },
    enabled: false,
    blockedBy: "No payment gateway is connected. See PAYMENTS.md.",
  },
  {
    id: "cliq",
    // Jordan's instant bank-transfer rail, far more widely used here than any
    // card-on-file wallet.
    name: { en: "CliQ", ar: "كليك" },
    note: { en: "Instant bank transfer", ar: "تحويل بنكي فوري" },
    enabled: false,
    blockedBy: "No CliQ alias or acquiring bank is configured. See PAYMENTS.md.",
  },
  {
    id: "apple-pay",
    name: { en: "Apple Pay", ar: "أبل باي" },
    note: { en: "One tap", ar: "بلمسة واحدة" },
    enabled: false,
    blockedBy: "Requires a card gateway first — Apple Pay is a wallet over one.",
  },
];

/**
 * The methods a customer may actually choose.
 *
 * Not env-dependent. A method that cannot take money in production cannot take
 * money in development either, and showing it in dev only teaches the team the
 * flow works when it does not.
 */
export function enabledPaymentMethods(): PaymentOption[] {
  return CATALOGUE.filter((option) => option.enabled).map(strip);
}

/** Drop the internal flag; callers get the option, not the bookkeeping. */
function strip({ enabled, ...option }: PaymentOption & { enabled: boolean }): PaymentOption {
  void enabled;
  return option;
}

/** Server-side guard: is this what the request claims it is? */
export function isPaymentMethodEnabled(method: unknown): method is PaymentMethod {
  return CATALOGUE.some((option) => option.enabled && option.id === method);
}

/** The default, and what an absent method falls back to. */
export const DEFAULT_PAYMENT_METHOD: PaymentMethod = "cod";

/** Everything not enabled, with its reason — for the admin and for docs. */
export function blockedPaymentMethods(): PaymentOption[] {
  return CATALOGUE.filter((option) => !option.enabled).map(strip);
}

/** A customer-facing label for a method, including on past orders. */
export function paymentLabel(method: PaymentMethod, locale: Locale = "en"): string {
  const option = CATALOGUE.find((o) => o.id === method);
  return option ? option.name[locale] : method;
}
