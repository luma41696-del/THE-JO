import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  applyImport,
  autoMapColumns,
  driveFileId,
  foldValue,
  matchValue,
  newValuesFor,
  planVariantImport,
  sheetCsvUrl,
  summarise,
  targetsFor,
} from "../src/lib/variant-import";
import { withValue } from "../src/lib/variant-matrix";
import type { ProductAttribute, ProductVariant } from "../src/types";

/**
 * Importing a variant table from a spreadsheet.
 *
 * Run with:
 *
 *     npm run test:variant-import
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
  ],
};

const capacity: ProductAttribute = {
  id: "capacity",
  name: { en: "Capacity", ar: "السعة" },
  kind: "custom",
  values: [{ id: "2l", label: { en: "2 L", ar: "٢ ل" } }],
};

const AXES = [colour, size];

const plan = (
  rows: string[][],
  mapping: (string | null)[],
  over: Partial<Parameters<typeof planVariantImport>[2]> = {},
) =>
  planVariantImport(rows, mapping, {
    attributes: AXES,
    existing: [],
    existingPolicy: "update",
    createMissingValues: false,
    ...over,
  });

/* -------------------------------------------------------------------------- */
/*  Mapping                                                                   */
/* -------------------------------------------------------------------------- */

describe("autoMapColumns", () => {
  test("maps the obvious columns", () => {
    assert.deepEqual(
      autoMapColumns(["Colour", "Size", "SKU", "Price", "Stock"], AXES),
      ["attr:color", "attr:size", "field:sku", "field:price", "field:stock"],
    );
  });

  test("maps an attribute the clothing importer has never heard of", () => {
    /*
     * The reason mapping is built from the product's axes rather than a
     * constant: a kettle's sheet says Capacity, and nothing fixed would know
     * what that is.
     */
    assert.deepEqual(autoMapColumns(["Capacity"], [capacity]), ["attr:capacity"]);
  });

  test("maps Arabic headers", () => {
    assert.deepEqual(autoMapColumns(["اللون", "السعر", "المخزون"], AXES), [
      "attr:color",
      "field:price",
      "field:stock",
    ]);
  });

  test("sale price does not steal the price column", () => {
    // It contains the word, and a loose-first pass would let it win.
    assert.deepEqual(autoMapColumns(["Sale Price", "Price"], AXES), [
      "field:salePrice",
      "field:price",
    ]);
    assert.deepEqual(autoMapColumns(["Price", "Sale Price"], AXES), [
      "field:price",
      "field:salePrice",
    ]);
  });

  test("a column nobody recognises is left unmapped rather than guessed", () => {
    // An unmapped column is a question; a wrongly guessed one writes prices
    // into the stock field across the whole table.
    assert.equal(autoMapColumns(["supplier lead time"], AXES)[0], null);
  });

  test("every target is offered, attributes first", () => {
    const targets = targetsFor(AXES);
    assert.equal(targets[0]!.key, "attr:color");
    assert.equal(targets.some((t) => t.key === "field:price"), true);
  });
});

describe("foldValue and matchValue", () => {
  test("the spellings people type collapse onto one value", () => {
    /*
     * Without this a sheet produces four whites, four columns in the stock
     * matrix, and a shop that appears to stock four different whites.
     */
    for (const written of ["White", "white", " WHITE ", "White "]) {
      assert.equal(matchValue(colour, written)?.id, "white", written);
    }
  });

  test("a value matches by its Arabic label too", () => {
    assert.equal(matchValue(colour, "أبيض")?.id, "white");
  });

  test("something unknown matches nothing", () => {
    assert.equal(matchValue(colour, "navy"), undefined);
    assert.equal(foldValue("  "), "");
  });
});

/* -------------------------------------------------------------------------- */
/*  Price is the only required field                                          */
/* -------------------------------------------------------------------------- */

const MAP = ["attr:color", "attr:size", "field:sku", "field:price", "field:stock"];

