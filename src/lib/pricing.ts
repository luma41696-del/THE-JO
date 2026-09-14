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
} from "@/types";
import { minorUnits } from "@/lib/format";
import { quoteShipping } from "@/lib/shipping";

/**
 * Jordan's general sales tax, applied to the discounted subtotal before
 * shipping. Kept as a single constant so a rate change is one edit, and so the
 * client-side summary and the server-side order can never disagree about it.
 */
const TAX_RATE = 0.16;

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
  offer?: Offer | null;
  currency?: CurrencyCode;
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
export function discountFor(items: CartItem[], offer: Offer | null | undefined, now = Date.now()) {
  const currency = items[0]?.currency ?? "JOD";
  if (!offer || !offer.active) return 0;
  if (offer.startsAt > now || offer.endsAt <= now) return 0;
  if (offer.usageLimit !== undefined && offer.usageCount >= offer.usageLimit) return 0;

  const scoped =
    offer.appliesToProductIds.length || offer.appliesToCategoryIds.length
      ? items.filter((i) => offer.appliesToProductIds.includes(i.productId))
      : items;

  const base = subtotalOf(scoped);
  if (base === 0) return 0;
  if (offer.minSubtotal && subtotalOf(items) < offer.minSubtotal) return 0;

  switch (offer.type) {
    case "percentage":
      return money(base * (offer.value / 100), currency);
    case "fixed":
      // Never discount below zero.
      return money(Math.min(offer.value, base), currency);
    case "free-shipping":
    case "bundle":
      // Handled in `shippingCostFor` / bundle rules respectively.
      return 0;
    default:
      return 0;
  }
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
) {
  if (!method) return 0;
  if (offer?.type === "free-shipping" && offer.active) return 0;

  if (classes.length > 0 && items.length > 0) {
    return quoteShipping(method, items, classes, subtotalAfterDiscount).total;
  }

  if (method.freeAbove !== undefined && subtotalAfterDiscount >= method.freeAbove) return 0;
  return money(method.price);
}

export function priceCart({
  items,
  shippingMethod,
  shippingClasses = [],
  offer,
  currency,
}: PriceInput): CartTotals {
  const resolvedCurrency =
    currency ??
    items[0]?.currency ??
    (process.env.NEXT_PUBLIC_DEFAULT_CURRENCY as CurrencyCode) ??
    "JOD";

  const subtotal = subtotalOf(items);
  const discount = Math.min(discountFor(items, offer), subtotal);
  const discounted = money(subtotal - discount, resolvedCurrency);
  const shipping = shippingCostFor(discounted, shippingMethod, offer, items, shippingClasses);
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
