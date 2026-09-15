import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  MAX_PERCENT_CHANGE,
  applyEdit,
  applyEdits,
  editProblems,
  roundMoney,
  type Edit,
} from "../src/lib/bulk-edit";
import type { Product } from "../src/types";

/**
 * Editing thirty products at once, and the refusals that stop it from being a
 * disaster.
 *
 * A bulk edit is applied before anybody sees the result, which is what makes
 * the mistakes expensive: a misplaced decimal point prices the catalogue at
 * zero and the shop finds out from the orders. Nearly every test here is about
 * a change the module declines to make.
 *
 * Run with:
 *
 *     npm run test:bulk-edit
 */

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    slug: "cotton-tee",
    title: { en: "Cotton tee", ar: "تي شيرت قطن" },
    description: { en: "", ar: "" },
    categoryId: "tees",
    categoryPath: ["tees"],
    type: "simple",
    price: 20,
    currency: "JOD",
    images: [],
    colors: [],
    sizes: [],
    tags: ["cotton", "summer"],
    badges: [],
    inStock: true,
    totalStock: 10,
    status: "active",
    publishedAt: 0,
    updatedAt: 0,
    ...over,
  } as Product;
}

/* -------------------------------------------------------------------------- */
/*  The instruction, before any product is touched                            */
/* -------------------------------------------------------------------------- */

describe("editProblems", () => {
  test("accepts a sane instruction", () => {
    assert.deepEqual(editProblems({ field: "price", mode: "decrease", value: 20 }, 12), []);
  });

  test("refuses a percentage change large enough to be a typo", () => {
    /*
     * "Reduce by 50" on a sale is routine. "Reduce by 500" is a decimal point
     * in the wrong place, and it is applied to forty products before anybody
     * reads a price.
     */
    const problems = editProblems(
      { field: "price", mode: "decrease", value: MAX_PERCENT_CHANGE + 1 },
      40,
    );
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.en.includes("product by product"), true);
    // The admin is read in Arabic as often as in English; a guard that can
    // only explain itself in one of them is half a guard.
    assert.equal(problems[0]!.ar.includes("منتجًا منتجًا"), true);
  });

  test("a change right at the limit is allowed", () => {
    assert.deepEqual(
      editProblems({ field: "price", mode: "decrease", value: MAX_PERCENT_CHANGE }, 40),
      [],
    );
  });

  test("refuses a slug on more than one product", () => {
    // A slug is the URL. Setting one on thirty products would give
    // twenty-nine of them a colliding address.
    assert.equal(editProblems({ field: "slug", mode: "set", value: "tee" }, 2).length, 1);
    assert.deepEqual(editProblems({ field: "slug", mode: "set", value: "tee" }, 1), []);
  });

  test("refuses a price that is not a number", () => {
    assert.equal(editProblems({ field: "price", mode: "set", value: "abc" }, 1).length, 1);
  });

  test("refuses a negative price and a zero percentage", () => {
    assert.equal(editProblems({ field: "price", mode: "set", value: -5 }, 1).length, 1);
    assert.equal(editProblems({ field: "price", mode: "increase", value: 0 }, 1).length, 1);
  });

  test("refuses clearing the price — every product has one", () => {
    assert.equal(editProblems({ field: "price", mode: "clear" }, 1).length, 1);
  });

  test("refuses an empty value where one is needed", () => {
    assert.equal(editProblems({ field: "categoryId", mode: "set", value: "  " }, 1).length, 1);
  });
});

/* -------------------------------------------------------------------------- */
/*  Money                                                                     */
/* -------------------------------------------------------------------------- */

