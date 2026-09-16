import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  MAX_ROWS,
  applyBulk,
  applyBulkTo,
  attributesFor,
  buildTable,
  combinationCountFor,
  combinationKey,
  editableAxes,
  fillSkus,
  rowMatches,
  rowProblems,
  splitAxes,
  splitSavable,
  stockMatrix,
  valueOf,
  withValue,
} from "../src/lib/variant-matrix";
import type { ProductAttribute, ProductVariant } from "../src/types";

/**
 * The variant table: N axes, bulk arithmetic, and the one required field.
 *
 * Run with:
 *
 *     npm run test:variant-matrix
 */

const colour: ProductAttribute = {
  id: "color",
  name: { en: "Colour", ar: "اللون" },
  kind: "color",
  values: [
    { id: "white", label: { en: "White", ar: "أبيض" } },
    { id: "black", label: { en: "Black", ar: "أسود" } },
  ],
};

const size: ProductAttribute = {
  id: "size",
  name: { en: "Size", ar: "المقاس" },
  kind: "size",
  values: [
    { id: "m", label: { en: "M", ar: "M" } },
    { id: "l", label: { en: "L", ar: "L" } },
    { id: "xl", label: { en: "XL", ar: "XL" } },
  ],
};

const capacity: ProductAttribute = {
  id: "capacity",
  name: { en: "Capacity", ar: "السعة" },
  kind: "custom",
  values: [
    { id: "1-5l", label: { en: "1.5 L", ar: "١٫٥ ل" } },
    { id: "2l", label: { en: "2 L", ar: "٢ ل" } },
  ],
};

const row = (over: Partial<ProductVariant> = {}): ProductVariant => ({
  sku: "",
  colorId: "",
  sizeId: "",
  stock: 0,
  ...over,
});

/* -------------------------------------------------------------------------- */
/*  Axes that are not colour and size                                         */
/* -------------------------------------------------------------------------- */

describe("reading and writing an axis", () => {
  test("colour and size write through to the original fields", () => {
    /*
     * They stay where they are on purpose: every stored order line and every
     * persisted cart key addresses them by name, so moving them into a map
     * would orphan baskets and orders already written.
     */
    const withColour = withValue(row(), colour, "white");
    assert.equal(withColour.colorId, "white");
    assert.equal(withColour.attributes, undefined);

    const withSize = withValue(withColour, size, "m");
    assert.equal(withSize.sizeId, "m");
  });

  test("a custom axis lives in the attribute map", () => {
    const filled = withValue(row(), capacity, "2l");
    assert.deepEqual(filled.attributes, { capacity: "2l" });
    assert.equal(valueOf(filled, capacity), "2l");
  });

  test("clearing a custom axis removes the key rather than storing empty", () => {
    // An empty string is a value that matches nothing, and it would make two
    // otherwise-identical rows look distinct.
    const filled = withValue(row(), capacity, "2l");
    const cleared = withValue(filled, capacity, "");
    assert.equal(cleared.attributes, undefined);
  });
});

describe("combinationKey", () => {
  test("two rows with the same values share a key, whatever their codes", () => {
    const a = withValue(withValue(row({ sku: "A" }), colour, "white"), size, "m");
    const b = withValue(withValue(row({ sku: "Z" }), colour, "white"), size, "m");
    assert.equal(combinationKey(a, [colour, size]), combinationKey(b, [colour, size]));
  });

  test("the key follows the axes given, so a third axis separates them", () => {
    const a = withValue(withValue(row(), colour, "white"), capacity, "2l");
    const b = withValue(withValue(row(), colour, "white"), capacity, "1-5l");
    assert.notEqual(combinationKey(a, [colour, capacity]), combinationKey(b, [colour, capacity]));
  });
});

/* -------------------------------------------------------------------------- */
/*  Building                                                                  */
/* -------------------------------------------------------------------------- */

