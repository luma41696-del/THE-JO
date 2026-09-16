/**
 * Catalogue repository.
 *
 * The single place the UI asks for products, categories, banners and offers.
 * It reads Firestore when the project has data and falls back to the bundled
 * demo catalogue when it does not — so the storefront renders on a clean clone
 * and degrades to something presentable if Firestore is unreachable.
 *
 * Every function is safe to call from a Server Component. Results are wrapped
 * in React's `cache()` so a page that asks for the same query in three places
 * still issues one read per request.
 */

import { cache } from "react";
import { rankProducts, suggestTerms } from "@/lib/search";
import { matchesFilters, sortProducts } from "@/lib/catalog-filters";
import { recommendationsFor, type OrderBasket } from "@/lib/recommend";
import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";

import { getDb } from "@/lib/firebase/db";
import {
  bannerConverter,
  categoryConverter,
  offerConverter,
  productConverter,
} from "@/lib/firebase/converters";
import {
  demoBanners,
  demoCategories,
  demoOffers,
  demoProducts,
  demoShippingClasses,
  demoShippingMethods,
  demoTestimonials,
} from "@/data/demo";
import {
  buildCategoryTree,
  descendantIds,
  withBorrowedImages,
  withRolledUpCounts,
} from "@/lib/categories";
import { visibleProducts } from "@/lib/visibility";
import { summarise, summariseAll } from "@/lib/reviews";
import type {
  Locale,
  Banner,
  BannerSlot,
  Category,
  CategoryNode,
  GiftCampaign,
  Review,
  ReviewSummary,
  SlotSettings,
  Offer,
  Product,
  ProductFilters,
  ShippingClass,
  ShippingMethod,
  ShippingZone,
  Testimonial,
} from "@/types";

/** Set to `false` in env once Firestore is seeded and you want hard failures. */
const ALLOW_DEMO_FALLBACK = process.env.NEXT_PUBLIC_DISABLE_DEMO_FALLBACK !== "true";

/** A slow read is a failed read as far as a storefront page is concerned. */
const READ_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Firestore read timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Run a Firestore read, falling back to local data on an empty result, an
 * error, or a timeout. Errors are logged rather than thrown: a storefront that
 * renders last-known-good product data beats a 500 page, and an unreachable
 * Firestore must never be able to take the shop offline.
 */
async function readOrFallback<T>(
  label: string,
  read: () => Promise<T[]>,
  fallback: () => T[],
): Promise<T[]> {
  try {
    const rows = await withTimeout(read(), READ_TIMEOUT_MS);
    if (rows.length > 0) return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    /*
     * Logged in production too, not just in development.
     *
     * The fallback exists so an unreachable Firestore cannot take the shop
     * offline, and that is still right. But it cannot tell a network blip from
     * a permanent misconfiguration, and the two need different reactions: a
     * blip heals, a missing index never does. Silenced in production, a
     * missing index is a page that says "no reviews yet" forever, with the
     * only evidence on a developer's laptop. It cost this shop exactly that.
     */
    const missingIndex = /requires an index/i.test(message);
    console.warn(
      missingIndex
        ? `[net sale] Firestore read "${label}" needs an index that does not exist — serving nothing. This will not heal on its own.`
        : `[net sale] Firestore read "${label}" failed — serving the demo catalogue.`,
      message,
    );
  }
  return ALLOW_DEMO_FALLBACK ? fallback() : [];
}

/* -------------------------------------------------------------------------- */
/*  Products                                                                  */
/* -------------------------------------------------------------------------- */

function productsRef() {
  return collection(getDb(), "products").withConverter(productConverter);
}

/**
 * Every **active** product, including ones hidden for the season.
 *
 * This is the catalogue as the *server* needs it: the checkout has to be able
 * to resolve a hidden product in order to refuse it by name, and the admin has
 * to see what it has pulled. Storefront code wants `getShopProducts` instead —
 * calling this one on a listing page is how a hidden product leaks back onto
 * the site.
 */
