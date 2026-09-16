import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  MAX_USEFUL_DISTANCE,
  colourDistance,
  dominantSwatches,
  hexToRgb,
  rgbToLab,
  scoreByPalette,
  similarTo,
  swatchToHex,
} from "../src/lib/visual-search";
import type { Product } from "../src/types";

/**
 * Finding a piece from a photograph, by colour.
 *
 * The thing worth testing hardest is what gets thrown away: a product shot is
 * mostly backdrop and shadow, and those are the most common pixels in it by a
 * wide margin. Leave them in and every upload answers "white".
 *
 * Run with:
 *
 *     npm run test:visual-search
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
    price: 30,
    currency: "JOD",
    images: [],
    colors: [],
    sizes: [],
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

const colour = (id: string, hex: string) => ({ id, name: { en: id, ar: id }, hex });

/** RGBA the way a canvas produces it. */
function pixels(list: [number, number, number, number][]): number[] {
  return list.flat();
}

/* -------------------------------------------------------------------------- */
/*  Colour                                                                    */
/* -------------------------------------------------------------------------- */

describe("hexToRgb", () => {
  test("reads a hex, with or without the hash", () => {
    assert.deepEqual(hexToRgb("#1F44B8"), { r: 31, g: 68, b: 184 });
    assert.deepEqual(hexToRgb("1f44b8"), { r: 31, g: 68, b: 184 });
  });

  test("refuses anything else rather than guessing", () => {
    // A guessed colour silently mis-ranks everything downstream.
    assert.equal(hexToRgb("#fff"), undefined);
    assert.equal(hexToRgb("blue"), undefined);
    assert.equal(hexToRgb(""), undefined);
  });
});

describe("colourDistance", () => {
  test("a colour is no distance from itself", () => {
    assert.equal(colourDistance("#1F44B8", "#1f44b8"), 0);
  });

  test("two greens are closer than a green and a red", () => {
    const greens = colourDistance("#3A7D44", "#4C8F52");
    const across = colourDistance("#3A7D44", "#B8342A");
    assert.equal(greens < across, true);
  });

  test("perceptual, not channel arithmetic", () => {
    /*
     * The reason Lab is worth twenty lines. In plain RGB the step from black
     * to navy and the step between two bright yellows are the same size; to a
     * person they are not, and an RGB match puts navy beside black while
     * missing two greens anybody would pair.
     */
    const darkPair = colourDistance("#000000", "#0B1A3A");
    const brightPair = colourDistance("#F2E34A", "#FDEE55");
    assert.equal(brightPair < darkPair, true);
  });

  test("an unreadable hex is infinitely far, never accidentally close", () => {
    assert.equal(colourDistance("#1F44B8", "not a colour"), Number.POSITIVE_INFINITY);
  });
});

describe("rgbToLab", () => {
  test("black and white land at the ends of the lightness axis", () => {
    assert.equal(Math.round(rgbToLab(0, 0, 0)[0]), 0);
    assert.equal(Math.round(rgbToLab(255, 255, 255)[0]), 100);
  });
});

/* -------------------------------------------------------------------------- */
/*  Reading a picture                                                         */
/* -------------------------------------------------------------------------- */

describe("dominantSwatches", () => {
  test("finds the colour that is actually there", () => {
    const green: [number, number, number, number] = [58, 125, 68, 255];
    const swatches = dominantSwatches(pixels(Array.from({ length: 40 }, () => green)));
    assert.equal(swatches.length, 1);
    assert.equal(swatchToHex(swatches[0]!), "#3a7d44");
    assert.equal(swatches[0]!.weight, 1);
  });

  test("drops the backdrop and the shadow", () => {
    /*
     * The failure that would make the whole feature useless. In a product
     * photograph the white sweep and the dark shadow are the most common
     * pixels by a wide margin — counted, every upload returns "white" and the
     * feature answers the same way for every picture.
     */
    const white: [number, number, number, number] = [252, 252, 250, 255];
    const black: [number, number, number, number] = [6, 6, 8, 255];
    const red: [number, number, number, number] = [184, 52, 42, 255];

    const swatches = dominantSwatches(
      pixels([
        ...Array.from({ length: 200 }, () => white),
        ...Array.from({ length: 120 }, () => black),
        ...Array.from({ length: 30 }, () => red),
      ]),
    );

    assert.equal(swatches.length, 1);
    assert.equal(swatchToHex(swatches[0]!), "#b8342a");
  });

  test("ignores transparent padding", () => {
    const clear: [number, number, number, number] = [180, 50, 40, 0];
    const blue: [number, number, number, number] = [31, 68, 184, 255];
    const swatches = dominantSwatches(
      pixels([...Array.from({ length: 100 }, () => clear), ...Array.from({ length: 10 }, () => blue)]),
    );
    assert.equal(swatches.length, 1);
    assert.equal(swatchToHex(swatches[0]!), "#1f44b8");
  });

  test("near-identical shades collapse into one swatch", () => {
    // Otherwise the gradient across a single garment reads as four colours and
    // crowds out everything else in the picture.
    const swatches = dominantSwatches(
      pixels([
        ...Array.from({ length: 20 }, () => [58, 125, 68, 255] as [number, number, number, number]),
        ...Array.from({ length: 20 }, () => [60, 128, 70, 255] as [number, number, number, number]),
      ]),
    );
    assert.equal(swatches.length, 1);
  });

  test("two real colours both survive, most common first", () => {
    const swatches = dominantSwatches(
      pixels([
        ...Array.from({ length: 40 }, () => [184, 52, 42, 255] as [number, number, number, number]),
        ...Array.from({ length: 10 }, () => [31, 68, 184, 255] as [number, number, number, number]),
      ]),
    );
    assert.equal(swatches.length, 2);
    assert.equal(swatchToHex(swatches[0]!), "#b8342a");
    assert.equal(swatches[0]!.weight > swatches[1]!.weight, true);
  });

  test("a picture with nothing but backdrop yields nothing, rather than white", () => {
    // Answering "white" for a blank photograph is worse than saying nothing:
    // it returns a page of results that have no relationship to the upload.
    const white: [number, number, number, number] = [255, 255, 255, 255];
    assert.deepEqual(dominantSwatches(pixels(Array.from({ length: 50 }, () => white))), []);
  });

  test("an empty buffer is empty, not a crash", () => {
    assert.deepEqual(dominantSwatches([]), []);
  });
});

