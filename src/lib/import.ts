import { normaliseSku } from "@/lib/product-options";
import type { Localized, Product } from "@/types";

/**
 * Bringing a spreadsheet into the catalogue.
 *
 * A merchant's product list arrives as a file somebody else made: exported from
 * a supplier's system, typed in Excel over a year, or copied out of an older
 * shop. It will not match our field names, its numbers may be written in
 * Arabic-Indic digits, its prices may carry a currency symbol, and it will
 * contain the same product twice. None of that is the merchant's mistake, and
 * an importer that refuses the file is an importer nobody uses.
 *
 * So the work here is in four parts, each of which exists because of a
 * specific way an import goes wrong:
 *
 *  1. **Parsing** — Excel writes `;` as the separator in Arabic and most
 *     European locales, and writes a BOM. A parser that assumes commas turns
 *     every row into one field and reports "no columns found" for a file that
 *     is perfectly well formed.
 *
 *  2. **Mapping** — columns are matched to fields by name, in both languages,
 *     and the guess is *shown* for correction rather than applied silently.
 *     Guessing wrong and importing anyway writes prices into the stock column.
 *
 *  3. **Checking** — every row is validated before a single one is written, so
 *     the merchant sees "row 47 has no price" while nothing has changed yet,
 *     rather than after 46 products are already in the shop.
 *
 *  4. **Planning** — each row is resolved against the catalogue as a create,
 *     an update, or a duplicate, and the plan is shown before it runs. "This
 *     will change 12 products and add 3" is a question somebody can answer.
 *
 * Everything here is pure: the same module parses in the browser for the
 * preview and validates on the server before the write, so the preview cannot
 * promise something the write then refuses.
 */

/* -------------------------------------------------------------------------- */
/*  Parsing a delimited file                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Work out what separates the columns.
 *
 * Excel writes `;` rather than `,` wherever the system list separator is a
 * semicolon, which is most of Europe and the Arabic locales — so a merchant in
 * Amman who exports from Excel and imports here gets a semicolon file without
 * ever choosing one. Counting on the header line rather than the whole file
 * keeps a comma inside a product description from outvoting the real
 * separator.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;

  for (const candidate of candidates) {
    // Counted outside quotes, so a description containing "black, wide" does
    // not make the comma look like a separator in a semicolon file.
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i += 1) {
      const char = firstLine[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === candidate && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }

  return best;
}

/**
 * Split a delimited file into rows of cells.
 *
 * Written out rather than taken from a library because the parse has to be
 * identical in the browser preview and in the server that writes: two
 * implementations, or one implementation behind a version range, is how a
 * preview comes to promise something the write refuses.
 *
 * It handles what real files contain: a UTF-8 BOM (Excel writes one, and a
 * leading `﻿` otherwise becomes part of the first column's name, so no
 * mapping matches it), quoted fields holding the delimiter or a newline,
 * doubled quotes as an escaped quote, and CRLF.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const sep = delimiter ?? detectDelimiter(body);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    // A trailing newline should not produce a final empty row.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < body.length) {
    const char = body[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += char;
      i += 1;
      continue;
    }

    if (char === '"' && cell === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === sep) {
      endCell();
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }

    cell += char;
    i += 1;
  }

  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/* -------------------------------------------------------------------------- */
/*  Numbers that were not typed in English                                    */
/* -------------------------------------------------------------------------- */

const ARABIC_INDIC = /[٠-٩]/g;
const EASTERN_ARABIC = /[۰-۹]/g;

/**
 * Read a number out of whatever the spreadsheet actually contains.
 *
 * A price column in a real file holds `12.500`, `12,500`, `JOD 12.500`,
 * `١٢٫٥٠٠`, and `12.500 د.أ` — often in the same file, because different people
 * typed different rows. Refusing everything but a bare decimal makes the
 * merchant re-type their own catalogue.
 *
 * Returns `undefined` rather than `NaN` or `0` for something that is not a
 * number at all: a zero here would silently price a product at nothing.
 */
