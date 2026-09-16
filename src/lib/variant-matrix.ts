import { normaliseSku } from "@/lib/product-options";
import type {
  Localized,
  ProductAttribute,
  ProductColor,
  ProductSize,
  ProductVariant,
} from "@/types";

/**
 * The variant table: building it, editing it in bulk, and checking it.
 *
 * This replaces a picker that knew about exactly two axes. Colour and size are
 * enough for clothing and nothing else — a kettle varies by capacity, an oven
 * by width — so the axes are now whatever the category defines, and the table's
 * columns follow.
 *
 * ## What did not change, and why
 *
 * `colorId` and `sizeId` stay where they are on the variant. Every stored order
 * line, every persisted cart key, the storefront's picker and `variantFor` all
 * address them by name; folding them into a generic map would orphan every
 * basket and every order already written, to tidy up a shape only the admin
 * sees. Attributes beyond those two live in `attributes`, and an attribute
 * declared as `color` or `size` writes through to the original field.
 *
 * ## The one required field
 *
 * A row needs a price and nothing else. SKU, stock, sale price, barcode and
 * every attribute may be blank — a merchant typing forty rows should not be
 * stopped at row three for a code they intend to add on Thursday. `rowProblems`
 * is the single authority on that, used by the table, by the import, and by the
 * server.
 *
 * Pure throughout, so the arithmetic that moves prices across five hundred rows
 * can be checked without a browser.
 */

/* -------------------------------------------------------------------------- */
/*  Reading and writing an axis                                               */
/* -------------------------------------------------------------------------- */

/** What this variant holds for one attribute, wherever that attribute lives. */
export function valueOf(variant: ProductVariant, attribute: ProductAttribute): string {
  if (attribute.kind === "color") return variant.colorId ?? "";
  if (attribute.kind === "size") return variant.sizeId ?? "";
  if (attribute.kind === "design") return variant.designId ?? "";
  return variant.attributes?.[attribute.id] ?? "";
}

/** Set one axis, writing through to the original field where there is one. */
export function withValue(
  variant: ProductVariant,
  attribute: ProductAttribute,
  value: string,
): ProductVariant {
  if (attribute.kind === "color") return { ...variant, colorId: value };
  if (attribute.kind === "size") return { ...variant, sizeId: value };
  // Undefined, not "": an unscoped row stands for every artwork, and an empty
  // string would read as a fourth design that matches none of them.
  if (attribute.kind === "design") return { ...variant, designId: value || undefined };

  const attributes = { ...(variant.attributes ?? {}) };
  // Removed rather than stored empty: an empty string is a value that matches
  // nothing, and it would make two otherwise-identical rows look distinct.
  if (value) attributes[attribute.id] = value;
  else delete attributes[attribute.id];

  return Object.keys(attributes).length > 0
    ? { ...variant, attributes }
    : { ...variant, attributes: undefined };
}

/**
 * The identity of a permutation: its values on every axis, in order.
 *
 * This is what "no duplicate combinations" means. Two rows with the same
 * values are the same sellable unit however they were created — generated,
 * added by hand, or imported — and a shop that holds both has two stock counts
 * for one thing and no way to say which is right.
 */
export function combinationKey(
  variant: ProductVariant,
  attributes: ProductAttribute[],
): string {
  return attributes.map((attribute) => valueOf(variant, attribute)).join("|");
}

/* -------------------------------------------------------------------------- */
/*  Building the table                                                        */
/* -------------------------------------------------------------------------- */

/** Beyond this a table stops being reviewable and becomes a spreadsheet job. */
export const MAX_ROWS = 1000;

/** How many rows a set of axes would produce, before the button is pressed. */
export function combinationCountFor(attributes: ProductAttribute[]): number {
  const axes = attributes.filter((attribute) => attribute.values.length > 0);
  if (axes.length === 0) return 0;
  return axes.reduce((total, attribute) => total * attribute.values.length, 1);
}