/* -------------------------------------------------------------------------- */
/*  Matching                                                                  */
/* -------------------------------------------------------------------------- */

describe("scoreByPalette", () => {
  const catalogue = [
    product({ id: "green", colors: [colour("sage", "#3A7D44")] }),
    product({ id: "red", colors: [colour("crimson", "#B8342A")] }),
    product({ id: "blue", colors: [colour("cobalt", "#1F44B8")] }),
  ];

  test("ranks the closest colour first", () => {
    const matches = scoreByPalette(catalogue, [{ hex: "#4C8F52", weight: 1 }]);
    assert.equal(matches[0]!.product.id, "green");
    assert.equal(matches[0]!.matchedHex, "#3A7D44");
  });

  test("says which colourway matched, so the result can explain itself", () => {
    const matches = scoreByPalette(catalogue, [{ hex: "#C04038", weight: 1 }]);
    assert.equal(matches[0]!.matchedHex, "#B8342A");
  });

  test("a product is scored by its best colourway, not by an average", () => {
    /*
     * "Do you have this in green" is answered yes if any one colourway is. A
     * piece offered in eight colours would otherwise always lose to a piece
     * offered in one.
     */
    const many = product({
      id: "many",
      colors: [colour("a", "#B8342A"), colour("b", "#1F44B8"), colour("c", "#3A7D44")],
    });
    const matches = scoreByPalette([many, ...catalogue], [{ hex: "#3A7D44", weight: 1 }]);
    assert.equal(["many", "green"].includes(matches[0]!.product.id), true);
    assert.equal(matches[0]!.score, 1);
  });

  test("unrelated colours are left out, not ranked last", () => {
    // A page of results that have nothing to do with the upload is worse than
    // a short one.
    const matches = scoreByPalette(catalogue, [{ hex: "#3A7D44", weight: 1 }]);
    assert.equal(matches.every((m) => m.score > 0), true);
    assert.equal(matches.some((m) => m.product.id === "blue"), false);
  });

  test("a draft or archived piece is never returned", () => {
    const hidden = product({ id: "draft", status: "draft", colors: [colour("sage", "#3A7D44")] });
    const matches = scoreByPalette([hidden], [{ hex: "#3A7D44", weight: 1 }]);
    assert.deepEqual(matches, []);
  });

  test("an empty palette matches nothing rather than everything", () => {
    assert.deepEqual(scoreByPalette(catalogue, []), []);
  });

  test("a product with no colours cannot match", () => {
    const plain = product({ id: "plain", colors: [] });
    assert.deepEqual(scoreByPalette([plain], [{ hex: "#3A7D44", weight: 1 }]), []);
  });

  test("the limit is respected", () => {
    assert.equal(scoreByPalette(catalogue, [{ hex: "#3A7D44", weight: 1 }], 1).length, 1);
  });

  test("the threshold is the one the module publishes", () => {
    // So a caller rendering "no close matches" agrees with the ranking.
    assert.equal(MAX_USEFUL_DISTANCE > 0, true);
  });
});

describe("similarTo", () => {
  const source = product({
    id: "source",
    colors: [colour("sage", "#3A7D44")],
    categoryPath: ["knitwear", "tees"],
  });

  const catalogue = [
    source,
    product({ id: "same-dept", colors: [colour("sage", "#4C8F52")], categoryPath: ["knitwear", "tees"] }),
    product({ id: "other-dept", colors: [colour("sage", "#3A7D44")], categoryPath: ["shoes"] }),
    product({ id: "unrelated", colors: [colour("cobalt", "#1F44B8")], categoryPath: ["shoes"] }),
  ];

  test("never returns the piece itself", () => {
    assert.equal(similarTo(source, catalogue).some((p) => p.id === "source"), false);
  });

  test("a piece from another department still qualifies on colour", () => {
    /*
     * Somebody looking at a green coat is very often looking for the colour. A
     * hard category filter would answer "a green coat" with only coats.
     */
    const results = similarTo(source, catalogue);
    assert.equal(results.some((p) => p.id === "other-dept"), true);
  });

  test("the same department is a nudge, not a rule", () => {
    // Exact colour and same department beats exact colour alone.
    const exactSameDept = product({
      id: "exact-same",
      colors: [colour("sage", "#3A7D44")],
      categoryPath: ["knitwear", "tees"],
    });
    const results = similarTo(source, [source, exactSameDept, catalogue[2]!]);
    assert.equal(results[0]!.id, "exact-same");
  });

  test("a piece with no colours recommends nothing rather than everything", () => {
    const plain = product({ id: "plain", colors: [] });
    assert.deepEqual(similarTo(plain, catalogue), []);
  });
});