export const getAllProducts = cache(async (): Promise<Product[]> =>
  readOrFallback(
    "products",
    async () => {
      const snap = await getDocs(
        query(productsRef(), where("status", "==", "active"), orderBy("publishedAt", "desc")),
      );
      return snap.docs.map((d) => d.data());
    },
    () => demoProducts,
  ),
);

/**
 * What a shopper may browse: active, and not withheld for the season.
 *
 * Out-of-stock products are deliberately kept. A sold-out size is useful
 * information, and removing the page would break every link that points at it.
 */
export const getShopProducts = cache(async (): Promise<Product[]> =>
  visibleProducts(await getAllProducts()),
);

/**
 * A product by slug, for the storefront.
 *
 * Resolves against the visible set, so a hidden product 404s rather than
 * rendering with a disabled button — the page would otherwise announce that
 * the piece exists and is being withheld, and would still be indexed.
 */
export const getProductBySlug = cache(async (slug: string): Promise<Product | null> => {
  const all = await getShopProducts();
  return all.find((p) => p.slug === slug) ?? null;
});

/** By slug, ignoring visibility — for the checkout's refusal message. */
export const getAnyProductBySlug = cache(async (slug: string): Promise<Product | null> => {
  const all = await getAllProducts();
  return all.find((p) => p.slug === slug) ?? null;
});

export const getNewArrivals = cache(async (count = 8): Promise<Product[]> => {
  const all = await getShopProducts();
  return [...all].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, count);
});

export const getFeaturedProducts = cache(async (count = 8): Promise<Product[]> => {
  const all = await getShopProducts();
  // "Featured" is editorially weighted: badge first, then rating, then recency.
  const weight = (p: Product) =>
    (p.badges.includes("exclusive") ? 3 : 0) +
    (p.badges.includes("bestseller") ? 2 : 0) +
    (p.badges.includes("limited") ? 1 : 0);
  return [...all]
    .sort(
      (a, b) =>
        weight(b) - weight(a) ||
        (b.rating?.average ?? 0) - (a.rating?.average ?? 0) ||
        b.publishedAt - a.publishedAt,
    )
    .slice(0, count);
});

export const getTrendingProducts = cache(async (count = 8): Promise<Product[]> => {
  const all = await getShopProducts();
  // Proxy for trend until real analytics land: review volume × rating.
  return [...all]
    .sort(
      (a, b) =>
        (b.rating?.count ?? 0) * (b.rating?.average ?? 0) -
        (a.rating?.count ?? 0) * (a.rating?.average ?? 0),
    )
    .slice(0, count);
});

export const getDiscountedProducts = cache(async (count = 8): Promise<Product[]> => {
  const all = await getShopProducts();
  return all
    .filter((p) => p.compareAtPrice && p.compareAtPrice > p.price)
    .sort(
      (a, b) =>
        (b.compareAtPrice! - b.price) / b.compareAtPrice! -
        (a.compareAtPrice! - a.price) / a.compareAtPrice!,
    )
    .slice(0, count);
});

/** Products a customer is likely to wear with this one — same collection first. */
export const getRelatedProducts = cache(
  async (product: Product, count = 4): Promise<Product[]> => {
    const all = await getShopProducts();
    const score = (p: Product) => {
      if (p.id === product.id) return -1;
      let s = 0;
      if (p.collectionIds.some((c) => product.collectionIds.includes(c))) s += 3;
      // A different category scores higher — the goal is a look, not a duplicate.
      if (p.categoryId !== product.categoryId) s += 2;
      s += p.tags.filter((tag) => product.tags.includes(tag)).length;
      return s;
    };
    return all
      .map((p) => [p, score(p)] as const)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([p]) => p);
  },
);