export interface BuildResult {
  rows: ProductVariant[];
  /** Rows that already existed and were kept untouched. */
  kept: number;
  added: number;
  /** True when the full cross product was larger than `MAX_ROWS`. */
  truncated: boolean;
}

/**
 * Build every combination of the chosen axes, keeping what is already there.
 *
 * Existing rows are matched on their *values*, not on their SKU. A merchant
 * who renamed a code by hand has not created a different product, and matching
 * on the code would orphan the stock and the price they typed against it —
 * which is a whole afternoon's work, silently.
 *
 * Rows whose combination is no longer reachable — an attribute value was
 * deleted — are kept rather than dropped, and reported. They hold stock, and
 * deleting them because a list changed is how a shop loses a count it still
 * has on a shelf.
 */
export function buildTable(
  attributes: ProductAttribute[],
  existing: ProductVariant[],
  baseSku = "",
): BuildResult {
  const axes = attributes.filter((attribute) => attribute.values.length > 0);

  if (axes.length === 0) {
    return { rows: existing, kept: existing.length, added: 0, truncated: false };
  }

  const byKey = new Map<string, ProductVariant>();
  for (const row of existing) byKey.set(combinationKey(row, axes), row);

  const rows: ProductVariant[] = [];
  const claimed = new Set<string>();
  let added = 0;
  let kept = 0;
  let truncated = false;

  const walk = (index: number, draft: ProductVariant) => {
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      return;
    }
    if (index >= axes.length) {
      const key = combinationKey(draft, axes);
      // A key already claimed in this pass is a duplicate the build must not
      // create — it happens when two attribute values share an id.
      if (claimed.has(key)) return;
      claimed.add(key);

      const previous = byKey.get(key);
      if (previous) {
        rows.push(previous);
        kept += 1;
        return;
      }

      rows.push({
        ...draft,
        sku: baseSku ? normaliseSku(`${baseSku}-${key.replace(/\|/g, "-")}`) : "",
        stock: 0,
      });
      added += 1;
      return;
    }

    const axis = axes[index]!;
    for (const value of axis.values) {
      walk(index + 1, withValue(draft, axis, value.id));
    }
  };

  walk(0, { sku: "", colorId: "", sizeId: "", stock: 0 });

  /*
   * Anything that existed and is no longer reachable goes on the end. It is
   * still a row the merchant can see, edit and delete deliberately — which is
   * the only safe way to remove something holding stock.
   */
  for (const row of existing) {
    const key = combinationKey(row, axes);
    if (!claimed.has(key)) {
      rows.push(row);
      claimed.add(key);
      kept += 1;
    }
  }

  return { rows, kept, added, truncated };
}

/** A blank row, for the "add variant" button. */
export function emptyRow(): ProductVariant {
  return { sku: "", colorId: "", sizeId: "", stock: 0 };
}

/* -------------------------------------------------------------------------- */
/*  What makes a row savable                                                  */
/* -------------------------------------------------------------------------- */

export type RowField = "price" | "salePrice" | "stock" | "sku" | "gtin";

export interface RowProblem {
  field: RowField;
  message: Localized;
}

/**
 * Everything wrong with one row, or nothing.
 *
 * **Price is the only required field.** That is the rule this whole screen was
 * rebuilt around: a merchant filling forty rows must not be stopped at row
 * three for a code they intend to add on Thursday, and a blank stock box means
 * "I have not counted yet", which is a true thing to say.
 *
 * `productPrice` is passed so a row can inherit it: a variant with no override
 * sells at the product's price, and that is a price — so the row is valid.
 * Only a product with no price either leaves the row genuinely priceless.
 */
