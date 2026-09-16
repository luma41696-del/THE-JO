import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { matchesFilters } from "../src/lib/catalog-filters";
import type { Product, ProductFilters } from "../src/types";

/**
 * Which products a set of filters lets through.
 *
 * The case that matters is a combination the shop never made: a coat offered
 * in white, and offered in XL, where white XL does not exist. Checking the two
 * option lists separately says yes, the shopper clicks through, and the size
 * is unavailable in that colour — so the filter reads as decoration.
 *
 * Run with:
 *
 *     npm run test:filters
 */

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    slug: "tee",
    title: { en: "Tee", ar: "تي شيرت" },
    description: { en: "", ar: "" },
    categoryId: "tees",
    categoryPath: ["knitwear", "tees"],
    type: "variable",
    price: 20,
    currency: "JOD",
    images: [],
    colors: [
      { id: "white", name: { en: "White", ar: "أبيض" }, hex: "#fff" },
      { id: "cobalt", name: { en: "Cobalt", ar: "كوبالت" }, hex: "#1F44B8" },
    ],
    sizes: [
      { id: "m", label: "M" },
      { id: "xl", label: "XL" },
    ],
    variants: [
      { sku: "T-WHT-M", colorId: "white", sizeId: "m", stock: 4 },
      { sku: "T-COB-XL", colorId: "cobalt", sizeId: "xl", stock: 2 },
    ],
    tags: [],
    badges: [],
    inStock: true,
    totalStock: 6,
    status: "active",
    publishedAt: 0,
    updatedAt: 0,
    ...over,
  } as Product;
}

const pass = (filters: ProductFilters, over: Partial<Product> = {}) =>
  matchesFilters(product(over), filters);

/* -------------------------------------------------------------------------- */
/*  Colour and size together                                                  */
/* -------------------------------------------------------------------------- */

describe("colour and size combined", () => {
  test("a combination that exists passes", () => {
    assert.equal(pass({ colorIds: ["white"], sizeIds: ["m"] }), true);
    assert.equal(pass({ colorIds: ["cobalt"], sizeIds: ["xl"] }), true);
  });

  test("a combination the shop never made is refused", () => {
    /*
     * White exists. XL exists. White XL was never made. Checking the two
     * option lists separately returns this product and sends the shopper to a
     * page where the size they filtered for cannot be chosen.
     */
    assert.equal(pass({ colorIds: ["white"], sizeIds: ["xl"] }), false);
    assert.equal(pass({ colorIds: ["cobalt"], sizeIds: ["m"] }), false);
  });

  test("either side of a multi-value filter can satisfy it", () => {
    // "white or cobalt" plus "XL" is satisfied by cobalt XL.
    assert.equal(pass({ colorIds: ["white", "cobalt"], sizeIds: ["xl"] }), true);
  });

  test("with in-stock only, a combination that exists but is empty is refused", () => {
    // The listing promised something buyable today.
    const soldOut = product({
      variants: [{ sku: "T-WHT-M", colorId: "white", sizeId: "m", stock: 0 }],
    });
    assert.equal(
      matchesFilters(soldOut, { colorIds: ["white"], sizeIds: ["m"], inStockOnly: true }),
      false,
    );
    assert.equal(matchesFilters(soldOut, { colorIds: ["white"], sizeIds: ["m"] }), true);
  });

  test("a product with no variant rows falls back to its declared options", () => {
    // It cannot contradict itself, so the options are the best answer there is.
    const simple = product({ variants: [] });
    assert.equal(matchesFilters(simple, { colorIds: ["white"], sizeIds: ["xl"] }), true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Each on its own                                                           */
/* -------------------------------------------------------------------------- */

describe("colour alone", () => {
  test("a colour the product offers passes", () => {
    assert.equal(pass({ colorIds: ["white"] }), true);
  });

  test("a colour it does not offer is refused", () => {
    assert.equal(pass({ colorIds: ["crimson"] }), false);
  });

  test("with in-stock only, a colourway that is entirely sold out is refused", () => {
    const halfGone = product({
      variants: [
        { sku: "T-WHT-M", colorId: "white", sizeId: "m", stock: 0 },
        { sku: "T-COB-XL", colorId: "cobalt", sizeId: "xl", stock: 3 },
      ],
    });
    assert.equal(matchesFilters(halfGone, { colorIds: ["white"], inStockOnly: true }), false);
    assert.equal(matchesFilters(halfGone, { colorIds: ["cobalt"], inStockOnly: true }), true);
  });
});

describe("size alone", () => {
  test("a size the product offers passes", () => {
    assert.equal(pass({ sizeIds: ["xl"] }), true);
  });

  test("a size it does not offer is refused", () => {
    assert.equal(pass({ sizeIds: ["xs"] }), false);
  });

  test("with in-stock only, a size that is gone everywhere is refused", () => {
    const gone = product({
      variants: [
        { sku: "T-WHT-M", colorId: "white", sizeId: "m", stock: 0 },
        { sku: "T-COB-XL", colorId: "cobalt", sizeId: "xl", stock: 3 },
      ],
    });
    assert.equal(matchesFilters(gone, { sizeIds: ["m"], inStockOnly: true }), false);
  });
});

/* -------------------------------------------------------------------------- */
/*  The rest                                                                  */
/* -------------------------------------------------------------------------- */

describe("category", () => {
  test("a department matches everything filed beneath it", () => {
    // No product is filed against a department directly, so filtering on one
    // has to match through the ancestry or it returns nothing at all.
    assert.equal(pass({ categoryIds: ["knitwear"] }), true);
    assert.equal(pass({ categoryIds: ["tees"] }), true);
    assert.equal(pass({ categoryIds: ["footwear"] }), false);
  });
});

describe("price", () => {
  test("the bounds are inclusive", () => {
    assert.equal(pass({ minPrice: 20 }), true);
    assert.equal(pass({ maxPrice: 20 }), true);
    assert.equal(pass({ minPrice: 21 }), false);
    assert.equal(pass({ maxPrice: 19 }), false);
  });
});

describe("in stock", () => {
  test("an empty product is refused when the filter is on", () => {
    assert.equal(matchesFilters(product({ inStock: false }), { inStockOnly: true }), false);
    assert.equal(matchesFilters(product({ inStock: false }), {}), true);
  });
});

describe("no filters", () => {
  test("everything passes", () => {
    assert.equal(pass({}), true);
  });
});
