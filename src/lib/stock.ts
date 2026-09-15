import type { Product, ProductVariant } from "@/types";

/**
 * Low-stock alerts, per variant.
 *
 * Per **variant** is the whole point. `product.totalStock` is a sum, and a sum
 * hides exactly the thing a buyer needs to see: a coat showing 40 in stock can
 * be entirely large and extra-large, with every wearable middle size at zero.
 * The product looks healthy on every dashboard while the sizes people actually
 * order are gone.
 *
 * Pure and sorted, so the admin surface is a render and the rule is testable.
 */

export type StockState = "out" | "low" | "ok";

/** The default when a merchant has not set one. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 3;

export function stockState(stock: number, threshold: number): StockState {
  if (stock <= 0) return "out";
  return stock <= threshold ? "low" : "ok";
}

export interface StockAlert {
  productId: string;
  slug: string;
  title: Product["title"];
  sku: string;
  colorName: string;
  sizeLabel: string;
  /** Empty when the product has no artwork axis. */
  designName: string;
  stock: number;
  state: Exclude<StockState, "ok">;
}

/**
 * Every variant at or below the threshold, most urgent first.
 *
 * Draft and archived products are excluded: a buyer cannot act on stock for
 * something that is not for sale, and burying the live alerts under them is
 * how a list like this stops being read.
 */
export function lowStockAlerts(
  products: Product[],
  threshold = DEFAULT_LOW_STOCK_THRESHOLD,
  limit = 50,
): StockAlert[] {
  const alerts: StockAlert[] = [];

  for (const product of products) {
    if (product.status !== "active") continue;

    // A simple product is its own trade item — one row, from the total.
    if (product.type !== "variable" || !product.variants?.length) {
      const state = stockState(product.totalStock, threshold);
      if (state === "ok") continue;
      alerts.push({
        productId: product.id,
        slug: product.slug,
        title: product.title,
        sku: product.sku,
        colorName: "",
        sizeLabel: "",
        designName: "",
        stock: product.totalStock,
        state,
      });
      continue;
    }

    for (const variant of product.variants) {
      const state = stockState(variant.stock, threshold);
      if (state === "ok") continue;
      alerts.push({
        productId: product.id,
        slug: product.slug,
        title: product.title,
        sku: variant.sku,
        colorName: nameOf(product, variant),
        sizeLabel: product.sizes.find((s) => s.id === variant.sizeId)?.label ?? variant.sizeId,
        designName:
          product.designs?.find((d) => d.id === variant.designId)?.name.en ?? "",
        stock: variant.stock,
        state,
      });
    }
  }

  /*
   * Sold out first, then the lowest counts, then alphabetically so the list
   * does not reshuffle between loads for rows that tie. A list whose order
   * changes under the reader is a list nobody trusts.
   */
  return alerts
    .sort(
      (a, b) =>
        a.stock - b.stock ||
        a.title.en.localeCompare(b.title.en) ||
        a.sku.localeCompare(b.sku),
    )
    .slice(0, limit);
}

function nameOf(product: Product, variant: ProductVariant): string {
  return product.colors.find((c) => c.id === variant.colorId)?.name.en ?? variant.colorId;
}

/** How many distinct products have at least one variant needing attention. */
export function alertedProductCount(alerts: StockAlert[]): number {
  return new Set(alerts.map((a) => a.productId)).size;
}