export function rowProblems(
  variant: ProductVariant,
  options: { productPrice?: number; allSkus?: string[] } = {},
): RowProblem[] {
  const problems: RowProblem[] = [];
  const price = variant.priceOverride ?? options.productPrice;

  if (price === undefined || price === null || !Number.isFinite(price)) {
    problems.push({
      field: "price",
      message: { en: "A price is required.", ar: "السعر مطلوب لهذا الخيار." },
    });
  } else if (price < 0) {
    problems.push({
      field: "price",
      message: { en: "A price cannot be negative.", ar: "السعر لا يمكن أن يكون سالبًا." },
    });
  }

  if (variant.salePrice !== undefined && variant.salePrice !== null) {
    if (!Number.isFinite(variant.salePrice) || variant.salePrice < 0) {
      problems.push({
        field: "salePrice",
        message: { en: "A sale price cannot be negative.", ar: "سعر التخفيض لا يمكن أن يكون سالبًا." },
      });
    } else if (price !== undefined && Number.isFinite(price) && variant.salePrice > price) {
      /*
       * A sale price above the price is a negative discount the customer sees.
       * The existing product-level rule says the same thing; this keeps the
       * variant honest to it.
       */
      problems.push({
        field: "salePrice",
        message: {
          en: "A sale price has to be below the price.",
          ar: "سعر التخفيض يجب أن يكون أقل من السعر.",
        },
      });
    }
  }

  if (variant.stock !== undefined && variant.stock !== null) {
    if (!Number.isInteger(variant.stock) || variant.stock < 0) {
      problems.push({
        field: "stock",
        message: { en: "Stock is a whole number, zero or more.", ar: "المخزون رقم صحيح، صفر أو أكثر." },
      });
    }
  }

  /*
   * A code must be unique — but only when there *is* one. Blank codes are not
   * duplicates of each other: several rows with no code yet is the normal
   * state of a table somebody is halfway through filling in.
   */
  const sku = (variant.sku ?? "").trim();
  if (sku && options.allSkus) {
    const clashes = options.allSkus.filter(
      (candidate) => normaliseSku(candidate) === normaliseSku(sku),
    ).length;
    if (clashes > 1) {
      problems.push({
        field: "sku",
        message: { en: "That code is used by another row.", ar: "هذا الرمز مستخدم في صف آخر." },
      });
    }
  }

  return problems;
}

/** The rows that can be written, and the ones that cannot, with reasons. */
export function splitSavable(
  rows: ProductVariant[],
  productPrice?: number,
): { savable: ProductVariant[]; rejected: { index: number; problems: RowProblem[] }[] } {
  const allSkus = rows.map((row) => row.sku ?? "").filter(Boolean);
  const savable: ProductVariant[] = [];
  const rejected: { index: number; problems: RowProblem[] }[] = [];

  rows.forEach((row, index) => {
    const problems = rowProblems(row, { productPrice, allSkus });
    if (problems.length === 0) savable.push(row);
    else rejected.push({ index, problems });
  });

  return { savable, rejected };
}

/* -------------------------------------------------------------------------- */
/*  Bulk actions                                                              */
/* -------------------------------------------------------------------------- */

export type BulkAction =
  | "set-price"
  | "set-sale-price"
  | "price-add"
  | "price-subtract"
  | "price-increase-percent"
  | "price-decrease-percent"
  | "sale-add"
  | "sale-subtract"
  | "sale-increase-percent"
  | "sale-decrease-percent"
  | "clear-sale-price"
  | "set-stock"
  | "stock-add"
  | "stock-subtract"
  | "enable"
  | "disable";