describe("buildTable", () => {
  test("produces every combination of two axes", () => {
    const { rows, added } = buildTable([colour, size], []);
    assert.equal(rows.length, 6);
    assert.equal(added, 6);
    assert.equal(combinationCountFor([colour, size]), 6);
  });

  test("multiplies a third axis in", () => {
    const { rows } = buildTable([colour, size, capacity], []);
    assert.equal(rows.length, 12);
  });

  test("works with axes that are neither colour nor size", () => {
    const { rows } = buildTable([capacity], []);
    assert.equal(rows.length, 2);
    assert.equal(rows.every((r) => Boolean(r.attributes?.capacity)), true);
  });

  test("never creates the same combination twice", () => {
    const { rows } = buildTable([colour, size], []);
    const keys = rows.map((r) => combinationKey(r, [colour, size]));
    assert.equal(new Set(keys).size, keys.length);
  });

  test("rebuilding keeps the price and stock already typed", () => {
    /*
     * The failure that matters. Adding one size must not reset the prices and
     * counts on the other rows — that is an afternoon of work, lost silently.
     */
    const first = buildTable([colour, size], []).rows;
    const edited = first.map((r, i) =>
      i === 0 ? { ...r, priceOverride: 19.5, stock: 42, sku: "HAND-TYPED" } : r,
    );

    const { rows, kept, added } = buildTable(
      [colour, { ...size, values: [...size.values, { id: "xxl", label: { en: "XXL", ar: "XXL" } }] }],
      edited,
    );

    assert.equal(rows.length, 8);
    assert.equal(kept, 6);
    assert.equal(added, 2);
    const survivor = rows.find((r) => r.sku === "HAND-TYPED");
    assert.equal(survivor?.priceOverride, 19.5);
    assert.equal(survivor?.stock, 42);
  });

  test("a row is matched on its values, not on its code", () => {
    // Renaming a code by hand has not created a different product.
    const existing = [
      withValue(withValue(row({ sku: "COMPLETELY-DIFFERENT", stock: 7 }), colour, "white"), size, "m"),
    ];
    const { rows } = buildTable([colour, size], existing);
    const kept = rows.find((r) => r.colorId === "white" && r.sizeId === "m");
    assert.equal(kept?.stock, 7);
    assert.equal(kept?.sku, "COMPLETELY-DIFFERENT");
  });

  test("a row whose value was deleted is kept, not dropped", () => {
    /*
     * It holds stock. Deleting it because a list changed is how a shop loses a
     * count it still has on a shelf — so it stays, visible and deletable by
     * hand.
     */
    const existing = [withValue(withValue(row({ stock: 3 }), colour, "navy"), size, "m")];
    const { rows } = buildTable([colour, size], existing);
    assert.equal(rows.length, 7);
    assert.equal(rows.some((r) => r.colorId === "navy"), true);
  });

  test("no axes leaves the table exactly as it was", () => {
    const existing = [row({ sku: "ONLY" })];
    assert.deepEqual(buildTable([], existing).rows, existing);
  });

  test("an enormous cross product is capped and says so", () => {
    const many = (id: string, n: number): ProductAttribute => ({
      id,
      name: { en: id, ar: id },
      kind: "custom",
      values: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, label: { en: `${i}`, ar: `${i}` } })),
    });
    const { rows, truncated } = buildTable([many("a", 40), many("b", 40)], []);
    assert.equal(rows.length, MAX_ROWS);
    assert.equal(truncated, true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Price is the only required field                                          */
/* -------------------------------------------------------------------------- */

describe("rowProblems", () => {
  test("a row with only a price is valid", () => {
    /*
     * The rule the whole screen was rebuilt around. No code, no stock, no sale
     * price, no barcode, no attributes — and it saves.
     */
    assert.deepEqual(rowProblems(row({ priceOverride: 12 })), []);
  });

  test("a row with no price of its own inherits the product's", () => {
    // It is currently selling at that price, so it has one.
    assert.deepEqual(rowProblems(row(), { productPrice: 20 }), []);
  });

  test("a row with no price anywhere is refused, and says so", () => {
    const problems = rowProblems(row());
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.field, "price");
    assert.equal(problems[0]!.message.ar.length > 0, true);
  });

  test("a negative price is refused", () => {
    assert.equal(rowProblems(row({ priceOverride: -1 }))[0]?.field, "price");
  });

  test("blank stock, code, sale price and barcode are all fine", () => {
    const bare = row({ priceOverride: 10, sku: "", gtin: undefined, salePrice: undefined });
    assert.deepEqual(rowProblems(bare), []);
  });

  test("a sale price above the price is refused", () => {
    // The customer would see a negative discount.
    const problems = rowProblems(row({ priceOverride: 10, salePrice: 15 }));
    assert.equal(problems[0]?.field, "salePrice");
  });

  test("a sale price below the price is accepted", () => {
    assert.deepEqual(rowProblems(row({ priceOverride: 10, salePrice: 8 })), []);
  });

  test("a fractional stock count is refused", () => {
    assert.equal(rowProblems(row({ priceOverride: 10, stock: 1.5 }))[0]?.field, "stock");
  });

  test("two rows sharing a code are refused, and blank codes are not duplicates", () => {
    /*
     * Several rows with no code yet is the normal state of a table somebody is
     * halfway through filling in.
     */
    const clash = rowProblems(row({ priceOverride: 1, sku: "A" }), { allSkus: ["A", "A"] });
    assert.equal(clash[0]?.field, "sku");

    const blanks = rowProblems(row({ priceOverride: 1, sku: "" }), { allSkus: ["", ""] });
    assert.deepEqual(blanks, []);
  });
});

describe("splitSavable", () => {
  test("separates what can be written from what cannot", () => {
    const rows = [row({ priceOverride: 10 }), row(), row({ priceOverride: 5 })];
    const { savable, rejected } = splitSavable(rows);
    assert.equal(savable.length, 2);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]!.index, 1);
  });
});

