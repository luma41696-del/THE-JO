import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  avatarFromProfile,
  bodyProfile,
  garmentKind,
  garmentRadiusAt,
  garmentSpan,
  profileCompleteness,
  radiusAt,
} from "@/lib/fitting/avatar";
import { inSeason, isBuyable, suggestLook } from "@/lib/fitting/suggest";
import { recommendSize } from "@/lib/fitting";
import type { Product, ProductSize } from "@/types";

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* -------------------------------------------------------------------------- */

/** A complete `Product["fit"]`, so a fixture never half-declares one. */
const fitSpec = (
  o: Partial<NonNullable<Product["fit"]>> = {},
): NonNullable<Product["fit"]> => ({
  scale: 0,
  silhouette: "regular",
  stretch: "none",
  ...o,
});

const base = {
  id: "p1", slug: "p1", type: "variable", title: { en: "Coat", ar: "معطف" },
  description: { en: "", ar: "" }, categoryId: "outerwear", categoryPath: ["outerwear"],
  collectionIds: [], tags: [], upsellIds: [], crossSellIds: [],
  price: 100, currency: "JOD", images: [],
  colors: [{ id: "black", name: { en: "Black", ar: "أسود" }, hex: "#000" }],
  sizes: [], variants: [], sizeSystem: "alpha", sku: "SKU",
  inStock: true, totalStock: 10, badges: [], status: "active",
  publishedAt: 0, updatedAt: 0,
  fit: fitSpec(),
} as unknown as Product;

const p = (o: Partial<Product> = {}) => ({ ...base, ...o }) as Product;

/** A size with a garment measurement table, in centimetres. */
const size = (id: string, chest: number, waist = chest - 16, hip = chest + 4): ProductSize => ({
  id,
  label: id.toUpperCase(),
  system: "alpha",
  measurements: { chest, waist, hip },
});

/** One variant per colour/size, so `resolveSelection` has something to resolve. */
const stocked = (product: Product, stock = 5) =>
  p({
    ...product,
    variants: product.sizes.map((s) => ({
      id: `black-${s.id}`,
      colorId: "black",
      sizeId: s.id,
      sku: `SKU-${s.id}`,
      stock,
    })),
  });

/* -------------------------------------------------------------------------- */
/*  Avatar geometry                                                           */
/* -------------------------------------------------------------------------- */

test("no height means no figure — a default body is never presented as yours", () => {
  assert.equal(avatarFromProfile(null), null);
  assert.equal(avatarFromProfile({}), null);
  assert.equal(avatarFromProfile({ chestCm: 94, waistCm: 78 }), null);
  assert.equal(avatarFromProfile({ heightCm: 60 }), null, "implausible height is a typo");
  assert.notEqual(avatarFromProfile({ heightCm: 172 }), null);
});

test("missing girths scale to this height rather than to the population median", () => {
  const short = avatarFromProfile({ heightCm: 150 })!;
  const tall = avatarFromProfile({ heightCm: 190 })!;
  assert.ok(short.chestCm < tall.chestCm, "a 150cm figure is not built at 190cm girths");
  assert.ok(short.chestCm > 70, "…but is still a plausible body");
});

test("measurements that are given are used, not adjusted away", () => {
  const avatar = avatarFromProfile({ heightCm: 165, chestCm: 112, waistCm: 96, hipCm: 118 })!;
  assert.equal(avatar.chestCm, 112);
  assert.equal(avatar.waistCm, 96);
  assert.equal(avatar.hipCm, 118);
});

test("two different bodies produce two different silhouettes", () => {
  const slim = bodyProfile(avatarFromProfile({ heightCm: 172, chestCm: 88, waistCm: 70, hipCm: 92 })!);
  const full = bodyProfile(avatarFromProfile({ heightCm: 172, chestCm: 112, waistCm: 98, hipCm: 116 })!);

  // Same height, so the rings sit at the same fractions — only the radii move.
  assert.deepEqual(slim.map((r) => r.y), full.map((r) => r.y));
  assert.ok(
    slim.every((ring, index) => ring.r <= full[index]!.r),
    "every ring of the smaller body is at most the radius of the larger",
  );
  assert.ok(radiusAt(slim, 0.5) < radiusAt(full, 0.5), "the waist reads differently");
});

test("radiusAt interpolates between rings instead of snapping to one", () => {
  const rings = bodyProfile(avatarFromProfile({ heightCm: 172 })!);
  const low = radiusAt(rings, 0.4);
  const mid = radiusAt(rings, 0.45);
  const high = radiusAt(rings, 0.5);
  assert.ok(Number.isFinite(mid));
  assert.ok(mid >= Math.min(low, high) && mid <= Math.max(low, high));
});

