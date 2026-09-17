import "server-only";

import type { Product } from "@/types";

/**
 * Deleting a product, everywhere it exists.
 *
 * A product is not one document. It is a row in `products`, a set of files in
 * Storage, every review written about it, every back-in-stock alert waiting on
 * it, an entry in however many collections, a line in other products' upsell
 * lists, and an id sitting in strangers' wishlists. Deleting only the first
 * leaves the rest pointing at nothing — which shows up weeks later as an empty
 * card in a wishlist and a review nobody can trace.
 *
 * ## The one thing that is deliberately *not* deleted
 *
 * Orders. A cart line carries its own copy of the title, image, SKU and price
 * at the moment it was bought — that is why an order stays readable after a
 * price change — so past orders survive this untouched and must. They are
 * accounting records; a shop that erases the product out from under a paid
 * invoice has broken its own books to tidy a catalogue.
 *
 * ## Shared images
 *
 * The media library lets one photograph sit on several products. A file is
 * removed only when no *other* product still points at it, using the same
 * usage count the media screen uses. Deleting a shared file would leave a hole
 * on a live page that nobody notices until a customer does.
 */

export interface DeletionPlan {
  /** Storage paths safe to remove — nothing else points at them. */
  filesToDelete: string[];
  /** Files kept because another product still uses them, and which. */
  filesKept: { path: string; usedBy: string[] }[];
  reviewIds: string[];
  alertIds: string[];
  /** Collections to take this product out of. */
  collectionIds: string[];
  /** Other products whose upsell or cross-sell lists name it. */
  linkedProductIds: string[];
  /** Users with it in their wishlist. */
  wishlistUserIds: string[];
  /** Orders that reference it. Reported, never touched. */
  orderCount: number;
}

/** An empty plan, so callers can render a summary before anything is read. */
export function emptyPlan(): DeletionPlan {
  return {
    filesToDelete: [],
    filesKept: [],
    reviewIds: [],
    alertIds: [],
    collectionIds: [],
    linkedProductIds: [],
    wishlistUserIds: [],
    orderCount: 0,
  };
}

/**
 * Is anything left that would break if the product vanished?
 *
 * Orders are excluded on purpose — they carry their own copy and are the one
 * reference that is *meant* to outlive the product.
 */
export function planTouchesAnything(plan: DeletionPlan): boolean {
  return (
    plan.filesToDelete.length > 0 ||
    plan.reviewIds.length > 0 ||
    plan.alertIds.length > 0 ||
    plan.collectionIds.length > 0 ||
    plan.linkedProductIds.length > 0 ||
    plan.wishlistUserIds.length > 0
  );
}

/**
 * A one-line summary for the confirmation dialog, in both languages.
 *
 * Written from the plan rather than from a guess, because "this will also
 * remove 14 reviews" is the sentence that stops the wrong button being
 * pressed — and a number nobody counted is worse than no number.
 */
export function describePlan(
  plan: DeletionPlan,
  product: Pick<Product, "title">,
): { en: string; ar: string } {
  const bits: { en: string; ar: string }[] = [];
  const add = (n: number, en: string, ar: string) => {
    if (n > 0) bits.push({ en: `${n} ${en}`, ar: `${n} ${ar}` });
  };

  add(plan.filesToDelete.length, "image files", "ملف صورة");
  add(plan.reviewIds.length, "reviews", "تقييماً");
  add(plan.alertIds.length, "stock alerts", "تنبيه توفّر");
  add(plan.collectionIds.length, "collections", "مجموعة");
  add(plan.wishlistUserIds.length, "wishlists", "قائمة أمنيات");
  add(plan.linkedProductIds.length, "linked products", "منتجاً مرتبطاً");

  const list = {
    en: bits.map((b) => b.en).join(", "),
    ar: bits.map((b) => b.ar).join("، "),
  };

  const orders =
    plan.orderCount > 0
      ? {
          en: ` ${plan.orderCount} past order${plan.orderCount === 1 ? "" : "s"} keep their own copy and are not touched.`,
          ar: ` ${plan.orderCount} طلباً سابقاً تحتفظ بنسختها ولا تُمَس.`,
        }
      : { en: "", ar: "" };

  if (bits.length === 0) {
    return {
      en: `Nothing else points at ${product.title.en}.${orders.en}`,
      ar: `لا شيء آخر يشير إلى ${product.title.ar}.${orders.ar}`,
    };
  }

  return {
    en: `This also removes ${list.en}.${orders.en}`,
    ar: `سيُحذف أيضاً ${list.ar}.${orders.ar}`,
  };
}