/* -------------------------------------------------------------------------- */
/*  Bulk arithmetic                                                           */
/* -------------------------------------------------------------------------- */

describe("applyBulk", () => {
  const priced = row({ priceOverride: 10, salePrice: 8, stock: 5 });

  test("sets a price", () => {
    assert.equal(applyBulk(priced, "set-price", 25).priceOverride, 25);
  });

  test("adds and subtracts a fixed amount", () => {
    assert.equal(applyBulk(priced, "price-add", 5).priceOverride, 15);
    assert.equal(applyBulk(priced, "price-subtract", 5).priceOverride, 5);
  });

  test("a fixed decrease never goes below zero", () => {
    // A negative price is a product the shop pays people to take.
    assert.equal(applyBulk(priced, "price-subtract", 50).priceOverride, 0);
  });

  test("moves by a percentage", () => {
    assert.equal(applyBulk(row({ priceOverride: 100 }), "price-increase-percent", 10).priceOverride, 110);
    assert.equal(applyBulk(row({ priceOverride: 200 }), "price-decrease-percent", 10).priceOverride, 180);
  });

  test("a percentage lands on the currency's minor unit", () => {
    // Without rounding the merchant sees 10.804500000000001 in the box.
    assert.equal(applyBulk(row({ priceOverride: 12.005 }), "price-decrease-percent", 10).priceOverride, 10.805);
  });

  test("a price action on an inheriting row starts from the product price", () => {
    /*
     * Starting from zero would silently reprice every inheriting row to the
     * size of the adjustment.
     */
    assert.equal(applyBulk(row(), "price-add", 5, 20).priceOverride, 25);
  });

  test("a sale action on a row with no sale price does nothing", () => {
    // "Reduce the sale price by 2" is not an instruction to put it on sale.
    const plain = row({ priceOverride: 10 });
    assert.equal(applyBulk(plain, "sale-subtract", 2).salePrice, undefined);
    assert.equal(applyBulk(plain, "sale-decrease-percent", 10).salePrice, undefined);
  });

  test("a sale price can be set and cleared", () => {
    assert.equal(applyBulk(priced, "set-sale-price", 6).salePrice, 6);
    assert.equal(applyBulk(priced, "clear-sale-price", 0).salePrice, undefined);
  });

  test("stock moves in whole units and never below zero", () => {
    assert.equal(applyBulk(priced, "set-stock", 12).stock, 12);
    assert.equal(applyBulk(priced, "stock-add", 3).stock, 8);
    assert.equal(applyBulk(priced, "stock-subtract", 99).stock, 0);
    assert.equal(applyBulk(priced, "set-stock", 4.9).stock, 4);
  });

  test("enabling clears the flag rather than writing true", () => {
    // Absent means sold, so a product that disables nothing carries no field.
    const off = applyBulk(priced, "disable", 0);
    assert.equal(off.available, false);
    assert.equal(applyBulk(off, "enable", 0).available, undefined);
  });
});