test("profile completeness counts only plausible values", () => {
  assert.deepEqual(profileCompleteness(null).given, 0);
  assert.equal(profileCompleteness({ heightCm: 172, chestCm: 94 }).given, 2);
  assert.equal(profileCompleteness({ heightCm: 172, chestCm: 9 }).given, 1, "9cm is not a chest");
});

/* -------------------------------------------------------------------------- */
/*  Garment shapes                                                            */
/* -------------------------------------------------------------------------- */

test("a garment is shaped by its ancestry, not its leaf category", () => {
  // The bug this guards: `trousers-wide` fell through to the default and was
  // shaped — and sized — as a top.
  assert.equal(garmentKind(["trousers", "trousers-wide"]), "trouser");
  assert.equal(garmentKind(["knitwear", "knitwear-cardigans"]), "top");
  assert.equal(garmentKind(["outerwear", "outerwear-coats"]), "coat");
  assert.equal(garmentKind(["objects", "candles"]), null, "not everything is wearable");
});

test("trousers are built as two legs and stop at the waist", () => {
  const span = garmentSpan("trouser", "regular")!;
  assert.equal(span.legs, true);
  assert.ok(span.to < 0.7, "trousers do not reach the shoulders");
  assert.equal(garmentSpan("top", "regular")!.legs, undefined);
});

test("ease is what makes a silhouette visible", () => {
  const slim = garmentSpan("top", "slim")!.ease;
  const regular = garmentSpan("top", "regular")!.ease;
  const oversized = garmentSpan("top", "oversized")!.ease;
  assert.ok(slim < regular && regular < oversized);
  assert.ok(oversized - slim >= 5, "the difference is large enough to see on the figure");
});

/* -------------------------------------------------------------------------- */
/*  Garment radius — the size, not just the silhouette                        */
/* -------------------------------------------------------------------------- */

const rings = () => bodyProfile(avatarFromProfile({ heightCm: 172, chestCm: 94, waistCm: 78, hipCm: 100 })!);

test("with no size table the garment falls back to the silhouette's ease", () => {
  const r = rings();
  assert.equal(garmentRadiusAt(r, 0.72, 4), radiusAt(r, 0.72) + 4);
  assert.equal(garmentRadiusAt(r, 0.72, 4, {}), radiusAt(r, 0.72) + 4);
});

test("a bigger size renders bigger and a smaller size renders smaller", () => {
  const r = rings();
  // The body's chest is 94cm, so a 104cm garment stands off it and an 86cm
  // one does not reach it.
  const roomy = garmentRadiusAt(r, 0.72, 2, { chest: 104 });
  const tight = garmentRadiusAt(r, 0.72, 2, { chest: 86 });
  const body = radiusAt(r, 0.72);

  assert.ok(roomy > body, "a size larger than the body sits outside it");
  assert.ok(tight < body, "a size smaller than the body sits inside it");
  assert.ok(roomy > tight);
});

test("the size table wins over the silhouette's ease where both exist", () => {
  const r = rings();
  // Same garment measurement, two silhouettes: the rendered radius is the
  // measurement's, not the ease's — otherwise every size looks the same.
  const slim = garmentRadiusAt(r, 0.72, 1, { chest: 104 });
  const oversized = garmentRadiusAt(r, 0.72, 7, { chest: 104 });
  assert.equal(slim, oversized);
});

test("the garment keeps the body's shape between measured landmarks", () => {
  const r = rings();
  // Equal circumferences at every landmark describe a tube, and that is what
  // should render — the body's own taper must not leak through.
  const table = { chest: 100, waist: 100, hip: 100 };
  const atChest = garmentRadiusAt(r, 0.72, 2, table);
  const atWaist = garmentRadiusAt(r, 0.62, 2, table);
  assert.ok(Math.abs(atChest - atWaist) < 0.001, "equal measurements render equal");

  // And a shaped table renders shaped.
  const shaped = { chest: 100, waist: 84, hip: 106 };
  assert.ok(garmentRadiusAt(r, 0.62, 2, shaped) < garmentRadiusAt(r, 0.72, 2, shaped));
});

test("outside the measured band the nearest gap is held, not extrapolated", () => {
  const r = rings();
  const table = { chest: 100 };
  const gap = garmentRadiusAt(r, 0.72, 2, table) - radiusAt(r, 0.72);
  // A hem well below the chest keeps the same standoff rather than running
  // away to some extrapolated radius.
  assert.ok(Math.abs(garmentRadiusAt(r, 0.35, 2, table) - (radiusAt(r, 0.35) + gap)) < 0.001);
  assert.ok(Math.abs(garmentRadiusAt(r, 0.8, 2, table) - (radiusAt(r, 0.8) + gap)) < 0.001);
});