/**
 * What was actually bought alongside this one.
 *
 * Reads recent orders and asks `lib/recommend` — which scores by lift rather
 * than raw count, so the shop's bestseller does not end up recommended on
 * every page, which is the same as recommending nothing.
 *
 * Falls back to the merchant's own cross-sell list where there is no evidence,
 * and to `getRelatedProducts` where there is neither: a new piece has no
 * history, and an empty rail is worse than a reasonable guess.
 *
 * The order read is capped and cached for the request. This is a small shop —
 * past a few thousand orders the counting belongs in a nightly job writing a
 * table, not in a page render.
 */
export const getBoughtWith = cache(
  async (product: Product, count = 4): Promise<Product[]> => {
    const all = await getShopProducts();
    const catalogue = new Map(all.map((candidate) => [candidate.id, candidate]));

    const baskets = await readBaskets();
    const fromOrders = recommendationsFor(product, baskets, catalogue, count);
    if (fromOrders.length >= count) return fromOrders;

    /*
     * Topped up rather than replaced. A product with two real companions
     * should show those two first and fill the rest, not discard them because
     * the rail wanted four.
     */
    const seen = new Set([product.id, ...fromOrders.map((p) => p.id)]);
    const filler = (await getRelatedProducts(product, count * 2)).filter(
      (candidate) => !seen.has(candidate.id),
    );
    return [...fromOrders, ...filler].slice(0, count);
  },
);

/** Recent orders, reduced to the product ids in each. */
const readBaskets = cache(async (): Promise<OrderBasket[]> => {
  try {
    const snap = await getDocs(
      query(collection(getDb(), "orders"), orderBy("createdAt", "desc"), fsLimit(500)),
    );
    return snap.docs.map((doc) => {
      const data = doc.data() as { items?: { productId?: string }[] };
      return {
        id: doc.id,
        productIds: (data.items ?? [])
          .map((item) => String(item.productId ?? ""))
          .filter(Boolean),
      };
    });
  } catch {
    /*
     * Orders are staff-readable, so this fails for an anonymous visitor
     * whenever the rules are enforced. That is the expected case, not an
     * error: the rail falls back to the curated and similarity lists, which
     * need no order history.
     */
    return [];
  }
});

/**
 * Upsells for a product: the pieces it explicitly points at, in the order the
 * merchant listed them.
 *
 * Deliberately *not* padded out with automatic suggestions when the list is
 * short. An upsell is a merchandising claim — "this is the better one" — and
 * an algorithm that fills the gap with whatever is expensive turns a curated
 * recommendation into a slot machine. An empty list renders nothing.
 */
export const getUpsellProducts = cache(async (product: Product): Promise<Product[]> => {
  if (product.upsellIds.length === 0) return [];
  const all = await getShopProducts();
  return product.upsellIds
    .map((id) => all.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p) && p!.inStock);
});

/**
 * Cross-sells for a whole basket, de-duplicated and with anything already in
 * the bag removed — suggesting what someone has just added is noise.
 */
export const getCrossSellProducts = cache(
  async (productIds: string[], count = 4): Promise<Product[]> => {
    if (productIds.length === 0) return [];
    const all = await getShopProducts();
    const inBag = new Set(productIds);

    const seen = new Set<string>();
    const out: Product[] = [];
    for (const id of productIds) {
      const source = all.find((p) => p.id === id);
      if (!source) continue;
      for (const crossId of source.crossSellIds) {
        if (inBag.has(crossId) || seen.has(crossId)) continue;
        const target = all.find((p) => p.id === crossId);
        if (!target || !target.inStock) continue;
        seen.add(crossId);
        out.push(target);
        if (out.length >= count) return out;
      }
    }
    return out;
  },
);

/* -------------------------------------------------------------------------- */
/*  Gift campaign                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The campaign currently running, if any.
 *
 * Read without caching: the gift page is dynamic because eligibility depends
 * on when *this* customer last played, and a campaign that has just been
 * paused must stop offering spins immediately rather than at the next
 * revalidation.
 *
 * Returns `null` rather than a placeholder when nothing is running. A wheel
 * with no campaign behind it is a button that cannot do anything, and the page
 * says so in words instead.
 */