export function parseNumber(raw: string | number | undefined | null): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (raw === undefined || raw === null) return undefined;

  let text = String(raw).trim();
  if (!text) return undefined;

  // Arabic-Indic and Eastern Arabic digits to ASCII.
  text = text
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EASTERN_ARABIC, (d) => String(d.charCodeAt(0) - 0x06f0))
    // Arabic decimal separator and thousands separator.
    .replace(/٫/g, ".")
    .replace(/٬/g, "")
    // Currency words and symbols, in both scripts.
    .replace(/(jod|jd|ils|usd|د\.?أ|دينار|ر\.?س|\$|€|£)/gi, "")
    .replace(/\s| /g, "");

  /*
   * Which separator is the decimal point.
   *
   * `1,234.50` is a thousands comma; `1.234,50` is a European decimal comma;
   * `12,500` on its own is ambiguous and is read as a thousands separator,
   * because a comma with exactly three digits after it is far more often
   * 12500 than 12.5 — and a shop that means 12.5 writes 12.500 in a currency
   * with three decimal places.
   */
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) text = text.replace(/\./g, "").replace(",", ".");
    else text = text.replace(/,/g, "");
  } else if (lastComma !== -1) {
    const after = text.length - lastComma - 1;
    text = after === 3 ? text.replace(/,/g, "") : text.replace(",", ".");
  }

  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** Yes/no in either language, however it was written. */
export function parseBoolean(raw: string | number | boolean | undefined): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  if (raw === undefined || raw === null) return undefined;
  const text = String(raw).trim().toLowerCase();
  if (!text) return undefined;
  if (["1", "true", "yes", "y", "نعم", "صح", "متوفر"].includes(text)) return true;
  if (["0", "false", "no", "n", "لا", "خطأ", "غير متوفر"].includes(text)) return false;
  return undefined;
}

/* -------------------------------------------------------------------------- */
/*  What can be imported                                                      */
/* -------------------------------------------------------------------------- */

export type ImportFieldId =
  | "id"
  | "slug"
  | "titleEn"
  | "titleAr"
  | "descriptionEn"
  | "descriptionAr"
  | "categoryId"
  | "price"
  | "compareAtPrice"
  | "totalStock"
  | "sku"
  | "gtin"
  | "tags"
  | "status"
  | "type";

export interface ImportField {
  id: ImportFieldId;
  label: Localized;
  kind: "text" | "number" | "list" | "enum";
  /**
   * Header names this field answers to, lowercased.
   *
   * Both languages, and the spellings people actually use — "قيمة" and "السعر"
   * for price, "المخزون" and "الكمية" for stock. A mapping table the merchant
   * has to fill in by hand for twelve columns is one they abandon.
   */
  aliases: string[];
  /** Required to create a *new* product. An update may carry only what changes. */
  requiredForCreate?: boolean;
}