/* -------------------------------------------------------------------------- */
/*  Size outcomes                                                             */
/* -------------------------------------------------------------------------- */

const shirt = (over: Partial<Product> = {}) =>
  p({
    categoryId: "knitwear",
    categoryPath: ["knitwear"],
    sizes: [size("s", 92), size("m", 100), size("l", 108)],
    ...over,
  });

test("a body inside the range gets a size, not a hedge", () => {
  // Ideal chest = 96 + 8 (regular ease) + 3 (regular silhouette) = 107, which
  // the 108 table hits almost exactly and the 100 one misses by 7.
  const fit = recommendSize(shirt(), { chestCm: 96, preferredFit: "regular" });
  assert.equal(fit.outcome, "recommended");
  assert.equal(fit.recommendedSizeId, "l");
  assert.ok(fit.confidence > 0.6);
});

test("a body between two sizes is told so rather than given a coin flip", () => {
  // Ideal chest = 92 + 11 = 103, sitting between the 100 and 108 tables: one
  // is 3cm tight, the other 5cm loose. Neither is the answer on its own.
  const fit = recommendSize(shirt(), { chestCm: 92, preferredFit: "regular" });
  assert.equal(fit.outcome, "between");
  assert.ok(fit.confidence < 0.6);
  assert.equal(fit.recommendedSizeId, "m", "the closer of the two leads");
  assert.equal(fit.alternativeSizeId, "l", "the other candidate is named");
  assert.match(fit.rationale.en, /between/i);
});

test("a body outside the range is told nothing fits — not handed the largest size", () => {
  const fit = recommendSize(shirt(), { chestCm: 140, preferredFit: "regular" });
  assert.equal(fit.outcome, "no-size");
  assert.equal(fit.recommendedSizeId, "", "there is nothing to add to a bag");
  assert.ok((fit.deviation ?? 0) > 12, "and it says how far off, for ranking — never as copy");
});

test("no measurements is a different answer from no size table", () => {
  const noBody = recommendSize(shirt(), {});
  assert.equal(noBody.outcome, "unmeasured");
  assert.match(noBody.rationale.en, /add your/i, "it asks for measurements");

  const noTable = recommendSize(
    shirt({ sizes: [{ id: "s", label: "S", system: "alpha" }, { id: "m", label: "M", system: "alpha" }] }),
    { chestCm: 94 },
  );
  assert.equal(noTable.outcome, "unmeasured");
  assert.match(noTable.rationale.en, /measurement table/i, "it blames the missing table");
});

test("one-size items are confident without any measurements at all", () => {
  const fit = recommendSize(shirt({ sizes: [{ id: "os", label: "One size", system: "one-size" }] }), {});
  assert.equal(fit.outcome, "recommended");
  assert.equal(fit.confidence, 1);
});

test("a stretchy garment forgives a tight size; a rigid one does not", () => {
  const body = { chestCm: 104, preferredFit: "slim" as const };
  const rigid = recommendSize(shirt(), body);
  const stretchy = recommendSize(
    shirt({ fit: fitSpec({ stretch: "high" }) }),
    body,
  );
  assert.ok((stretchy.deviation ?? 99) <= (rigid.deviation ?? 0));
});

/* -------------------------------------------------------------------------- */
/*  Suggestions                                                               */
/* -------------------------------------------------------------------------- */

const SLOTS = [
  { id: "top" as const, categories: ["knitwear", "dresses"] },
  { id: "bottom" as const, categories: ["trousers"] },
  { id: "outerwear" as const, categories: ["outerwear"] },
];

const top = (id: string, price: number, over: Partial<Product> = {}) =>
  stocked(
    p({
      id,
      slug: id,
      price,
      categoryId: "knitwear",
      categoryPath: ["knitwear"],
      sizes: [size("s", 92), size("m", 100), size("l", 108)],
      ...over,
    }),
  );

const trouser = (id: string, price: number, over: Partial<Product> = {}) =>
  stocked(
    p({
      id,
      slug: id,
      price,
      categoryId: "trousers",
      categoryPath: ["trousers"],
      sizes: [size("s", 92, 72, 96), size("m", 100, 80, 104)],
      ...over,
    }),
  );

const body = { chestCm: 92, waistCm: 74, hipCm: 98, preferredFit: "regular" as const };

test("a suggestion never reaches for something that is sold out", () => {
  const soldOut = stocked(top("sold-out", 10), 0);
  const inStock = top("in-stock", 80);

  const look = suggestLook({ products: [soldOut, inStock], slots: SLOTS, body });
  assert.equal(look.items.top?.id, "in-stock", "the cheap sold-out piece is not chosen");
});

