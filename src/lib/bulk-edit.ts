import type { Localized, Product } from "@/types";

/**
 * Editing many products at once, and editing one without opening it.
 *
 * Both are the same operation with a different number of ids, so they share
 * one set of rules. The rules are the reason this is a module rather than a
 * few lines in a route: a bulk edit is the single most destructive thing a
 * merchant can do by accident, because the mistake is applied thirty times
 * before anybody sees the result.
 *
 * Everything here is pure. The route reads the stored products, asks this what
 * each one becomes, and writes only what it is told.
 */

export type EditField =
  | "price"
  | "compareAtPrice"
  | "totalStock"
  | "categoryId"
  | "shippingClassId"
  | "tags"
  | "slug";

export type EditMode = "set" | "increase" | "decrease" | "clear" | "add" | "remove";

export interface Edit {
  field: EditField;
  mode: EditMode;
  /** A number for money and stock, a string for ids, a comma list for tags. */
  value?: string | number;
}

export interface EditOutcome {
  id: string;
  ok: boolean;
  /** What to write. Absent when refused, or when nothing would change. */
  patch?: Partial<Product>;
  reason?: string;
  reasonAr?: string;
}

/**
 * The largest proportional price move a bulk edit will make.
 *
 * Not a technical limit — a guard against the decimal point. "Reduce by 50" on
 * a sale is routine; "reduce by 500" is a typo that prices forty products at
 * zero, and the shop finds out when the orders arrive. Past this the merchant
 * is asked to do it product by product, where they see each new price.
 */
export const MAX_PERCENT_CHANGE = 60;

/** Fields whose value is unique per product, so bulk-setting them collides. */
const SINGLE_ONLY: EditField[] = ["slug"];

/** The merchant-facing name of each field, used in the messages below. */
export const FIELD_LABELS: Record<EditField, { en: string; ar: string }> = {
  price: { en: "Price", ar: "السعر" },
  compareAtPrice: { en: "Was-price", ar: "السعر قبل الخصم" },
  totalStock: { en: "Stock", ar: "المخزون" },
  categoryId: { en: "Category", ar: "الفئة" },
  shippingClassId: { en: "Shipping class", ar: "فئة الشحن" },
  tags: { en: "Tags", ar: "الوسوم" },
  slug: { en: "Slug", ar: "الرابط" },
};

/* -------------------------------------------------------------------------- */
/*  Validating the instruction itself                                         */
/* -------------------------------------------------------------------------- */

/**
 * Problems with the edit before any product is read.
 *
 * Checked first so a malformed instruction fails once with a clear message,
 * rather than producing thirty identical refusals the merchant has to read
 * through to find out they typed a letter into the price box.
 */
export function editProblems(edit: Edit, idCount: number): Localized[] {
  const problems: Localized[] = [];
  const name = FIELD_LABELS[edit.field] ?? { en: edit.field, ar: edit.field };

  if (SINGLE_ONLY.includes(edit.field) && idCount > 1) {
    problems.push({
      en: `${name.en} is unique to one product and cannot be set on several at once.`,
      ar: `${name.ar} خاص بمنتج واحد ولا يمكن ضبطه على عدة منتجات معًا.`,
    });
  }

  const numeric =
    edit.field === "price" || edit.field === "compareAtPrice" || edit.field === "totalStock";

  if (numeric && edit.mode !== "clear") {
    const value = Number(edit.value);
    if (!Number.isFinite(value)) {
      problems.push({ en: `${name.en} needs a number.`, ar: `${name.ar} يحتاج رقمًا.` });
    } else if (edit.mode === "increase" || edit.mode === "decrease") {
      if (value <= 0) {
        problems.push({
          en: "A percentage change has to be more than zero.",
          ar: "نسبة التغيير يجب أن تكون أكبر من صفر.",
        });
      } else if (value > MAX_PERCENT_CHANGE) {
        problems.push({
          en: `A change of ${value}% is more than this screen will apply. Do it product by product.`,
          ar: `تغيير بنسبة ${value}% أكبر مما تطبّقه هذه الشاشة. نفّذه منتجًا منتجًا.`,
        });
      }
    } else if (value < 0) {
      problems.push({ en: `${name.en} cannot be negative.`, ar: `${name.ar} لا يمكن أن يكون سالبًا.` });
    }
  }

  if (edit.mode === "clear" && edit.field === "price") {
    problems.push({ en: "A product has to have a price.", ar: "كل منتج يجب أن يكون له سعر." });
  }

  if ((edit.field === "categoryId" || edit.field === "slug") && edit.mode !== "set") {
    problems.push({
      en: `${name.en} can only be set, not adjusted.`,
      ar: `${name.ar} يُضبط فقط ولا يُعدّل بنسبة.`,
    });
  }

  if (edit.field === "tags" && !["add", "remove", "set"].includes(edit.mode)) {
    problems.push({
      en: "Tags can be added, removed or replaced.",
      ar: "الوسوم تُضاف أو تُزال أو تُستبدل.",
    });
  }

  if (
    (edit.mode === "set" || edit.mode === "add" || edit.mode === "remove") &&
    !numeric &&
    edit.field !== "shippingClassId" &&
    String(edit.value ?? "").trim() === ""
  ) {
    problems.push({ en: `${name.en} needs a value.`, ar: `${name.ar} يحتاج قيمة.` });
  }

  return problems;
}

/* -------------------------------------------------------------------------- */
/*  Applying one edit to one product                                          */
/* -------------------------------------------------------------------------- */

function refuse(id: string, en: string, ar: string): EditOutcome {
  return { id, ok: false, reason: en, reasonAr: ar };
}

