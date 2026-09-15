/**
 * Product visibility — the one answer to "is this on the storefront".
 *
 * Four different states used to be conflated into "can I see it", and telling
 * them apart is the whole point of the seasonal warehouse:
 *
 *   draft        — never published; the merchant is still writing it
 *   archived     — retired for good; kept only so old orders still resolve
 *   hidden       — active and in stock, but pulled for the season
 *   out of stock — on display, but nothing left to sell
 *
 * A winter coat in July is *hidden*. It keeps its stock, its reviews and its
 * price; it is simply not shown. Archiving it instead would claim it is gone,
 * and zeroing its stock would destroy a real count that has to come back in
 * October.
 *
 * Scheduling is resolved **at read time** rather than by a cron job. A job
 * that fails silently leaves the catalogue wrong until a human notices; a
 * comparison against `now` is simply correct on the next request, and needs no
 * infrastructure that can be down.
 */

import type { Product, ProductVisibility, Season } from "@/types";

export const SEASONS: Season[] = ["winter", "spring", "summer", "autumn", "all-season"];

export type StorefrontState =
  | "live"
  | "out-of-stock"
  | "hidden"
  | "draft"
  | "archived";

/**
 * Seasons a product belongs to.
 *
 * An unclassified product reads as `all-season` rather than as belonging to
 * nothing: a product nobody has got round to tagging must not disappear the
 * first time someone filters by season.
 */
export function seasonsOf(product: Product): Season[] {
  return product.seasons && product.seasons.length > 0 ? product.seasons : ["all-season"];
}

/**
 * The visibility a product *should* have right now, after applying any
 * schedule.
 *
 * A manual override wins: "show this now" must not be undone an hour later by
 * a rule somebody set last season and forgot about.
 */
export function effectiveVisibility(product: Product, now = Date.now()): ProductVisibility {
  const stored: ProductVisibility = product.visibility ?? "visible";
  if (product.visibilityOverride) return stored;

  const schedule = product.visibilitySchedule;
  if (!schedule) return stored;

  const { showAt, hideAt } = schedule;

  /*
   * When both bounds are set they describe a window, and which one is "inside"
   * depends on their order: showAt < hideAt is a run (visible between them),
   * while hideAt < showAt is a blackout (hidden between them). Reading them as
   * two independent rules would make a blackout that spans the new year
   * behave backwards.
   */
  if (showAt !== undefined && hideAt !== undefined) {
    if (showAt <= hideAt) {
      return now >= showAt && now < hideAt ? "visible" : "hidden";
    }
    return now >= hideAt && now < showAt ? "hidden" : "visible";
  }

  if (showAt !== undefined) return now >= showAt ? "visible" : "hidden";
  if (hideAt !== undefined) return now >= hideAt ? "hidden" : "visible";
  return stored;
}

/** The full state, for admin badges and for deciding what a customer may see. */
export function storefrontState(product: Product, now = Date.now()): StorefrontState {
  if (product.status === "draft") return "draft";
  if (product.status === "archived") return "archived";
  if (effectiveVisibility(product, now) === "hidden") return "hidden";
  if (!product.inStock || product.totalStock <= 0) return "out-of-stock";
  return "live";
}

/**
 * Whether a shopper may see this product at all.
 *
 * Out-of-stock products *are* shown — a sold-out size is information, and
 * removing the page breaks every link to it. Hidden, draft and archived ones
 * are not.
 */
export function isShoppable(product: Product, now = Date.now()): boolean {
  const state = storefrontState(product, now);
  return state === "live" || state === "out-of-stock";
}

/**
 * Whether it may be *bought*. Stricter than `isShoppable`: this is the check
 * the cart and the checkout use, and it is what stops a hidden product being
 * ordered through a stale cart or a direct API call.
 */
export function isPurchasable(product: Product, now = Date.now()): boolean {
  return storefrontState(product, now) === "live";
}

/** Filter a list down to what a shopper may browse. */
export function visibleProducts<T extends Product>(products: T[], now = Date.now()): T[] {
  return products.filter((p) => isShoppable(p, now));
}

/**
 * Why a product cannot be bought, in both languages.
 *
 * A hidden product must not say "sold out" — that is a claim about stock, and
 * it is false. Nor should it leak that it exists and is being withheld; "not
 * available" is true, useful, and gives nothing away.
 */
export function unavailableReason(product: Product, now = Date.now()) {
  switch (storefrontState(product, now)) {
    case "out-of-stock":
      return {
        en: `${product.title.en} has sold out.`,
        ar: `نفدت الكمية من ${product.title.ar}.`,
      };
    case "hidden":
    case "draft":
    case "archived":
      return {
        en: `${product.title.en} is not available at the moment.`,
        ar: `${product.title.ar} غير متاح حالياً.`,
      };
    default:
      return null;
  }
}