describe("what makes an imported row valid", () => {
  test("a row with a price and nothing else imports", () => {
    /*
     * The rule the screen was rebuilt around, carried into the import: no
     * code, no stock, no sale price.
     */
    const { rows } = plan([["White", "M", "", "12", ""]], MAP);
    assert.equal(rows[0]!.status, "create");
    assert.equal(rows[0]!.variant?.priceOverride, 12);
    assert.equal(rows[0]!.variant?.sku, "");
  });

  test("a row with no price is an error", () => {
    const { rows } = plan([["White", "M", "TEE-1", "", "4"]], MAP);
    assert.equal(rows[0]!.status, "error");
    assert.equal(rows[0]!.problems[0]!.ar.length > 0, true);
  });

  test("a row with no price of its own inherits the product's", () => {
    // It genuinely has a price: the one it is selling at.
    const { rows } = plan([["White", "M", "", "", ""]], MAP, { productPrice: 20 });
    assert.equal(rows[0]!.status, "create");
  });

  test("a price that is not a number is an error", () => {
    const { rows } = plan([["White", "M", "", "ask us", ""]], MAP);
    assert.equal(rows[0]!.status, "error");
  });

  test("Arabic-Indic digits and a currency are read", () => {
    const { rows } = plan([["White", "M", "", "JOD ١٢٫٥٠٠", "٤"]], MAP);
    assert.equal(rows[0]!.variant?.priceOverride, 12.5);
    assert.equal(rows[0]!.variant?.stock, 4);
  });

  test("a sale price above the price is an error", () => {
    const { rows } = plan(
      [["White", "M", "", "10", "15"]],
      ["attr:color", "attr:size", "field:sku", "field:price", "field:salePrice"],
    );
    assert.equal(rows[0]!.status, "error");
  });
});

/* -------------------------------------------------------------------------- */
/*  Duplicates                                                                */
/* -------------------------------------------------------------------------- */

