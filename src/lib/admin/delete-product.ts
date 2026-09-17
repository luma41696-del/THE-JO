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
 * The counted parts of a plan, as a phrase in both languages.
 *
 * Shared by the one-product dialog and the whole-selection one so the two
 * cannot describe the same operation differently — the only thing that changes
 * between them is how many products the numbers were added up over.
 */
function countedParts(plan: DeletionPlan): { en: string; ar: string } {
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

  return {
    en: bits.map((bit) => bit.en).join(", "),
    ar: bits.map((bit) => bit.ar).join("، "),
  };
}

/** The sentence about orders, which is the same at any scale. */
function ordersLine(orderCount: number): { en: string; ar: string } {
  if (orderCount <= 0) return { en: "", ar: "" };
  return {
    en: ` ${orderCount} past order${orderCount === 1 ? "" : "s"} keep their own copy and are not touched.`,
    ar: ` ${orderCount} طلباً سابقاً تحتفظ بنسختها ولا تُمَس.`,
  };
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
  const list = countedParts(plan);
  const orders = ordersLine(plan.orderCount);

  if (!list.en) {
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

/**
 * One plan describing a whole selection.
 *
 * Files are merged by path rather than concatenated. Two products sharing a
 * photograph produce it in both their plans, and a summary that counts it
 * twice overstates what is about to happen — in the one direction where
 * overstating is not the safe error, because the number is there to be
 * recognised.
 *
 * `orderCount` is passed in rather than summed, for the same reason and a
 * sharper one: one order holding two of the selected products is *one* order,
 * and adding the plans' counts would report it as two. Only something looking
 * at the whole selection at once can count orders correctly, so that is where
 * the number comes from.
 */
export function mergePlans(plans: DeletionPlan[], orderCount: number): DeletionPlan {
  const merged = emptyPlan();
  merged.orderCount = orderCount;

  const files = new Set<string>();
  const kept = new Map<string, Set<string>>();
  const reviews = new Set<string>();
  const alerts = new Set<string>();
  const collections = new Set<string>();
  const linked = new Set<string>();
  const wishlists = new Set<string>();

  for (const plan of plans) {
    for (const path of plan.filesToDelete) files.add(path);
    for (const entry of plan.filesKept) {
      const usedBy = kept.get(entry.path) ?? new Set<string>();
      for (const id of entry.usedBy) usedBy.add(id);
      kept.set(entry.path, usedBy);
    }
    for (const id of plan.reviewIds) reviews.add(id);
    for (const id of plan.alertIds) alerts.add(id);
    for (const id of plan.collectionIds) collections.add(id);
    for (const id of plan.linkedProductIds) linked.add(id);
    for (const id of plan.wishlistUserIds) wishlists.add(id);
  }

  merged.filesToDelete = [...files];
  merged.filesKept = [...kept].map(([path, usedBy]) => ({ path, usedBy: [...usedBy] }));
  merged.reviewIds = [...reviews];
  merged.alertIds = [...alerts];
  merged.collectionIds = [...collections];
  merged.linkedProductIds = [...linked];
  merged.wishlistUserIds = [...wishlists];

  return merged;
}

/**
 * The same summary for a selection, led by how many products it is.
 *
 * The product count comes first and alone, because at this scale it is the
 * number that is wrong when something is wrong. Nobody selects thirty-nine
 * products and misreads the review count; they misread the selection.
 */
export function describeBatch(
  plan: DeletionPlan,
  productCount: number,
): { en: string; ar: string } {
  const list = countedParts(plan);
  const orders = ordersLine(plan.orderCount);

  const lead = {
    en: `Deleting ${productCount} product${productCount === 1 ? "" : "s"}, for good.`,
    ar: `حذف ${productCount} منتجاً نهائياً.`,
  };

  if (!list.en) {
    return {
      en: `${lead.en} Nothing else points at ${productCount === 1 ? "it" : "them"}.${orders.en}`,
      ar: `${lead.ar} لا شيء آخر يشير إليها.${orders.ar}`,
    };
  }

  return {
    en: `${lead.en} This also removes ${list.en}.${orders.en}`,
    ar: `${lead.ar} سيُحذف أيضاً ${list.ar}.${orders.ar}`,
  };
}