export const IMPORT_FIELDS: ImportField[] = [
  {
    id: "id",
    label: { en: "Product ID", ar: "معرّف المنتج" },
    kind: "text",
    aliases: ["id", "product id", "productid", "معرف", "المعرف", "رقم المنتج"],
  },
  {
    id: "slug",
    label: { en: "Address (slug)", ar: "الرابط" },
    kind: "text",
    aliases: ["slug", "handle", "url", "address", "الرابط", "المعرف النصي"],
  },
  {
    id: "titleEn",
    label: { en: "Name (English)", ar: "الاسم (إنجليزي)" },
    kind: "text",
    aliases: ["title", "name", "title en", "name en", "english name", "product name", "الاسم بالانجليزية"],
    requiredForCreate: true,
  },
  {
    id: "titleAr",
    label: { en: "Name (Arabic)", ar: "الاسم (عربي)" },
    kind: "text",
    aliases: ["title ar", "name ar", "arabic name", "الاسم", "اسم المنتج", "الاسم بالعربية"],
    requiredForCreate: true,
  },
  {
    id: "descriptionEn",
    label: { en: "Description (English)", ar: "الوصف (إنجليزي)" },
    kind: "text",
    aliases: ["description", "description en", "details", "الوصف بالانجليزية"],
  },
  {
    id: "descriptionAr",
    label: { en: "Description (Arabic)", ar: "الوصف (عربي)" },
    kind: "text",
    aliases: ["description ar", "الوصف", "التفاصيل"],
  },
  {
    id: "categoryId",
    label: { en: "Category", ar: "الفئة" },
    kind: "text",
    aliases: ["category", "category id", "collection", "الفئة", "القسم", "التصنيف"],
    requiredForCreate: true,
  },
  {
    id: "price",
    label: { en: "Price", ar: "السعر" },
    kind: "number",
    aliases: ["price", "unit price", "selling price", "السعر", "سعر البيع", "القيمة"],
    requiredForCreate: true,
  },
  {
    id: "compareAtPrice",
    label: { en: "Was-price", ar: "السعر قبل الخصم" },
    kind: "number",
    aliases: ["compare at price", "was price", "rrp", "list price", "السعر قبل الخصم", "السعر الاصلي"],
  },
  {
    id: "totalStock",
    label: { en: "Stock", ar: "المخزون" },
    kind: "number",
    aliases: ["stock", "quantity", "qty", "inventory", "on hand", "المخزون", "الكمية", "المتوفر"],
  },
  {
    id: "sku",
    label: { en: "Product code", ar: "رمز المنتج" },
    kind: "text",
    aliases: ["sku", "code", "item code", "article", "رمز", "الرمز", "كود"],
  },
  {
    id: "gtin",
    label: { en: "Barcode", ar: "الباركود" },
    kind: "text",
    aliases: ["gtin", "barcode", "ean", "upc", "باركود", "الباركود"],
  },
  {
    id: "tags",
    label: { en: "Tags", ar: "الوسوم" },
    kind: "list",
    aliases: ["tags", "labels", "keywords", "الوسوم", "الكلمات المفتاحية"],
  },
  {
    id: "status",
    label: { en: "Status", ar: "الحالة" },
    kind: "enum",
    aliases: ["status", "state", "published", "الحالة"],
  },
  {
    id: "type",
    label: { en: "Type", ar: "النوع" },
    kind: "enum",
    aliases: ["type", "product type", "النوع", "نوع المنتج"],
  },
];

const FIELD_BY_ID = new Map(IMPORT_FIELDS.map((field) => [field.id, field]));