describe("price edits", () => {
  test("sets an absolute price", () => {
    const outcome = applyEdit(product(), { field: "price", mode: "set", value: 15 });
    assert.deepEqual(outcome.patch, { price: 15 });
  });

  test("a percentage lands on the dinar's own minor unit", () => {
    // Three decimals, so no write can store 13.333333333333334.
    const outcome = applyEdit(product({ price: 20 }), {
      field: "price",
      mode: "decrease",
      value: 33.333,
    });
    assert.equal(outcome.patch?.price, 13.333);
  });

  test("increase and decrease move the right way", () => {
    assert.equal(
      applyEdit(product({ price: 20 }), { field: "price", mode: "increase", value: 10 }).patch?.price,
      22,
    );
    assert.equal(
      applyEdit(product({ price: 20 }), { field: "price", mode: "decrease", value: 10 }).patch?.price,
      18,
    );
  });

  test("a price that would land at zero is refused", () => {
    const outcome = applyEdit(product(), { field: "price", mode: "set", value: 0 });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reasonAr!.length > 0, true);
  });

  test("lowering the price under an existing was-price is refused", () => {
    /*
     * The customer would see a was-price beneath the price — a negative
     * discount. Silently clearing the sale instead would throw away something
     * the merchant set up deliberately, so this asks rather than decides.
     */
    const onSale = product({ price: 20, compareAtPrice: 25 });
    const outcome = applyEdit(onSale, { field: "price", mode: "set", value: 30 });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason!.includes("25"), true);
  });

  test("a price already at the target writes nothing", () => {
    // A no-op write still moves `updatedAt`, which breaks every open editor's
    // conflict check for no reason.
    assert.equal(applyEdit(product({ price: 20 }), { field: "price", mode: "set", value: 20 }).patch, undefined);
  });
});