export async function getActiveGiftCampaign(): Promise<GiftCampaign | null> {
  const now = Date.now();
  const rows = await readOrFallback(
    "giftCampaign",
    async () => {
      const snap = await getDocs(
        query(
          collection(getDb(), "giftCampaigns"),
          where("status", "==", "active"),
          fsLimit(1),
        ),
      );
      return snap.docs.map((d) => ({ ...(d.data() as GiftCampaign), id: d.id }));
    },
    () => [],
  );

  const campaign = rows[0] ?? null;
  if (!campaign) return null;
  // A window that has closed must not survive a stale read into the page.
  if (campaign.startsAt > now || campaign.endsAt <= now) return null;
  return campaign;
}

/* -------------------------------------------------------------------------- */
/*  Reviews                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Published reviews for one product.
 *
 * Only published ones are read, and the filter is in the *query* rather than
 * applied afterwards — a client reading this collection is bound by the same
 * rule in the security rules, so the two cannot drift into a state where the
 * server hides a review the browser can still fetch.
 *
 * ## Why the sort is in memory
 *
 * It used to be `orderBy("createdAt", "desc")`, which turns two equality
 * filters into a query needing a composite index on
 * `(productId, status, createdAt)`. That index was never declared, so every
 * call threw `FAILED_PRECONDITION` — and the fallback below turned the throw
 * into an empty list. The result was a product page that said "no reviews yet"
 * while the admin showed a published one, with nothing anywhere to say why.
 *
 * Equality-only filters are served by Firestore's automatic single-field
 * indexes, so this query needs nothing declared and cannot break again on a
 * fresh project. Sorting at most 200 rows here costs nothing next to the round
 * trip that fetched them.
 */
export const getProductReviews = cache(async (productId: string): Promise<Review[]> =>
  readOrFallback(
    `reviews:${productId}`,
    async () => {
      const snap = await getDocs(
        query(
          collection(getDb(), "reviews"),
          where("productId", "==", productId),
          where("status", "==", "published"),
          fsLimit(200),
        ),
      );
      return snap.docs
        .map((d) => ({ ...(d.data() as Review), id: d.id }))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    },
    // No demo reviews. A hand-written testimonial counting toward a product's
    // average is the difference between a rating and an advertisement.
    () => [],
  ),
);

/** The rating block for one product. */
export const getReviewSummary = cache(async (productId: string): Promise<ReviewSummary> =>
  summarise(productId, await getProductReviews(productId)),
);

/**
 * Summaries for every product, for listing cards.
 *
 * One read for the whole catalogue rather than one per card: a grid of twelve
 * products would otherwise issue twelve queries, and the star row is not worth
 * twelve round trips.
 */
export const getAllReviewSummaries = cache(
  async (): Promise<Record<string, ReviewSummary>> => {
    const rows = await readOrFallback(
      "reviews:all",
      async () => {
        const snap = await getDocs(
          query(
            collection(getDb(), "reviews"),
            where("status", "==", "published"),
            fsLimit(1000),
          ),
        );
        return snap.docs.map((d) => ({ ...(d.data() as Review), id: d.id }));
      },
      () => [],
    );
    return summariseAll(rows);
  },
);

/**
 * How each placement presents its banners.
 *
 * Stored as one document rather than a field per banner, because it is a
 * property of the *slot*: whether the hero is a carousel is not something each
 * banner should be able to disagree about.
 *
 * The default for every slot is `single`. A carousel shows its second slide to
 * almost nobody, so defaulting to one would quietly bury whichever campaign
 * happened to sort second.
 */
export const getSlotSettings = cache(async (slot: BannerSlot): Promise<SlotSettings> => {
  const fallback: SlotSettings = { id: slot, display: "single", interval: 6, enabled: true };
  return readOrFallback(
    `slots:${slot}`,
    async () => {
      const snap = await getDocs(
        query(collection(getDb(), "slotSettings"), where("id", "==", slot), fsLimit(1)),
      );
      const row = snap.docs[0]?.data();
      if (!row) return [fallback];
      return [
        {
          id: slot,
          display: row.display === "carousel" ? "carousel" : "single",
          interval: Number(row.interval) > 0 ? Number(row.interval) : 6,
          enabled: row.enabled !== false,
        } as SlotSettings,
      ];
    },
    () => [fallback],
  ).then((rows) => rows[0] ?? fallback);
});