describe("duplicates", () => {
  test("the same combination twice in one sheet is an error the second time", () => {
    /*
     * Two rows for White / M are the same sellable unit however they are
     * labelled, and a shop holding both has two stock counts for one thing.
     */
    const { rows } = plan(
      [
        ["White", "M", "A", "10", "1"],
        ["White", "M", "B", "20", "2"],
      ],
      MAP,
    );
    assert.equal(rows[0]!.status, "create");
    assert.equal(rows[1]!.status, "error");
    assert.equal(rows[1]!.problems[0]!.en.includes("line 2"), true);
  });

  test("the same code twice in one sheet is an error the second time", () => {
    const { rows } = plan(
      [
        ["White", "M", "SAME", "10", "1"],
        ["Black", "L", "SAME", "20", "2"],
      ],
      MAP,
    );
    assert.equal(rows[1]!.status, "error");
  });

  test("two rows with no code are not duplicates of each other", () => {
    // Several blank codes is the normal state of a half-filled sheet.
    const { rows } = plan(
      [
        ["White", "M", "", "10", ""],
        ["Black", "L", "", "20", ""],
      ],
      MAP,
    );
    assert.deepEqual(rows.map((r) => r.status), ["create", "create"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  Rows that already exist                                                   */
/* -------------------------------------------------------------------------- */

describe("existing variants", () => {
  const existing: ProductVariant[] = [
    withValue(withValue({ sku: "TEE-WHT-M", colorId: "", sizeId: "", stock: 9, priceOverride: 30, gtin: "123" }, colour, "white"), size, "m"),
  ];

  test("update merges onto the row rather than replacing it", () => {
    /*
     * A sheet with only a price column must not blank the stock and the
     * barcode of every row it touches: the columns it does not carry are not
     * instructions to clear those fields.
     */
    const { rows } = plan([["White", "M", "", "25", ""]], MAP, { existing, existingPolicy: "update" });
    assert.equal(rows[0]!.status, "update");
    assert.equal(rows[0]!.variant?.priceOverride, 25);
    assert.equal(rows[0]!.variant?.gtin, "123");
  });

  test("skip leaves it alone", () => {
    const { rows } = plan([["White", "M", "", "25", ""]], MAP, { existing, existingPolicy: "skip" });
    assert.equal(rows[0]!.status, "skip");
  });

  test("error reports it", () => {
    const { rows } = plan([["White", "M", "", "25", ""]], MAP, { existing, existingPolicy: "error" });
    assert.equal(rows[0]!.status, "error");
  });

  test("a matching code updates even when the combination is blank", () => {
    const { rows } = plan([["", "", "TEE-WHT-M", "25", ""]], MAP, { existing, existingPolicy: "update" });
    assert.equal(rows[0]!.status, "update");
  });
});

/* -------------------------------------------------------------------------- */
/*  Values the product does not have yet                                      */
/* -------------------------------------------------------------------------- */

describe("unknown attribute values", () => {
  test("are an error when creating them was not asked for", () => {
    const { rows, newValues } = plan([["Navy", "M", "", "10", ""]], MAP);
    assert.equal(rows[0]!.status, "error");
    // Still collected, so the preview can offer to create them.
    assert.equal(newValues.get("color")?.has("Navy"), true);
  });

  test("are created when asked for", () => {
    const { rows, newValues } = plan([["Navy", "M", "", "10", ""]], MAP, {
      createMissingValues: true,
    });
    assert.equal(rows[0]!.status, "create");
    assert.equal(rows[0]!.variant?.colorId, "navy");
    assert.equal(newValues.get("color")?.has("Navy"), true);
  });

  test("newValuesFor adds them to the axis without duplicating what is there", () => {
    const map = new Map([["color", new Set(["Navy", "white", "WHITE"])]]);
    const [updated] = newValuesFor([colour], map);
    const ids = updated!.values.map((v) => v.id);
    assert.equal(ids.includes("navy"), true);
    // "white" and "WHITE" already exist, folded.
    assert.equal(ids.filter((id) => id === "white").length, 1);
    assert.equal(updated!.values.length, 3);
  });
});

/* -------------------------------------------------------------------------- */
/*  The plan as a whole                                                       */
/* -------------------------------------------------------------------------- */

describe("summarise and applyImport", () => {
  const { rows } = plan(
    [
      ["White", "M", "", "10", "1"],
      ["Black", "L", "", "20", "2"],
      ["White", "", "", "", ""],
    ],
    MAP,
  );

  test("counts what will happen", () => {
    const totals = summarise(rows);
    assert.equal(totals.total, 3);
    assert.equal(totals.create, 2);
    assert.equal(totals.error, 1);
  });

  test("applies the valid rows and leaves the invalid ones out", () => {
    /*
     * "Import the 95 valid rows" — the three that failed stay on the preview
     * with their reasons rather than being silently dropped or blocking the
     * rest.
     */
    const next = applyImport([], rows);
    assert.equal(next.length, 2);
    assert.deepEqual(next.map((r) => r.priceOverride), [10, 20]);
  });

  test("an update replaces in place rather than appending", () => {
    const existing = [withValue(withValue({ sku: "X", colorId: "", sizeId: "", stock: 1 }, colour, "white"), size, "m")];
    const { rows: updates } = plan([["White", "M", "", "99", ""]], MAP, {
      existing,
      existingPolicy: "update",
    });
    const next = applyImport(existing, updates);
    assert.equal(next.length, 1);
    assert.equal(next[0]!.priceOverride, 99);
  });

  test("an empty sheet is an empty plan", () => {
    assert.deepEqual(plan([], MAP).rows, []);
  });
});

/* -------------------------------------------------------------------------- */
/*  Google Sheets                                                             */
/* -------------------------------------------------------------------------- */

describe("sheetCsvUrl", () => {
  test("rewrites a sheet link to its CSV export", () => {
    /*
     * A pasted sheet URL is a page: fetching it returns the editor's HTML.
     * Rewriting the link is the whole trick, and it needs no key for a sheet
     * shared with anyone-with-the-link.
     */
    assert.equal(
      sheetCsvUrl("https://docs.google.com/spreadsheets/d/ABC123_x-y/edit#gid=0"),
      "https://docs.google.com/spreadsheets/d/ABC123_x-y/export?format=csv&gid=0",
    );
  });

  test("carries the tab across", () => {
    // Without the gid the export returns the first sheet, and a merchant who
    // sent the second one silently imports the wrong data.
    assert.equal(
      sheetCsvUrl("https://docs.google.com/spreadsheets/d/ABC/edit#gid=98765"),
      "https://docs.google.com/spreadsheets/d/ABC/export?format=csv&gid=98765",
    );
  });

  test("a link with no tab exports the first sheet", () => {
    assert.equal(
      sheetCsvUrl("https://docs.google.com/spreadsheets/d/ABC/edit"),
      "https://docs.google.com/spreadsheets/d/ABC/export?format=csv",
    );
  });

  test("anything that is not a sheet link yields nothing", () => {
    assert.equal(sheetCsvUrl("https://example.com/file.csv"), undefined);
    assert.equal(sheetCsvUrl("not a url"), undefined);
  });
});

describe("driveFileId", () => {
  test("reads a Drive file link", () => {
    assert.equal(driveFileId("https://drive.google.com/file/d/FILE_ID_1/view"), "FILE_ID_1");
    assert.equal(driveFileId("https://drive.google.com/open?id=FILE_ID_2"), "FILE_ID_2");
  });

  test("anything else yields nothing", () => {
    assert.equal(driveFileId("https://example.com"), undefined);
  });
});
