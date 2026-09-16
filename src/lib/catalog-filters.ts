import type { Product, ProductFilters } from "@/types";

/**
 * Does one product pass a set of filters?
 *
 * Pulled out of `lib/catalog` so it can be tested on its own: that module
 * reaches for Firestore at import time, and the question "does a white XL
 * exist" needs no database to answer.
 *
 * ## The bug this was extracted to fix
 *
 * Colour and size used to be checked against the two *declared option lists*
 * separately. A coat offered in white, and offered in XL, where white XL was
 * never made, therefore came back for "white + XL". The shopper clicks
 * through, finds the size unavailable in that colour, and reasonably concludes
 * the filters are decoration. With "in stock only" on it is worse: the listing
 * promised something buyable.
 *
 * So when both are filtered, the question becomes whether a *combination*
 * exists — which is what the variant rows are for.
 */
export function matchesFilters(product: Product, filters: ProductFilters = {}): boolean {
  /*
   * Category matches against the whole ancestry, not just the leaf. Filtering
   * on "Outerwear" has to return the coats and the blazers filed beneath it,
   * and no product is ever filed against a department directly.
   */
  if (
    filters.categoryIds?.length &&
    !product.categoryPath.some((id) => filters.categoryIds!.includes(id))
  ) {
    return false;
  }

  if (filters.productTypes?.length && !filters.productTypes.includes(product.type)) return false;

  if (
    filters.shippingClassIds?.length &&
    !filters.shippingClassIds.includes(product.shippingClassId ?? "")
  ) {
    return false;
  }

  if (!matchesOptions(product, filters)) return false;

  if (filters.minPrice !== undefined && product.price < filters.minPrice) return false;
  if (filters.maxPrice !== undefined && product.price > filters.maxPrice) return false;

  if (filters.badges?.length && !product.badges.some((b) => filters.badges!.includes(b))) {
    return false;
  }

  if (filters.inStockOnly && !product.inStock) return false;

  return true;
}

/** The colour and size half, where the combination question lives. */
function matchesOptions(product: Product, filters: ProductFilters): boolean {
  const wantsColor = Boolean(filters.colorIds?.length);
  const wantsSize = Boolean(filters.sizeIds?.length);
  if (!wantsColor && !wantsSize) return true;

  const rows = product.variants ?? [];

  if (wantsColor && wantsSize) {
    // A product with no variant rows cannot contradict itself, so its declared
    // options are the best answer available.
    if (rows.length === 0) {
      return (
        product.colors.some((c) => filters.colorIds!.includes(c.id)) &&
        product.sizes.some((s) => filters.sizeIds!.includes(s.id))
      );
    }
    return rows.some(
      (variant) =>
        filters.colorIds!.includes(variant.colorId) &&
        filters.sizeIds!.includes(variant.sizeId) &&
        (!filters.inStockOnly || variant.stock > 0),
    );
  }

  if (wantsColor) {
    if (!product.colors.some((c) => filters.colorIds!.includes(c.id))) return false;
    // With "in stock only" on, a colourway that is sold out in every size is
    // not something the shopper can buy today.
    if (filters.inStockOnly && rows.length > 0) {
      return rows.some((v) => filters.colorIds!.includes(v.colorId) && v.stock > 0);
    }
    return true;
  }

  if (!product.sizes.some((s) => filters.sizeIds!.includes(s.id))) return false;
  if (filters.inStockOnly && rows.length > 0) {
    return rows.some((v) => filters.sizeIds!.includes(v.sizeId) && v.stock > 0);
  }
  return true;
}

/** Sort a filtered list. Kept here so the listing and its tests agree on order. */
export function sortProducts(rows: Product[], sort: ProductFilters["sort"]): Product[] {
  switch (sort) {
    case "newest":
      return [...rows].sort((a, b) => b.publishedAt - a.publishedAt);
    case "price-asc":
      return [...rows].sort((a, b) => a.price - b.price);
    case "price-desc":
      return [...rows].sort((a, b) => b.price - a.price);
    case "rating":
      return [...rows].sort((a, b) => (b.rating?.average ?? 0) - (a.rating?.average ?? 0));
    default:
      return rows;
  }
}
