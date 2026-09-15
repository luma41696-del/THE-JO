/**
 * Coupon evaluation — the single source of truth for "does this code apply".
 *
 * Before this module the answer lived in three places that disagreed: the cart
 * checked the minimum spend, `discountFor` checked dates and usage, and
 * `shippingCostFor` checked neither — so an expired free-shipping code still
 * waived the delivery fee. Every caller now asks `evaluateOffer`, which
 * returns *both* the money and the reason, so the cart can explain a refusal
 * in the customer's language and the server can refuse the same order for the
 * same reason.
 *
 * Isomorphic and pure: no clock of its own, no I/O. `now` and the customer's
 * prior usage are passed in, which is what lets the checkout transaction
 * evaluate against numbers it has just read inside the transaction.
 */

import type {
  CartItem,
  CurrencyCode,
  Localized,
  Offer,
  OfferStatus,
  Product,
} from "@/types";
import { money } from "@/lib/pricing";

/* -------------------------------------------------------------------------- */
/*  Result                                                                    */
/* -------------------------------------------------------------------------- */

export type OfferRejection =
  | "not-found"
  | "not-active"
  | "archived"
  | "not-started"
  | "expired"
  | "usage-limit"
  | "user-limit"
  | "first-order-only"
  | "wrong-account"
  | "min-subtotal"
  | "no-eligible-items";

export interface OfferEvaluation {
  ok: boolean;
  reason?: OfferRejection;
  /** Why, in both languages. Shown verbatim; never a raw enum. */
  message: Localized;
  /** Monetary discount. Always 0 for a free-shipping coupon. */
  discount: number;
  /** Whether the delivery fee is waived. */
  freeShipping: boolean;
  /** The part of the basket the coupon actually applies to. */
  eligibleSubtotal: number;
}

export interface OfferContext {
  items: CartItem[];
  /** Basket subtotal before any discount. */
  subtotal: number;
  now?: number;
  currency?: CurrencyCode;
  /** How many times *this* customer has already used *this* coupon. */
  userUsage?: number;
  /** Signed-in account, for personal codes. */
  uid?: string | null;
  /** Whether this would be the account's first completed order. */
  isFirstOrder?: boolean;
  /**
   * Product id → category ancestry, so a category-scoped coupon can be
   * resolved without the cart line carrying its category. Cart lines
   * deliberately do not: a category can be renamed or reparented after the
   * item was added, and the coupon must follow the catalogue, not the bag.
   */
  categoryPaths?: Record<string, string[]>;
}

function reject(reason: OfferRejection, message: Localized): OfferEvaluation {
  return { ok: false, reason, message, discount: 0, freeShipping: false, eligibleSubtotal: 0 };
}

/* -------------------------------------------------------------------------- */
/*  Status                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Read a coupon's status, tolerating documents written before `status`
 * existed. Those carry only `active`, and a missing status must not silently
 * read as "draft" — that would switch off every live campaign on deploy.
 */
export function offerStatus(offer: Offer): OfferStatus {
  if (offer.status) return offer.status;
  return offer.active ? "active" : "paused";
}

export function isLive(offer: Offer, now = Date.now()): boolean {
  return offerStatus(offer) === "active" && offer.startsAt <= now && offer.endsAt > now;
}

/* -------------------------------------------------------------------------- */
/*  Scope                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The lines a coupon may discount.
 *
 * Includes first, then exclusions — and exclusions win, so "20% off outerwear,
 * except the Atelier coat" behaves the way the sentence reads.
 */