describe("was-price edits", () => {
  test("a was-price at or below the price is refused", () => {
    const outcome = applyEdit(product({ price: 20 }), {
      field: "compareAtPrice",
      mode: "set",
      value: 20,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason!.includes("negative discount"), true);
  });

  test("a genuine was-price is accepted", () => {
    assert.deepEqual(
      applyEdit(product({ price: 20 }), { field: "compareAtPrice", mode: "set", value: 30 }).patch,
      { compareAtPrice: 30 },
    );
  });

  test("clearing ends the sale", () => {
    const outcome = applyEdit(product({ compareAtPrice: 30 }), {
      field: "compareAtPrice",
      mode: "clear",
    });
    assert.equal(outcome.ok, true);
    assert.equal("compareAtPrice" in outcome.patch!, true);
    assert.equal(outcome.patch!.compareAtPrice, undefined);
  });

  test("clearing one that is already absent writes nothing", () => {
    assert.equal(applyEdit(product(), { field: "compareAtPrice", mode: "clear" }).patch, undefined);
  });
});

/* -------------------------------------------------------------------------- */
/*  Stock                                                                     */
/* -------------------------------------------------------------------------- */

describe("stock edits", () => {
  test("a simple product's stock can be set here", () => {
    assert.deepEqual(applyEdit(product(), { field: "totalStock", mode: "set", value: 4 }).patch, {
      totalStock: 4,
      inStock: true,
    });
  });

  test("setting stock to zero also clears inStock", () => {
    // Otherwise the listing keeps offering a product with nothing behind it.
    assert.deepEqual(applyEdit(product(), { field: "totalStock", mode: "set", value: 0 }).patch, {
      totalStock: 0,
      inStock: false,
    });
  });

  test("a variable product's stock is refused, and says where to edit it", () => {
    /*
     * Its total is the sum of the variant rows. Writing over the top makes the
     * product claim stock that no individual size has — the invented-average
     * bug the options table was built to kill.
     */
    const variable = product({
      type: "variable",
      variants: [{ sku: "A", colorId: "white", sizeId: "m", stock: 3 }],
    });
    const outcome = applyEdit(variable, { field: "totalStock", mode: "set", value: 40 });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason!.includes("options"), true);
  });

  test("a variable product with no rows yet is treated as simple", () => {
    const empty = product({ type: "variable", variants: [] });
    assert.equal(applyEdit(empty, { field: "totalStock", mode: "set", value: 4 }).ok, true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Tags and ids                                                              */
/* -------------------------------------------------------------------------- */

describe("tag edits", () => {
  test("adding keeps what is there", () => {
    const outcome = applyEdit(product(), { field: "tags", mode: "add", value: "linen, sale" });
    assert.deepEqual(outcome.patch?.tags, ["cotton", "summer", "linen", "sale"]);
  });

  test("adding a tag that is already there writes nothing", () => {
    assert.equal(applyEdit(product(), { field: "tags", mode: "add", value: "cotton" }).patch, undefined);
  });

  test("removing takes only what was named", () => {
    assert.deepEqual(
      applyEdit(product(), { field: "tags", mode: "remove", value: "summer" }).patch?.tags,
      ["cotton"],
    );
  });

  test("set replaces the lot", () => {
    assert.deepEqual(
      applyEdit(product(), { field: "tags", mode: "set", value: "winter" }).patch?.tags,
      ["winter"],
    );
  });

  test("tags are lowercased and de-duplicated, so the same tag is one tag", () => {
    assert.deepEqual(
      applyEdit(product({ tags: [] }), { field: "tags", mode: "add", value: "Sale, sale, SALE" })
        .patch?.tags,
      ["sale"],
    );
  });
});

describe("category and shipping edits", () => {
  test("a category moves", () => {
    assert.deepEqual(applyEdit(product(), { field: "categoryId", mode: "set", value: "shirts" }).patch, {
      categoryId: "shirts",
    });
  });

  test("a shipping class can be cleared back to the default", () => {
    const outcome = applyEdit(product({ shippingClassId: "bulky" }), {
      field: "shippingClassId",
      mode: "clear",
    });
    assert.equal("shippingClassId" in outcome.patch!, true);
    assert.equal(outcome.patch!.shippingClassId, undefined);
  });
});

describe("slug edits", () => {
  test("a clean slug is accepted", () => {
    assert.deepEqual(applyEdit(product(), { field: "slug", mode: "set", value: "Linen-Tee" }).patch, {
      slug: "linen-tee",
    });
  });

  test("anything a URL cannot carry is refused", () => {
    assert.equal(applyEdit(product(), { field: "slug", mode: "set", value: "linen tee" }).ok, false);
    assert.equal(applyEdit(product(), { field: "slug", mode: "set", value: "قميص" }).ok, false);
  });
});

/* -------------------------------------------------------------------------- */
/*  Several edits at once                                                     */
/* -------------------------------------------------------------------------- */

describe("applyEdits", () => {
  test("combines into one patch", () => {
    const outcome = applyEdits(product(), [
      { field: "price", mode: "set", value: 15 },
      { field: "tags", mode: "add", value: "sale" },
    ]);
    assert.equal(outcome.patch?.price, 15);
    assert.deepEqual(outcome.patch?.tags, ["cotton", "summer", "sale"]);
  });

  test("each edit sees the one before it", () => {
    /*
     * Raising the price and then setting a was-price above it is a legitimate
     * pair of instructions. Checking the second against the *stored* price
     * would refuse it for a conflict that no longer exists.
     */
    const outcome = applyEdits(product({ price: 20 }), [
      { field: "price", mode: "set", value: 40 },
      { field: "compareAtPrice", mode: "set", value: 50 },
    ]);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.patch?.compareAtPrice, 50);
  });

  test("one refusal refuses the whole product, rather than half-applying", () => {
    // Half of a two-part change is a state the merchant did not ask for and
    // cannot see.
    const outcome = applyEdits(product(), [
      { field: "price", mode: "set", value: 15 },
      { field: "slug", mode: "set", value: "not a slug" },
    ]);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.patch, undefined);
  });

  test("edits that change nothing produce no write at all", () => {
    const outcome = applyEdits(product(), [
      { field: "price", mode: "set", value: 20 },
      { field: "tags", mode: "add", value: "cotton" },
    ]);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.patch, undefined);
  });
});

describe("roundMoney", () => {
  test("keeps three decimals for the dinar", () => {
    assert.equal(roundMoney(13.3333333), 13.333);
    assert.equal(roundMoney(0.0005), 0.001);
  });
});

/* -------------------------------------------------------------------------- */
/*  A worked catalogue-wide example                                           */
/* -------------------------------------------------------------------------- */

describe("a sale across a selection", () => {
  test("applies where it can and names every product it cannot", () => {
    const selection = [
      product({ id: "a", price: 20 }),
      product({ id: "b", price: 30, compareAtPrice: 35 }),
      product({ id: "c", price: 10 }),
    ];
    const edit: Edit = { field: "price", mode: "decrease", value: 25 };

    const outcomes = selection.map((p) => applyEdit(p, edit));
    assert.deepEqual(
      outcomes.map((o) => [o.id, o.ok, o.patch?.price]),
      [
        ["a", true, 15],
        // Already on sale at 35→30; a quarter off leaves 22.5, still under the
        // was-price, so it goes through.
        ["b", true, 22.5],
        ["c", true, 7.5],
      ],
    );
  });
});
