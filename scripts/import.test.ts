import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  IMPORT_FIELDS,
  autoMap,
  detectDelimiter,
  foldHeader,
  parseBoolean,
  parseDelimited,
  parseNumber,
  parseRow,
  planImport,
  productPatch,
  rowKey,
  slugFromCell,
  type ExistingProduct,
  type ImportFieldId,
} from "../src/lib/import";

/**
 * Importing somebody else's spreadsheet.
 *
 * The file is never in our format. It comes out of Excel with semicolons, out
 * of a supplier's system with a currency symbol in the price column, and out of
 * a year of typing with the same product on two rows. Most of these tests are
 * about reading such a file correctly rather than rejecting it — and about the
 * rows the planner refuses to treat as an update.
 *
 * Run with:
 *
 *     npm run test:import
 */

/* -------------------------------------------------------------------------- */
/*  Reading the file                                                          */
/* -------------------------------------------------------------------------- */

describe("detectDelimiter", () => {
  test("finds the semicolon Excel writes in an Arabic locale", () => {
    /*
     * The failure this prevents: a comma-only parser reads a semicolon file as
     * one column and reports "no columns found" for a file that is perfectly
     * well formed — and the merchant has no idea what is wrong with it.
     */
    assert.equal(detectDelimiter("name;price;stock\nTee;12;4"), ";");
  });

  test("finds a comma, a tab and a pipe", () => {
    assert.equal(detectDelimiter("name,price\nTee,12"), ",");
    assert.equal(detectDelimiter("name\tprice\nTee\t12"), "\t");
    assert.equal(detectDelimiter("name|price\nTee|12"), "|");
  });

  test("a comma inside a quoted header does not outvote the real separator", () => {
    assert.equal(detectDelimiter('"name, full";price;stock'), ";");
  });

  test("a single-column file falls back to a comma rather than guessing", () => {
    assert.equal(detectDelimiter("name\nTee"), ",");
  });
});