export function eligibleLines(offer: Offer, context: OfferContext): CartItem[] {
  const paths = context.categoryPaths ?? {};
  const inCategory = (productId: string, ids: string[]) =>
    (paths[productId] ?? []).some((id) => ids.includes(id));

  const hasIncludes =
    offer.appliesToProductIds.length > 0 || offer.appliesToCategoryIds.length > 0;

  return context.items.filter((item) => {
    if (hasIncludes) {
      const included =
        offer.appliesToProductIds.includes(item.productId) ||
        inCategory(item.productId, offer.appliesToCategoryIds);
      if (!included) return false;
    }

    if (offer.excludesProductIds?.includes(item.productId)) return false;
    if (offer.excludesCategoryIds?.length && inCategory(item.productId, offer.excludesCategoryIds)) {
      return false;
    }
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/*  Evaluation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Decide whether a coupon applies, and for how much.
 *
 * The order of the checks is the order a customer would ask them in: does the
 * code exist, is it running, is there any left, may *I* use it, does my basket
 * qualify. Reporting the first failure in that order gives the most actionable
 * message — "this expired" is more useful than "your basket is too small" when
 * both are true.
 */
export function evaluateOffer(
  offer: Offer | null | undefined,
  context: OfferContext,
): OfferEvaluation {
  const now = context.now ?? Date.now();
  const currency = context.currency ?? context.items[0]?.currency ?? "JOD";

  if (!offer) {
    return reject("not-found", {
      en: "That code is not recognised.",
      ar: "هذا الرمز غير معروف.",
    });
  }

  const status = offerStatus(offer);
  if (status === "archived") {
    return reject("archived", {
      en: "That code is no longer available.",
      ar: "هذا الرمز لم يعد متاحاً.",
    });
  }
  if (status !== "active") {
    return reject("not-active", {
      en: "That code is not active.",
      ar: "هذا الرمز غير مُفعَّل.",
    });
  }

  if (offer.startsAt > now) {
    return reject("not-started", {
      en: "That code has not started yet.",
      ar: "لم تبدأ صلاحية هذا الرمز بعد.",
    });
  }
  if (offer.endsAt <= now) {
    return reject("expired", { en: "That code has expired.", ar: "انتهت صلاحية هذا الرمز." });
  }

  if (offer.usageLimit !== undefined && offer.usageCount >= offer.usageLimit) {
    return reject("usage-limit", {
      en: "That code has been fully redeemed.",
      ar: "استُخدم هذا الرمز بالكامل.",
    });
  }

  // Personal codes: the check is "is this my code", and the message must not
  // confirm that someone else's code exists.
  if (offer.assignedUid && offer.assignedUid !== context.uid) {
    return reject("wrong-account", {
      en: "That code is not valid on this account.",
      ar: "هذا الرمز غير صالح على هذا الحساب.",
    });
  }

  if (offer.perUserLimit !== undefined && (context.userUsage ?? 0) >= offer.perUserLimit) {
    return reject("user-limit", {
      en:
        offer.perUserLimit === 1
          ? "You have already used this code."
          : `You have used this code the maximum ${offer.perUserLimit} times.`,
      ar:
        offer.perUserLimit === 1
          ? "لقد استخدمت هذا الرمز من قبل."
          : `استخدمت هذا الرمز ${offer.perUserLimit} مرات، وهو الحد الأقصى.`,
    });
  }

  if (offer.firstOrderOnly && context.isFirstOrder === false) {
    return reject("first-order-only", {
      en: "That code is for first orders only.",
      ar: "هذا الرمز للطلب الأول فقط.",
    });
  }

  if (offer.minSubtotal && context.subtotal < offer.minSubtotal) {
    const short = money(offer.minSubtotal - context.subtotal, currency);
    return reject("min-subtotal", {
      en: `Spend ${short.toFixed(minorDigits(currency))} more to use this code.`,
      ar: `أضف ${short.toFixed(minorDigits(currency))} لاستخدام هذا الرمز.`,
    });
  }

  const lines = eligibleLines(offer, context);
  const eligibleSubtotal = money(
    lines.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    currency,
  );

  if (lines.length === 0 || eligibleSubtotal === 0) {
    return reject("no-eligible-items", {
      en: "That code does not apply to anything in your bag.",
      ar: "لا ينطبق هذا الرمز على أي قطعة في حقيبتك.",
    });
  }

  const applied: Localized = {
    en: `${offer.code} applied.`,
    ar: `طُبِّق الرمز ${offer.code}.`,
  };

  if (offer.type === "free-shipping") {
    return {
      ok: true,
      message: applied,
      discount: 0,
      freeShipping: true,
      eligibleSubtotal,
    };
  }

  let discount = 0;
  if (offer.type === "percentage") {
    discount = eligibleSubtotal * (offer.value / 100);
    // The cap is what keeps "20% off" from becoming an unbounded liability.
    if (offer.maxDiscount !== undefined && offer.maxDiscount > 0) {
      discount = Math.min(discount, offer.maxDiscount);
    }
  } else if (offer.type === "fixed") {
    discount = Math.min(offer.value, eligibleSubtotal);
  }

  return {
    ok: true,
    message: applied,
    // Never discount below the eligible subtotal, whatever the configuration.
    discount: money(Math.max(0, Math.min(discount, eligibleSubtotal)), currency),
    freeShipping: false,
    eligibleSubtotal,
  };
}

/** Decimal places for a currency — JOD has three. */
function minorDigits(currency: CurrencyCode): number {
  return currency === "JOD" ? 3 : 2;
}

/* -------------------------------------------------------------------------- */
/*  Helpers for callers                                                       */
/* -------------------------------------------------------------------------- */

/** Build the `categoryPaths` map an evaluation needs, from the catalogue. */
export function categoryPathsFor(products: Product[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const product of products) out[product.id] = product.categoryPath;
  return out;
}

/** Case- and space-insensitive code match, the way customers actually type. */
export function findOfferByCode(offers: Offer[], code: string): Offer | null {
  const needle = code.trim().toLowerCase().replace(/\s+/g, "");
  if (!needle) return null;
  return (
    offers.find((o) => o.code.trim().toLowerCase().replace(/\s+/g, "") === needle) ?? null
  );
}

/** Redemption document id. Deterministic, so the transaction can read it. */
export function redemptionId(offerId: string, uid: string): string {
  return `${offerId}__${uid}`;
}
