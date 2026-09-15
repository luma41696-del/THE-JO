/**
 * Outfit suggestions.
 *
 * "Build me a look" is easy to fake — pick five products at random, call it a
 * styling engine. What makes it worth having is that every constraint it
 * claims to respect is actually enforced here, and the ones it *cannot*
 * satisfy come back named rather than silently dropped:
 *
 *   stock       a look built from sold-out pieces is an insult, not a look
 *   size        a piece that cannot fit this body is never offered
 *   budget      the running total is checked before each piece is added
 *   season      a wool coat is not suggested for a Jordanian July
 *   preference  silhouettes near the customer's preferred ease rank higher
 *
 * Pure and deterministic: same inputs, same look. That is what makes it
 * testable, and what stops the suggestion shuffling under the customer's
 * fingers when an unrelated bit of state changes.
 */

import { recommendSize, type BodyProfile } from "@/lib/fitting";
import { resolveSelection } from "@/lib/product";
import type { OutfitSlot, Product, Season } from "@/types";

/** Why a slot came back empty. Each maps to a sentence the UI can show. */
export type SkipReason =
  | "nothing-here"
  | "out-of-stock"
  | "no-size"
  | "out-of-season"
  | "over-budget";

export interface SuggestedLook {
  items: Partial<Record<OutfitSlot, Product>>;
  /** Sum of the suggested pieces, including any that were already locked. */
  total: number;
  skipped: { slot: OutfitSlot; reason: SkipReason }[];
}

export interface SuggestInput {
  products: Product[];
  slots: { id: OutfitSlot; categories: string[] }[];
  body: BodyProfile;
  /** Pieces the customer already picked. Never replaced, always counted. */
  locked?: Partial<Record<OutfitSlot, Product>>;
  /** Maximum for the whole look. Undefined means no ceiling. */
  budget?: number;
  season?: Season | "any";
}

/**
 * Fill order, and it is not alphabetical.
 *
 * The top and the bottom are the look; outerwear, shoes and a bag finish it.
 * Under a tight budget the greedy pass spends what it has on the pieces that
 * decide whether there is an outfit at all, rather than on a bag that leaves
 * nothing for trousers.
 */
const FILL_ORDER: OutfitSlot[] = ["top", "bottom", "outerwear", "shoes", "accessory"];

/** Does any variant of this product have stock a customer could actually buy? */
export function isBuyable(product: Product): boolean {
  if (product.status !== "active") return false;
  if (product.type !== "variable") return resolveSelection(product).buyable;

  return product.colors.some((colour) =>
    product.sizes.some((size) => resolveSelection(product, colour.id, size.id).buyable),
  );
}

/** Does the product belong in this season? Unclassified counts as all-season. */
export function inSeason(product: Product, season: Season | "any" | undefined): boolean {
  if (!season || season === "any") return true;
  const seasons = product.seasons?.length ? product.seasons : (["all-season"] as Season[]);
  return seasons.includes(season) || seasons.includes("all-season");
}

/**
 * How well a silhouette answers a stated preference.
 *
 * Not a hard filter: someone who prefers a slim cut is not forbidden an
 * oversized coat, they just see it ranked below the slim one. A hard filter
 * here would empty the outerwear slot for half the catalogue.
 */
function preferenceScore(product: Product, preferred: BodyProfile["preferredFit"]): number {
  const silhouette = product.fit?.silhouette ?? "regular";
  if (!preferred) return 0;

  const distance: Record<string, Record<string, number>> = {
    slim: { slim: 0, regular: 1, relaxed: 2, oversized: 3 },
    regular: { slim: 1, regular: 0, relaxed: 1, oversized: 2 },
    relaxed: { slim: 2, regular: 1, relaxed: 0, oversized: 1 },
  };

  return -(distance[preferred]?.[silhouette] ?? 1);
}

export function suggestLook({
  products,
  slots,
  body,
  locked = {},
  budget,
  season = "any",
}: SuggestInput): SuggestedLook {
  const items: Partial<Record<OutfitSlot, Product>> = { ...locked };
  const skipped: { slot: OutfitSlot; reason: SkipReason }[] = [];

  // What the customer has already committed to counts against the budget —
  // suggesting a JOD 200 coat on top of a JOD 180 dress inside a JOD 250
  // budget would be a suggestion nobody can take.
  let total = Object.values(items).reduce((sum, product) => sum + (product?.price ?? 0), 0);
  const taken = new Set(Object.values(items).map((p) => p?.id));

  const ordered = [...slots].sort(
    (a, b) => FILL_ORDER.indexOf(a.id) - FILL_ORDER.indexOf(b.id),
  );

  for (const slot of ordered) {
    if (items[slot.id]) continue;

    const inSlot = products.filter(
      (product) =>
        !taken.has(product.id) &&
        slot.categories.some((category) =>
          (product.categoryPath ?? [product.categoryId]).includes(category),
        ),
    );

    if (inSlot.length === 0) {
      skipped.push({ slot: slot.id, reason: "nothing-here" });
      continue;
    }

    /*
     * The filters run in order and the *first* one to empty the list is the
     * reason reported. That ordering is the difference between "nothing in
     * your size" and "everything here is over budget" — two problems with
     * completely different answers for the customer.
     */
    const stocked = inSlot.filter(isBuyable);
    if (stocked.length === 0) {
      skipped.push({ slot: slot.id, reason: "out-of-stock" });
      continue;
    }

    const seasonal = stocked.filter((product) => inSeason(product, season));
    if (seasonal.length === 0) {
      skipped.push({ slot: slot.id, reason: "out-of-season" });
      continue;
    }

    const scored = seasonal
      .map((product) => ({ product, fit: recommendSize(product, body) }))
      .filter(({ fit }) => fit.outcome !== "no-size");

    if (scored.length === 0) {
      skipped.push({ slot: slot.id, reason: "no-size" });
      continue;
    }

    const affordable =
      budget === undefined
        ? scored
        : scored.filter(({ product }) => total + product.price <= budget);

    if (affordable.length === 0) {
      skipped.push({ slot: slot.id, reason: "over-budget" });
      continue;
    }

    const best = affordable
      .map((entry) => ({
        ...entry,
        score:
          entry.fit.confidence * 2 +
          preferenceScore(entry.product, body.preferredFit) +
          // A nudge towards pieces the shop is actually promoting, so the
          // suggestion is not indifferent to what the buyer chose to feature.
          (entry.product.badges?.length ? 0.25 : 0),
      }))
      // Ties break on id, never on array order: two equally good pieces must
      // not swap places because an unrelated product was edited.
      .sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id))[0]!;

    items[slot.id] = best.product;
    taken.add(best.product.id);
    total += best.product.price;
  }

  return { items, total, skipped };
}

export const SKIP_TEXT: Record<SkipReason, { en: string; ar: string }> = {
  "nothing-here": { en: "nothing in this slot yet", ar: "لا توجد قطع في هذه الخانة" },
  "out-of-stock": { en: "everything here is sold out", ar: "جميع القطع نفدت" },
  "no-size": { en: "nothing here fits your measurements", ar: "لا يوجد مقاس يناسب قياساتك" },
  "out-of-season": { en: "nothing for this season", ar: "لا شيء يناسب هذا الموسم" },
  "over-budget": { en: "over your budget", ar: "يتجاوز ميزانيتك" },
};
