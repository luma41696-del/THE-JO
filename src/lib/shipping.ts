/**
 * Shipping quotes.
 *
 * A method's list price is only the starting point. What a basket actually
 * costs to move depends on what is in it, and that is what shipping classes
 * encode: tag a coat as `bulky` once, and every rate table knows what to do
 * with it.
 *
 * Isomorphic on purpose. The checkout summary and the server-side order
 * creation both call `quoteShipping`, so the price quoted is the price
 * charged; the server still recomputes from Firestore rather than trusting the
 * client's number.
 */

import type {
  CartItem,
  ShippingClass,
  ShippingMethod,
  ShippingQuote,
  ShippingZone,
} from "@/types";
import { money } from "@/lib/pricing";

/** Classes present in a basket, in the order the classes themselves declare. */
export function classesInCart(
  items: CartItem[],
  classes: ShippingClass[],
): ShippingClass[] {
  const present = new Set(
    items.map((i) => i.shippingClassId).filter((id): id is string => Boolean(id)),
  );
  return classes.filter((c) => present.has(c.id)).sort((a, b) => a.order - b.order);
}

/**
 * Quote one method against one basket.
 *
 * Surcharge rules, in the order they apply:
 *  1. A class listed in `classPriceOverrides` *replaces* the method's own
 *     price — carriers that quote a flat bulky rate rather than an add-on.
 *     The highest override wins when several apply, because the basket has to
 *     move as one shipment and the hardest item sets the rate.
 *  2. `surcharge` is added once per class present, not once per line: two
 *     coats are one oversized box, not two handling fees.
 *  3. `perItemSurcharge` is added for every unit carrying that class.
 *  4. The free-shipping threshold is applied last, and only if no class in the
 *     basket opts out of it.
 */
export function quoteShipping(
  method: ShippingMethod,
  items: CartItem[],
  classes: ShippingClass[],
  subtotal: number,
): ShippingQuote {
  const currency = items[0]?.currency ?? "JOD";
  const present = classesInCart(items, classes);

  const blocked = present.some((c) => c.excludedSpeeds.includes(method.speed));
  if (blocked) {
    return {
      method,
      base: method.price,
      surcharge: 0,
      total: method.price,
      freeApplied: false,
      classIds: present.map((c) => c.id),
      unavailableReason: "class-excluded",
    };
  }

  const overrides = present
    .map((c) => method.classPriceOverrides?.[c.id])
    .filter((v): v is number => typeof v === "number");
  const base = overrides.length > 0 ? Math.max(...overrides) : method.price;

  let surcharge = 0;
  for (const cls of present) {
    surcharge += cls.surcharge;
    const units = items
      .filter((i) => i.shippingClassId === cls.id)
      .reduce((sum, i) => sum + i.quantity, 0);
    surcharge += cls.perItemSurcharge * units;
  }

  const gross = money(base + surcharge, currency);

  const blocksFree = present.some((c) => c.ignoresFreeThreshold);
  const freeApplied =
    !blocksFree && typeof method.freeAbove === "number" && subtotal >= method.freeAbove;

  return {
    method,
    base: money(base, currency),
    surcharge: money(surcharge, currency),
    total: freeApplied ? 0 : gross,
    freeApplied,
    classIds: present.map((c) => c.id),
  };
}

/**
 * Quote every method, dropping the ones this basket cannot use.
 *
 * Returning the available list rather than the full one means a customer can
 * never select a method that will fail at the door — the same-day option
 * simply is not there when the bag holds a rolled coat.
 */
export function availableMethods(
  methods: ShippingMethod[],
  items: CartItem[],
  classes: ShippingClass[],
  subtotal: number,
): ShippingQuote[] {
  return methods
    .map((m) => quoteShipping(m, items, classes, subtotal))
    .filter((q) => !q.unavailableReason);
}

/**
 * Methods this basket *cannot* use, with the class responsible.
 *
 * Worth surfacing rather than silently hiding: "Same-day is unavailable
 * because your bag contains an oversized item" turns a missing option into an
 * explained one, and tells the customer what to remove if they want it back.
 */
export function excludedMethods(
  methods: ShippingMethod[],
  items: CartItem[],
  classes: ShippingClass[],
  subtotal: number,
): { quote: ShippingQuote; blockedBy: ShippingClass[] }[] {
  const present = classesInCart(items, classes);
  return methods
    .map((m) => quoteShipping(m, items, classes, subtotal))
    .filter((q) => q.unavailableReason === "class-excluded")
    .map((quote) => ({
      quote,
      blockedBy: present.filter((c) => c.excludedSpeeds.includes(quote.method.speed)),
    }));
}

/** How much more is needed to clear the free-shipping bar, or 0. */
export function amountToFreeShipping(
  method: ShippingMethod,
  items: CartItem[],
  classes: ShippingClass[],
  subtotal: number,
): number {
  if (typeof method.freeAbove !== "number") return 0;
  if (classesInCart(items, classes).some((c) => c.ignoresFreeThreshold)) return 0;
  const currency = items[0]?.currency ?? "JOD";
  return subtotal >= method.freeAbove ? 0 : money(method.freeAbove - subtotal, currency);
}

/* -------------------------------------------------------------------------- */
/*  Zones                                                                     */
/* -------------------------------------------------------------------------- */

/** Normalise for comparison: customers type their own address. */
const fold = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Which zone an address falls in.
 *
 * Region first, then city. An address matching nothing returns `undefined`,
 * and the caller quotes the method's own price — a shopper in a town the
 * merchant has not listed yet must not hit a wall at checkout over an
 * omission in a settings table.
 */
export function zoneFor(
  zones: ShippingZone[],
  address: { city?: string; region?: string } | null | undefined,
): ShippingZone | undefined {
  if (!address) return undefined;
  const region = fold(address.region ?? "");
  const city = fold(address.city ?? "");
  if (!region && !city) return undefined;

  const ordered = [...zones].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const field of [region, city]) {
    if (!field) continue;
    const hit = ordered.find((zone) => zone.areas.some((area) => fold(area) === field));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Apply a zone to a quote.
 *
 * Kept separate from `quoteShipping` so the cart — which has no address yet —
 * can show an honest pre-address price, and the checkout can refine it the
 * moment a city is typed. Quoting a zone surcharge before knowing the address
 * would be inventing a number.
 */
export function applyZone(
  quote: ShippingQuote,
  zone: ShippingZone | undefined,
  subtotal: number,
): ShippingQuote {
  if (!zone) return quote;

  const currency = "JOD";

  if (zone.excluded) {
    return { ...quote, zone, total: quote.total, unavailableReason: "zone-excluded" };
  }

  const gross = money(quote.base + quote.surcharge + zone.surcharge, currency);

  /*
   * A zone threshold *replaces* the method's rather than stacking with it, so
   * a shop can require more in the south without the two rules quietly
   * cancelling. `freeApplied` is recomputed here for the same reason the
   * class rule lives in `quoteShipping`: one place decides, or the cart and
   * the checkout disagree.
   */
  const threshold = zone.freeAbove ?? quote.method.freeAbove;
  const stillFree =
    quote.freeApplied || (typeof threshold === "number" && subtotal >= threshold);
  const freeApplied = stillFree && !quote.unavailableReason;

  return {
    ...quote,
    zone,
    surcharge: money(quote.surcharge + zone.surcharge, currency),
    total: freeApplied ? 0 : gross,
    freeApplied,
  };
}
