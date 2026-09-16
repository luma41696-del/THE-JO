import type { Locale, Product } from "@/types";

/**
 * Finding a product in a bilingual shop.
 *
 * The search this replaces lowercased the query, joined a few fields into one
 * string, and asked whether that string contained it. In a shop written half in
 * Arabic that fails for reasons a customer can never guess at:
 *
 *  - **Spelling.** Arabic is written with or without diacritics, with أ إ آ or
 *    a bare ا, ending in ة or ه, with ى or ي. "قميص" and "قَمِيص" are the same
 *    word; "ابيض" and "أبيض" are the same colour. A substring match says no.
 *
 *  - **Vocabulary.** A customer looking for a coat types "جاكيت". The product
 *    is called "معطف". Neither contains the other, and the shop appears to
 *    stock no coats.
 *
 *  - **Codes.** Staff and returning customers search by the code on the label.
 *    `sku` was not in the haystack at all, so "NS-ATWOCO" found nothing.
 *
 *  - **Phrases.** "معطف صوف" never matches "معطف الصوف" — one definite article
 *    between the words and the whole query fails.
 *
 *  - **False matches.** Joining the fields into one string means a query can
 *    match across the seam between two of them and return a product that
 *    contains the phrase nowhere.
 *
 * And it returned matches in catalogue order, so a product whose *title* is the
 * query could sit below one that merely carries it as a tag.
 *
 * This module fixes each of those, and is pure so all of it can be tested
 * without a catalogue.
 */

/* -------------------------------------------------------------------------- */
/*  Normalising                                                               */
/* -------------------------------------------------------------------------- */

/** Harakat, tanwin, shadda, sukun, superscript alef. */
const DIACRITICS = /[ً-ْٰٓ-ٕ]/g;
/** ـ, the kashida, used to stretch a word for typesetting. Carries no sound. */
const TATWEEL = /ـ/g;
const ARABIC_INDIC = /[٠-٩]/g;
const EASTERN_ARABIC = /[۰-۹]/g;

/**
 * Reduce a word to the form two people spelling it differently would share.
 *
 * Every fold here is a pair of spellings that mean the same thing and that
 * ordinary people mix freely:
 *
 *  - أ إ آ ٱ → ا   — the hamza is routinely dropped when typing quickly
 *  - ة → ه         — the ta marbuta is often written as a plain ha
 *  - ى → ي         — and the alef maqsura as a ya
 *  - ؤ ئ → و ي     — hamza on a seat, same
 *
 * The risk of over-folding is real: it makes a few genuinely different words
 * collide. In a clothing catalogue that trade is overwhelmingly worth it —
 * a customer who cannot find "عباية" because they wrote "عبايه" simply leaves.
 */
export function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EASTERN_ARABIC, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .normalize("NFKD")
    // Latin accents, for a French or Turkish loan word typed either way.
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The Arabic definite article, when it is safe to remove.
 *
 * "معطف الصوف" and "معطف صوف" are the same request. Stripping ال lets one
 * match the other. Only applied to words long enough to survive it: dropping
 * it from الم leaves م, which matches everything.
 */
function stripArticle(token: string): string {
  if (token.length > 4 && token.startsWith("ال")) return token.slice(2);
  return token;
}