describe("applyBulkTo", () => {
  test("touches only the selected rows", () => {
    /*
     * The whole contract of a bulk action. A merchant who selected three rows
     * and watched forty change would never use the feature again.
     */
    const rows = [row({ priceOverride: 10 }), row({ priceOverride: 20 }), row({ priceOverride: 30 })];
    const next = applyBulkTo(rows, new Set([0, 2]), "price-add", 5);
    assert.deepEqual(next.map((r) => r.priceOverride), [15, 20, 35]);
  });

  test("an empty selection changes nothing", () => {
    const rows = [row({ priceOverride: 10 })];
    assert.deepEqual(applyBulkTo(rows, new Set(), "set-price", 99), rows);
  });
});

/* -------------------------------------------------------------------------- */
/*  Searching                                                                 */
/* -------------------------------------------------------------------------- */

describe("rowMatches", () => {
  const white = withValue(withValue(row({ sku: "TEE-WHT-M" }), colour, "white"), size, "m");

  test("finds a row by its code", () => {
    assert.equal(rowMatches(white, [colour, size], "wht"), true);
  });

  test("finds a row by an attribute label, in either language", () => {
    // A merchant searches for "White", not for the slug it is stored under.
    assert.equal(rowMatches(white, [colour, size], "White"), true);
    assert.equal(rowMatches(white, [colour, size], "أبيض"), true);
  });

  test("an empty query matches everything", () => {
    assert.equal(rowMatches(white, [colour, size], "  "), true);
  });

  test("something that is not there does not match", () => {
    assert.equal(rowMatches(white, [colour, size], "navy"), false);
  });
});

/* -------------------------------------------------------------------------- */
/*  The stock matrix                                                          */
/* -------------------------------------------------------------------------- */