/** Fold a header for comparison: lowercase, no punctuation, Arabic normalised. */
export function foldHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[_\-./\\()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Guess which column is which.
 *
 * The guess is a starting point shown for correction, never applied on its
 * own. An importer that maps silently and gets one column wrong writes prices
 * into the stock field across the whole catalogue, and the merchant finds out
 * from the storefront.
 *
 * A field is claimed by the first column that matches it, so a file with both
 * "Name" and "Product Name" does not map both to the same field and lose one.
 */
export function autoMap(headers: string[]): (ImportFieldId | null)[] {
  const taken = new Set<ImportFieldId>();

  return headers.map((header) => {
    const folded = foldHeader(header);
    if (!folded) return null;

    for (const field of IMPORT_FIELDS) {
      if (taken.has(field.id)) continue;
      if (field.aliases.some((alias) => foldHeader(alias) === folded)) {
        taken.add(field.id);
        return field.id;
      }
    }

    // A looser pass only after every exact match has had its chance, so
    // "price" never loses to "compare at price" containing "price".
    for (const field of IMPORT_FIELDS) {
      if (taken.has(field.id)) continue;
      if (field.aliases.some((alias) => folded.includes(foldHeader(alias)))) {
        taken.add(field.id);
        return field.id;
      }
    }

    return null;
  });
}

/* -------------------------------------------------------------------------- */
/*  One row, checked                                                          */
/* -------------------------------------------------------------------------- */

export interface RowProblem {
  field: ImportFieldId | null;
  message: Localized;
}

export interface ParsedRow {
  /** 1-based line in the file as the merchant sees it, header counted. */
  line: number;
  values: Partial<Record<ImportFieldId, string | number | string[]>>;
  problems: RowProblem[];
}

const STATUSES = new Set(["active", "draft", "archived"]);
const TYPES = new Set(["simple", "variable"]);

/** Statuses as they are actually written in a spreadsheet. */
function readStatus(raw: string): string | undefined {
  const text = foldHeader(raw);
  if (!text) return undefined;
  if (["active", "published", "live", "on", "منشور", "معروض", "نشط"].includes(text)) return "active";
  if (["draft", "unpublished", "off", "مسودة"].includes(text)) return "draft";
  if (["archived", "retired", "مؤرشف", "مؤرشفة"].includes(text)) return "archived";
  return STATUSES.has(text) ? text : undefined;
}

/**
 * Turn one line of the file into values, and say what is wrong with it.
 *
 * Problems are collected rather than thrown on the first one: a merchant
 * fixing a 300-row file wants every problem in that row at once, not one per
 * round trip through the spreadsheet.
 */
export function parseRow(
  cells: string[],
  mapping: (ImportFieldId | null)[],
  line: number,
): ParsedRow {
  const values: ParsedRow["values"] = {};
  const problems: RowProblem[] = [];

  mapping.forEach((fieldId, index) => {
    if (!fieldId) return;
    const field = FIELD_BY_ID.get(fieldId);
    if (!field) return;

    const raw = (cells[index] ?? "").trim();
    if (!raw) return;

    switch (field.kind) {
      case "number": {
        const value = parseNumber(raw);
        if (value === undefined) {
          problems.push({
            field: fieldId,
            message: {
              en: `${field.label.en}: "${raw}" is not a number.`,
              ar: `${field.label.ar}: "${raw}" ليس رقمًا.`,
            },
          });
          return;
        }
        if (value < 0) {
          problems.push({
            field: fieldId,
            message: {
              en: `${field.label.en} cannot be negative.`,
              ar: `${field.label.ar} لا يمكن أن يكون سالبًا.`,
            },
          });
          return;
        }
        values[fieldId] = value;
        return;
      }

      case "list": {
        values[fieldId] = raw
          .split(/[,،|]/)
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean);
        return;
      }

      case "enum": {
        if (fieldId === "status") {
          const status = readStatus(raw);
          if (!status) {
            problems.push({
              field: fieldId,
              message: {
                en: `Status "${raw}" is not one we recognise. Use published, draft or archived.`,
                ar: `الحالة "${raw}" غير معروفة. استخدم منشور أو مسودة أو مؤرشف.`,
              },
            });
            return;
          }
          values[fieldId] = status;
          return;
        }
        const type = foldHeader(raw);
        if (!TYPES.has(type)) {
          problems.push({
            field: fieldId,
            message: {
              en: `Type "${raw}" is not one we recognise. Use simple or variable.`,
              ar: `النوع "${raw}" غير معروف. استخدم simple أو variable.`,
            },
          });
          return;
        }
        values[fieldId] = type;
        return;
      }

      default: {
        if (fieldId === "sku") values[fieldId] = normaliseSku(raw);
        else if (fieldId === "slug") values[fieldId] = slugFromCell(raw);
        else values[fieldId] = raw;
      }
    }
  });

  /*
   * A was-price at or below the price shows the customer a negative discount.
   * Caught here, in the preview, where it costs a spreadsheet edit — rather
   * than on the storefront, where it costs trust.
   */
  const price = values.price;
  const wasPrice = values.compareAtPrice;
  if (typeof price === "number" && typeof wasPrice === "number" && wasPrice <= price) {
    problems.push({
      field: "compareAtPrice",
      message: {
        en: `A was-price of ${wasPrice} is not above the price of ${price}.`,
        ar: `السعر قبل الخصم ${wasPrice} ليس أعلى من السعر ${price}.`,
      },
    });
  }

  return { line, values, problems };
}

/** A slug the URL can carry, from whatever the cell held. */
export function slugFromCell(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9؀-ۿ]+/g, "-")
    .replace(/^-|-$/g, "");
}

/* -------------------------------------------------------------------------- */
/*  The plan                                                                  */
/* -------------------------------------------------------------------------- */

export type RowAction = "create" | "update" | "error" | "duplicate";

export interface PlannedRow extends ParsedRow {
  action: RowAction;
  /** The product this row resolves to, when it is an update. */
  matchedId?: string;
  /** How it was matched, so the merchant can see why. */
  matchedBy?: "id" | "slug" | "sku";
  /** For a duplicate: the line earlier in the file that already claimed it. */
  duplicateOfLine?: number;
  /** Fields this update would actually change, with their before and after. */
  changes?: { field: ImportFieldId; from: unknown; to: unknown }[];
}