/** Split into words, on whitespace and on punctuation from either script. */
export function tokenize(text: string): string[] {
  return normalizeArabic(text)
    .split(/[\s،,.؛;:!؟?"'()[\]{}\/\\|+*&^%$#@~`<>=]+/)
    .map(stripArticle)
    .filter((token) => token.length > 0);
}

/* -------------------------------------------------------------------------- */
/*  Synonyms                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Words that should find each other.
 *
 * Each group is a set of terms a customer might reasonably type for the same
 * thing, across both languages and across the regional vocabulary actually
 * used in Jordan — "جزمة" and "صباط" for shoes, "شنطة" for a bag, "كوتشي" for
 * trainers. A catalogue written in formal Arabic is not searchable by the
 * words its customers use, and neither is one written only in English.
 *
 * These are stored unnormalised and folded on load, so the table stays
 * readable and the matching stays consistent with everything else.
 */
export const SYNONYM_GROUPS: string[][] = [
  // Tops
  ["تي شيرت", "تيشيرت", "تيشرت", "تى شيرت", "t-shirt", "tshirt", "tee", "tees"],
  ["قميص", "قمصان", "shirt", "shirts"],
  ["بلوزة", "بلوزه", "blouse", "top"],
  ["تريكو", "كنزة", "بلوفر", "سويتر", "جرزاية", "knit", "knitwear", "sweater", "jumper", "pullover"],
  ["هودي", "كنزة بقبعة", "hoodie", "sweatshirt"],

  // Outerwear
  /*
   * Coat and jacket are one group, not two.
   *
   * In Levantine usage جاكيت, معطف, بالطو and كوت are used for the same
   * garment more or less interchangeably, and a customer who types one of them
   * is not making a distinction the shop should enforce. Keeping them apart
   * meant a search for جاكيت reported that the shop stocks no coats.
   */
  ["معطف", "بالطو", "كوت", "جاكيت", "جاكت", "سترة", "coat", "overcoat", "jacket"],
  /*
   * A blazer is specific, so بليزر finds only blazers — but the general word
   * جاكيت appears here too, so somebody typing it gets both. A term in two
   * groups carries both, which is exactly the asymmetry wanted: the broad word
   * reaches wider, the precise one stays precise.
   */
  ["بليزر", "بليزار", "جاكيت", "blazer"],
  ["ترنش", "trench"],

  // Lower
  ["بنطال", "بنطلون", "سروال", "بنطرون", "trousers", "pants", "slacks"],
  ["جينز", "جنز", "jeans", "denim"],
  ["تنورة", "جيبة", "skirt"],
  ["شورت", "شورتات", "shorts"],

  // Whole pieces
  ["فستان", "فساتين", "dress", "dresses", "gown"],
  ["جمبسوت", "أفرول", "jumpsuit", "overall"],
  ["عباية", "عباءة", "abaya"],
  ["حجاب", "طرحة", "إيشارب", "hijab", "headscarf"],

  // Feet
  ["حذاء", "احذية", "جزمة", "صباط", "shoe", "shoes", "footwear"],
  ["سنيكرز", "كوتشي", "رياضي", "sneaker", "sneakers", "trainers", "runner", "runners"],
  ["صندل", "شبشب", "sandal", "sandals"],
  ["بوت", "بوط", "boot", "boots"],

  // Carried
  ["حقيبة", "شنطة", "جزدان", "bag", "bags", "purse", "handbag"],
  ["توت", "حقيبة كبيرة", "tote"],
  ["محفظة", "wallet"],

  // Worn over
  ["وشاح", "شال", "كوفية", "scarf", "shawl"],
  ["حزام", "belt"],
  ["قبعة", "طاقية", "hat", "cap"],

  // Materials
  ["قطن", "قطني", "cotton"],
  ["كتان", "كتاني", "linen"],
  ["صوف", "صوفي", "wool", "woollen", "woolen"],
  ["حرير", "حريري", "silk"],
  ["جلد", "جلدي", "جلدية", "leather"],
  ["شمواه", "سويد", "suede"],
  ["كشمير", "cashmere"],
  ["دنيم", "denim"],

  // Colours — a customer searches for these as often as for garments.
  ["ابيض", "بيضاء", "white"],
  ["اسود", "سوداء", "black"],
  ["احمر", "حمراء", "red", "crimson"],
  ["ازرق", "زرقاء", "blue"],
  ["كوبالت", "cobalt"],
  ["اخضر", "خضراء", "green", "olive", "sage"],
  ["بيج", "بيچ", "beige", "sand", "camel", "bone"],
  ["رمادي", "رمادية", "grey", "gray", "slate", "charcoal"],
  ["بني", "بنية", "brown", "clay"],
  ["كحلي", "navy", "ink"],

  // Intent
  ["تخفيض", "خصم", "اوفر", "تنزيلات", "sale", "discount", "offer", "reduced"],
  ["جديد", "الجديد", "new", "latest", "arrival", "arrivals"],
];

/** Folded term → every folded term in its group. Built once. */
const SYNONYMS = (() => {
  const map = new Map<string, string[]>();
  for (const group of SYNONYM_GROUPS) {
    const folded = group.map((term) => normalizeArabic(term));
    for (const term of folded) {
      // A term can sit in more than one group — "denim" is both a material and
      // a garment — so the entries are merged rather than overwritten.
      const existing = map.get(term) ?? [];
      map.set(term, [...new Set([...existing, ...folded])]);
    }
  }
  return map;
})();

/** One token plus everything that means the same thing. */
export function expandToken(token: string): string[] {
  return SYNONYMS.get(token) ?? [token];
}

/* -------------------------------------------------------------------------- */
/*  Codes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Does this look like somebody typing a code rather than a word?
 *
 * Codes are matched differently: a code search wants the product carrying that
 * exact label, not everything whose description happens to contain the
 * characters. Getting this wrong in the other direction is worse — treating
 * "coat" as a code would return nothing at all.
 */
export function looksLikeCode(query: string): boolean {
  const text = query.trim();
  if (text.length < 3) return false;
  // Digits or a separator, no spaces, and nothing outside the set a barcode or
  // an SKU is made of.
  return /^[A-Za-z0-9][A-Za-z0-9\-_/]*$/.test(text) && /[0-9\-_/]/.test(text);
}

/** Every code a product answers to: its own, its variants', its barcode. */
export function codesOf(product: Partial<Product>): string[] {
  const codes = [product.sku ?? "", product.gtin ?? ""];
  for (const variant of product.variants ?? []) {
    if (variant.sku) codes.push(variant.sku);
    if (variant.gtin) codes.push(variant.gtin);
  }
  return codes.filter(Boolean).map((code) => code.toLowerCase().replace(/[\s\-_/]/g, ""));
}

/* -------------------------------------------------------------------------- */
/*  Scoring                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Where a match was found, and what that is worth.
 *
 * The ordering is the whole point: a product whose *name* is what was typed has
 * to come above one that merely carries the word as a tag. Returning matches in
 * catalogue order — which is what happened before — buries the obvious answer.
 */
const WEIGHT = {
  exactTitle: 1000,
  code: 900,
  titleStarts: 400,
  titleWord: 250,
  subtitle: 120,
  tag: 90,
  category: 70,
  description: 30,
  /** A synonym found it rather than the word itself. Still a match, worth less. */
  synonymPenalty: 0.6,
} as const;

interface Haystack {
  title: string;
  titleWords: Set<string>;
  subtitle: string;
  tags: Set<string>;
  category: string;
  description: string;
  codes: string[];
}

function haystackOf(product: Partial<Product>): Haystack {
  const titles = [product.title?.en ?? "", product.title?.ar ?? ""].join(" ");
  return {
    title: normalizeArabic(titles),
    titleWords: new Set(tokenize(titles)),
    subtitle: normalizeArabic(
      [product.subtitle?.en ?? "", product.subtitle?.ar ?? ""].join(" "),
    ),
    tags: new Set((product.tags ?? []).flatMap((tag) => tokenize(tag))),
    category: normalizeArabic(
      [product.categoryId ?? "", ...(product.categoryPath ?? [])].join(" "),
    ),
    description: normalizeArabic(
      [product.description?.en ?? "", product.description?.ar ?? ""].join(" "),
    ),
    codes: codesOf(product),
  };
}

/**
 * What one token is worth against one product.
 *
 * `weak` marks a match found *only* in the description. The distinction earns
 * its keep: a search for "جاكيت" was returning a jar of leather balm, because
 * its care instructions say "a thin coat twice a year", and a knit dress,
 * because its description says it "works under a coat". Both contain the word
 * and neither is one.
 *
 * The description is still worth searching — "wool coat" should find a coat
 * whose fabric is only mentioned in its prose — so it is not dropped. It is
 * demoted to something that can *add* to a match without being one, which
 * `scoreProduct` enforces.
 */
function scoreToken(hay: Haystack, token: string): { score: number; weak: boolean } {
  const forms = expandToken(token);

  let best = 0;
  let bestWeak = true;

  for (const form of forms) {
    const isSynonym = form !== token;
    const factor = isSynonym ? WEIGHT.synonymPenalty : 1;

    let score = 0;
    let weak = false;

    if (hay.titleWords.has(form)) score = WEIGHT.titleWord;
    else if (hay.title.startsWith(form)) score = WEIGHT.titleStarts;
    else if (hay.title.includes(form)) score = WEIGHT.titleWord * 0.7;
    else if (hay.tags.has(form)) score = WEIGHT.tag;
    else if (hay.subtitle.includes(form)) score = WEIGHT.subtitle;
    else if (hay.category.includes(form)) score = WEIGHT.category;
    else if (hay.description.includes(form)) {
      score = WEIGHT.description;
      weak = true;
    }

    const weighted = score * factor;
    if (weighted > best) {
      best = weighted;
      bestWeak = weak;
    }
  }

  return { score: best, weak: bestWeak };
}

export interface Scored<T> {
  product: T;
  score: number;
}

/**
 * Score one product against a query.
 *
 * **Every token must match somewhere.** Two words narrow the search rather than
 * widening it: somebody typing "معطف صوف" wants a wool coat, not every coat
 * plus every wool thing. A single token that is nowhere in the product means no
 * result, however well the others scored.
 */
export function scoreProduct(product: Partial<Product>, query: string): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;

  const hay = haystackOf(product);

  /*
   * Codes are checked first, and on their own terms.
   *
   * The check is "does this product carry that code", not "does this query
   * look like a code" — because a code typed without its hyphens is still a
   * code, and `looksLikeCode("nsatwoco")` is quite reasonably false. Asking
   * the product settles it either way.
   *
   * `looksLikeCode` then decides only what happens when nothing carries it: a
   * query that is plainly a code and matches none returns *nothing*, rather
   * than falling through to a word search that would answer a mistyped digit
   * with half the catalogue.
   */
  const needle = query.trim().toLowerCase().replace(/[\s\-_/]/g, "");
  if (needle && hay.codes.some((code) => code === needle || code.startsWith(needle))) {
    return WEIGHT.code;
  }
  if (looksLikeCode(query)) return 0;

  const whole = normalizeArabic(query);
  if (whole && hay.title === whole) return WEIGHT.exactTitle;

  let total = 0;
  let anyStrong = false;

  for (const token of tokens) {
    const { score, weak } = scoreToken(hay, token);
    if (score === 0) return 0;
    if (!weak) anyStrong = true;
    total += score;
  }

  /*
   * At least one token has to have been found somewhere that names the product
   * — its title, tags, subtitle or category — and not only in its prose.
   *
   * Without this a jar of leather balm answers a search for "جاكيت", because
   * its care instructions mention applying "a thin coat". The word is there;
   * the product is not what was asked for, and a shopper reading a results
   * page of near-misses concludes the search is broken.
   */
  if (!anyStrong) return 0;

  // A two-word query that matched two words is worth more than one that
  // matched the same total in one field, so longer exact phrases win.
  if (tokens.length > 1 && hay.title.includes(whole)) total += WEIGHT.titleStarts;

  return total;
}

/**
 * Rank a catalogue against a query.
 *
 * Ties break on price, ascending. Some tiebreak is needed or the order depends
 * on however the catalogue happened to be sorted, and two identical searches a
 * minute apart can disagree; cheapest-first is the one a shopper is least
 * annoyed by.
 */
export function rankProducts<T extends Partial<Product>>(
  products: T[],
  query: string,
  max = 12,
): T[] {
  if (!query.trim()) return [];

  const scored: Scored<T>[] = [];
  for (const product of products) {
    const score = scoreProduct(product, query);
    if (score > 0) scored.push({ product, score });
  }

  scored.sort((a, b) => b.score - a.score || (a.product.price ?? 0) - (b.product.price ?? 0));
  return scored.slice(0, max).map((entry) => entry.product);
}

/* -------------------------------------------------------------------------- */
/*  Suggestions                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What to offer when a search returns nothing.
 *
 * An empty result page that says only "no results" is a dead end. Offering the
 * nearest words the catalogue actually contains turns it into a next step —
 * and quietly teaches the customer what this shop calls things.
 */
export function suggestTerms(products: Partial<Product>[], query: string, locale: Locale, max = 4): string[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const vocabulary = new Map<string, string>();
  for (const product of products) {
    const label = product.title?.[locale] ?? product.title?.en ?? "";
    for (const word of tokenize(label)) {
      if (word.length >= 3 && !vocabulary.has(word)) vocabulary.set(word, word);
    }
    for (const tag of product.tags ?? []) {
      const folded = normalizeArabic(tag);
      if (folded.length >= 3 && !vocabulary.has(folded)) vocabulary.set(folded, tag);
    }
  }

  const scored = [...vocabulary.entries()]
    .map(([folded, original]) => ({ original, distance: editDistance(tokens[0]!, folded) }))
    // Within two edits of what they typed. Beyond that it is not a correction,
    // it is a different word, and offering one reads as the shop not listening.
    .filter((entry) => entry.distance > 0 && entry.distance <= 2)
    .sort((a, b) => a.distance - b.distance);

  return scored.slice(0, max).map((entry) => entry.original);
}

/** Levenshtein, iterative, two rows. Enough for one short token against a small vocabulary. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // A long difference in length is never within the threshold, and skipping it
  // keeps a 40-character description token from costing a full matrix.
  if (Math.abs(a.length - b.length) > 2) return 99;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[b.length]!;
}
