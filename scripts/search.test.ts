import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  SYNONYM_GROUPS,
  codesOf,
  editDistance,
  expandToken,
  looksLikeCode,
  normalizeArabic,
  rankProducts,
  scoreProduct,
  suggestTerms,
  tokenize,
} from "../src/lib/search";
import type { Product } from "../src/types";

/**
 * Searching a shop written in two languages.
 *
 * Almost every test here is a search that returned nothing before: a word
 * spelled without its hamza, a coat somebody called a jacket, a code off a
 * label, a two-word phrase with a definite article in the middle. Those are
 * not edge cases in an Arabic catalogue — they are how people type.
 *
 * Run with:
 *
 *     npm run test:search
 */

function product(over: Partial<Product> = {}): Partial<Product> {
  return {
    id: "p1",
    slug: "wool-coat",
    title: { en: "Atelier Wool Coat", ar: "معطف أتلييه الصوف" },
    subtitle: { en: "Double faced", ar: "بوجهين" },
    description: { en: "A heavy winter coat.", ar: "معطف شتوي ثقيل." },
    categoryId: "outerwear-coats",
    categoryPath: ["outerwear", "outerwear-coats"],
    tags: ["wool", "coat", "investment"],
    sku: "NS-ATWOCO",
    price: 349,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/*  Spelling                                                                  */
/* -------------------------------------------------------------------------- */

describe("normalizeArabic", () => {
  test("strips the diacritics a word may or may not carry", () => {
    assert.equal(normalizeArabic("قَمِيص"), normalizeArabic("قميص"));
  });

  test("folds every hamza-on-alef onto a bare alef", () => {
    /*
     * The single most common reason an Arabic search fails: the hamza is
     * routinely dropped when typing quickly, and "ابيض" then matches nothing
     * in a catalogue that spells it "أبيض".
     */
    const bare = normalizeArabic("ابيض");
    assert.equal(normalizeArabic("أبيض"), bare);
    assert.equal(normalizeArabic("إبيض"), bare);
    assert.equal(normalizeArabic("آبيض"), bare);
  });

  test("folds ta marbuta onto ha, and alef maqsura onto ya", () => {
    assert.equal(normalizeArabic("عباية"), normalizeArabic("عبايه"));
    assert.equal(normalizeArabic("مرمى"), normalizeArabic("مرمي"));
  });

  test("removes the kashida, which carries no sound", () => {
    // Typesetting stretches a word with ـ; it must not change what it matches.
    assert.equal(normalizeArabic("قمــــيص"), normalizeArabic("قميص"));
  });

  test("reads Arabic-Indic digits as digits", () => {
    assert.equal(normalizeArabic("مقاس ٤٢"), "مقاس 42");
  });

  test("lowercases and strips Latin accents", () => {
    assert.equal(normalizeArabic("Créme"), normalizeArabic("creme"));
  });
});

describe("tokenize", () => {
  test("splits on punctuation from either script", () => {
    assert.deepEqual(tokenize("معطف، صوف"), ["معطف", "صوف"]);
    assert.deepEqual(tokenize("wool; coat"), ["wool", "coat"]);
  });

  test("drops the definite article so a phrase still matches", () => {
    /*
     * "معطف الصوف" and "معطف صوف" are the same request, and one definite
     * article between the words used to fail the whole query.
     */
    assert.deepEqual(tokenize("معطف الصوف"), tokenize("معطف صوف"));
  });

  test("keeps a short word that would vanish without its article", () => {
    // Stripping ال from الم leaves م, which matches everything.
    assert.deepEqual(tokenize("الم"), ["الم"]);
  });

  test("an empty query yields no tokens", () => {
    assert.deepEqual(tokenize("   "), []);
  });
});

/* -------------------------------------------------------------------------- */
/*  Vocabulary                                                                */
/* -------------------------------------------------------------------------- */

describe("synonyms", () => {
  test("a coat is found by every word for a coat", () => {
    /*
     * The customer types what they call it. The catalogue is written in what
     * the merchant calls it. Neither is wrong, and without this table the shop
     * appears to stock no coats.
     */
    for (const word of ["جاكيت", "بالطو", "كوت", "jacket", "coat"]) {
      assert.equal(scoreProduct(product(), word) > 0, true, `"${word}" should find the coat`);
    }
  });

  test("regional words find the thing, not just the formal ones", () => {
    const shoe = product({
      title: { en: "Suede Runner", ar: "حذاء رياضي من الشمواه" },
      tags: ["footwear"],
      sku: "NS-SUERUN",
    });
    for (const word of ["جزمة", "صباط", "كوتشي", "سنيكرز", "sneakers"]) {
      assert.equal(scoreProduct(shoe, word) > 0, true, `"${word}" should find the shoe`);
    }
  });

  test("searching in English finds an Arabic-only name", () => {
    const arabicOnly = product({
      title: { en: "", ar: "معطف صوف" },
      tags: [],
      description: { en: "", ar: "" },
      subtitle: undefined,
    });
    assert.equal(scoreProduct(arabicOnly, "coat") > 0, true);
  });

  test("searching in Arabic finds an English-only name", () => {
    const englishOnly = product({
      title: { en: "Wool Coat", ar: "" },
      tags: [],
      description: { en: "", ar: "" },
      subtitle: undefined,
    });
    assert.equal(scoreProduct(englishOnly, "معطف") > 0, true);
  });

  test("a synonym match is worth less than the word itself", () => {
    // Both are results; the one the merchant actually wrote comes first.
    const direct = scoreProduct(product(), "معطف");
    const viaSynonym = scoreProduct(product(), "جاكيت");
    assert.equal(direct > viaSynonym, true);
  });

  test("expandToken returns the word itself when it has no group", () => {
    assert.deepEqual(expandToken("zzzznotaword"), ["zzzznotaword"]);
  });

  test("a term in two groups carries both", () => {
    // "denim" is a material and a garment; it must find jeans and denim things.
    assert.equal(expandToken(normalizeArabic("denim")).includes(normalizeArabic("جينز")), true);
  });

  test("every synonym group has at least one word in each script", () => {
    /*
     * A group that is all-English cannot help an Arabic search, which is the
     * entire reason the table exists — so a group missing one side is a bug
     * that would otherwise go unnoticed until a customer hit it.
     */
    const arabic = /[؀-ۿ]/;
    const latin = /[a-z]/i;
    for (const group of SYNONYM_GROUPS) {
      assert.equal(group.some((w) => arabic.test(w)), true, `no Arabic in [${group.join(", ")}]`);
      assert.equal(group.some((w) => latin.test(w)), true, `no English in [${group.join(", ")}]`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Codes                                                                     */
/* -------------------------------------------------------------------------- */

describe("codes", () => {
  test("a code off the label finds its product", () => {
    // `sku` was not in the haystack at all before: this returned nothing.
    assert.equal(scoreProduct(product(), "NS-ATWOCO") > 0, true);
  });

  test("a code matches however it was punctuated", () => {
    assert.equal(scoreProduct(product(), "nsatwoco") > 0, true);
    assert.equal(scoreProduct(product(), "ns_atwoco") > 0, true);
  });

  test("a partial code matches from the start", () => {
    assert.equal(scoreProduct(product(), "NS-ATW") > 0, true);
  });

  test("a variant's own code finds the parent product", () => {
    // The code on the label of the thing in the customer's hand is the
    // variant's, not the parent's.
    const withVariants = product({
      sku: "NS-TEE",
      variants: [{ sku: "NS-TEE-WHT-M", colorId: "white", sizeId: "m", stock: 2 }],
    });
    assert.equal(scoreProduct(withVariants, "NS-TEE-WHT-M") > 0, true);
  });

  test("a barcode finds it", () => {
    assert.equal(scoreProduct(product({ gtin: "6281000123457" }), "6281000123457") > 0, true);
  });

  test("a code that belongs to nothing returns nothing rather than fuzzy matches", () => {
    /*
     * Somebody typing a code wants that product. Falling back to a word search
     * would return the whole catalogue for a mistyped digit.
     */
    assert.equal(scoreProduct(product(), "ZZ-99999"), 0);
  });

  test("a word is not mistaken for a code", () => {
    // Treating "coat" as a code would answer nothing at all.
    assert.equal(looksLikeCode("coat"), false);
    assert.equal(looksLikeCode("معطف"), false);
    assert.equal(looksLikeCode("NS-ATWOCO"), true);
    assert.equal(looksLikeCode("6281000123457"), true);
  });

  test("codesOf gathers the product's, its variants' and its barcode", () => {
    const codes = codesOf(
      product({
        sku: "A-1",
        gtin: "12345",
        variants: [{ sku: "A-1-M", colorId: "w", sizeId: "m", stock: 1 }],
      }),
    );
    assert.deepEqual(codes.sort(), ["12345", "a1", "a1m"].sort());
  });
});

/* -------------------------------------------------------------------------- */
/*  Phrases, and what must not match                                          */
/* -------------------------------------------------------------------------- */

describe("multi-word queries", () => {
  test("every word has to be somewhere", () => {
    /*
     * Two words narrow the search. "معطف صوف" means a wool coat, not every
     * coat plus every wool thing — an any-token search returns a catalogue.
     */
    assert.equal(scoreProduct(product(), "معطف صوف") > 0, true);
    assert.equal(scoreProduct(product(), "معطف جينز"), 0);
  });

  test("a definite article between the words does not break it", () => {
    assert.equal(scoreProduct(product(), "معطف الصوف") > 0, true);
  });

  test("a phrase found whole outranks the same words found apart", () => {
    const together = product({ title: { en: "Wool Coat", ar: "معطف صوف" } });
    const apart = product({
      title: { en: "Coat", ar: "معطف" },
      tags: ["wool"],
      description: { en: "wool", ar: "صوف" },
    });
    assert.equal(scoreProduct(together, "wool coat") > scoreProduct(apart, "wool coat"), true);
  });

  test("a query never matches across the seam between two fields", () => {
    /*
     * The old search joined the fields into one string, so a query could match
     * the end of one and the start of the next — returning a product that
     * contains the phrase nowhere.
     */
    const seam = product({
      title: { en: "Coat", ar: "معطف" },
      tags: ["investment"],
      subtitle: undefined,
      description: { en: "", ar: "" },
    });
    assert.equal(scoreProduct(seam, "coatinvestment"), 0);
  });

  test("an empty query matches nothing", () => {
    assert.equal(scoreProduct(product(), "   "), 0);
  });
});

describe("a word found only in the prose", () => {
  /*
   * Both of these are real products from the catalogue, and both were returned
   * by a search for "جاكيت" until the rule below existed. The word is genuinely
   * in each description; neither product is a jacket.
   */
  const balm = product({
    title: { en: "Leather Balm", ar: "بلسم الجلد" },
    subtitle: { en: "Neutral, beeswax base", ar: "محايد بقاعدة شمع العسل" },
    description: {
      en: "A thin coat twice a year keeps it supple.",
      ar: "طبقة رقيقة مرتين في السنة تُبقيه ليّناً.",
    },
    categoryId: "objects-care",
    categoryPath: ["objects", "objects-care"],
    tags: ["care", "leather", "object"],
    sku: "NS-LEABAL",
  });

  const dress = product({
    title: { en: "Column Knit Dress", ar: "فستان تريكو عمودي" },
    subtitle: { en: "Seamless merino column", ar: "ميرينو بلا خياطات" },
    description: { en: "It works under a coat and on its own.", ar: "" },
    categoryId: "dresses-day",
    categoryPath: ["dresses", "dresses-day"],
    tags: ["knit", "merino", "dress"],
    sku: "NS-COLKNI",
  });

  test("does not make the product a result on its own", () => {
    assert.equal(scoreProduct(balm, "coat"), 0);
    assert.equal(scoreProduct(dress, "coat"), 0);
    assert.equal(scoreProduct(balm, "جاكيت"), 0);
  });

  test("but the description is still searched, and still narrows", () => {
    /*
     * Dropping the description entirely would be the easy fix and the wrong
     * one: "wool coat" has to find a coat whose fabric is only mentioned in
     * its prose. The rule is that *something* must name the product, not that
     * prose is worthless.
     */
    const coat = product({
      title: { en: "Atelier Coat", ar: "معطف أتلييه" },
      tags: [],
      description: { en: "Double-faced Italian wool.", ar: "صوف إيطالي." },
    });
    assert.equal(scoreProduct(coat, "wool coat") > 0, true);
    // And the prose alone still cannot carry it.
    assert.equal(scoreProduct(coat, "italian"), 0);
  });

  test("the product each word actually names still wins", () => {
    const realCoat = product({ title: { en: "Wool Coat", ar: "معطف صوف" }, tags: [] });
    const results = rankProducts([balm, dress, realCoat], "coat", 10);
    assert.deepEqual(results.map((r) => r.title!.en), ["Wool Coat"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  Ranking                                                                   */
/* -------------------------------------------------------------------------- */

describe("rankProducts", () => {
  const catalogue = [
    product({ id: "tagged", title: { en: "Linen Shirt", ar: "قميص كتان" }, tags: ["coat"], price: 30, sku: "A" }),
    product({ id: "named", title: { en: "Wool Coat", ar: "معطف صوف" }, tags: [], price: 300, sku: "B" }),
    product({ id: "described", title: { en: "Scarf", ar: "وشاح" }, tags: [], description: { en: "wear with a coat", ar: "" }, price: 40, sku: "C" }),
  ];

  test("the product named for the query comes first", () => {
    /*
     * The failure that made the old search feel broken: results came back in
     * catalogue order, so the coat could sit below a shirt tagged "coat".
     */
    const results = rankProducts(catalogue, "coat", 10);
    assert.equal(results[0]!.id, "named");
  });

  test("a tag beats a description", () => {
    const results = rankProducts(catalogue, "coat", 10);
    assert.deepEqual(results.map((r) => r.id), ["named", "tagged", "described"]);
  });

  test("the limit is respected", () => {
    assert.equal(rankProducts(catalogue, "coat", 2).length, 2);
  });

  test("nothing matching returns nothing", () => {
    assert.deepEqual(rankProducts(catalogue, "bicycle", 10), []);
  });

  test("an empty query returns nothing rather than the catalogue", () => {
    assert.deepEqual(rankProducts(catalogue, "", 10), []);
  });

  test("ties break on price, so two identical searches agree", () => {
    // Without a tiebreak the order depends on however the catalogue was
    // sorted, and the same search twice can disagree.
    const twins = [
      product({ id: "dear", title: { en: "Coat", ar: "معطف" }, tags: [], price: 500, sku: "X" }),
      product({ id: "cheap", title: { en: "Coat", ar: "معطف" }, tags: [], price: 100, sku: "Y" }),
    ];
    assert.deepEqual(rankProducts(twins, "coat", 10).map((r) => r.id), ["cheap", "dear"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  When nothing matches                                                      */
/* -------------------------------------------------------------------------- */

describe("suggestTerms", () => {
  const catalogue = [
    product({ title: { en: "Wool Coat", ar: "معطف صوف" }, tags: ["winter"] }),
    product({ title: { en: "Linen Shirt", ar: "قميص كتان" }, tags: ["summer"] }),
  ];

  test("offers the nearest word the shop actually uses", () => {
    // A dead end that says only "no results" teaches the customer nothing.
    const suggestions = suggestTerms(catalogue, "shrt", "en");
    assert.equal(suggestions.some((s) => s.toLowerCase().includes("shirt")), true);
  });

  test("corrects an Arabic typo", () => {
    const suggestions = suggestTerms(catalogue, "قميس", "ar");
    assert.equal(suggestions.length > 0, true);
  });

  test("a word nothing resembles offers nothing, rather than a wrong guess", () => {
    // Beyond two edits it is a different word, and offering one reads as the
    // shop not listening.
    assert.deepEqual(suggestTerms(catalogue, "bicycle", "en"), []);
  });

  test("an empty query offers nothing", () => {
    assert.deepEqual(suggestTerms(catalogue, "", "en"), []);
  });
});

describe("editDistance", () => {
  test("counts the edits", () => {
    assert.equal(editDistance("coat", "coat"), 0);
    assert.equal(editDistance("coat", "cost"), 1);
    assert.equal(editDistance("shirt", "shrt"), 1);
  });

  test("a length gap beyond the threshold short-circuits", () => {
    assert.equal(editDistance("a", "abcdefgh") > 2, true);
  });
});
