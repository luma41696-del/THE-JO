/**
 * Pricing engine.
 *
 * Deliberately isomorphic: the cart drawer, the checkout summary and the
 * server-side order creation all call `priceCart`, so the number the customer
 * sees and the number they are charged come from one implementation. The
 * server still recomputes from Firestore prices — it just uses the same maths.
 */

import type {
  CartItem,
  CartTotals,
  CurrencyCode,
  Offer,
  ShippingClass,
  ShippingMethod,
  ShippingZone,
} from "@/types";
import { minorUnits } from "@/lib/format";
import { applyZone, quoteShipping } from "@/lib/shipping";
import { evaluateOffer, type OfferEvaluation } from "@/lib/offers";

/**
 * Jordan's general sales tax, applied to the discounted subtotal before
 * shipping. Kept as a single constant so a rate change is one edit, and so the
 * client-side summary and the server-side order can never disagree about it.
 */
/**
 * Jordan's general sales tax.
 *
 * Exported because it was declared twice — here and in the invoice builder —
 * and two copies of a tax rate is one rate plus a future discrepancy between
 * what a customer was charged and what their invoice says.
 */
export const TAX_RATE = 0.16;

export interface PriceInput {
  items: CartItem[];
  shippingMethod?: ShippingMethod | null;
  /**
   * The store's shipping classes. Omitted, shipping falls back to the method's
   * flat price — correct for a catalogue with no classes, and never silently
   * wrong for one that has them, because a missing class cannot add a
   * surcharge that was never configured.
   */
  shippingClasses?: ShippingClass[];
  /**
   * The delivery zone the address falls in, once there is an address.
   *
   * Omitted before the customer has typed one — the bag has no address, and
   * quoting a zone surcharge for a city nobody has named would be inventing a
   * number. The checkout passes it the moment the city is filled in.
   */
  shippingZone?: ShippingZone | null;
  offer?: Offer | null;
  /**
   * A pre-computed coupon evaluation.
   *
   * Callers that have one (the cart, which needs the rejection message
   * anyway; the checkout, which evaluates inside its transaction) pass it so
   * the coupon is judged exactly once. Callers that do not pass only `offer`,
   * and this module evaluates it — but without the customer's usage history,
   * so a per-user limit cannot be enforced from here. That is why the server
   * never relies on this path.
   */
  offerEvaluation?: OfferEvaluation | null;
  currency?: CurrencyCode;
  /** Product id → category ancestry, for category-scoped coupons. */
  categoryPaths?: Record<string, string[]>;
}

/**
 * Round to the currency's own precision, without the float drift of
 * round-tripping through `toFixed`.
 *
 * This has to be currency-aware: the dinar has **three** decimal places (1000
 * fils), so rounding to 2dp would quietly discard a fils on every line and
 * leave the order total disagreeing with the sum of its lines.
 */
