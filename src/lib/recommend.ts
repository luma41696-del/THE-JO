import type { Product } from "@/types";

/**
 * "Bought together", from what was actually bought together.
 *
 * The shop already has `crossSellIds` — a list somebody typed on each product.
 * That list is right on the day it is written and wrong six months later, and
 * nobody ever goes back to it: a hand-curated recommendation is a snapshot of
 * one person's guess, kept forever.
 *
 * This derives the same thing from orders. Not because a co-occurrence count
 * is clever — it is the oldest trick there is — but because it is the only
 * version that stays true as the catalogue changes.
 *
 * ## What it refuses to do
 *
 * **It does not recommend the obvious.** Two products that appear together in
 * nine orders out of ten look strongly related and usually are not: they are
 * simply the two bestsellers, and they co-occur because everything co-occurs
 * with them. Raw counts recommend the bestseller on every page, which is the
 * same as recommending nothing. The score divides by how often each product
 * appears on its own, so a genuinely unusual pairing outranks a popular one.
 *
 * **It does not speak from one order.** A pair seen once is a coincidence, and
 * presenting it as "customers also bought" is a claim the data does not
 * support.
 *
 * **It falls back rather than showing nothing.** A new product has no history,
 * and an empty rail on a product page is worse than the merchant's own guess —
 * so the hand-curated list is used where there is no evidence, not instead of
 * it.
 *
 * Pure: the caller supplies the orders.
 */

/** One order, reduced to the only thing this needs. */
export interface OrderBasket {
  id: string;
  productIds: string[];
}

/** A pair has to be seen this many times before it is evidence. */
export const MIN_CO_OCCURRENCE = 2;

export interface Recommendation {
  productId: string;
  /** How many baskets held both. */
  together: number;
  /** Lift over chance — above 1 means the pair is more than popularity. */
  score: number;
}

/**
 * Count how often each pair of products shares a basket.
 *
 * Duplicated lines within one order collapse first: a basket holding two of
 * the same tee is one appearance of that tee, not two, or a product bought in
 * multiples would look like its own best companion.
 */
export function coOccurrence(orders: OrderBasket[]): {
  pairs: Map<string, number>;
  singles: Map<string, number>;
  baskets: number;
} {
  const pairs = new Map<string, number>();
  const singles = new Map<string, number>();
  let baskets = 0;

  for (const order of orders) {
    const ids = [...new Set(order.productIds)].filter(Boolean).sort();
    if (ids.length === 0) continue;
    baskets += 1;

    for (const id of ids) singles.set(id, (singles.get(id) ?? 0) + 1);

    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]}|${ids[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  return { pairs, singles, baskets };
}

/**
 * What else people bought with this one, best first.
 *
 * The score is lift: how much more often the two appear together than they
 * would if they were unrelated. A bestseller that appears with everything
 * scores near 1 and loses to a pair that genuinely travels together.
 */
export function boughtWith(
  productId: string,
  orders: OrderBasket[],
  max = 4,
): Recommendation[] {
  const { pairs, singles, baskets } = coOccurrence(orders);
  if (baskets === 0) return [];

  const own = singles.get(productId) ?? 0;
  if (own === 0) return [];

  const results: Recommendation[] = [];

  for (const [key, together] of pairs) {
    if (together < MIN_CO_OCCURRENCE) continue;
    const [a, b] = key.split("|");
    if (a !== productId && b !== productId) continue;

    const other = a === productId ? b! : a!;
    const otherCount = singles.get(other) ?? 0;
    if (otherCount === 0) continue;

    /*
     * P(both) / (P(a) × P(b)). Anything above 1 means the pair happens more
     * than popularity alone explains; below 1 they are, if anything, avoided
     * together.
     */
    const expected = (own / baskets) * (otherCount / baskets);
    const score = expected > 0 ? together / baskets / expected : 0;

    results.push({ productId: other, together, score });
  }

  return results
    // Ties broken on how many baskets support the pair, so of two equally
    // surprising pairs the better-evidenced one wins.
    .sort((x, y) => y.score - x.score || y.together - x.together)
    .slice(0, max);
}

/**
 * The rail a product page shows.
 *
 * Evidence first, the merchant's own list where there is none. The two are not
 * mixed in a fixed ratio — a product with three real companions should show
 * three, not two plus a guess, and one with none should still show something.
 *
 * Everything is filtered through what is actually on sale. A recommendation
 * for an archived product is a click into a dead end, and it is the most
 * common way these rails rot: the data is fine, the catalogue moved.
 */
export function recommendationsFor(
  product: Product,
  orders: OrderBasket[],
  catalogue: Map<string, Product>,
  max = 4,
): Product[] {
  const seen = new Set<string>([product.id]);
  const out: Product[] = [];

  const push = (id: string) => {
    if (out.length >= max || seen.has(id)) return;
    const candidate = catalogue.get(id);
    if (!candidate) return;
    if (candidate.status !== "active") return;
    seen.add(id);
    out.push(candidate);
  };

  for (const recommendation of boughtWith(product.id, orders, max * 2)) {
    push(recommendation.productId);
  }

  for (const id of product.crossSellIds ?? []) push(id);

  return out;
}
