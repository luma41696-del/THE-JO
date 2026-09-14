/**
 * Product resolution.
 *
 * One product shape serves two very different purchases. A **simple** product
 * is a single trade item — no choices, stock and identifiers on the product
 * itself. A **variable** product is a family of them, and a purchase is only
 * real once a colour and a size have resolved to one `ProductVariant`.
 *
 * Everything that needs to know "what am I actually selling right now" goes
 * through `resolveSelection`, so the product page, the cart, the checkout API
 * and the admin all agree on the answer.
 */

import type { CartItem, Product, ProductVariant } from "@/types";

/* -------------------------------------------------------------------------- */
/*  Type                                                                      */
/* -------------------------------------------------------------------------- */

export function isVariable(product: Product): boolean {
  return product.type === "variable";
}

/**
 * Whether the customer has a choice to make before adding to the bag.
 *
 * Checked against the actual option arrays rather than `type` alone: a
 * variable product whose options were emptied by an admin edit is, in the
 * moment, unbuyable — and a size grid with nothing in it is worse than none.
 */
export function hasOptions(product: Product): boolean {
  return isVariable(product) && product.colors.length > 0 && product.sizes.length > 0;
}

/* -------------------------------------------------------------------------- */
/*  Variants                                                                  */
/* -------------------------------------------------------------------------- */

export function variantFor(
  product: Product,
  colorId: string,
  sizeId: string,
): ProductVariant | undefined {
  return product.variants?.find((v) => v.colorId === colorId && v.sizeId === sizeId);
}

/**
 * Stock for one permutation.
 *
 * A variable product with no `variants` array has not been expanded yet (a
 * draft, or a seed that predates variants). Falling back to the product total
 * would advertise the whole product's stock for every size, so it reports 0
 * and the size renders as unavailable — the honest answer when we do not know.
 */
export function stockFor(product: Product, colorId: string, sizeId: string): number {
  if (!isVariable(product)) return product.totalStock;
  if (!product.variants) return 0;
  return variantFor(product, colorId, sizeId)?.stock ?? 0;
}

/** Colours that have at least one in-stock size. */
export function availableColorIds(product: Product): string[] {
  if (!isVariable(product) || !product.variants) return [];
  const seen = new Set<string>();
  for (const v of product.variants) if (v.stock > 0) seen.add(v.colorId);
  return product.colors.filter((c) => seen.has(c.id)).map((c) => c.id);
}

/** Sizes in stock for one colour — what greys out the size grid. */
export function availableSizeIds(product: Product, colorId: string): string[] {
  if (!isVariable(product) || !product.variants) return [];
  const seen = new Set<string>();
  for (const v of product.variants) if (v.colorId === colorId && v.stock > 0) seen.add(v.sizeId);
  return product.sizes.filter((s) => seen.has(s.id)).map((s) => s.id);
}

/* -------------------------------------------------------------------------- */
/*  Per-order limits                                                          */
/* -------------------------------------------------------------------------- */

/** Nothing sensible is ever this high; it just keeps a stepper finite. */
export const ABSOLUTE_MAX_PER_LINE = 10;

export interface QuantityCap {
  max: number;
  /**
   * Which rule produced `max`. The UI must say "Limit 1 per order" for a
   * policy and "Only 1 left" for scarcity — claiming scarcity that does not
   * exist is a lie, and customers notice when the item never sells out.
   */
  reason: "stock" | "per-order";
}

/**
 * The most units of this permutation one order may contain.
 *
 * Policy wins ties: when the cap and the stock are equal, it reports
 * `per-order`, because a limit the merchant set is the more useful thing to
 * tell the customer and does not expire when stock is replenished.
 */
export function quantityCap(product: Product, colorId = "", sizeId = ""): QuantityCap {
  const stock = isVariable(product)
    ? stockFor(product, colorId, sizeId)
    : product.totalStock;

  const limit = product.maxPerOrder;
  const stockMax = Math.max(0, Math.min(stock, ABSOLUTE_MAX_PER_LINE));

  if (limit === undefined || limit <= 0) return { max: stockMax, reason: "stock" };
  if (limit <= stockMax) return { max: limit, reason: "per-order" };
  return { max: stockMax, reason: "stock" };
}

/** `true` when the merchant capped this product at one unit per order. */
export function isSoldIndividually(product: Product): boolean {
  return product.maxPerOrder === 1;
}