/**
 * The cross-sell graph, in the smallest form a client can use.
 *
 * The bag lives in client state, so the server cannot know which cross-sells
 * to resolve. Shipping the whole catalogue to find out would work at this size
 * and be indefensible at any other, so this ships two things instead: the
 * id → ids edges, and only those products that are actually the *target* of an
 * edge. In this catalogue that is two documents rather than fourteen, and it
 * stays proportional to how much cross-selling the merchant has set up rather
 * than to how many products exist.
 */
export const getCrossSellIndex = cache(
  async (): Promise<{ edges: Record<string, string[]>; targets: Product[] }> => {
    const all = await getShopProducts();
    const edges: Record<string, string[]> = {};
    const targetIds = new Set<string>();

    for (const product of all) {
      if (product.crossSellIds.length === 0) continue;
      const live = product.crossSellIds.filter((id) => {
        const target = all.find((p) => p.id === id);
        return Boolean(target) && target!.inStock;
      });
      if (live.length === 0) continue;
      edges[product.id] = live;
      for (const id of live) targetIds.add(id);
    }

    return { edges, targets: all.filter((p) => targetIds.has(p.id)) };
  },
);

/**
 * Listing query. Filtering happens in memory because the catalogue is small
 * and a fashion PLP wants multi-select facets that Firestore cannot express in
 * one composite index. Past a few thousand SKUs this should move to an
 * Algolia/Typesense index rather than growing more `where` clauses.
 */
export async function listProducts(filters: ProductFilters = {}): Promise<Product[]> {
  const all = await getShopProducts();
  return sortProducts(all.filter((product) => matchesFilters(product, filters)), filters.sort);
}

/**
 * Server-side search, ranked.
 *
 * The matching itself lives in `lib/search`, which is pure and tested: Arabic
 * spelling folded, synonyms across both languages, product and variant codes,
 * and an order that puts the product *named* for the query above one that
 * merely carries the word as a tag.
 *
 * Read through the same catalogue layer as the pages, so a search can never
 * surface something the storefront is hiding.
 */
export async function searchProducts(term: string, max = 12): Promise<Product[]> {
  if (!term.trim()) return [];
  const all = await getShopProducts();
  return rankProducts(all, term, max);
}

/** Near-misses to offer when a search finds nothing. */
export async function searchSuggestions(term: string, locale: Locale, max = 4): Promise<string[]> {
  if (!term.trim()) return [];
  const all = await getShopProducts();
  return suggestTerms(all, term, locale, max);
}

/* -------------------------------------------------------------------------- */
/*  Categories, banners, offers                                               */
/* -------------------------------------------------------------------------- */

export const getCategories = cache(async (): Promise<Category[]> =>
  readOrFallback(
    "categories",
    async () => {
      const snap = await getDocs(
        query(collection(getDb(), "categories").withConverter(categoryConverter), orderBy("order")),
      );
      return snap.docs.map((d) => d.data());
    },
    () => demoCategories,
  ),
);

export const getCategoryBySlug = cache(async (slug: string): Promise<Category | null> => {
  const rows = await getCategories();
  return rows.find((c) => c.slug === slug) ?? null;
});

/**
 * The nav tree, with counts rolled up from the live product list.
 *
 * Counts are recomputed here rather than trusted from the category documents:
 * `productCount` in Firestore is maintained by a Cloud Function and drifts the
 * moment a product is archived by hand, and a subcategory advertising products
 * it no longer has is a dead end the customer walks into.
 */