export interface ImportPlan {
  rows: PlannedRow[];
  creates: number;
  updates: number;
  errors: number;
  duplicates: number;
  /** Nothing to do: every row matched and changed nothing. */
  unchanged: number;
}

export interface ExistingProduct {
  id: string;
  slug?: string;
  sku?: string;
  title?: Localized;
  price?: number;
  compareAtPrice?: number;
  totalStock?: number;
  categoryId?: string;
  status?: Product["status"];
  tags?: string[];
  type?: Product["type"];
  gtin?: string;
  description?: Localized;
}

/** Which existing product a row is about, and how we know. */
function matchExisting(
  row: ParsedRow,
  byId: Map<string, ExistingProduct>,
  bySlug: Map<string, ExistingProduct>,
  bySku: Map<string, ExistingProduct>,
): { product: ExistingProduct; by: "id" | "slug" | "sku" } | undefined {
  /*
   * In this order, deliberately. An id is exact. A slug is the product's
   * address and is unique by construction. An SKU is a supplier's code and is
   * the one most likely to be reused across two products by accident, so it is
   * the last resort rather than the first.
   */
  const id = row.values.id;
  if (typeof id === "string" && byId.has(id)) {
    return { product: byId.get(id)!, by: "id" };
  }
  const slug = row.values.slug;
  if (typeof slug === "string" && bySlug.has(slug)) {
    return { product: bySlug.get(slug)!, by: "slug" };
  }
  const sku = row.values.sku;
  if (typeof sku === "string" && sku && bySku.has(sku)) {
    return { product: bySku.get(sku)!, by: "sku" };
  }
  return undefined;
}

/** The key a row claims, used to spot the same product twice in one file. */
export function rowKey(row: ParsedRow): string | undefined {
  const id = row.values.id;
  if (typeof id === "string" && id) return `id:${id}`;
  const slug = row.values.slug;
  if (typeof slug === "string" && slug) return `slug:${slug}`;
  const sku = row.values.sku;
  if (typeof sku === "string" && sku) return `sku:${sku}`;
  return undefined;
}

const COMPARABLE: { field: ImportFieldId; read: (p: ExistingProduct) => unknown }[] = [
  { field: "titleEn", read: (p) => p.title?.en },
  { field: "titleAr", read: (p) => p.title?.ar },
  { field: "descriptionEn", read: (p) => p.description?.en },
  { field: "descriptionAr", read: (p) => p.description?.ar },
  { field: "slug", read: (p) => p.slug },
  { field: "categoryId", read: (p) => p.categoryId },
  { field: "price", read: (p) => p.price },
  { field: "compareAtPrice", read: (p) => p.compareAtPrice },
  { field: "totalStock", read: (p) => p.totalStock },
  { field: "sku", read: (p) => p.sku },
  { field: "gtin", read: (p) => p.gtin },
  { field: "status", read: (p) => p.status },
  { field: "type", read: (p) => p.type },
  { field: "tags", read: (p) => p.tags },
];

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => value === b[i]);
  }
  return a === b;
}

/**
 * Resolve every row against the catalogue, before anything is written.
 *
 * The output is what the merchant is shown and then approves. Three things it
 * is careful about:
 *
 * **A row that changes nothing is not an update.** Re-importing yesterday's
 * file should report "nothing to do", not rewrite 300 products — each of which
 * would move `updatedAt`, invalidate every open editor's conflict check, and
 * fill the audit log with changes that changed nothing.
 *
 * **The second mention of a product in one file is a duplicate, not a second
 * update.** Applying both means the last one silently wins, and which one is
 * last depends on the order somebody's spreadsheet happened to be sorted in.
 *
 * **A row with any problem is an error and is not counted as anything else.**
 * Importing the good half of a broken row is how a product ends up with a name
 * and no price.
 */
