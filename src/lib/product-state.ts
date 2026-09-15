import type { Localized, Product } from "@/types";

/**
 * What a merchant can do to a product's state, and what each action is allowed
 * to touch.
 *
 * Three things were being conflated, and every confusing bug in this area came
 * from treating them as one switch:
 *
 *   1. **Publication** — draft, published, archived. Where the product is in
 *      its life, and whether it exists for shoppers at all.
 *   2. **Display** — visible or hidden. Whether a *published* product is on
 *      the shopfront right now. A winter coat in July is published and hidden.
 *   3. **Sale** — automatic (follow the stock count) or stopped by hand.
 *      Whether a *visible* product can be bought.
 *
 * Keeping them apart is what lets "move to the warehouse" leave stock alone,
 * "sold out" leave the stock record intact, and "back on sale" not silently
 * undo a deliberate manual stop.
 *
 * Every rule here is pure so it can be tested without a database, and the
 * route applies them rather than re-deciding them.
 */

export type ProductAction =
  | "draft"
  | "publish"
  | "sold-out"
  | "restock"
  | "warehouse"
  | "shopfront"
  | "archive"
  | "restore";

/** The patch an action produces. Only the fields it is allowed to touch. */
export interface StatePatch {
  status?: Product["status"];
  visibility?: "visible" | "hidden";
  saleState?: "auto" | "sold-out";
  /** Set when the action is a deliberate override of a schedule. */
  visibilityOverride?: boolean;
}

export type Refusal =
  | "incomplete"
  | "already"
  | "no-stock"
  | "archived"
  | "unknown-action";

export interface ActionResult {
  ok: boolean;
  patch?: StatePatch;
  reason?: Refusal;
  message: Localized;
}

function no(reason: Refusal, en: string, ar: string): ActionResult {
  return { ok: false, reason, message: { en, ar } };
}

function yes(patch: StatePatch): ActionResult {
  return { ok: true, patch, message: { en: "", ar: "" } };
}

/* -------------------------------------------------------------------------- */
/*  Publishing                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What a product must have before it can be published.
 *
 * Deliberately **not** enforced on save: a merchant writing a product over two
 * sittings must be able to keep a half-finished draft. The requirement lands
 * at the moment it starts costing something — when a shopper could see it.
 *
 * Returns field names, not sentences, so the caller can render them in either
 * language and highlight the fields themselves.
 */
export function publishBlockers(product: Partial<Product>): string[] {
  const missing: string[] = [];

  if (!product.title?.en?.trim()) missing.push("title.en");
  if (!product.title?.ar?.trim()) missing.push("title.ar");
  if (!product.slug?.trim()) missing.push("slug");
  if (!product.categoryId?.trim()) missing.push("categoryId");
  if (!(typeof product.price === "number" && product.price > 0)) missing.push("price");
  if (!product.images || product.images.length === 0) missing.push("images");

  /*
   * A variable product with no sellable permutation is a page with a buy
   * button that cannot resolve to anything. The count is what matters, not the
   * stock in them — publishing something that is sold out is legitimate.
   */
  if (product.type === "variable") {
    const colours = product.colors?.length ?? 0;
    const sizes = product.sizes?.length ?? 0;
    if (colours === 0) missing.push("colors");
    if (sizes === 0) missing.push("sizes");
  }

  return missing;
}

export function canPublish(product: Partial<Product>): boolean {
  return publishBlockers(product).length === 0;
}

/* -------------------------------------------------------------------------- */
/*  Stock roll-up                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Units available across every sellable permutation.
 *
 * Counted from the variants rather than read from `totalStock`, because that
 * field is a cached aggregate: the point of this function is to decide whether
 * the aggregate is still true.
 */
export function sellableUnits(product: Pick<Product, "variants" | "totalStock">): number {
  const variants = product.variants ?? [];
  if (variants.length === 0) return Math.max(0, product.totalStock ?? 0);
  return variants.reduce((sum, v) => sum + Math.max(0, v.stock ?? 0), 0);
}

/**
 * Is every permutation out?
 *
 * One size selling out must not stop the others — that is the difference
 * between a sold-out *variant* and a sold-out *product*, and collapsing them
 * is how a shop stops selling the eleven sizes it still has.
 */
export function allVariantsOut(product: Pick<Product, "variants" | "totalStock">): boolean {
  return sellableUnits(product) <= 0;
}

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Work out what an action does to a product, or why it cannot.
 *
 * The refusals are the interesting part; each one exists because the obvious
 * implementation does something the merchant did not ask for.
 */
