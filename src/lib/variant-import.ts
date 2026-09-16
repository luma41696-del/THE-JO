import { foldHeader, parseNumber } from "@/lib/import";
import { normaliseSku } from "@/lib/product-options";
import { combinationKey, withValue } from "@/lib/variant-matrix";
import type { Localized, ProductAttribute, ProductVariant } from "@/types";

/**
 * Bringing a variant table in from a spreadsheet.
 *
 * The product importer already reads files; this is the same job one level
 * down — rows that are *permutations of one product* rather than products —
 * and it differs in three ways that matter enough to justify its own module:
 *
 *  - **The columns are not fixed.** They depend on the product's own axes, so
 *    a kettle's sheet has Capacity where a shirt's has Size. Mapping has to be
 *    built from the attributes in hand, not from a constant.
 *  - **Only the price is required.** A row with a price and nothing else is a
 *    valid row, and refusing it because the code column is blank is the exact
 *    friction this screen was rebuilt to remove.
 *  - **A duplicate is a duplicate of a *combination*, not of a code.** Two
 *    rows for White / M are the same sellable unit however they are labelled.
 *
 * Pure: the browser reads the file, this decides what the rows mean.
 */

/* -------------------------------------------------------------------------- */
/*  What a column can be                                                      */
/* -------------------------------------------------------------------------- */

export type FixedField = "sku" | "price" | "salePrice" | "stock" | "gtin" | "active";

/** A mapping target: one of the fixed fields, or one of the product's axes. */
export type MapTarget = { kind: "field"; field: FixedField } | { kind: "attribute"; id: string };

export interface ColumnTarget {
  key: string;
  label: Localized;
  target: MapTarget;
}

const FIXED: { field: FixedField; label: Localized; aliases: string[] }[] = [
  {
    field: "price",
    label: { en: "Regular price", ar: "السعر" },
    aliases: ["price", "regular price", "regular_price", "unit price", "cost", "السعر", "سعر", "السعر العادي"],
  },
  {
    field: "salePrice",
    label: { en: "Sale price", ar: "سعر التخفيض" },
    aliases: ["sale price", "sale_price", "sale", "discount price", "offer price", "سعر التخفيض", "سعر العرض", "الخصم"],
  },
  {
    field: "sku",
    label: { en: "SKU", ar: "الرمز" },
    aliases: ["sku", "code", "item code", "article", "رمز", "الرمز", "كود"],
  },
  {
    field: "stock",
    label: { en: "Stock", ar: "المخزون" },
    aliases: ["stock", "quantity", "qty", "inventory", "on hand", "المخزون", "الكمية", "المتوفر"],
  },
  {
    field: "gtin",
    label: { en: "GTIN / Barcode", ar: "الباركود" },
    aliases: ["gtin", "barcode", "ean", "upc", "باركود", "الباركود"],
  },
  {
    field: "active",
    label: { en: "Active", ar: "مفعّل" },
    aliases: ["active", "enabled", "available", "status", "مفعل", "متاح", "الحالة"],
  },
];

/** Every target a column may be mapped to, for this product's axes. */
export function targetsFor(attributes: ProductAttribute[]): ColumnTarget[] {
  return [
    ...attributes.map((attribute) => ({
      key: `attr:${attribute.id}`,
      label: attribute.name,
      target: { kind: "attribute" as const, id: attribute.id },
    })),
    ...FIXED.map((entry) => ({
      key: `field:${entry.field}`,
      label: entry.label,
      target: { kind: "field" as const, field: entry.field },
    })),
  ];
}

/**
 * Guess what each column is.
 *
 * Attribute names are matched first and by their own name, so a sheet whose
 * column says "Capacity" lands on the capacity axis rather than being read as
 * some fixed field. A column nobody recognises is left unmapped rather than
 * guessed — an unmapped column is a question for the merchant, a wrongly
 * guessed one writes prices into the stock field across the whole table.
 */