export function planImport(rows: ParsedRow[], existing: ExistingProduct[]): ImportPlan {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const bySlug = new Map(existing.filter((p) => p.slug).map((p) => [p.slug!, p]));
  const bySku = new Map(existing.filter((p) => p.sku).map((p) => [p.sku!, p]));

  const claimed = new Map<string, number>();
  const planned: PlannedRow[] = [];

  for (const row of rows) {
    const problems = [...row.problems];

    const key = rowKey(row);
    if (key && claimed.has(key)) {
      planned.push({
        ...row,
        problems,
        action: "duplicate",
        duplicateOfLine: claimed.get(key),
      });
      continue;
    }

    const match = matchExisting(row, byId, bySlug, bySku);

    if (!match) {
      // Creating needs enough to be a product at all. Updating does not: a
      // file that is only "code, new price" is a perfectly good price list.
      for (const field of IMPORT_FIELDS) {
        if (!field.requiredForCreate) continue;
        const value = row.values[field.id];
        if (value === undefined || value === "" || value === null) {
          problems.push({
            field: field.id,
            message: {
              en: `${field.label.en} is needed to create a new product.`,
              ar: `${field.label.ar} مطلوب لإنشاء منتج جديد.`,
            },
          });
        }
      }
    }

    if (problems.length > 0) {
      planned.push({ ...row, problems, action: "error" });
      continue;
    }

    if (key) claimed.set(key, row.line);

    if (!match) {
      planned.push({ ...row, problems, action: "create" });
      continue;
    }

    const changes: PlannedRow["changes"] = [];
    for (const { field, read } of COMPARABLE) {
      const incoming = row.values[field];
      if (incoming === undefined) continue;
      const current = read(match.product);
      if (!same(current, incoming)) changes.push({ field, from: current, to: incoming });
    }

    planned.push({
      ...row,
      problems,
      action: "update",
      matchedId: match.product.id,
      matchedBy: match.by,
      changes,
    });
  }

  return {
    rows: planned,
    creates: planned.filter((row) => row.action === "create").length,
    updates: planned.filter((row) => row.action === "update" && (row.changes?.length ?? 0) > 0)
      .length,
    unchanged: planned.filter((row) => row.action === "update" && (row.changes?.length ?? 0) === 0)
      .length,
    errors: planned.filter((row) => row.action === "error").length,
    duplicates: planned.filter((row) => row.action === "duplicate").length,
  };
}

/**
 * The document fields one planned row writes.
 *
 * Only what the file actually carried: a column the merchant did not include
 * must not be written as empty. An importer that sends `description: ""` for a
 * price-list file erases every description in the catalogue.
 */
export function productPatch(row: PlannedRow, existing?: ExistingProduct): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const v = row.values;

  if (v.titleEn !== undefined || v.titleAr !== undefined) {
    patch.title = {
      en: (v.titleEn as string) ?? existing?.title?.en ?? "",
      ar: (v.titleAr as string) ?? existing?.title?.ar ?? "",
    };
  }
  if (v.descriptionEn !== undefined || v.descriptionAr !== undefined) {
    patch.description = {
      en: (v.descriptionEn as string) ?? existing?.description?.en ?? "",
      ar: (v.descriptionAr as string) ?? existing?.description?.ar ?? "",
    };
  }
  if (v.slug !== undefined) patch.slug = v.slug;
  if (v.categoryId !== undefined) patch.categoryId = v.categoryId;
  if (v.price !== undefined) patch.price = v.price;
  if (v.compareAtPrice !== undefined) patch.compareAtPrice = v.compareAtPrice;
  if (v.sku !== undefined) patch.sku = v.sku;
  if (v.gtin !== undefined) patch.gtin = v.gtin;
  if (v.tags !== undefined) patch.tags = v.tags;
  if (v.status !== undefined) patch.status = v.status;
  if (v.type !== undefined) patch.type = v.type;

  /*
   * Stock carries `inStock` with it, always. They are two fields describing
   * one fact, and a listing reads `inStock` — so importing a count of zero
   * without it leaves the product offered for sale with nothing behind it.
   */
  if (v.totalStock !== undefined) {
    patch.totalStock = v.totalStock;
    patch.inStock = (v.totalStock as number) > 0;
  }

  return patch;
}

/** The columns an export writes, which an import reads back unchanged. */
export const TEMPLATE_HEADERS: ImportFieldId[] = [
  "id",
  "slug",
  "titleEn",
  "titleAr",
  "categoryId",
  "price",
  "compareAtPrice",
  "totalStock",
  "sku",
  "gtin",
  "tags",
  "status",
  "type",
];