export function money(value: number, currency: CurrencyCode = "JOD") {
  const factor = 10 ** minorUnits(currency);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function subtotalOf(items: CartItem[]) {
  const currency = items[0]?.currency ?? "JOD";
  return money(
    items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    currency,
  );
}

/**
 * Discount for one offer against one cart. Returns 0 rather than throwing for
 * an offer that does not apply, so callers can attempt optimistically.
 */
/**
 * Monetary discount for one coupon against one basket.
 *
 * Thin wrapper over `evaluateOffer` now. It used to carry its own copy of the
 * rules, and the copy had drifted: it filtered by product id while *claiming*
 * to honour `appliesToCategoryIds`, so a category-scoped coupon matched no
 * lines and silently discounted nothing.
 */
export function discountFor(
  items: CartItem[],
  offer: Offer | null | undefined,
  now = Date.now(),
  categoryPaths: Record<string, string[]> = {},
) {
  return evaluateOffer(offer, {
    items,
    subtotal: subtotalOf(items),
    now,
    categoryPaths,
  }).discount;
}

/**
 * What shipping actually costs for this basket.
 *
 * Order of precedence, and each step matters:
 *  1. A free-shipping *offer* beats everything, including a class that opts
 *     out of the free threshold — the merchant issued that code deliberately,
 *     and a code that silently fails to apply is a support ticket.
 *  2. Otherwise the class-aware quote decides, which is where surcharges, flat
 *     overrides and the free threshold are resolved together.
 */
export function shippingCostFor(
  subtotalAfterDiscount: number,
  method: ShippingMethod | null | undefined,
  offer?: Offer | null,
  items: CartItem[] = [],
  classes: ShippingClass[] = [],
  evaluation?: OfferEvaluation | null,
  zone?: ShippingZone | null,
) {
  if (!method) return 0;

  /*
   * A free-shipping coupon waives the fee only if it is *valid*.
   *
   * This line used to read `offer?.type === "free-shipping" && offer.active`,
   * which checked neither the dates, nor the redemption limit, nor the
   * minimum spend. A campaign that ended in March kept shipping free
   * indefinitely for anyone who still had the code, and nothing in the totals
   * showed it — the order simply arrived with a smaller number on it.
   *
   * The evaluation is trusted when the caller supplies one (it may know the
   * customer's usage history, which this function cannot). Otherwise the
   * coupon is evaluated here, which still catches every basket-level rule.
   */
  if (offer?.type === "free-shipping") {
    const verdict =
      evaluation ??
      evaluateOffer(offer, {
        items,
        subtotal: subtotalAfterDiscount,
      });
    if (verdict.ok && verdict.freeShipping) return 0;
  }

  if (classes.length > 0 && items.length > 0) {
    const quote = quoteShipping(method, items, classes, subtotalAfterDiscount);
    return applyZone(quote, zone ?? undefined, subtotalAfterDiscount).total;
  }

  /*
   * No classes configured: the method's flat price, still adjusted for the
   * zone. A shop with no shipping classes is not a shop with no geography.
   */
  if (zone) {
    const threshold = zone.freeAbove ?? method.freeAbove;
    if (typeof threshold === "number" && subtotalAfterDiscount >= threshold) return 0;
    return money(method.price + zone.surcharge);
  }

  if (method.freeAbove !== undefined && subtotalAfterDiscount >= method.freeAbove) return 0;
  return money(method.price);
}

export function priceCart({
  items,
  shippingMethod,
  shippingClasses = [],
  shippingZone,
  offer,
  offerEvaluation,
  categoryPaths = {},
  currency,
}: PriceInput): CartTotals {
  const resolvedCurrency =
    currency ??
    items[0]?.currency ??
    (process.env.NEXT_PUBLIC_DEFAULT_CURRENCY as CurrencyCode) ??
    "JOD";

  const subtotal = subtotalOf(items);

  // Evaluate once, then spend the answer on both the discount and the
  // shipping waiver — the two used to be decided by separate rule sets.
  const verdict =
    offerEvaluation ??
    (offer
      ? evaluateOffer(offer, { items, subtotal, currency: resolvedCurrency, categoryPaths })
      : null);

  const discount = Math.min(verdict?.ok ? verdict.discount : 0, subtotal);
  const discounted = money(subtotal - discount, resolvedCurrency);
  const shipping = shippingCostFor(
    discounted,
    shippingMethod,
    offer,
    items,
    shippingClasses,
    verdict,
    shippingZone,
  );
  const tax = money(discounted * TAX_RATE, resolvedCurrency);
  const total = money(discounted + shipping + tax, resolvedCurrency);

  return {
    subtotal,
    discount,
    shipping,
    tax,
    total,
    currency: resolvedCurrency,
  };
}

/** How much more is needed to clear a free-shipping threshold, or 0. */
export function amountToFreeShipping(subtotal: number, method: ShippingMethod | undefined) {
  if (!method?.freeAbove) return 0;
  return Math.max(0, money(method.freeAbove - subtotal));
}

/** 0-1 progress toward the free-shipping threshold, for the cart drawer meter. */
export function freeShippingProgress(subtotal: number, method: ShippingMethod | undefined) {
  if (!method?.freeAbove) return 1;
  return Math.min(1, subtotal / method.freeAbove);
}