export const BULK_LABELS: Record<BulkAction, Localized> = {
  "set-price": { en: "Set regular price", ar: "تعيين السعر" },
  "set-sale-price": { en: "Set sale price", ar: "تعيين سعر التخفيض" },
  "price-add": { en: "Increase price by amount", ar: "زيادة السعر بمقدار" },
  "price-subtract": { en: "Decrease price by amount", ar: "إنقاص السعر بمقدار" },
  "price-increase-percent": { en: "Increase price by %", ar: "زيادة السعر بنسبة %" },
  "price-decrease-percent": { en: "Decrease price by %", ar: "إنقاص السعر بنسبة %" },
  "sale-add": { en: "Increase sale price by amount", ar: "زيادة سعر التخفيض بمقدار" },
  "sale-subtract": { en: "Decrease sale price by amount", ar: "إنقاص سعر التخفيض بمقدار" },
  "sale-increase-percent": { en: "Increase sale price by %", ar: "زيادة سعر التخفيض بنسبة %" },
  "sale-decrease-percent": { en: "Decrease sale price by %", ar: "إنقاص سعر التخفيض بنسبة %" },
  "clear-sale-price": { en: "Clear sale price", ar: "مسح سعر التخفيض" },
  "set-stock": { en: "Set stock", ar: "تعيين المخزون" },
  "stock-add": { en: "Increase stock", ar: "زيادة المخزون" },
  "stock-subtract": { en: "Decrease stock", ar: "إنقاص المخزون" },
  enable: { en: "Enable selected", ar: "تفعيل المحدد" },
  disable: { en: "Disable selected", ar: "تعطيل المحدد" },
};

/** Actions that need no number — the modal shows no value field for these. */
export const VALUELESS: BulkAction[] = ["enable", "disable", "clear-sale-price"];

/**
 * Round to the currency's own minor unit.
 *
 * The dinar has three, so a 10% cut off 12.005 has to land somewhere a price
 * field can hold. Without this a percentage action writes 10.804500000000001
 * and the merchant sees it in the box.
 */