test("an empty slot reports the reason it is empty", () => {
  const look = suggestLook({
    products: [stocked(top("t", 50), 0)],
    slots: SLOTS,
    body,
  });
  assert.equal(look.items.top, undefined);
  assert.deepEqual(
    look.skipped.find((s) => s.slot === "top")?.reason,
    "out-of-stock",
  );
  assert.deepEqual(
    look.skipped.find((s) => s.slot === "bottom")?.reason,
    "nothing-here",
    "a slot with no products at all is a different problem",
  );
});

test("the budget is a ceiling on the whole look, not on each piece", () => {
  const look = suggestLook({
    products: [top("t1", 90), trouser("b1", 90)],
    slots: SLOTS,
    body,
    budget: 120,
  });

  assert.ok(look.total <= 120, `total ${look.total} stays inside the budget`);
  assert.equal(look.items.top?.id, "t1");
  assert.equal(look.items.bottom, undefined, "the second piece would have blown it");
  assert.equal(look.skipped.find((s) => s.slot === "bottom")?.reason, "over-budget");
});

test("pieces already chosen are kept, and counted against the budget", () => {
  const locked = top("locked", 100);
  const look = suggestLook({
    products: [locked, trouser("b1", 40)],
    slots: SLOTS,
    body,
    locked: { top: locked },
    budget: 120,
  });

  assert.equal(look.items.top?.id, "locked", "the customer's own choice survives");
  assert.equal(look.items.bottom, undefined);
  assert.equal(look.total, 100, "the locked piece counts towards the total");
});

test("season is respected, and unclassified pieces count as all-season", () => {
  const wool = top("wool", 60, { seasons: ["winter"] });
  const linen = top("linen", 60, { seasons: ["summer"] });
  const plain = top("plain", 60);

  assert.equal(inSeason(plain, "summer"), true, "unclassified is not excluded");
  assert.equal(inSeason(wool, "summer"), false);

  const summer = suggestLook({ products: [wool, linen], slots: SLOTS, body, season: "summer" });
  assert.equal(summer.items.top?.id, "linen");

  const winter = suggestLook({ products: [linen], slots: SLOTS, body, season: "winter" });
  assert.equal(winter.items.top, undefined);
  assert.equal(winter.skipped.find((s) => s.slot === "top")?.reason, "out-of-season");
});

test("a piece no size of which fits is never suggested", () => {
  const tiny = top("tiny", 20, { sizes: [size("xs", 70)] });
  const fits = top("fits", 200);

  const look = suggestLook({
    products: [tiny, fits],
    slots: SLOTS,
    body: { chestCm: 120, waistCm: 104, hipCm: 124, preferredFit: "regular" },
  });

  assert.notEqual(look.items.top?.id, "tiny");
});

test("the same inputs always produce the same look", () => {
  const products = [top("a", 50), top("b", 50), trouser("c", 40), trouser("d", 40)];
  const first = suggestLook({ products, slots: SLOTS, body });
  const second = suggestLook({ products: [...products].reverse(), slots: SLOTS, body });

  assert.equal(first.items.top?.id, second.items.top?.id, "not dependent on array order");
  assert.equal(first.items.bottom?.id, second.items.bottom?.id);
});

test("preferred fit ranks silhouettes without forbidding any", () => {
  const roomy = top("roomy", 50, {
    fit: fitSpec({ silhouette: "oversized" }),
  });
  const close = top("close", 50, {
    fit: fitSpec({ silhouette: "slim" }),
  });

  const slimTaste = suggestLook({
    products: [roomy, close],
    slots: SLOTS,
    body: { ...body, preferredFit: "slim" },
  });
  assert.equal(slimTaste.items.top?.id, "close");

  // The oversized piece is still reachable when it is the only one there.
  const onlyRoomy = suggestLook({
    products: [roomy],
    slots: SLOTS,
    body: { ...body, preferredFit: "slim" },
  });
  assert.equal(onlyRoomy.items.top?.id, "roomy", "a preference is not a ban");
});

test("isBuyable needs a real variant, not just a non-zero total", () => {
  const noVariants = p({ sizes: [size("s", 92)], variants: [], totalStock: 40 });
  assert.equal(isBuyable(noVariants), false, "totalStock alone sells nothing");
  assert.equal(isBuyable(stocked(p({ sizes: [size("s", 92)] }))), true);
  assert.equal(isBuyable(stocked(p({ sizes: [size("s", 92)], status: "draft" }))), false);
});