describe("stockMatrix", () => {
  const rows = [
    withValue(withValue(row({ stock: 0 }), colour, "white"), size, "m"),
    withValue(withValue(row({ stock: 5 }), colour, "white"), size, "l"),
    withValue(withValue(row({ stock: 1 }), colour, "white"), size, "xl"),
    withValue(withValue(row({ stock: 3 }), colour, "black"), size, "m"),
  ];

  test("lays the first axis down the side and the second across the top", () => {
    const matrix = stockMatrix(rows, [colour, size]);
    assert.deepEqual(matrix.columns.map((c) => c.id), ["m", "l", "xl"]);
    const white = matrix.rows.find((r) => r.id === "white")!;
    assert.deepEqual(white.cells, { m: 0, l: 5, xl: 1 });
    assert.equal(white.total, 6);
  });

  test("totals the columns and the whole grid", () => {
    const matrix = stockMatrix(rows, [colour, size]);
    assert.equal(matrix.columnTotals.m, 3);
    assert.equal(matrix.grandTotal, 9);
  });

  test("works for axes that are not colour and size", () => {
    // A kettle varies by capacity, and the grid has to follow.
    const kettles = [
      withValue(withValue(row({ stock: 4 }), colour, "white"), capacity, "2l"),
      withValue(withValue(row({ stock: 2 }), colour, "white"), capacity, "1-5l"),
    ];
    const matrix = stockMatrix(kettles, [colour, capacity]);
    assert.deepEqual(matrix.columns.map((c) => c.id), ["1-5l", "2l"]);
    assert.equal(matrix.rows.find((r) => r.id === "white")!.total, 6);
  });

  test("a third axis is sliced by a filter rather than summed away", () => {
    /*
     * Summing across it would produce a total that matches no shelf: 6 of
     * "white / M" across two capacities is not 6 of anything a person can pick
     * up.
     */
    const three = [
      withValue(withValue(withValue(row({ stock: 4 }), colour, "white"), size, "m"), capacity, "2l"),
      withValue(withValue(withValue(row({ stock: 9 }), colour, "white"), size, "m"), capacity, "1-5l"),
    ];
    const sliced = stockMatrix(three, [colour, size, capacity], { capacity: "2l" });
    assert.equal(sliced.rows.find((r) => r.id === "white")!.cells.m, 4);
  });

  test("one axis produces a single column", () => {
    const matrix = stockMatrix([withValue(row({ stock: 7 }), colour, "white")], [colour]);
    assert.equal(matrix.columns.length, 1);
    assert.equal(matrix.rows.find((r) => r.id === "white")!.total, 7);
  });

  test("no axes still totals what is there", () => {
    const matrix = stockMatrix([row({ stock: 3 }), row({ stock: 4 })], []);
    assert.equal(matrix.grandTotal, 7);
  });

  test("a negative count never adds", () => {
    const odd = [withValue(withValue(row({ stock: -5 }), colour, "white"), size, "m")];
    assert.equal(stockMatrix(odd, [colour, size]).grandTotal, 0);
  });
});

/* -------------------------------------------------------------------------- */
/*  Existing products, which have no attributes defined                       */
/* -------------------------------------------------------------------------- */

describe("attributesFor", () => {
  test("reconstructs axes from a product that predates attributes", () => {
    /*
     * Every product in the shop is in this state. Opening the new table on one
     * has to show its colours and sizes rather than an empty screen.
     */
    const axes = attributesFor({
      colors: [{ id: "white", name: { en: "White", ar: "أبيض" }, hex: "#fff" }],
      sizes: [{ id: "m", label: "M" }],
    });
    assert.deepEqual(axes.map((a) => a.kind), ["color", "size"]);
    assert.equal(axes[0]!.values[0]!.hex, "#fff");
  });

  test("appends the category's own attributes", () => {
    const axes = attributesFor(
      { colors: [{ id: "white", name: { en: "White", ar: "أبيض" } }] },
      [capacity],
    );
    assert.deepEqual(axes.map((a) => a.id), ["color", "capacity"]);
  });

  test("a category colour attribute does not produce a second colour column", () => {
    const axes = attributesFor(
      { colors: [{ id: "white", name: { en: "White", ar: "أبيض" } }] },
      [{ ...colour, id: "colour-again" }],
    );
    assert.equal(axes.filter((a) => a.kind === "color").length, 1);
  });

  test("a product with nothing yields no axes, rather than empty ones", () => {
    assert.deepEqual(attributesFor({}), []);
  });
});

/* -------------------------------------------------------------------------- */
/*  Artwork is an axis                                                        */
/* -------------------------------------------------------------------------- */

const design: ProductAttribute = {
  id: "design",
  name: { en: "Design", ar: "التصميم" },
  kind: "design",
  values: [
    { id: "crest", label: { en: "Crest", ar: "شعار" } },
    { id: "script", label: { en: "Script", ar: "خط" } },
  ],
};