export function autoMapColumns(
  headers: string[],
  attributes: ProductAttribute[],
): (string | null)[] {
  const taken = new Set<string>();

  return headers.map((header) => {
    const folded = foldHeader(header);
    if (!folded) return null;

    for (const attribute of attributes) {
      const key = `attr:${attribute.id}`;
      if (taken.has(key)) continue;
      const names = [attribute.id, attribute.name.en, attribute.name.ar].map(foldHeader);
      if (names.includes(folded)) {
        taken.add(key);
        return key;
      }
    }

    for (const entry of FIXED) {
      const key = `field:${entry.field}`;
      if (taken.has(key)) continue;
      if (entry.aliases.map(foldHeader).includes(folded)) {
        taken.add(key);
        return key;
      }
    }

    /*
     * A loose pass, only after every exact match has had its chance — or
     * "sale price" would claim the "price" column simply by containing it.
     */
    for (const entry of FIXED) {
      const key = `field:${entry.field}`;
      if (taken.has(key)) continue;
      if (entry.aliases.some((alias) => folded.includes(foldHeader(alias)))) {
        taken.add(key);
        return key;
      }
    }

    return null;
  });
}

/* -------------------------------------------------------------------------- */
/*  Matching a written value to an attribute value                            */
/* -------------------------------------------------------------------------- */

/**
 * Fold a value so the spellings people type collapse onto one.
 *
 * "White", "white", " WHITE " and "White " are one colour. Without this a
 * sheet produces four attribute values, four columns in the stock matrix, and
 * a shop that appears to stock four different whites.
 */
export function foldValue(value: string): string {
  return foldHeader(value);
}

/** The existing value this cell names, if any. */
export function matchValue(
  attribute: ProductAttribute,
  written: string,
): { id: string } | undefined {
  const folded = foldValue(written);
  if (!folded) return undefined;
  return attribute.values.find(
    (value) =>
      foldValue(value.id) === folded ||
      foldValue(value.label.en) === folded ||
      foldValue(value.label.ar) === folded,
  );
}

/* -------------------------------------------------------------------------- */
/*  Reading one row                                                           */
/* -------------------------------------------------------------------------- */

export type RowStatus = "create" | "update" | "skip" | "error";

export interface ImportRow {
  /** 1-based line as the merchant sees it in the sheet, header counted. */
  line: number;
  status: RowStatus;
  variant?: ProductVariant;
  /** Index in the existing table when this updates one. */
  updatesIndex?: number;
  problems: Localized[];
  /** Attribute values named by this row that the product does not have yet. */
  newValues: { attributeId: string; written: string }[];
}

export type ExistingPolicy = "update" | "skip" | "error";

export interface ParseOptions {
  attributes: ProductAttribute[];
  existing: ProductVariant[];
  /** Falls back to this when a row names no price of its own. */
  productPrice?: number;
  existingPolicy: ExistingPolicy;
  /** Create attribute values the sheet names but the product does not have. */
  createMissingValues: boolean;
}

/**
 * Turn a sheet into a plan.
 *
 * Nothing is written here. The result is what the preview renders and what the
 * merchant confirms — the whole point of the step being separate is that
 * "forty-seven valid, three with errors" is a question somebody can answer
 * before anything changes.
 */