describe("parseDelimited", () => {
  test("reads a plain file", () => {
    assert.deepEqual(parseDelimited("a,b\n1,2"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("strips the BOM Excel writes", () => {
    /*
     * Left in place, `﻿` becomes part of the first column's name, so the
     * mapping never matches it — and the merchant sees their ID column
     * stubbornly unmapped with no visible reason.
     */
    const rows = parseDelimited("﻿id,price\np1,12");
    assert.equal(rows[0]![0], "id");
  });

  test("keeps a delimiter that is inside quotes", () => {
    const rows = parseDelimited('name,description\nTee,"black, wide, soft"');
    assert.deepEqual(rows[1], ["Tee", "black, wide, soft"]);
  });

  test("keeps a newline that is inside quotes", () => {
    // A description typed over two lines in Excel is one cell, not two rows.
    const rows = parseDelimited('name,description\nTee,"first line\nsecond line"');
    assert.equal(rows.length, 2);
    assert.equal(rows[1]![1], "first line\nsecond line");
  });

  test("a doubled quote is one quote", () => {
    const rows = parseDelimited('name\n"the ""wide"" tee"');
    assert.equal(rows[1]![0], 'the "wide" tee');
  });

  test("CRLF reads the same as LF", () => {
    assert.deepEqual(parseDelimited("a,b\r\n1,2\r\n"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("a trailing newline does not produce an empty row", () => {
    // Which would otherwise become a row of errors at the end of every import.
    assert.equal(parseDelimited("a,b\n1,2\n").length, 2);
  });

  test("empty cells are kept, so the columns stay aligned", () => {
    assert.deepEqual(parseDelimited("a,b,c\n1,,3")[1], ["1", "", "3"]);
  });

  test("Arabic content survives intact", () => {
    const rows = parseDelimited("الاسم;السعر\nتي شيرت قطن;12.500");
    assert.deepEqual(rows[1], ["تي شيرت قطن", "12.500"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  Numbers as people actually write them                                     */
/* -------------------------------------------------------------------------- */

describe("parseNumber", () => {
  test("reads a plain decimal", () => {
    assert.equal(parseNumber("12.5"), 12.5);
    assert.equal(parseNumber(12.5), 12.5);
  });

  test("reads Arabic-Indic digits", () => {
    // A merchant typing in Arabic on an Arabic keyboard produces these, and a
    // parser that refuses them makes them re-type their own catalogue.
    assert.equal(parseNumber("١٢٫٥"), 12.5);
    assert.equal(parseNumber("٣٥"), 35);
  });

  test("reads Eastern Arabic digits", () => {
    assert.equal(parseNumber("۱۲۳"), 123);
  });

  test("strips a currency, in either script", () => {
    assert.equal(parseNumber("JOD 12.500"), 12.5);
    assert.equal(parseNumber("12.500 د.أ"), 12.5);
    assert.equal(parseNumber("$99"), 99);
  });

  test("a thousands comma is not a decimal point", () => {
    assert.equal(parseNumber("1,234.50"), 1234.5);
    // Three digits after a lone comma reads as thousands: 12,500 is far more
    // often twelve and a half thousand than twelve and a half.
    assert.equal(parseNumber("12,500"), 12500);
  });

  test("a European decimal comma is read as one", () => {
    assert.equal(parseNumber("1.234,50"), 1234.5);
    assert.equal(parseNumber("12,5"), 12.5);
  });

  test("something that is not a number returns nothing, never zero", () => {
    /*
     * A zero here would price a product at nothing and look like a deliberate
     * value. `undefined` lets the row be reported as a problem instead.
     */
    assert.equal(parseNumber("about twelve"), undefined);
    assert.equal(parseNumber(""), undefined);
    assert.equal(parseNumber(undefined), undefined);
    assert.equal(parseNumber(Number.NaN), undefined);
  });
});

describe("parseBoolean", () => {
  test("reads yes and no in both languages", () => {
    assert.equal(parseBoolean("yes"), true);
    assert.equal(parseBoolean("نعم"), true);
    assert.equal(parseBoolean("0"), false);
    assert.equal(parseBoolean("لا"), false);
  });

  test("anything else is unknown rather than false", () => {
    assert.equal(parseBoolean("maybe"), undefined);
    assert.equal(parseBoolean(""), undefined);
  });
});

/* -------------------------------------------------------------------------- */
/*  Matching columns to fields                                                */
/* -------------------------------------------------------------------------- */

describe("autoMap", () => {
  test("maps the obvious English headers", () => {
    assert.deepEqual(autoMap(["SKU", "Price", "Stock"]), ["sku", "price", "totalStock"]);
  });

  test("maps Arabic headers", () => {
    assert.deepEqual(autoMap(["الاسم", "السعر", "المخزون"]), ["titleAr", "price", "totalStock"]);
  });

  test("ignores punctuation and case in a header", () => {
    assert.deepEqual(autoMap(["compare_at_price", "Product ID"]), ["compareAtPrice", "id"]);
  });

  test("exact matches are claimed before loose ones", () => {
    /*
     * "Compare at price" contains "price". Matching loosely first would let it
     * steal the price field, and the real price column would then map to
     * nothing — or worse, to the was-price.
     */
    assert.deepEqual(autoMap(["Compare at price", "Price"]), ["compareAtPrice", "price"]);
    assert.deepEqual(autoMap(["Price", "Compare at price"]), ["price", "compareAtPrice"]);
  });

  test("a field is claimed once, so two similar columns do not collide", () => {
    const mapped = autoMap(["Name", "Product name"]);
    assert.equal(mapped[0], "titleEn");
    assert.notEqual(mapped[1], "titleEn");
  });

  test("a column nobody recognises is left unmapped rather than guessed", () => {
    // An unmapped column is a question for the merchant. A guessed one is a
    // wrong value written across the catalogue.
    assert.equal(autoMap(["supplier lead time"])[0], null);
  });

  test("an empty header maps to nothing", () => {
    assert.equal(autoMap(["", "   "])[0], null);
  });
});

describe("foldHeader", () => {
  test("folds Arabic spelling differences", () => {
    assert.equal(foldHeader("الأسم"), foldHeader("الاسم"));
  });
});

/* -------------------------------------------------------------------------- */
/*  One row                                                                   */
/* -------------------------------------------------------------------------- */

const MAP: (ImportFieldId | null)[] = ["sku", "titleEn", "titleAr", "price", "totalStock"];

describe("parseRow", () => {
  test("reads a complete row", () => {
    const row = parseRow(["tee-01", "Cotton tee", "تي شيرت قطن", "12.500", "7"], MAP, 2);
    assert.deepEqual(row.problems, []);
    assert.equal(row.values.sku, "TEE-01");
    assert.equal(row.values.price, 12.5);
    assert.equal(row.values.totalStock, 7);
  });

  test("an empty cell is absent, not empty", () => {
    /*
     * The distinction the whole importer rests on. A blank stock column in a
     * price list means "do not touch the stock", not "set it to nothing".
     */
    const row = parseRow(["tee-01", "Cotton tee", "", "12.5", ""], MAP, 2);
    assert.equal("titleAr" in row.values, false);
    assert.equal("totalStock" in row.values, false);
  });

  test("a price that is not a number is a problem, and the row keeps the rest", () => {
    const row = parseRow(["tee-01", "Cotton tee", "قطن", "ask us", "7"], MAP, 4);
    assert.equal(row.problems.length, 1);
    assert.equal(row.problems[0]!.field, "price");
    assert.equal(row.problems[0]!.message.ar.length > 0, true);
    assert.equal(row.values.totalStock, 7);
  });

  test("every problem in a row is reported at once", () => {
    // So a merchant fixing a 300-row file makes one pass through it, not one
    // pass per problem.
    const row = parseRow(["tee", "Tee", "قطن", "nope", "-4"], MAP, 5);
    assert.equal(row.problems.length, 2);
  });

  test("a was-price below the price is caught in the preview", () => {
    const row = parseRow(
      ["tee", "Tee", "قطن", "20", "30"],
      ["sku", "titleEn", "titleAr", "price", "compareAtPrice"],
      2,
    );
    assert.deepEqual(row.problems, []);

    const bad = parseRow(
      ["tee", "Tee", "قطن", "30", "20"],
      ["sku", "titleEn", "titleAr", "price", "compareAtPrice"],
      2,
    );
    assert.equal(bad.problems.length, 1);
    assert.equal(bad.problems[0]!.field, "compareAtPrice");
  });

  test("tags split on either comma", () => {
    // Arabic keyboards produce ، and a parser that only knows , makes one tag
    // out of the whole list.
    const row = parseRow(["summer، cotton, sale"], ["tags"], 2);
    assert.deepEqual(row.values.tags, ["summer", "cotton", "sale"]);
  });

  test("a status is read however it was written", () => {
    assert.equal(parseRow(["published"], ["status"], 2).values.status, "active");
    assert.equal(parseRow(["منشور"], ["status"], 2).values.status, "active");
    assert.equal(parseRow(["مسودة"], ["status"], 2).values.status, "draft");
  });

  test("a status nobody recognises is a problem, not a silent draft", () => {
    // Defaulting it would unpublish products the file never mentioned
    // unpublishing.
    const row = parseRow(["on hold"], ["status"], 2);
    assert.equal(row.problems.length, 1);
    assert.equal("status" in row.values, false);
  });

  test("an unmapped column is skipped entirely", () => {
    const row = parseRow(["ignored", "Tee"], [null, "titleEn"], 2);
    assert.equal(row.values.titleEn, "Tee");
    assert.equal(Object.keys(row.values).length, 1);
  });
});

describe("slugFromCell", () => {
  test("makes a usable address", () => {
    assert.equal(slugFromCell("  Cotton Tee!  "), "cotton-tee");
  });

  test("keeps Arabic, which a URL can carry", () => {
    assert.equal(slugFromCell("تي شيرت قطن"), "تي-شيرت-قطن");
  });
});

/* -------------------------------------------------------------------------- */
/*  The plan                                                                  */
/* -------------------------------------------------------------------------- */

const catalogue: ExistingProduct[] = [
  {
    id: "p1",
    slug: "cotton-tee",
    sku: "TEE-01",
    title: { en: "Cotton tee", ar: "تي شيرت قطن" },
    price: 12.5,
    totalStock: 7,
    categoryId: "tees",
    status: "active",
    tags: ["cotton"],
  },
  {
    id: "p2",
    slug: "linen-shirt",
    sku: "SHIRT-01",
    title: { en: "Linen shirt", ar: "قميص كتان" },
    price: 30,
    totalStock: 2,
    categoryId: "shirts",
    status: "active",
  },
];

const row = (values: Partial<Record<ImportFieldId, unknown>>, line = 2) => ({
  line,
  values: values as never,
  problems: [],
});

describe("planImport", () => {
  test("a row matching nothing is a create", () => {
    const plan = planImport(
      [row({ titleEn: "New tee", titleAr: "جديد", categoryId: "tees", price: 9 })],
      catalogue,
    );
    assert.equal(plan.creates, 1);
    assert.equal(plan.rows[0]!.action, "create");
  });

  test("a create missing something essential is an error, not a half product", () => {
    /*
     * Importing the good half of a broken row is how a product ends up in the
     * catalogue with a name and no price.
     */
    const plan = planImport([row({ titleEn: "New tee" })], catalogue);
    assert.equal(plan.errors, 1);
    assert.equal(plan.rows[0]!.action, "error");
    assert.equal(plan.rows[0]!.problems.length >= 2, true);
  });

  test("a row matched by id is an update, and says so", () => {
    const plan = planImport([row({ id: "p1", price: 14 })], catalogue);
    assert.equal(plan.updates, 1);
    assert.equal(plan.rows[0]!.matchedId, "p1");
    assert.equal(plan.rows[0]!.matchedBy, "id");
  });

  test("an update needs only what changes", () => {
    // A file that is nothing but "code, new price" is a perfectly good price
    // list, and demanding a title on every row would make it unimportable.
    const plan = planImport([row({ sku: "TEE-01", price: 14 })], catalogue);
    assert.equal(plan.errors, 0);
    assert.equal(plan.rows[0]!.action, "update");
    assert.equal(plan.rows[0]!.matchedBy, "sku");
  });

  test("id beats slug beats code", () => {
    /*
     * An SKU is a supplier's code and is the one most likely to have been
     * reused across two products by accident, so it is the last resort.
     */
    const plan = planImport([row({ id: "p1", slug: "linen-shirt", sku: "SHIRT-01" })], catalogue);
    assert.equal(plan.rows[0]!.matchedId, "p1");
    assert.equal(plan.rows[0]!.matchedBy, "id");
  });

  test("the changes are listed with their before and after", () => {
    const plan = planImport([row({ id: "p1", price: 14, totalStock: 7 })], catalogue);
    const changes = plan.rows[0]!.changes!;
    // Stock is unchanged at 7, so it is not listed as a change.
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], { field: "price", from: 12.5, to: 14 });
  });

  test("re-importing the same file changes nothing", () => {
    /*
     * The most common thing a merchant does: run yesterday's file again to be
     * sure. Rewriting 300 unchanged products would move every `updatedAt`,
     * break every open editor's conflict check, and fill the audit log with
     * changes that changed nothing.
     */
    const plan = planImport(
      [row({ id: "p1", price: 12.5, totalStock: 7 }), row({ id: "p2", price: 30 }, 3)],
      catalogue,
    );
    assert.equal(plan.updates, 0);
    assert.equal(plan.unchanged, 2);
  });

  test("the same product twice in one file is a duplicate, not two updates", () => {
    /*
     * Applying both means the last one wins silently, and which one is last
     * depends on how somebody's spreadsheet happened to be sorted.
     */
    const plan = planImport(
      [row({ sku: "TEE-01", price: 14 }, 2), row({ sku: "TEE-01", price: 19 }, 7)],
      catalogue,
    );
    assert.equal(plan.duplicates, 1);
    assert.equal(plan.rows[1]!.action, "duplicate");
    assert.equal(plan.rows[1]!.duplicateOfLine, 2);
    // The first one still applies — it is the one the merchant can see.
    assert.equal(plan.rows[0]!.action, "update");
  });

  test("two new rows sharing a code collide with each other, not with the catalogue", () => {
    const plan = planImport(
      [
        row({ sku: "NEW-1", titleEn: "A", titleAr: "أ", categoryId: "tees", price: 5 }, 2),
        row({ sku: "NEW-1", titleEn: "B", titleAr: "ب", categoryId: "tees", price: 6 }, 3),
      ],
      catalogue,
    );
    assert.equal(plan.creates, 1);
    assert.equal(plan.duplicates, 1);
  });

  test("a row with a problem never counts as a create or an update", () => {
    const broken = { line: 2, values: { id: "p1", price: 14 } as never, problems: [
      { field: "price" as const, message: { en: "bad", ar: "خطأ" } },
    ] };
    const plan = planImport([broken], catalogue);
    assert.equal(plan.errors, 1);
    assert.equal(plan.updates, 0);
  });

  test("an errored row does not claim its key, so a later good row can use it", () => {
    // Otherwise one typo in an early row silently blocks the correct row
    // further down the file.
    const broken = { line: 2, values: { sku: "TEE-01" } as never, problems: [
      { field: null, message: { en: "bad", ar: "خطأ" } },
    ] };
    const plan = planImport([broken, row({ sku: "TEE-01", price: 14 }, 3)], catalogue);
    assert.equal(plan.rows[1]!.action, "update");
  });
});

describe("rowKey", () => {
  test("prefers the id, then the address, then the code", () => {
    assert.equal(rowKey(row({ id: "p1", slug: "s", sku: "K" })), "id:p1");
    assert.equal(rowKey(row({ slug: "s", sku: "K" })), "slug:s");
    assert.equal(rowKey(row({ sku: "K" })), "sku:K");
    assert.equal(rowKey(row({ price: 1 })), undefined);
  });
});

/* -------------------------------------------------------------------------- */
/*  What actually gets written                                                */
/* -------------------------------------------------------------------------- */

describe("productPatch", () => {
  test("writes only the fields the file carried", () => {
    /*
     * The one that matters most. An importer that sends `description: ""` for
     * a price-list file erases every description in the catalogue, and nothing
     * in the preview would have suggested it was going to.
     */
    const plan = planImport([row({ id: "p1", price: 14 })], catalogue);
    const patch = productPatch(plan.rows[0]!, catalogue[0]);
    assert.deepEqual(Object.keys(patch), ["price"]);
  });

  test("a partial name keeps the other language", () => {
    // Importing an English-only file must not empty every Arabic title.
    const plan = planImport([row({ id: "p1", titleEn: "Renamed" })], catalogue);
    const patch = productPatch(plan.rows[0]!, catalogue[0]) as { title: { en: string; ar: string } };
    assert.equal(patch.title.en, "Renamed");
    assert.equal(patch.title.ar, "تي شيرت قطن");
  });

  test("stock carries inStock with it", () => {
    /*
     * Two fields describing one fact. A listing reads `inStock`, so importing
     * a count of zero without it leaves the product on sale with nothing
     * behind it.
     */
    const plan = planImport([row({ id: "p1", totalStock: 0 })], catalogue);
    const patch = productPatch(plan.rows[0]!, catalogue[0]);
    assert.equal(patch.totalStock, 0);
    assert.equal(patch.inStock, false);

    const restock = planImport([row({ id: "p1", totalStock: 4 })], catalogue);
    assert.equal(productPatch(restock.rows[0]!, catalogue[0]).inStock, true);
  });

  test("a new product's patch carries everything the row had", () => {
    const plan = planImport(
      [row({ titleEn: "New", titleAr: "جديد", categoryId: "tees", price: 9, tags: ["a"] })],
      catalogue,
    );
    const patch = productPatch(plan.rows[0]!);
    assert.equal(patch.price, 9);
    assert.deepEqual(patch.tags, ["a"]);
    assert.deepEqual(patch.title, { en: "New", ar: "جديد" });
  });
});

/* -------------------------------------------------------------------------- */
/*  A file from end to end                                                    */
/* -------------------------------------------------------------------------- */

describe("a real file, start to finish", () => {
  test("a semicolon export with Arabic headers and Arabic digits imports", () => {
    const file =
      "﻿المعرف;الاسم;السعر;المخزون\n" +
      "p1;تي شيرت قطن;١٤٫٥٠٠;7\n" +
      "p2;قميص كتان;JOD 30.000;2\n" +
      ";بلا معرّف;5;1\n";

    const rows = parseDelimited(file);
    const headers = rows[0]!;
    const mapping = autoMap(headers);
    assert.deepEqual(mapping, ["id", "titleAr", "price", "totalStock"]);

    const parsed = rows.slice(1).map((cells, i) => parseRow(cells, mapping, i + 2));
    const plan = planImport(parsed, catalogue);

    // p1's price moves; p2 is unchanged; the third row has no id and cannot be
    // created without an English name, a category and a price.
    assert.equal(plan.updates, 1);
    assert.equal(plan.unchanged, 1);
    assert.equal(plan.errors, 1);
    assert.equal(plan.rows[0]!.changes?.[0]?.to, 14.5);
    assert.equal(plan.rows[2]!.line, 4);
  });
});

describe("the field catalogue", () => {
  test("every field is named in both languages and has aliases", () => {
    for (const field of IMPORT_FIELDS) {
      assert.equal(field.label.en.length > 0, true, `${field.id} needs an English label`);
      assert.equal(field.label.ar.length > 0, true, `${field.id} needs an Arabic label`);
      assert.equal(field.aliases.length > 0, true, `${field.id} needs aliases`);
    }
  });

  test("no alias is claimed by two fields", () => {
    /*
     * Across fields, a shared alias makes the mapping depend on field order —
     * the kind of thing that changes silently when somebody adds a field.
     * Within one field it is dead weight: folding already strips the shadda
     * and turns an underscore into a space, so a second spelling of the same
     * word can never be reached, and leaving it in suggests it is doing
     * something.
     */
    const seen = new Map<string, string>();
    for (const field of IMPORT_FIELDS) {
      for (const alias of field.aliases) {
        const folded = foldHeader(alias);
        assert.equal(
          seen.has(folded),
          false,
          `"${alias}" is claimed by both ${seen.get(folded)} and ${field.id}`,
        );
        seen.set(folded, field.id);
      }
    }
  });
});