describe("the design axis", () => {
  test("reads and writes the variant's own designId", () => {
    const row = withValue({ sku: "", colorId: "", sizeId: "", stock: 0 }, design, "crest");
    assert.equal(row.designId, "crest");
    assert.equal(valueOf(row, design), "crest");
  });

  test("clearing it leaves the row unscoped rather than matching a design named ''", () => {
    const row = withValue({ sku: "", colorId: "", sizeId: "", stock: 4, designId: "crest" }, design, "");
    assert.equal(row.designId, undefined);
  });

  test("two artworks of one colour and size are two combinations", () => {
    const a: ProductVariant = { sku: "A", colorId: "white", sizeId: "m", designId: "crest", stock: 3 };
    const b: ProductVariant = { sku: "B", colorId: "white", sizeId: "m", designId: "script", stock: 7 };
    assert.notEqual(combinationKey(a, [colour, size, design]), combinationKey(b, [colour, size, design]));
  });

  /*
   * The regression this axis exists for. Before designs were part of a
   * combination, a build saw two artwork rows as one permutation, kept
   * whichever came last, and dropped the other's stock — with a cheerful
   * "kept 1" in the notice.
   */
  test("building keeps both artworks of a colour and size, with their stock", () => {
    const existing: ProductVariant[] = [
      { sku: "A", colorId: "white", sizeId: "m", designId: "crest", stock: 3 },
      { sku: "B", colorId: "white", sizeId: "m", designId: "script", stock: 7 },
    ];
    const result = buildTable([colour, size, design], existing);

    const kept = result.rows.filter(
      (row) => row.colorId === "white" && row.sizeId === "m" && row.stock > 0,
    );
    assert.deepEqual(
      kept.map((row) => [row.designId, row.stock]).sort(),
      [["crest", 3], ["script", 7]],
    );
  });

  test("the matrix can be sliced by artwork rather than summing over it", () => {
    const rows: ProductVariant[] = [
      { sku: "A", colorId: "white", sizeId: "m", designId: "crest", stock: 3 },
      { sku: "B", colorId: "white", sizeId: "m", designId: "script", stock: 7 },
    ];
    const all = stockMatrix(rows, [colour, size, design]);
    assert.equal(all.grandTotal, 10);

    const crestOnly = stockMatrix(rows, [colour, size, design], { design: "crest" });
    assert.equal(crestOnly.grandTotal, 3);
  });

  test("attributesFor derives it from the product's designs", () => {
    const axes = attributesFor({
      colors: [{ id: "white", name: { en: "White", ar: "أبيض" } }],
      designs: [{ id: "crest", name: { en: "Crest", ar: "شعار" } }],
    });
    assert.deepEqual(axes.map((a) => a.kind), ["color", "design"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  Axes back into the product's own fields                                   */
/* -------------------------------------------------------------------------- */

describe("splitAxes", () => {
  test("a colour axis becomes the product's colours, with their fills", () => {
    const { colors } = splitAxes([
      {
        ...colour,
        values: [{ id: "white", label: { en: "White", ar: "أبيض" }, hex: "#ffffff" }],
      },
    ]);
    assert.deepEqual(colors, [{ id: "white", name: { en: "White", ar: "أبيض" }, hex: "#ffffff" }]);
  });

  /*
   * The table has no column for a second tone or for body measurements, so
   * rebuilding the arrays from what it knows would delete them. Matching by id
   * and writing over only the fields the axis carries is what keeps a size
   * guide alive through an unrelated rename.
   */
  test("fields the table cannot see survive an edit", () => {
    const { colors, sizes } = splitAxes(
      [
        { ...colour, values: [{ id: "white", label: { en: "Ivory", ar: "عاجي" } }] },
        { ...size, values: [{ id: "m", label: { en: "M", ar: "M" } }] },
      ],
      {
        colors: [
          { id: "white", name: { en: "White", ar: "أبيض" }, hex: "#eee", hexSecondary: "#ccc" },
        ],
        sizes: [{ id: "m", label: "M", system: "numeric", measurements: { chest: 96 } }],
      },
    );

    assert.equal(colors[0]?.hexSecondary, "#ccc");
    assert.equal(colors[0]?.name.en, "Ivory");
    assert.equal(sizes[0]?.system, "numeric");
    assert.equal(sizes[0]?.measurements?.chest, 96);
  });

  test("a colour with no fill gets a visible placeholder, not a blank swatch", () => {
    const { colors } = splitAxes([
      { ...colour, values: [{ id: "navy", label: { en: "Navy", ar: "كحلي" } }] },
    ]);
    assert.match(colors[0]?.hex ?? "", /^#[0-9a-f]{6}$/i);
  });

  test("removing the colour axis clears the colours", () => {
    const { colors } = splitAxes([size], {
      colors: [{ id: "white", name: { en: "White", ar: "أبيض" }, hex: "#fff" }],
    });
    assert.deepEqual(colors, []);
  });

  /*
   * Artwork carries a thumbnail the axes list has no room for, so it is owned
   * by the designs panel. Writing it back from a list of labels would strip
   * every image the merchant uploaded.
   */
  test("the design axis is not written back", () => {
    const { custom } = splitAxes([colour, design, capacity]);
    assert.deepEqual(custom.map((a) => a.id), ["capacity"]);
  });
});

describe("editableAxes", () => {
  test("a brand-new product still offers colour and size to fill in", () => {
    const axes = editableAxes({});
    assert.deepEqual(axes.map((a) => a.kind), ["color", "size"]);
    assert.deepEqual(axes.map((a) => a.values.length), [0, 0]);
  });

  test("an empty axis changes nothing about a build", () => {
    const axes = editableAxes({ colors: [{ id: "white", name: { en: "White", ar: "أبيض" } }] });
    const result = buildTable(axes, []);
    assert.equal(result.rows.length, 1);
  });

  test("what the product already has is not duplicated", () => {
    const axes = editableAxes({
      colors: [{ id: "white", name: { en: "White", ar: "أبيض" } }],
      sizes: [{ id: "m", label: "M" }],
    });
    assert.equal(axes.filter((a) => a.kind === "color").length, 1);
    assert.equal(axes.filter((a) => a.kind === "size").length, 1);
    assert.equal(axes[0]?.values.length, 1);
  });
});

describe("fillSkus", () => {
  test("a blank code is built from the parent code and the row's values", () => {
    const rows = fillSkus(
      [{ sku: "", colorId: "white", sizeId: "m", stock: 0 }],
      [colour, size],
      "TEE",
    );
    assert.equal(rows[0]?.sku, "TEE-WHITE-M");
  });

  test("a code the merchant typed is left exactly as it is", () => {
    const rows = fillSkus([{ sku: "my-code", colorId: "white", sizeId: "m", stock: 0 }], [colour, size], "TEE");
    assert.equal(rows[0]?.sku, "my-code");
  });

  test("a row with no values at all still gets the parent code", () => {
    const rows = fillSkus([{ sku: "", colorId: "", sizeId: "", stock: 0 }], [colour, size], "KETTLE");
    assert.equal(rows[0]?.sku, "KETTLE");
  });

  /*
   * Two rows deriving one code have the same values, which is a duplicate
   * combination. Numbering them apart would store two rows for one sellable
   * thing and hide the problem behind codes that look deliberate.
   */
  test("identical rows are not numbered apart to hide a duplicate", () => {
    const rows = fillSkus(
      [
        { sku: "", colorId: "white", sizeId: "m", stock: 0 },
        { sku: "", colorId: "white", sizeId: "m", stock: 0 },
      ],
      [colour, size],
      "TEE",
    );
    assert.equal(rows[0]?.sku, rows[1]?.sku);
  });

  test("with nothing to build from, the row is left blank for the caller to report", () => {
    const rows = fillSkus([{ sku: "", colorId: "", sizeId: "", stock: 0 }], [colour, size], "");
    assert.equal(rows[0]?.sku, "");
  });

  test("an artwork is part of the code, so two designs do not share one", () => {
    const rows = fillSkus(
      [
        { sku: "", colorId: "white", sizeId: "m", designId: "crest", stock: 0 },
        { sku: "", colorId: "white", sizeId: "m", designId: "script", stock: 0 },
      ],
      [colour, size, design],
      "TEE",
    );
    assert.notEqual(rows[0]?.sku, rows[1]?.sku);
  });
});