export function planVariantImport(
  rows: string[][],
  mapping: (string | null)[],
  options: ParseOptions,
): { rows: ImportRow[]; newValues: Map<string, Set<string>> } {
  const { attributes, existing, productPrice, existingPolicy, createMissingValues } = options;

  const existingByKey = new Map<string, number>();
  existing.forEach((row, index) => existingByKey.set(combinationKey(row, attributes), index));

  const existingBySku = new Map<string, number>();
  existing.forEach((row, index) => {
    if (row.sku) existingBySku.set(normaliseSku(row.sku), index);
  });

  /*
   * Values the sheet names that the product does not have. Collected as it
   * goes so the preview can offer to create them once, rather than asking
   * about "Navy" forty times.
   */
  const newValues = new Map<string, Set<string>>();
  const seenKeys = new Map<string, number>();
  const seenSkus = new Map<string, number>();
  const out: ImportRow[] = [];

  rows.forEach((cells, rowIndex) => {
    const line = rowIndex + 2;
    const problems: Localized[] = [];
    const rowNewValues: { attributeId: string; written: string }[] = [];

    let variant: ProductVariant = { sku: "", colorId: "", sizeId: "", stock: 0 };
    let price: number | undefined;
    let salePrice: number | undefined;
    let stock: number | undefined;
    let active: boolean | undefined;

    mapping.forEach((key, columnIndex) => {
      if (!key) return;
      const raw = (cells[columnIndex] ?? "").trim();

      if (key.startsWith("attr:")) {
        if (!raw) return;
        const attributeId = key.slice(5);
        const attribute = attributes.find((candidate) => candidate.id === attributeId);
        if (!attribute) return;

        const match = matchValue(attribute, raw);
        if (match) {
          variant = withValue(variant, attribute, match.id);
          return;
        }

        if (createMissingValues) {
          const id = foldValue(raw).replace(/\s+/g, "-") || raw;
          variant = withValue(variant, attribute, id);
          rowNewValues.push({ attributeId, written: raw });
          if (!newValues.has(attributeId)) newValues.set(attributeId, new Set());
          newValues.get(attributeId)!.add(raw);
        } else {
          rowNewValues.push({ attributeId, written: raw });
          if (!newValues.has(attributeId)) newValues.set(attributeId, new Set());
          newValues.get(attributeId)!.add(raw);
          problems.push({
            en: `"${raw}" is not a value of ${attribute.name.en}.`,
            ar: `"${raw}" ليست قيمة لـ${attribute.name.ar}.`,
          });
        }
        return;
      }

      const field = key.slice(6) as FixedField;
      switch (field) {
        case "price": {
          if (!raw) return;
          const value = parseNumber(raw);
          if (value === undefined || value < 0) {
            problems.push({
              en: `"${raw}" is not a price.`,
              ar: `"${raw}" ليس سعرًا صالحًا.`,
            });
            return;
          }
          price = value;
          return;
        }
        case "salePrice": {
          if (!raw) return;
          const value = parseNumber(raw);
          if (value === undefined || value < 0) {
            problems.push({ en: `"${raw}" is not a sale price.`, ar: `"${raw}" ليس سعر تخفيض صالحًا.` });
            return;
          }
          salePrice = value;
          return;
        }
        case "stock": {
          if (!raw) return;
          const value = parseNumber(raw);
          if (value === undefined || value < 0) {
            problems.push({ en: `"${raw}" is not a stock count.`, ar: `"${raw}" ليس كمية صالحة.` });
            return;
          }
          stock = Math.floor(value);
          return;
        }
        case "sku":
          if (raw) variant = { ...variant, sku: normaliseSku(raw) };
          return;
        case "gtin":
          if (raw) variant = { ...variant, gtin: raw };
          return;
        case "active": {
          if (!raw) return;
          const text = raw.toLowerCase();
          active = !["0", "false", "no", "n", "لا", "غير مفعل", "معطل"].includes(text);
          return;
        }
        default:
          return;
      }
    });

    /*
     * The one required field. A row with no price of its own is fine when the
     * product has one to inherit — that row genuinely has a price.
     */
    const effectivePrice = price ?? productPrice;
    if (effectivePrice === undefined || !Number.isFinite(effectivePrice)) {
      problems.push({ en: "A price is required.", ar: "السعر مطلوب." });
    }

    if (
      salePrice !== undefined &&
      effectivePrice !== undefined &&
      Number.isFinite(effectivePrice) &&
      salePrice > effectivePrice
    ) {
      problems.push({
        en: "The sale price is above the price.",
        ar: "سعر التخفيض أعلى من السعر.",
      });
    }

    if (price !== undefined) variant = { ...variant, priceOverride: price };
    if (salePrice !== undefined) variant = { ...variant, salePrice };
    variant = { ...variant, stock: stock ?? 0 };
    if (active === false) variant = { ...variant, available: false };

    const key = combinationKey(variant, attributes);
    const sku = variant.sku ? normaliseSku(variant.sku) : "";

    /* ---- duplicates inside the sheet itself -------------------------- */

    if (seenKeys.has(key)) {
      out.push({
        line,
        status: "error",
        problems: [
          {
            en: `The same combination is already on line ${seenKeys.get(key)}.`,
            ar: `التركيبة نفسها موجودة في السطر ${seenKeys.get(key)}.`,
          },
        ],
        newValues: rowNewValues,
      });
      return;
    }
    if (sku && seenSkus.has(sku)) {
      out.push({
        line,
        status: "error",
        problems: [
          {
            en: `That code is already on line ${seenSkus.get(sku)}.`,
            ar: `هذا الرمز موجود في السطر ${seenSkus.get(sku)}.`,
          },
        ],
        newValues: rowNewValues,
      });
      return;
    }

    if (problems.length > 0) {
      out.push({ line, status: "error", problems, newValues: rowNewValues });
      return;
    }

    seenKeys.set(key, line);
    if (sku) seenSkus.set(sku, line);

    /* ---- against what the product already has ------------------------ */

    const matchIndex = existingByKey.get(key) ?? (sku ? existingBySku.get(sku) : undefined);

    if (matchIndex !== undefined) {
      if (existingPolicy === "skip") {
        out.push({ line, status: "skip", problems: [], newValues: rowNewValues });
        return;
      }
      if (existingPolicy === "error") {
        out.push({
          line,
          status: "error",
          problems: [
            { en: "This variant already exists.", ar: "هذا الخيار موجود مسبقًا." },
          ],
          newValues: rowNewValues,
        });
        return;
      }

      /*
       * Merged onto the existing row rather than replacing it. A sheet with
       * only a price column would otherwise blank the stock and the barcode of
       * every row it touched — the columns it did not carry are not
       * instructions to clear those fields.
       */
      const previous = existing[matchIndex]!;
      out.push({
        line,
        status: "update",
        updatesIndex: matchIndex,
        variant: {
          ...previous,
          ...(variant.sku ? { sku: variant.sku } : {}),
          ...(price !== undefined ? { priceOverride: price } : {}),
          ...(salePrice !== undefined ? { salePrice } : {}),
          ...(stock !== undefined ? { stock } : {}),
          ...(variant.gtin ? { gtin: variant.gtin } : {}),
          ...(active !== undefined ? { available: active ? undefined : false } : {}),
        },
        problems: [],
        newValues: rowNewValues,
      });
      return;
    }

    out.push({ line, status: "create", variant, problems: [], newValues: rowNewValues });
  });

  return { rows: out, newValues };
}

