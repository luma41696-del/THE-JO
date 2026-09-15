import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  COLOR_PALETTE,
  MAX_VARIANTS,
  combinationCount,
  duplicateSkus,
  generateVariants,
  isHex,
  normaliseSku,
  optionId,
  paletteColor,
  priceForQuantity,
  suggestSku,
  tierProblems,
} from "../src/lib/product-options";

/**
 * Options, permutations and quantity pricing.
 *
 * The combination maths is where the off-by-one lives, and losing a merchant's
 * afternoon of typed prices is the failure that matters — so most of this is
 * about what regeneration *preserves*.
 *
 * Run with:
 *
 *     npm run test:product-options
 */

/* -------------------------------------------------------------------------- */
/*  The palette                                                               */
/* -------------------------------------------------------------------------- */

describe("the colour palette", () => {
  test("carries cobalt, named in both languages", () => {
    const cobalt = paletteColor("cobalt");
    assert.ok(cobalt, "cobalt must be in the palette");
    assert.equal(cobalt.name.en, "Cobalt");
    assert.equal(cobalt.name.ar, "كوبالت");
    assert.equal(isHex(cobalt.hex), true);
  });

  test("cobalt is a blue, not a navy pretending to be one", () => {
    // Blue channel clearly dominant, and light enough not to read as black.
    const hex = paletteColor("cobalt")!.hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    assert.equal(b > r + 60, true, `blue must dominate red (${hex})`);
    assert.equal(b > g + 60, true, `blue must dominate green (${hex})`);
    assert.equal(b > 120, true, `too dark to read as a colour (${hex})`);
  });

  test("every colour has a name in both languages and a renderable swatch", () => {
    for (const colour of COLOR_PALETTE) {
      assert.equal(colour.name.en.length > 0, true, `${colour.id} needs an English name`);
      assert.equal(colour.name.ar.length > 0, true, `${colour.id} needs an Arabic name`);
      assert.equal(isHex(colour.hex), true, `${colour.id} has an unrenderable hex`);
    }
  });

  test("ids are unique — a variant resolves its colour through one", () => {
    const ids = COLOR_PALETTE.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("a hex is validated, not trusted", () => {
    assert.equal(isHex("#1F44B8"), true);
    assert.equal(isHex("#fff"), false);
    assert.equal(isHex("1F44B8"), false);
    assert.equal(isHex("blue"), false);
    assert.equal(isHex("#GGGGGG"), false);
  });
});

describe("optionId", () => {
  test("makes a code-safe id from a name", () => {
    assert.equal(optionId("Cobalt Blue"), "cobalt-blue");
    assert.equal(optionId("  Off White  "), "off-white");
  });

  test("an Arabic-only name still gets a usable Latin id", () => {
    /*
     * The id ends up inside an SKU, and an SKU with Arabic in it breaks every
     * scanner, spreadsheet and courier label it touches.
     */
    const id = optionId("كوبالت");
    assert.match(id, /^opt-[a-z0-9]+$/);
  });

  test("the same name always gives the same id", () => {
    assert.equal(optionId("كوبالت"), optionId("كوبالت"));
  });
});

/* -------------------------------------------------------------------------- */
/*  Codes                                                                     */
/* -------------------------------------------------------------------------- */

describe("SKUs", () => {
  test("are normalised to something a scanner copes with", () => {
    assert.equal(normaliseSku("  tee wht m "), "TEE-WHT-M");
    assert.equal(normaliseSku("tee__wht///m"), "TEE-WHT-M");
    assert.equal(normaliseSku("--tee--"), "TEE");
  });

  test("a suggestion is readable on a picking list", () => {
    assert.equal(
      suggestSku("TEE", { colorId: "white", sizeId: "l", designId: "palm" }),
      "TEE-WHIT-L-PALM",
    );
  });

  test("duplicates are found, including ones that only differ in case or spacing", () => {
    const dupes = duplicateSkus([
      { sku: "TEE-WHT-M" },
      { sku: "tee wht m" },
      { sku: "TEE-WHT-L" },
    ]);
    assert.deepEqual(dupes, ["TEE-WHT-M"]);
  });

  test("blank codes are not counted as duplicates of each other", () => {
    // They are a different error — "every variant needs a code" — and reporting
    // them as duplicates sends the merchant looking for the wrong thing.
    assert.deepEqual(duplicateSkus([{ sku: "" }, { sku: "  " }]), []);
  });
});

/* -------------------------------------------------------------------------- */
/*  Generating the table                                                      */
/* -------------------------------------------------------------------------- */

const colors = [{ id: "white" }, { id: "cobalt" }];
const sizes = [{ id: "m" }, { id: "l" }];

describe("generateVariants", () => {
  test("produces one row per combination", () => {
    const rows = generateVariants({ baseSku: "TEE", colors, sizes });
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((r) => `${r.colorId}/${r.sizeId}`).sort(),
      ["cobalt/l", "cobalt/m", "white/l", "white/m"],
    );
  });

  test("multiplies designs in as a third axis", () => {
    const rows = generateVariants({
      baseSku: "TEE",
      colors,
      sizes,
      designs: [{ id: "plain" }, { id: "palm" }],
    });
    assert.equal(rows.length, 8);
    assert.equal(combinationCount(colors, sizes, [{ id: "a" }, { id: "b" }]), 8);
  });

  test("regenerating preserves the price, stock and code of rows that exist", () => {
    /*
     * The failure that matters. Adding one size must not reset the prices and
     * counts already typed into the other rows — that is an afternoon of work,
     * and losing it silently is worse than having no generator.
     */
    const existing = generateVariants({ baseSku: "TEE", colors, sizes }).map((row, i) =>
      i === 0 ? { ...row, sku: "HAND-TYPED", stock: 42, priceOverride: 19.5 } : row,
    );

    const regenerated = generateVariants({
      baseSku: "TEE",
      colors,
      sizes: [...sizes, { id: "xl" }],
      existing,
    });

    assert.equal(regenerated.length, 6);
    const kept = regenerated.find((r) => r.sku === "HAND-TYPED");
    assert.ok(kept, "the hand-typed row must survive");
    assert.equal(kept.stock, 42);
    assert.equal(kept.priceOverride, 19.5);

    // And the new rows arrive empty rather than inheriting somebody else's price.
    const fresh = regenerated.filter((r) => r.sizeId === "xl");
    assert.equal(fresh.length, 2);
    assert.equal(fresh.every((r) => r.stock === 0 && r.priceOverride === undefined), true);
  });

  test("a row is matched on its axes, not on its code", () => {
    // So renaming an SKU by hand does not orphan its stock on the next regen.
    const existing = [
      { sku: "COMPLETELY-DIFFERENT", colorId: "white", sizeId: "m", stock: 7 },
    ];
    const rows = generateVariants({ baseSku: "TEE", colors, sizes, existing });
    const kept = rows.find((r) => r.colorId === "white" && r.sizeId === "m");
    assert.equal(kept?.stock, 7);
    assert.equal(kept?.sku, "COMPLETELY-DIFFERENT");
  });

  test("a product with no options still gets one sellable row", () => {
    const rows = generateVariants({ baseSku: "BALM", colors: [], sizes: [] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.colorId, "");
  });

  test("the generated table is capped", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}` }));
    const rows = generateVariants({ baseSku: "X", colors: many, sizes: many });
    assert.equal(rows.length, MAX_VARIANTS);
    assert.equal(combinationCount(many, many), 900);
  });

  test("generated codes are unique across the table", () => {
    const rows = generateVariants({
      baseSku: "TEE",
      colors,
      sizes,
      designs: [{ id: "plain" }, { id: "palm" }],
    });
    assert.deepEqual(duplicateSkus(rows), []);
  });
});

/* -------------------------------------------------------------------------- */
/*  Quantity pricing                                                          */
/* -------------------------------------------------------------------------- */

describe("priceForQuantity", () => {
  const tiers = [
    { minQuantity: 3, unitPrice: 11 },
    { minQuantity: 6, unitPrice: 10 },
  ];

  test("below the first tier the base price stands", () => {
    assert.equal(priceForQuantity(12, 1, tiers), 12);
    assert.equal(priceForQuantity(12, 2, tiers), 12);
  });

  test("the highest matching tier wins", () => {
    assert.equal(priceForQuantity(12, 3, tiers), 11);
    assert.equal(priceForQuantity(12, 5, tiers), 11);
    assert.equal(priceForQuantity(12, 6, tiers), 10);
    assert.equal(priceForQuantity(12, 50, tiers), 10);
  });

  test("tiers written out of order still behave", () => {
    // A merchant adding "10+" above "5+" has not created a hole where buying
    // more costs more.
    const jumbled = [
      { minQuantity: 6, unitPrice: 10 },
      { minQuantity: 3, unitPrice: 11 },
    ];
    assert.equal(priceForQuantity(12, 7, jumbled), 10);
    assert.equal(priceForQuantity(12, 4, jumbled), 11);
  });

  test("a tier never raises the price", () => {
    /*
     * A mistyped tier that charges more for buying more is a bug the customer
     * pays for. Refusing it here is cheaper than finding it in a support
     * ticket.
     */
    assert.equal(priceForQuantity(12, 5, [{ minQuantity: 3, unitPrice: 20 }]), 12);
  });

  test("no tiers, or a nonsense quantity, returns the base price", () => {
    assert.equal(priceForQuantity(12, 5), 12);
    assert.equal(priceForQuantity(12, 0, tiers), 12);
    assert.equal(priceForQuantity(12, Number.NaN, tiers), 12);
  });
});

describe("tierProblems", () => {
  test("accepts a sane ladder", () => {
    assert.deepEqual(tierProblems([{ minQuantity: 3, unitPrice: 11 }]), []);
  });

  test("rejects a tier that starts at one — that is just the price", () => {
    assert.equal(tierProblems([{ minQuantity: 1, unitPrice: 11 }]).length, 1);
  });

  test("rejects two tiers starting at the same quantity", () => {
    const problems = tierProblems([
      { minQuantity: 3, unitPrice: 11 },
      { minQuantity: 3, unitPrice: 10 },
    ]);
    assert.equal(problems.some((p) => p.includes("3")), true);
  });

  test("rejects a negative price", () => {
    assert.equal(tierProblems([{ minQuantity: 3, unitPrice: -1 }]).length, 1);
  });
});