export function applyAction(product: Product, action: ProductAction): ActionResult {
  const status = product.status;
  const visibility = product.visibility ?? "visible";
  const saleState = product.saleState ?? "auto";

  switch (action) {
    case "draft":
      if (status === "draft") {
        return no("already", "Already a draft.", "مسودة بالفعل.");
      }
      /*
       * Stock, images, reviews and order history are untouched. Unpublishing
       * is a statement about display, not a reason to destroy a real count
       * that has to come back.
       */
      return yes({ status: "draft" });

    case "publish": {
      const missing = publishBlockers(product);
      if (missing.length > 0) {
        return no(
          "incomplete",
          `Cannot publish — missing: ${missing.join(", ")}.`,
          `لا يمكن النشر — ناقص: ${missing.join("، ")}.`,
        );
      }
      if (status === "active") {
        return no("already", "Already published.", "منشور بالفعل.");
      }
      return yes({ status: "active" });
    }

    case "sold-out":
      if (saleState === "sold-out") {
        return no("already", "Already stopped.", "موقوف بالفعل.");
      }
      /*
       * A manual stop, kept apart from the stock count on purpose. Zeroing the
       * quantity to stop sales destroys the number a merchant needs back, and
       * it lies to every stock report. This says "do not sell" and nothing
       * else; correcting a count to zero is a separate stock action.
       */
      return yes({ saleState: "sold-out" });

    case "restock": {
      if (saleState !== "sold-out") {
        return no("already", "Already on sale.", "معروض للبيع بالفعل.");
      }
      /*
       * Lifting the manual stop does not conjure stock. If the shelves are
       * genuinely empty the product goes straight back to reading as out of
       * stock — which is true — rather than offering units that do not exist.
       */
      if (allVariantsOut(product)) {
        return no(
          "no-stock",
          "Nothing in stock — add units before putting it back on sale.",
          "لا يوجد مخزون — أضف كميات قبل إعادته للبيع.",
        );
      }
      return yes({ saleState: "auto" });
    }

    case "warehouse":
      if (visibility === "hidden") {
        return no("already", "Already in the warehouse.", "في المستودع بالفعل.");
      }
      /*
       * `visibilityOverride` marks this as a decision by a person, so a
       * schedule set last season cannot put it back on the shopfront an hour
       * later without anybody understanding why.
       */
      return yes({ visibility: "hidden", visibilityOverride: true });

    case "shopfront": {
      if (status === "archived") {
        return no(
          "archived",
          "Archived products are restored first, then published.",
          "المنتجات المؤرشفة تُستعاد أولاً ثم تُنشر.",
        );
      }
      /*
       * Returning something to the shopfront must not publish a draft that was
       * never finished. Display and publication are different axes, and this
       * action only moves one of them.
       */
      if (status === "draft") {
        return no(
          "incomplete",
          "This is a draft — publish it rather than returning it to display.",
          "هذه مسودة — انشرها بدل إعادتها إلى العرض.",
        );
      }
      if (visibility === "visible") {
        return no("already", "Already on the shopfront.", "على الواجهة بالفعل.");
      }
      return yes({ visibility: "visible", visibilityOverride: true });
    }

    case "archive":
      if (status === "archived") {
        return no("already", "Already archived.", "مؤرشف بالفعل.");
      }
      // Kept, not deleted: old orders and invoices still have to resolve it.
      return yes({ status: "archived" });

    case "restore":
      if (status !== "archived") {
        return no("already", "Not archived.", "ليس مؤرشفاً.");
      }
      /*
       * Restores to *draft*, never straight to published. Whatever caused the
       * archiving deserves a look before the product is on sale again, and
       * publishing is one more deliberate click away.
       */
      return yes({ status: "draft" });

    default:
      return no("unknown-action", "Unknown action.", "إجراء غير معروف.");
  }
}

/** Human names for the actions, for buttons and for the audit log. */
export const ACTION_LABELS: Record<ProductAction, Localized> = {
  draft: { en: "Move to draft", ar: "تحويل إلى مسودة" },
  publish: { en: "Publish", ar: "نشر" },
  "sold-out": { en: "Stop selling", ar: "إيقاف البيع" },
  restock: { en: "Back on sale", ar: "إعادة التوفر" },
  warehouse: { en: "Move to warehouse", ar: "نقل إلى المستودع" },
  shopfront: { en: "Return to shopfront", ar: "إعادة إلى العرض" },
  archive: { en: "Archive", ar: "أرشفة" },
  restore: { en: "Restore", ar: "استعادة" },
};

export const ACTIONS = Object.keys(ACTION_LABELS) as ProductAction[];

export function isProductAction(value: unknown): value is ProductAction {
  return typeof value === "string" && (ACTIONS as string[]).includes(value);
}
