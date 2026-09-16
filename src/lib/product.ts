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

import { isVariantAvailable, priceForStock } from "@/lib/product-options";
import { cartKey } from "@/lib/utils";
import { t as tr } from "@/lib/format";
import type { CartItem, Locale, Product, ProductDesign, ProductVariant } from "@/types";

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
/*  Designs                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Artwork options a customer may actually pick.
 *
 * A design withdrawn from sale keeps its record — orders that already carry it
 * must still render its name on the invoice — so it is filtered here rather
 * than deleted. `available` defaults to true, because a design written before
 * the flag existed is on sale.
 */
export function sellableDesigns(product: Product): ProductDesign[] {
  return (product.designs ?? [])
    .filter((d) => d.available !== false)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** Does this product ask the customer to choose an artwork? */
export function hasDesigns(product: Product): boolean {
  return sellableDesigns(product).length > 0;
}

export function designFor(product: Product, designId: string): ProductDesign | undefined {
  return product.designs?.find((d) => d.id === designId);
}

/**
 * The gallery for a chosen design, falling back to the product's own shots.
 *
 * The fallback is what lets a merchant add a fifth embroidery without
 * re-photographing the garment: the design shows its thumbnail in the picker
 * and the product's images in the gallery until its own are uploaded.
 */
export function imagesFor(product: Product, designId = "", colorId = "") {
  const design = designId ? designFor(product, designId) : undefined;
  const pool = design?.images?.length ? design.images : product.images;
  if (!colorId) return pool;
  const forColour = pool.filter((i) => i.colorId === colorId);
  return forColour.length > 0 ? forColour : pool;
}

/* -------------------------------------------------------------------------- */
/*  Variants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The one permutation a colour, size and design resolve to.
 *
 * `designId` is matched loosely against an absent one: a product that gained
 * designs after its variants were written has rows with no `designId`, and
 * refusing to match those would make the whole product unbuyable the moment a
 * design was added. So an unset variant design matches anything, and once the
 * merchant expands the grid the exact rows take over.
 */
export function variantFor(
  product: Product,
  colorId: string,
  sizeId: string,
  designId = "",
  attributes: Record<string, string> = {},
): ProductVariant | undefined {
  const rows = product.variants?.filter(
    (v) => v.colorId === colorId && v.sizeId === sizeId && matchesAttributes(v, attributes),
  );
  if (!rows || rows.length === 0) return undefined;
  return rows.find((v) => (v.designId ?? "") === designId) ?? rows.find((v) => !v.designId);
}

/**
 * Does this row answer to the axes beyond colour, size and design?
 *
 * Loose in the same direction as `matchesDesign`, and for the same reason: a
 * row written before an attribute existed has nothing stored for it, and
 * refusing to match those would make a whole product unbuyable the instant a
 * merchant added a Capacity column. An absent value means "this row is that
 * axis's answer, whatever it is"; once the grid is rebuilt the exact rows take
 * over.
 *
 * A *selected* value of "" means the customer has not chosen yet, which every
 * row satisfies — the Add button is held back elsewhere, by `buyable`.
 */
function matchesAttributes(
  variant: ProductVariant,
  attributes: Record<string, string>,
): boolean {
  for (const [id, value] of Object.entries(attributes)) {
    if (!value) continue;
    const stored = variant.attributes?.[id];
    if (stored && stored !== value) return false;
  }
  return true;
}

/**
 * Stock for one permutation.
 *
 * A variable product with no `variants` array has not been expanded yet (a
 * draft, or a seed that predates variants). Falling back to the product total
 * would advertise the whole product's stock for every size, so it reports 0
 * and the size renders as unavailable — the honest answer when we do not know.
 */
export function stockFor(
  product: Product,
  colorId: string,
  sizeId: string,
  designId = "",
  attributes: Record<string, string> = {},
): number {
  if (!isVariable(product)) return product.totalStock;
  if (!product.variants) return 0;
  return variantFor(product, colorId, sizeId, designId, attributes)?.stock ?? 0;
}

/** Colours that have at least one in-stock size. */
export function availableColorIds(product: Product, designId = ""): string[] {
  if (!isVariable(product) || !product.variants) return [];
  const seen = new Set<string>();
  for (const v of product.variants) {
    if (v.stock > 0 && matchesDesign(v, designId)) seen.add(v.colorId);
  }
  return product.colors.filter((c) => seen.has(c.id)).map((c) => c.id);
}

/** A variant with no design of its own belongs to every design. */
function matchesDesign(variant: ProductVariant, designId: string): boolean {
  return !variant.designId || variant.designId === designId;
}

/** Designs with at least one permutation in stock. */
export function availableDesignIds(product: Product): string[] {
  if (!isVariable(product) || !product.variants) return sellableDesigns(product).map((d) => d.id);
  const seen = new Set<string>();
  let unscoped = false;
  for (const v of product.variants) {
    if (v.stock <= 0) continue;
    if (v.designId) seen.add(v.designId);
    else unscoped = true;
  }
  return sellableDesigns(product)
    .filter((d) => unscoped || seen.has(d.id))
    .map((d) => d.id);
}

/** Sizes in stock for one colour — what greys out the size grid. */
export function availableSizeIds(
  product: Product,
  colorId: string,
  designId = "",
  attributes: Record<string, string> = {},
): string[] {
  if (!isVariable(product) || !product.variants) return [];
  const seen = new Set<string>();
  for (const v of product.variants) {
    // A combination the shop has switched off is not available in any sense
    // the picker cares about, whatever its count says.
    if (
      v.colorId === colorId &&
      v.stock > 0 &&
      isVariantAvailable(v) &&
      matchesDesign(v, designId) &&
      matchesAttributes(v, attributes)
    ) {
      seen.add(v.sizeId);
    }
  }
  return product.sizes.filter((s) => seen.has(s.id)).map((s) => s.id);
}

/**
 * Values of one axis that can still be bought, given everything else chosen.
 *
 * What greys out a capacity the way a sold-out size already greys out. The
 * axis being asked about is excluded from the filter — otherwise every value
 * except the selected one would report itself unavailable, which is true and
 * useless.
 */
export function availableValueIds(
  product: Product,
  attributeId: string,
  colorId = "",
  designId = "",
  attributes: Record<string, string> = {},
): string[] {
  const declared = valuesOfAttribute(product, attributeId);
  if (!isVariable(product) || !product.variants) return [];

  const others = { ...attributes };
  delete others[attributeId];

  const seen = new Set<string>();
  for (const v of product.variants) {
    if (v.stock <= 0 || !isVariantAvailable(v)) continue;
    if (colorId && v.colorId !== colorId) continue;
    if (!matchesDesign(v, designId) || !matchesAttributes(v, others)) continue;

    const value = v.attributes?.[attributeId];
    // A row with nothing stored for this axis predates it and stands for every
    // value of it, so nothing greys out on its account.
    if (value) seen.add(value);
    else return declared;
  }

  return declared.filter((id) => seen.has(id));
}

/** Declared values of one axis, in the merchant's own order. */
function valuesOfAttribute(product: Product, attributeId: string): string[] {
  const attribute = product.attributes?.find((a) => a.id === attributeId);
  return attribute ? attribute.values.map((value) => value.id) : [];
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
export function quantityCap(
  product: Product,
  colorId = "",
  sizeId = "",
  designId = "",
  attributes: Record<string, string> = {},
): QuantityCap {
  const stock = isVariable(product)
    ? stockFor(product, colorId, sizeId, designId, attributes)
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
  design?: ProductDesign;
  /** `false` when a variable product still needs a choice, or stock is zero. */
  /** Resolvable, but the shop has switched this permutation off. */
  unavailableCombination?: boolean;
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
  designId = "",
  attributes: Record<string, string> = {},
): Selection {
  if (!isVariable(product)) {
    const cap = quantityCap(product);
    return {
      sku: product.sku,
      gtin: product.gtin,
      price: priceForStock(product.price, product.totalStock, product.stockPriceRules),
      compareAtPrice: product.compareAtPrice,
      stock: product.totalStock,
      cap,
      buyable: product.status === "active" && product.totalStock > 0,
    };
  }

  const variant = variantFor(product, colorId, sizeId, designId, attributes);
  const stock = variant?.stock ?? 0;
  const cap = quantityCap(product, colorId, sizeId, designId, attributes);
  const design = designId ? designFor(product, designId) : undefined;

  /*
   * The design's surcharge applies on top of whichever price won — a variant
   * override is about that permutation, the delta is about the artwork, and
   * one must not silently cancel the other.
   */
  const base = variant?.priceOverride ?? product.price;

  /*
   * The markdown follows *this* permutation's remaining stock, not the
   * product's total. "The last two" means the last two of the size in front of
   * the customer; discounting a medium because the shop is low on extra-large
   * is a price that cannot be explained.
   *
   * Applied after the design delta so the discount is off what is actually
   * being charged, and never above it — `priceForStock` refuses to raise.
   */
  const withDesign = Math.max(0, base + (design?.priceDelta ?? 0));
  const price = priceForStock(withDesign, stock, product.stockPriceRules);

  /*
   * A combination the shop has switched off is resolvable but not buyable.
   *
   * Resolvable on purpose: the page can then say "we do not make this one"
   * rather than behaving as though the size does not exist, which is what a
   * missing variant looks like. Not buyable is enforced here, in the one
   * function both the storefront and the checkout ask — so a client that
   * ignores the disabled state still cannot buy it.
   */
  const available = !variant || isVariantAvailable(variant);

  return {
    sku: variant?.sku ?? product.sku,
    gtin: variant?.gtin,
    price,
    compareAtPrice: product.compareAtPrice,
    stock,
    cap,
    variant,
    design,
    unavailableCombination: Boolean(variant) && !available,
    // A product that offers artwork is not resolved until one is picked.
    buyable:
      product.status === "active" &&
      Boolean(variant) &&
      available &&
      stock > 0 &&
      (!hasDesigns(product) || Boolean(design)) &&
      /*
       * Every declared axis has to be answered before this is a trade item.
       * Without it, a kettle sold in two capacities would add to the bag on
       * page load with whichever row happened to be first — and the customer
       * would find out which at the door.
       */
      requiredAxes(product).every((id) => Boolean(attributes[id])),
  };
}

/** Axes the customer must answer: the ones with values to choose between. */
export function requiredAxes(product: Product): string[] {
  return (product.attributes ?? [])
    .filter((attribute) => attribute.kind === "custom" && attribute.values.length > 0)
    .map((attribute) => attribute.id);
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
  designId = "",
  attributes: Record<string, string> = {},
): CartItem {
  const color = product.colors.find((c) => c.id === colorId);
  const size = product.sizes.find((s) => s.id === sizeId);

  /*
   * The design's own shot when it has one, so the bag shows the artwork the
   * customer chose rather than the garment's stock photograph. Four tees that
   * differ only by embroidery would otherwise be four identical thumbnails.
   */
  const image = imagesFor(product, designId, colorId)[0] ??
    product.images[0] ?? {
      url: "/demo/campaign-bone.svg",
      alt: product.title.en,
      width: 400,
      height: 520,
    };

  /*
   * The chosen values, spelled out.
   *
   * Stored on the line rather than looked up later, because the bag, the
   * invoice and the packing slip all outlive the product: renaming "1.5 L" to
   * "1.5 litres" next month must not rewrite what somebody already bought.
   */
  const chosen = (product.attributes ?? [])
    .filter((attribute) => attributes[attribute.id])
    .map((attribute) => {
      const value = attribute.values.find((v) => v.id === attributes[attribute.id]);
      return {
        id: attribute.id,
        name: attribute.name,
        valueId: attributes[attribute.id]!,
        valueLabel: value?.label ?? { en: attributes[attribute.id]!, ar: attributes[attribute.id]! },
      };
    });

  return {
    key: cartKey(product.id, colorId, sizeId, designId, attributes),
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
    ...(designId
      ? { designId, designName: selection.design?.name ?? { en: "", ar: "" } }
      : {}),
    ...(chosen.length > 0 ? { attributes: chosen } : {}),
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

/**
 * What a bag line is, in words: artwork, colour, size, and any other axis.
 *
 * Extracted because five screens were each composing this list by hand — the
 * drawer, the bag page, checkout, order tracking and the invoice — in two
 * different orders, and a new axis had to be remembered in all five or it
 * would reach the customer on one screen and not on the packing slip. Now
 * there is one place to forget, and it is tested.
 *
 * Empty strings are dropped by the caller's `join`, so a simple product with
 * no options produces nothing rather than a line of separators.
 */
export function lineOptions(item: CartItem, locale: Locale): string[] {
  return [
    item.designName ? tr(item.designName, locale) : "",
    tr(item.colorName, locale),
    item.sizeLabel,
    ...(item.attributes ?? []).map((attribute) => tr(attribute.valueLabel, locale)),
  ].filter(Boolean);
}