export const getCategoryTree = cache(async (): Promise<CategoryNode[]> => {
  const [categories, products] = await Promise.all([getCategories(), getShopProducts()]);
  /*
   * Counted from the *visible* set, and hidden categories are dropped. A
   * department advertising "12 pieces" that leads to an empty grid — because
   * all twelve are in the seasonal warehouse — is a dead end the customer
   * walks into.
   */
  /*
   * Images are borrowed last, after the counts and the hidden filter, so a
   * category only ever borrows from products that are actually on sale in
   * it — and a hidden category never claims a photograph a visible one
   * could have used.
   */
  return buildCategoryTree(
    withBorrowedImages(
      withRolledUpCounts(
        categories.filter((c) => !c.hidden),
        products,
      ),
      products,
    ),
  );
});

/** A category plus every category beneath it — the ids a listing filters on. */
export const getCategoryScope = cache(async (categoryId: string): Promise<string[]> => {
  const categories = await getCategories();
  return descendantIds(categories, categoryId);
});

/* -------------------------------------------------------------------------- */
/*  Shipping classes                                                          */
/* -------------------------------------------------------------------------- */

export const getShippingClasses = cache(async (): Promise<ShippingClass[]> =>
  readOrFallback(
    "shippingClasses",
    async () => {
      const snap = await getDocs(
        query(collection(getDb(), "shippingClasses"), orderBy("order")),
      );
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ShippingClass);
    },
    () => demoShippingClasses,
  ),
);

export const getBanners = cache(async (slot: BannerSlot): Promise<Banner[]> => {
  const now = Date.now();
  const rows = await readOrFallback(
    `banners:${slot}`,
    async () => {
      const constraints: QueryConstraint[] = [
        where("slot", "==", slot),
        where("active", "==", true),
        orderBy("priority", "desc"),
        fsLimit(12),
      ];
      const snap = await getDocs(
        query(collection(getDb(), "banners").withConverter(bannerConverter), ...constraints),
      );
      return snap.docs.map((d) => d.data());
    },
    () => demoBanners.filter((b) => b.slot === slot && b.active),
  );

  // A campaign that has ended must never survive a stale cache into the page.
  return rows
    .filter((b) => (!b.startsAt || b.startsAt <= now) && (!b.endsAt || b.endsAt > now))
    .sort((a, b) => b.priority - a.priority);
});

export const getActiveOffers = cache(async (): Promise<Offer[]> => {
  const now = Date.now();
  const rows = await readOrFallback(
    "offers",
    async () => {
      const snap = await getDocs(
        query(
          collection(getDb(), "offers").withConverter(offerConverter),
          where("active", "==", true),
        ),
      );
      return snap.docs.map((d) => d.data());
    },
    () => demoOffers,
  );
  return rows.filter((o) => o.startsAt <= now && o.endsAt > now);
});

/* -------------------------------------------------------------------------- */
/*  Static-ish config                                                         */
/* -------------------------------------------------------------------------- */

export const getShippingMethods = cache(async (): Promise<ShippingMethod[]> =>
  readOrFallback(
    "shippingMethods",
    async () => {
      const snap = await getDocs(
        query(collection(getDb(), "shippingMethods"), orderBy("price")),
      );
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ShippingMethod);
    },
    () => demoShippingMethods,
  ),
);

/**
 * Delivery zones.
 *
 * The fallback is an **empty list**, not a set of invented Jordanian regions.
 * With no zones every address quotes the method's own price, which is exactly
 * what the shop did before zones existed — so adding the feature changes no
 * customer's total until a merchant deliberately sets one up. Shipping a
 * guessed rate table would silently start charging people for a decision
 * nobody made.
 */
export const getShippingZones = cache(async (): Promise<ShippingZone[]> =>
  readOrFallback(
    "shippingZones",
    async () => {
      const snap = await getDocs(query(collection(getDb(), "shippingZones"), orderBy("order")));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ShippingZone);
    },
    () => [],
  ),
);

export async function getTestimonials(): Promise<Testimonial[]> {
  return demoTestimonials;
}
