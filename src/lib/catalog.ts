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
import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";

import { getDb } from "@/lib/firebase/client";
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
  demoShippingMethods,
  demoTestimonials,
} from "@/data/demo";
import type {
  Banner,
  BannerSlot,
  Category,
  Offer,
  Product,
  ProductFilters,
  ShippingMethod,
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
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[net sale] Firestore read "${label}" failed — serving the demo catalogue.`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return ALLOW_DEMO_FALLBACK ? fallback() : [];
}

/* -------------------------------------------------------------------------- */
/*  Products                                                                  */
/* -------------------------------------------------------------------------- */

function productsRef() {
  return collection(getDb(), "products").withConverter(productConverter);
}

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

export const getProductBySlug = cache(async (slug: string): Promise<Product | null> => {
  const all = await getAllProducts();
  return all.find((p) => p.slug === slug) ?? null;
});

export const getNewArrivals = cache(async (count = 8): Promise<Product[]> => {
  const all = await getAllProducts();
  return [...all].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, count);
});

export const getFeaturedProducts = cache(async (count = 8): Promise<Product[]> => {
  const all = await getAllProducts();
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
  const all = await getAllProducts();
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
  const all = await getAllProducts();
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
    const all = await getAllProducts();
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
 * Listing query. Filtering happens in memory because the catalogue is small
 * and a fashion PLP wants multi-select facets that Firestore cannot express in
 * one composite index. Past a few thousand SKUs this should move to an
 * Algolia/Typesense index rather than growing more `where` clauses.
 */
export async function listProducts(filters: ProductFilters = {}): Promise<Product[]> {
  const all = await getAllProducts();

  let rows = all.filter((p) => {
    if (filters.categoryIds?.length && !filters.categoryIds.includes(p.categoryId)) return false;
    if (filters.colorIds?.length && !p.colors.some((c) => filters.colorIds!.includes(c.id))) {
      return false;
    }
    if (filters.sizeIds?.length && !p.sizes.some((s) => filters.sizeIds!.includes(s.id))) {
      return false;
    }
    if (filters.minPrice !== undefined && p.price < filters.minPrice) return false;
    if (filters.maxPrice !== undefined && p.price > filters.maxPrice) return false;
    if (filters.badges?.length && !p.badges.some((b) => filters.badges!.includes(b))) return false;
    if (filters.inStockOnly && !p.inStock) return false;
    return true;
  });

  switch (filters.sort) {
    case "newest":
      rows = rows.sort((a, b) => b.publishedAt - a.publishedAt);
      break;
    case "price-asc":
      rows = rows.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      rows = rows.sort((a, b) => b.price - a.price);
      break;
    case "rating":
      rows = rows.sort((a, b) => (b.rating?.average ?? 0) - (a.rating?.average ?? 0));
      break;
    default:
      break;
  }

  return rows;
}

/** Server-side search across title, tags and category. */
export async function searchProducts(term: string, max = 12): Promise<Product[]> {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  const all = await getAllProducts();
  return all
    .filter((p) =>
      [p.title.en, p.title.ar, p.subtitle?.en ?? "", p.categoryId, ...p.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
    .slice(0, max);
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

export async function getShippingMethods(): Promise<ShippingMethod[]> {
  return demoShippingMethods;
}

export async function getTestimonials(): Promise<Testimonial[]> {
  return demoTestimonials;
}
