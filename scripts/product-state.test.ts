import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  ACTIONS,
  allVariantsOut,
  applyAction,
  canPublish,
  publishBlockers,
  sellableUnits,
} from "../src/lib/product-state";
import { isPurchasable, isShoppable, storefrontState } from "../src/lib/visibility";
import type { Product } from "../src/types";

/**
 * The three axes of a product's state, and the refusals that keep them apart.
 *
 * Every refusal below exists because the obvious implementation quietly does
 * something the merchant did not ask for — publishes a half-written draft,
 * throws away a stock count, or undoes a deliberate decision.
 *
 * Run with:
 *
 *     npm run test:product-state
 */

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    slug: "cotton-tee",
    title: { en: "Cotton tee", ar: "تي شيرت قطن" },
    description: { en: "", ar: "" },
    categoryId: "tees",
    type: "variable",
    price: 12,
    currency: "JOD",
    images: [{ url: "/a.jpg", alt: "a", width: 800, height: 1000 }],
    colors: [{ id: "white", name: { en: "White", ar: "أبيض" }, hex: "#fff" }],
    sizes: [{ id: "m", label: "M" }],
    variants: [{ sku: "TEE-WHT-M", colorId: "white", sizeId: "m", stock: 5 }],
    tags: [],
    badges: [],
    inStock: true,
    totalStock: 5,
    status: "active",
    publishedAt: 0,
    updatedAt: 0,
    ...over,
  } as Product;
}

/* -------------------------------------------------------------------------- */
/*  Publishing                                                                */
/* -------------------------------------------------------------------------- */

describe("publish preconditions", () => {
  test("a complete product can be published", () => {
    assert.equal(canPublish(product()), true);
    assert.deepEqual(publishBlockers(product()), []);
  });

  test("each missing essential is named, not summarised", () => {
    /*
     * Field names rather than a sentence: the merchant has to know *which*
     * box to fill, and "this product is incomplete" sends them hunting.
     */
    assert.deepEqual(publishBlockers(product({ title: { en: "", ar: "قطن" } })), ["title.en"]);
    assert.deepEqual(publishBlockers(product({ title: { en: "Tee", ar: "" } })), ["title.ar"]);
    assert.deepEqual(publishBlockers(product({ images: [] })), ["images"]);
    assert.deepEqual(publishBlockers(product({ price: 0 })), ["price"]);
    assert.deepEqual(publishBlockers(product({ categoryId: "" })), ["categoryId"]);
  });

  test("a variable product needs colours and sizes; a simple one does not", () => {
    assert.deepEqual(publishBlockers(product({ colors: [], sizes: [] })), ["colors", "sizes"]);
    assert.deepEqual(publishBlockers(product({ type: "simple", colors: [], sizes: [] })), []);
  });

  test("being sold out does not block publishing", () => {
    // Publishing something that is out of stock is normal — the page is the
    // point, and "sold out" is information a shopper came for.
    const empty = product({ variants: [], totalStock: 0, inStock: false });
    assert.equal(canPublish(empty), true);
  });

  test("an incomplete draft is refused, with the reason", () => {
    const draft = product({ status: "draft", title: { en: "Tee", ar: "" }, images: [] });
    const result = applyAction(draft, "publish");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "incomplete");
    assert.equal(result.message.en.includes("title.ar"), true);
    assert.equal(result.message.ar.length > 0, true);
  });

  test("a complete draft publishes", () => {
    const result = applyAction(product({ status: "draft" }), "publish");
    assert.equal(result.ok, true);
    assert.deepEqual(result.patch, { status: "active" });
  });
});

/* -------------------------------------------------------------------------- */
/*  The three axes stay apart                                                 */
/* -------------------------------------------------------------------------- */

describe("moving to draft", () => {
  test("keeps stock, images and history", () => {
    /*
     * The patch is the whole assertion: unpublishing is a statement about
     * display, and anything else in this object would be data destroyed as a
     * side effect.
     */
    const result = applyAction(product(), "draft");
    assert.equal(result.ok, true);
    assert.deepEqual(result.patch, { status: "draft" });
  });

  test("a draft is neither shoppable nor purchasable", () => {
    const draft = product({ status: "draft" });
    assert.equal(storefrontState(draft), "draft");
    assert.equal(isShoppable(draft), false);
    assert.equal(isPurchasable(draft), false);
  });
});

describe("the warehouse", () => {
  test("hiding never touches the quantity", () => {
    const result = applyAction(product(), "warehouse");
    assert.equal(result.ok, true);
    assert.deepEqual(result.patch, { visibility: "hidden", visibilityOverride: true });
    assert.equal("totalStock" in (result.patch ?? {}), false);
  });

  test("returning to the shopfront does not publish a draft", () => {
    /*
     * Display and publication are different axes. "Put it back on the
     * shopfront" must not quietly push an unfinished product live.
     */
    const draft = product({ status: "draft", visibility: "hidden" });
    const result = applyAction(draft, "shopfront");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "incomplete");
  });

  test("an archived product is restored before it is displayed", () => {
    const archived = product({ status: "archived", visibility: "hidden" });
    assert.equal(applyAction(archived, "shopfront").reason, "archived");
  });

  test("restore goes to draft, never straight to published", () => {
    const result = applyAction(product({ status: "archived" }), "restore");
    assert.equal(result.ok, true);
    assert.deepEqual(result.patch, { status: "draft" });
  });
});