/* -------------------------------------------------------------------------- */
/*  Selection                                                                 */
/* -------------------------------------------------------------------------- */

export interface Selection {
  sku: string;
  gtin?: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  cap: QuantityCap;
  variant?: ProductVariant;
  /** `false` when a variable product still needs a choice, or stock is zero. */
  buyable: boolean;
}

/**
 * Everything the "add to bag" button needs, for either product type.
 *
 * For a simple product the colour and size arguments are ignored entirely —
 * callers may pass whatever they have without branching first.
 */
export function resolveSelection(
  product: Product,
  colorId = "",
  sizeId = "",
): Selection {
  if (!isVariable(product)) {
    const cap = quantityCap(product);
    return {
      sku: product.sku,
      gtin: product.gtin,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      stock: product.totalStock,
      cap,
      buyable: product.status === "active" && product.totalStock > 0,
    };
  }

  const variant = variantFor(product, colorId, sizeId);
  const stock = variant?.stock ?? 0;
  const cap = quantityCap(product, colorId, sizeId);

  return {
    sku: variant?.sku ?? product.sku,
    gtin: variant?.gtin,
    price: variant?.priceOverride ?? product.price,
    compareAtPrice: product.compareAtPrice,
    stock,
    cap,
    variant,
    buyable: product.status === "active" && Boolean(variant) && stock > 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  GTIN                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Validate a GTIN-8, -12, -13 or -14.
 *
 * The last digit is a mod-10 check digit over the others, weighted 3 and 1
 * alternating from the right. Worth checking rather than trusting: a GTIN that
 * fails this is rejected by every marketplace feed, and finding that out from
 * Google Merchant Center three days later is a bad way to find out.
 */
export function isValidGtin(value: string): boolean {
  const digits = value.trim();
  if (!/^\d+$/.test(digits)) return false;
  if (![8, 12, 13, 14].includes(digits.length)) return false;

  let sum = 0;
  // Weight alternates 3,1,3,1… counting from the digit before the check digit.
  for (let i = digits.length - 2; i >= 0; i -= 1) {
    const digit = Number(digits[i]);
    const weight = (digits.length - 2 - i) % 2 === 0 ? 3 : 1;
    sum += digit * weight;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits[digits.length - 1]);
}

/** Compute the check digit for a GTIN body (the code without its last digit). */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    const weight = (body.length - 1 - i) % 2 === 0 ? 3 : 1;
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** Human label for the product details block and the admin. */
export function gtinKind(value: string): string {
  switch (value.trim().length) {
    case 8:
      return "GTIN-8 (EAN-8)";
    case 12:
      return "GTIN-12 (UPC-A)";
    case 13:
      return "GTIN-13 (EAN-13)";
    case 14:
      return "GTIN-14 (ITF-14)";
    default:
      return "GTIN";
  }
}

/* -------------------------------------------------------------------------- */
/*  Cart lines                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build a cart line from a product and a selection.
 *
 * Centralised so the product page, the fitting room and the "add the whole
 * look" button cannot produce subtly different lines for the same item — a
 * mismatched `key` would show the same product twice in the bag.
 */
export function buildCartItem(
  product: Product,
  selection: Selection,
  colorId: string,
  sizeId: string,
  quantity: number,
): CartItem {
  const color = product.colors.find((c) => c.id === colorId);
  const size = product.sizes.find((s) => s.id === sizeId);
  const image =
    product.images.find((i) => i.colorId === colorId) ??
    product.images[0] ?? {
      url: "/demo/campaign-bone.svg",
      alt: product.title.en,
      width: 400,
      height: 520,
    };

  return {
    key: `${product.id}:${colorId}:${sizeId}`,
    productId: product.id,
    sku: selection.sku,
    gtin: selection.gtin,
    slug: product.slug,
    title: product.title,
    image,
    colorId,
    colorName: color?.name ?? { en: "", ar: "" },
    sizeId,
    sizeLabel: size?.label ?? "",
    unitPrice: selection.price,
    compareAtPrice: selection.compareAtPrice,
    currency: product.currency,
    quantity: Math.min(quantity, selection.cap.max),
    maxQuantity: selection.cap.max,
    maxReason: selection.cap.reason,
    shippingClassId: product.shippingClassId,
    addedAt: Date.now(),
  };
}