/** Round to the currency's own minor unit, so no write can produce 11.999999. */
export function roundMoney(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function adjusted(current: number, edit: Edit): number {
  const value = Number(edit.value);
  if (edit.mode === "increase") return roundMoney(current * (1 + value / 100));
  if (edit.mode === "decrease") return roundMoney(current * (1 - value / 100));
  return roundMoney(value);
}

function parseTags(value: string | number | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * What one product becomes under one edit.
 *
 * Returns no patch — rather than an empty one — when the product is already in
 * the state asked for. A write that changes nothing still moves `updatedAt`,
 * which invalidates every open editor's conflict check and fills the audit log
 * with edits that edited nothing.
 */
export function applyEdit(product: Product, edit: Edit): EditOutcome {
  const id = product.id;

  switch (edit.field) {
    case "price": {
      const next = adjusted(product.price, edit);
      if (next <= 0) {
        return refuse(
          id,
          "That would price the product at zero or less.",
          "هذا سيجعل سعر المنتج صفرًا أو أقل.",
        );
      }
      /*
       * A was-price below the new price shows the customer a negative
       * discount. Clearing it silently would hide a sale the merchant set up;
       * refusing tells them the two prices now disagree.
       */
      if (product.compareAtPrice && product.compareAtPrice <= next) {
        return refuse(
          id,
          `The was-price (${product.compareAtPrice}) is no longer above the new price. Clear or raise it first.`,
          `السعر قبل الخصم (${product.compareAtPrice}) لم يعد أعلى من السعر الجديد. امسحه أو ارفعه أولًا.`,
        );
      }
      if (next === product.price) return { id, ok: true };
      return { id, ok: true, patch: { price: next } };
    }

    case "compareAtPrice": {
      if (edit.mode === "clear") {
        if (product.compareAtPrice === undefined) return { id, ok: true };
        return { id, ok: true, patch: { compareAtPrice: undefined } };
      }
      const next = adjusted(product.compareAtPrice ?? product.price, edit);
      if (next <= product.price) {
        return refuse(
          id,
          `A was-price of ${next} is not above the price of ${product.price}, so it would show as a negative discount.`,
          `السعر قبل الخصم ${next} ليس أعلى من السعر ${product.price}، وسيظهر كخصم سالب.`,
        );
      }
      if (next === product.compareAtPrice) return { id, ok: true };
      return { id, ok: true, patch: { compareAtPrice: next } };
    }

    case "totalStock": {
      /*
       * Refused on a variable product, on purpose.
       *
       * Its total is the sum of its variant rows. Writing a number over the
       * top makes the product claim stock that no size actually has — the
       * exact invented-average bug the variant grid was built to kill. The
       * grid is where those numbers are edited.
       */
      if (product.type === "variable" && (product.variants?.length ?? 0) > 0) {
        return refuse(
          id,
          "This product's stock comes from its size and colour rows. Edit it in the product's own options table.",
          "مخزون هذا المنتج يأتي من صفوف المقاسات والألوان. عدّله في جدول خيارات المنتج.",
        );
      }
      const next = Math.max(0, Math.round(Number(edit.value)));
      if (next === product.totalStock) return { id, ok: true };
      return { id, ok: true, patch: { totalStock: next, inStock: next > 0 } };
    }

    case "categoryId": {
      const next = String(edit.value ?? "").trim();
      if (next === product.categoryId) return { id, ok: true };
      // `categoryPath` is denormalised ancestry and is recomputed by the route,
      // which is the only place that can see the category tree.
      return { id, ok: true, patch: { categoryId: next } };
    }

    case "shippingClassId": {
      const next = String(edit.value ?? "").trim();
      if (edit.mode === "clear" || next === "") {
        if (!product.shippingClassId) return { id, ok: true };
        return { id, ok: true, patch: { shippingClassId: undefined } };
      }
      if (next === product.shippingClassId) return { id, ok: true };
      return { id, ok: true, patch: { shippingClassId: next } };
    }

    case "tags": {
      const incoming = parseTags(edit.value);
      const current = product.tags ?? [];
      let next: string[];

      if (edit.mode === "add") next = [...new Set([...current, ...incoming])];
      else if (edit.mode === "remove") next = current.filter((tag) => !incoming.includes(tag));
      else next = [...new Set(incoming)];

      if (next.length === current.length && next.every((tag, i) => tag === current[i])) {
        return { id, ok: true };
      }
      return { id, ok: true, patch: { tags: next } };
    }

    case "slug": {
      const next = String(edit.value ?? "").trim().toLowerCase();
      if (!/^[a-z0-9-]+$/.test(next)) {
        return refuse(
          id,
          "A slug is lowercase letters, numbers and hyphens.",
          "الرابط يتكوّن من حروف صغيرة وأرقام وشرطات فقط.",
        );
      }
      if (next === product.slug) return { id, ok: true };
      return { id, ok: true, patch: { slug: next } };
    }

    default:
      return refuse(id, "Unknown field.", "حقل غير معروف.");
  }
}

/** Apply several edits to one product, stopping at the first refusal. */
export function applyEdits(product: Product, edits: Edit[]): EditOutcome {
  const patch: Partial<Product> = {};
  /*
   * Each edit sees the product as the previous ones left it, so raising the
   * price and then the was-price in one action is checked against the new
   * price rather than the stored one.
   */
  let working = product;

  for (const edit of edits) {
    const outcome = applyEdit(working, edit);
    if (!outcome.ok) return outcome;
    if (outcome.patch) {
      Object.assign(patch, outcome.patch);
      working = { ...working, ...outcome.patch };
    }
  }

  return Object.keys(patch).length > 0
    ? { id: product.id, ok: true, patch }
    : { id: product.id, ok: true };
}