/* -------------------------------------------------------------------------- */
/*  Selling                                                                   */
/* -------------------------------------------------------------------------- */

describe("stopping and resuming sales", () => {
  test("a manual stop leaves the stock record alone", () => {
    const result = applyAction(product(), "sold-out");
    assert.equal(result.ok, true);
    assert.deepEqual(result.patch, { saleState: "sold-out" });
  });

  test("a stopped product reads as stopped, not as out of stock", () => {
    /*
     * The distinction customers see. Claiming the stock is gone when the
     * shelves are full is a lie the shop then has to keep telling.
     */
    const stopped = product({ saleState: "sold-out", totalStock: 40, inStock: true });
    assert.equal(storefrontState(stopped), "sold-out");
    assert.equal(isPurchasable(stopped), false);
    // Its page still works — the link is valid and the state is information.
    assert.equal(isShoppable(stopped), true);
  });

  test("resuming refuses when there is genuinely nothing to sell", () => {
    const empty = product({
      saleState: "sold-out",
      variants: [{ sku: "TEE-WHT-M", colorId: "white", sizeId: "m", stock: 0 }],
      totalStock: 0,
      inStock: false,
    });
    const result = applyAction(empty, "restock");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no-stock");
  });

  test("resuming works when stock exists", () => {
    const stopped = product({ saleState: "sold-out" });
    assert.deepEqual(applyAction(stopped, "restock").patch, { saleState: "auto" });
  });

  test("resuming a product that was never stopped is refused, not a no-op write", () => {
    // Otherwise a bulk "back on sale" would clear manual stops it never set.
    assert.equal(applyAction(product(), "restock").reason, "already");
  });
});

describe("variant roll-up", () => {
  test("one size selling out leaves the others buyable", () => {
    const partial = product({
      variants: [
        { sku: "A", colorId: "white", sizeId: "m", stock: 0 },
        { sku: "B", colorId: "white", sizeId: "l", stock: 3 },
      ],
      totalStock: 3,
      inStock: true,
    });
    assert.equal(allVariantsOut(partial), false);
    assert.equal(sellableUnits(partial), 3);
    assert.equal(storefrontState(partial), "live");
    assert.equal(isPurchasable(partial), true);
  });

  test("every variant out means the product is out", () => {
    const gone = product({
      variants: [
        { sku: "A", colorId: "white", sizeId: "m", stock: 0 },
        { sku: "B", colorId: "white", sizeId: "l", stock: 0 },
      ],
      totalStock: 0,
      inStock: false,
    });
    assert.equal(allVariantsOut(gone), true);
    assert.equal(storefrontState(gone), "out-of-stock");
    assert.equal(isPurchasable(gone), false);
  });

  test("a negative count never adds to the total", () => {
    const odd = product({
      variants: [
        { sku: "A", colorId: "white", sizeId: "m", stock: -5 },
        { sku: "B", colorId: "white", sizeId: "l", stock: 2 },
      ],
    });
    assert.equal(sellableUnits(odd), 2);
  });

  test("a simple product with no variants falls back to its own count", () => {
    const simple = product({ type: "simple", variants: [], totalStock: 7 });
    assert.equal(sellableUnits(simple), 7);
    assert.equal(allVariantsOut(simple), false);
  });
});

/* -------------------------------------------------------------------------- */
/*  Order of precedence                                                       */
/* -------------------------------------------------------------------------- */

describe("which state wins", () => {
  test("hidden beats a manual stop, which beats an empty shelf", () => {
    /*
     * The order matters for what the merchant is told. A hidden product that
     * is also stopped should read "hidden" — that is the thing to undo first.
     */
    const hiddenAndStopped = product({
      visibility: "hidden",
      saleState: "sold-out",
      totalStock: 0,
      inStock: false,
    });
    assert.equal(storefrontState(hiddenAndStopped), "hidden");

    const stoppedAndEmpty = product({ saleState: "sold-out", totalStock: 0, inStock: false });
    assert.equal(storefrontState(stoppedAndEmpty), "sold-out");
  });

  test("draft and archived beat everything", () => {
    assert.equal(storefrontState(product({ status: "draft", saleState: "sold-out" })), "draft");
    assert.equal(storefrontState(product({ status: "archived" })), "archived");
  });
});

describe("every action refuses a no-op rather than writing one", () => {
  test("acting twice is reported, not repeated", () => {
    // A silent second write would churn `updatedAt`, fill the audit log with
    // changes that changed nothing, and hide a real failure in a bulk run.
    assert.equal(applyAction(product({ status: "draft" }), "draft").reason, "already");
    assert.equal(applyAction(product(), "publish").reason, "already");
    assert.equal(applyAction(product({ visibility: "hidden" }), "warehouse").reason, "already");
    assert.equal(applyAction(product(), "shopfront").reason, "already");
    assert.equal(applyAction(product({ saleState: "sold-out" }), "sold-out").reason, "already");
    assert.equal(applyAction(product({ status: "archived" }), "archive").reason, "already");
    assert.equal(applyAction(product(), "restore").reason, "already");
  });

  test("every action is bilingual and answers something", () => {
    for (const action of ACTIONS) {
      const result = applyAction(product(), action);
      if (!result.ok) {
        assert.equal(result.message.en.length > 0, true, `${action} needs an English reason`);
        assert.equal(result.message.ar.length > 0, true, `${action} needs an Arabic reason`);
      }
    }
  });
});