export function roundMoney(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Apply one action to one row.
 *
 * Two rules run through all of it. **Nothing goes below zero** — a fixed
 * decrease larger than the price clamps rather than writing a negative, which
 * would be a product the shop pays people to take. And **a price action on a
 * row with no price of its own starts from the product price**, because that
 * is what the row is currently selling at; starting from zero would silently
 * reprice every inheriting row to the size of the adjustment.
 */
export function applyBulk(
  variant: ProductVariant,
  action: BulkAction,
  value: number,
  productPrice = 0,
): ProductVariant {
  const price = variant.priceOverride ?? productPrice;
  const sale = variant.salePrice;
  const stock = variant.stock ?? 0;

  switch (action) {
    case "set-price":
      return { ...variant, priceOverride: roundMoney(Math.max(0, value)) };
    case "price-add":
      return { ...variant, priceOverride: roundMoney(Math.max(0, price + value)) };
    case "price-subtract":
      return { ...variant, priceOverride: roundMoney(Math.max(0, price - value)) };
    case "price-increase-percent":
      return { ...variant, priceOverride: roundMoney(Math.max(0, price * (1 + value / 100))) };
    case "price-decrease-percent":
      return { ...variant, priceOverride: roundMoney(Math.max(0, price * (1 - value / 100))) };

    case "set-sale-price":
      return { ...variant, salePrice: roundMoney(Math.max(0, value)) };
    case "clear-sale-price":
      return { ...variant, salePrice: undefined };
    /*
     * A sale action on a row with no sale price does nothing rather than
     * inventing one from the regular price. "Reduce the sale price by 2" on a
     * row that is not on sale is not an instruction to put it on sale.
     */
    case "sale-add":
      return sale === undefined ? variant : { ...variant, salePrice: roundMoney(Math.max(0, sale + value)) };
    case "sale-subtract":
      return sale === undefined ? variant : { ...variant, salePrice: roundMoney(Math.max(0, sale - value)) };
    case "sale-increase-percent":
      return sale === undefined
        ? variant
        : { ...variant, salePrice: roundMoney(Math.max(0, sale * (1 + value / 100))) };
    case "sale-decrease-percent":
      return sale === undefined
        ? variant
        : { ...variant, salePrice: roundMoney(Math.max(0, sale * (1 - value / 100))) };

    case "set-stock":
      return { ...variant, stock: Math.max(0, Math.floor(value)) };
    case "stock-add":
      return { ...variant, stock: Math.max(0, stock + Math.floor(value)) };
    case "stock-subtract":
      return { ...variant, stock: Math.max(0, stock - Math.floor(value)) };

    case "enable":
      return { ...variant, available: undefined };
    case "disable":
      return { ...variant, available: false };

    default:
      return variant;
  }
}

/** Apply an action to the selected rows only, leaving the rest untouched. */
export function applyBulkTo(
  rows: ProductVariant[],
  selected: Set<number>,
  action: BulkAction,
  value: number,
  productPrice = 0,
): ProductVariant[] {
  return rows.map((row, index) =>
    selected.has(index) ? applyBulk(row, action, value, productPrice) : row,
  );
}

/* -------------------------------------------------------------------------- */
/*  Searching                                                                 */
/* -------------------------------------------------------------------------- */

/** Does this row match what was typed? Matches codes and every axis value. */
export function rowMatches(
  variant: ProductVariant,
  attributes: ProductAttribute[],
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [
    variant.sku ?? "",
    variant.gtin ?? "",
    ...attributes.map((attribute) => {
      const value = valueOf(variant, attribute);
      const match = attribute.values.find((candidate) => candidate.id === value);
      // The label as well as the id: a merchant searches for "White", not for
      // the slug the value happens to be stored under.
      return [value, match?.label.en ?? "", match?.label.ar ?? ""].join(" ");
    }),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

/* -------------------------------------------------------------------------- */
/*  The stock check matrix                                                    */
/* -------------------------------------------------------------------------- */

export interface StockMatrix {
  rowAttribute?: ProductAttribute;
  columnAttribute?: ProductAttribute;
  columns: { id: string; label: Localized }[];
  rows: {
    id: string;
    label: Localized;
    cells: Record<string, number>;
    total: number;
  }[];
  columnTotals: Record<string, number>;
  grandTotal: number;
}

/**
 * Stock, laid out as a grid to be read rather than a list to be scrolled.
 *
 * The first axis becomes the rows and the second the columns, whatever they
 * are — colour by size for a shirt, colour by capacity for a kettle. With more
 * than two axes the extra ones are filtered by the caller and the grid shows
 * the slice; summing across them instead would produce a total that matches no
 * shelf.
 *
 * Derived from the rows in hand on every render, so editing a stock box
 * upstairs changes this immediately. A copy kept in state would be a second
 * source of truth for the one number a merchant is checking.
 */
export function stockMatrix(
  rows: ProductVariant[],
  attributes: ProductAttribute[],
  filters: Record<string, string> = {},
): StockMatrix {
  const axes = attributes.filter((attribute) => attribute.values.length > 0);
  const rowAttribute = axes[0];
  const columnAttribute = axes[1];

  if (!rowAttribute) {
    const total = rows.reduce((sum, row) => sum + Math.max(0, row.stock ?? 0), 0);
    return { columns: [], rows: [], columnTotals: {}, grandTotal: total };
  }

  // Only the slice the filters describe. Axes beyond the first two are the
  // reason this exists: a grid that silently summed them would be wrong.
  const visible = rows.filter((row) =>
    Object.entries(filters).every(([attributeId, value]) => {
      if (!value) return true;
      const attribute = axes.find((candidate) => candidate.id === attributeId);
      return attribute ? valueOf(row, attribute) === value : true;
    }),
  );

  const columns = columnAttribute
    ? columnAttribute.values.map((value) => ({ id: value.id, label: value.label }))
    : [{ id: "", label: { en: "Stock", ar: "المخزون" } as Localized }];

  const columnTotals: Record<string, number> = {};
  for (const column of columns) columnTotals[column.id] = 0;

  const matrixRows = rowAttribute.values.map((value) => {
    const cells: Record<string, number> = {};
    for (const column of columns) cells[column.id] = 0;

    for (const row of visible) {
      if (valueOf(row, rowAttribute) !== value.id) continue;
      const columnId = columnAttribute ? valueOf(row, columnAttribute) : "";
      if (!(columnId in cells)) continue;
      const units = Math.max(0, row.stock ?? 0);
      cells[columnId] = (cells[columnId] ?? 0) + units;
      columnTotals[columnId] = (columnTotals[columnId] ?? 0) + units;
    }

    return {
      id: value.id,
      label: value.label,
      cells,
      total: Object.values(cells).reduce((sum, units) => sum + units, 0),
    };
  });

  return {
    rowAttribute,
    columnAttribute,
    columns,
    rows: matrixRows,
    columnTotals,
    grandTotal: Object.values(columnTotals).reduce((sum, units) => sum + units, 0),
  };
}

/* -------------------------------------------------------------------------- */
/*  Deriving axes from what a product already has                             */
/* -------------------------------------------------------------------------- */

/**
 * The axes to show for a product that has never had attributes defined.
 *
 * Every existing product is in this state, and opening the new table on one
 * must show its colours and sizes rather than an empty screen — so they are
 * reconstructed from the fields the product already carries. A category's own
 * attributes are appended, which is how a kettle's capacity appears without
 * anybody migrating anything.
 */
export function attributesFor(
  product: {
    colors?: { id: string; name: Localized; hex?: string }[];
    sizes?: { id: string; label: string }[];
    designs?: { id: string; name: Localized }[];
  },
  categoryAttributes: ProductAttribute[] = [],
): ProductAttribute[] {
  const axes: ProductAttribute[] = [];

  if ((product.colors?.length ?? 0) > 0) {
    axes.push({
      id: "color",
      name: { en: "Colour", ar: "اللون" },
      kind: "color",
      values: product.colors!.map((colour) => ({
        id: colour.id,
        label: colour.name,
        ...(colour.hex ? { hex: colour.hex } : {}),
      })),
    });
  }

  if ((product.sizes?.length ?? 0) > 0) {
    axes.push({
      id: "size",
      name: { en: "Size", ar: "المقاس" },
      kind: "size",
      values: product.sizes!.map((size) => ({
        id: size.id,
        label: { en: size.label, ar: size.label },
      })),
    });
  }

  /*
   * Artwork is an axis too, and it has to be one *here* rather than a
   * special case elsewhere. Two rows that differ only by design are two
   * sellable things; if the table's notion of a combination could not see
   * `designId`, a build would treat them as duplicates and keep one — losing
   * the other's stock without saying so.
   *
   * Its values are not editable in the axes list: an artwork needs a
   * thumbnail, so it is created in the Designs panel and only *used* here.
   */
  if ((product.designs?.length ?? 0) > 0) {
    axes.push({
      id: "design",
      name: { en: "Design", ar: "التصميم" },
      kind: "design",
      values: product.designs!.map((design) => ({ id: design.id, label: design.name })),
    });
  }

  for (const attribute of categoryAttributes) {
    // A category attribute that duplicates one already derived is skipped, or
    // the table would show two colour columns.
    if (axes.some((existing) => existing.kind === attribute.kind && attribute.kind !== "custom")) {
      continue;
    }
    if (axes.some((existing) => existing.id === attribute.id)) continue;
    axes.push(attribute);
  }

  return axes.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * The inverse of `attributesFor`: axes back into the product's own fields.
 *
 * The workbench edits one flat list of axes, but the product does not store
 * one — colours and sizes have dedicated arrays that the storefront picker,
 * the size guide and the fitting room all read by name. So an edit to the
 * Colour axis has to land in `colors`, not in a generic map, or the swatches
 * disappear from the product page while the admin table still shows them.
 *
 * Existing entries are matched by id and **kept**, with only the fields the
 * axis actually carries written over. A colour's second tone and a size's
 * measurements have no representation in the table above, and rebuilding the
 * array from what the table knows would quietly delete them.
 */
export function splitAxes(
  next: ProductAttribute[],
  existing: { colors?: ProductColor[]; sizes?: ProductSize[] } = {},
): { colors: ProductColor[]; sizes: ProductSize[]; custom: ProductAttribute[] } {
  const colorAxis = next.find((attribute) => attribute.kind === "color");
  const sizeAxis = next.find((attribute) => attribute.kind === "size");

  const colors: ProductColor[] = (colorAxis?.values ?? []).map((value) => {
    const prior = existing.colors?.find((colour) => colour.id === value.id);
    return {
      ...(prior ?? {}),
      id: value.id,
      name: value.label,
      // A colour with no fill renders as an invisible swatch. Mid-grey is a
      // placeholder the merchant can see and correct, not a silent blank.
      hex: value.hex ?? prior?.hex ?? "#c9c9c9",
    };
  });

  const sizes: ProductSize[] = (sizeAxis?.values ?? []).map((value) => {
    const prior = existing.sizes?.find((size) => size.id === value.id);
    return {
      ...(prior ?? {}),
      id: value.id,
      label: value.label.en || value.label.ar || value.id,
      system: prior?.system ?? "alpha",
    };
  });

  /*
   * The design axis is deliberately *not* returned. Artwork is owned by the
   * Designs panel, which holds the thumbnails; writing it back from a list of
   * labels would strip every image the merchant uploaded.
   */
  return {
    colors,
    sizes,
    custom: next.filter((attribute) => attribute.kind === "custom"),
  };
}

/**
 * The axes to *edit*, which are not quite the axes a product has.
 *
 * `attributesFor` reports what is there; a new product has nothing there, and
 * an editor that only shows what exists would offer a merchant no way to say
 * "this comes in three colours" — the one thing they opened the screen to do.
 * So colour and size are always present as rows to fill in, empty if need be.
 *
 * An empty axis is inert everywhere it matters: `buildTable` and `stockMatrix`
 * both drop axes with no values, so an unused Colour row costs a column header
 * and nothing else.
 */
export function editableAxes(
  product: {
    colors?: { id: string; name: Localized; hex?: string }[];
    sizes?: { id: string; label: string }[];
    designs?: { id: string; name: Localized }[];
  },
  categoryAttributes: ProductAttribute[] = [],
): ProductAttribute[] {
  const axes = [...attributesFor(product, categoryAttributes)];

  if (!axes.some((attribute) => attribute.kind === "color")) {
    axes.unshift({ id: "color", name: { en: "Colour", ar: "اللون" }, kind: "color", values: [] });
  }

  if (!axes.some((attribute) => attribute.kind === "size")) {
    const afterColor = axes.findIndex((attribute) => attribute.kind === "color") + 1;
    axes.splice(afterColor, 0, {
      id: "size",
      name: { en: "Size", ar: "المقاس" },
      kind: "size",
      values: [],
    });
  }

  return axes;
}

/**
 * Give every row a code, without making the merchant type one.
 *
 * Two true things are in tension here. A merchant filling in a table should
 * not have to invent forty codes — a price is the only thing a row genuinely
 * needs. But a code is not decoration downstream: it goes on the order line,
 * the picking list and the invoice, and a blank one there is a parcel nobody
 * can identify.
 *
 * So a blank is filled in rather than refused, from the parent code and the
 * row's own values — the same shape `buildTable` generates, so a hand-added
 * row and a generated one end up looking alike. Deliberately *not* unique-ified
 * with a counter: two rows that derive the same code have the same values,
 * which is a duplicate combination, and quietly numbering them would hide the
 * thing the merchant needs to know.
 */
export function fillSkus(
  rows: ProductVariant[],
  attributes: ProductAttribute[],
  baseSku = "",
): ProductVariant[] {
  return rows.map((row) => {
    if (normaliseSku(row.sku ?? "")) return row;

    const parts = attributes
      .map((attribute) => valueOf(row, attribute))
      .filter((value) => value !== "");
    const derived = normaliseSku([baseSku, ...parts].filter(Boolean).join("-"));

    // Nothing to build one from — no parent code and no values. The caller
    // reports it; inventing a random code would put an unsearchable string on
    // an invoice.
    return derived ? { ...row, sku: derived } : row;
  });
}