/** The headline numbers the preview shows before anything is written. */
export function summarise(rows: ImportRow[]) {
  return {
    total: rows.length,
    create: rows.filter((row) => row.status === "create").length,
    update: rows.filter((row) => row.status === "update").length,
    skip: rows.filter((row) => row.status === "skip").length,
    error: rows.filter((row) => row.status === "error").length,
  };
}

/**
 * Fold a plan into the table.
 *
 * Errors are left out and everything else is applied, which is what "import
 * the 95 valid rows" means. The invalid ones stay on the preview with their
 * reasons rather than being silently dropped.
 */
export function applyImport(
  existing: ProductVariant[],
  plan: ImportRow[],
): ProductVariant[] {
  const next = [...existing];

  for (const row of plan) {
    if (row.status === "update" && row.updatesIndex !== undefined && row.variant) {
      next[row.updatesIndex] = row.variant;
    } else if (row.status === "create" && row.variant) {
      next.push(row.variant);
    }
  }

  return next;
}

/** Attribute values the plan wants to add, ready to merge into the axes. */
export function newValuesFor(
  attributes: ProductAttribute[],
  newValues: Map<string, Set<string>>,
): ProductAttribute[] {
  return attributes.map((attribute) => {
    const additions = newValues.get(attribute.id);
    if (!additions || additions.size === 0) return attribute;

    const existing = new Set(attribute.values.map((value) => foldValue(value.id)));
    const added = [...additions]
      .filter((written) => !existing.has(foldValue(written)))
      .map((written) => ({
        id: foldValue(written).replace(/\s+/g, "-") || written,
        label: { en: written, ar: written } as Localized,
      }));

    return { ...attribute, values: [...attribute.values, ...added] };
  });
}

/* -------------------------------------------------------------------------- */
/*  Google Sheets                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Turn a Google Sheets link into one that returns CSV.
 *
 * A pasted sheet URL is a *page*, and fetching it returns the editor's HTML.
 * Google exposes the same document as CSV at a different path, and rewriting
 * the link is the whole trick — it needs no API key and no OAuth for a sheet
 * whose sharing is set to anyone-with-the-link.
 *
 * `gid` is carried across when the link names a tab, or the export returns the
 * first sheet and a merchant who sent the second one silently imports the
 * wrong data.
 */
export function sheetCsvUrl(url: string): string | undefined {
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url)?.[1];
  if (!id) return undefined;

  const gid = /[#&?]gid=([0-9]+)/.exec(url)?.[1];
  const base = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  return gid ? `${base}&gid=${gid}` : base;
}

/** A Drive file link, for a sheet shared from Drive rather than opened. */
export function driveFileId(url: string): string | undefined {
  return (
    /\/file\/d\/([a-zA-Z0-9-_]+)/.exec(url)?.[1] ??
    /[?&]id=([a-zA-Z0-9-_]+)/.exec(url)?.[1]
  );
}
