import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  availableDesignIds,
  availableSizeIds,
  buildCartItem,
  designFor,
  hasDesigns,
  imagesFor,
  resolveSelection,
  sellableDesigns,
  stockFor,
  variantFor,
} from "@/lib/product";
import { lowStockAlerts, stockState } from "@/lib/stock";
import { cartKey } from "@/lib/utils";
import type { Product, ProductDesign, ProductImage, ProductVariant } from "@/types";

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* -------------------------------------------------------------------------- */

const img = (url: string, colorId?: string): ProductImage => ({
  url,
  alt: url,
  width: 800,
  height: 1000,
  ...(colorId ? { colorId } : {}),
});

const design = (id: string, over: Partial<ProductDesign> = {}): ProductDesign => ({
  id,
  name: { en: id, ar: id },
  thumbnail: img(`/demo/${id}.svg`),
  available: true,
  ...over,
});

const variant = (
  colorId: string,
  sizeId: string,
  designId: string | undefined,
  stock: number,
): ProductVariant => ({
  sku: `SKU-${colorId}-${sizeId}-${designId ?? "any"}`,
  colorId,
  sizeId,
  ...(designId ? { designId } : {}),
  stock,
});

const base = {
  id: "tee", slug: "tee", type: "variable",
  title: { en: "Boxy Cotton Tee", ar: "تيشيرت" },
  description: { en: "", ar: "" }, categoryId: "knitwear", categoryPath: ["knitwear"],
  collectionIds: [], tags: [], upsellIds: [], crossSellIds: [],
  price: 35, currency: "JOD",
  images: [img("/demo/tee.svg")],
  colors: [
    { id: "bone", name: { en: "Bone", ar: "عظمي" }, hex: "#efe9de" },
    { id: "ink", name: { en: "Ink", ar: "حبري" }, hex: "#1b1717" },
  ],
  sizes: [
    { id: "s", label: "S", system: "alpha" },
    { id: "m", label: "M", system: "alpha" },
  ],
  sizeSystem: "alpha", sku: "TEE", designs: [], variants: [],
  inStock: true, totalStock: 0, badges: [], status: "active",
  publishedAt: 0, updatedAt: 0,
} as unknown as Product;

const p = (o: Partial<Product> = {}) => ({ ...base, ...o }) as Product;

/** A tee with two embroideries, stocked per design. */
const embroidered = (over: Partial<Product> = {}) =>
  p({
    designs: [design("palm"), design("wave")],
    variants: [
      variant("bone", "s", "palm", 4),
      variant("bone", "m", "palm", 0),
      variant("ink", "s", "palm", 2),
      variant("bone", "s", "wave", 0),
      variant("bone", "m", "wave", 6),
    ],
    ...over,
  });

/* -------------------------------------------------------------------------- */
/*  Resolution                                                                */
/* -------------------------------------------------------------------------- */

test("stock is per design, not shared across the product", () => {
  const tee = embroidered();
  assert.equal(stockFor(tee, "bone", "s", "palm"), 4);
  assert.equal(stockFor(tee, "bone", "s", "wave"), 0, "the wave is out in bone S");
  assert.equal(stockFor(tee, "bone", "m", "wave"), 6);
});

test("sizes available depend on the chosen artwork", () => {
  const tee = embroidered();
  assert.deepEqual(availableSizeIds(tee, "bone", "palm"), ["s"]);
  assert.deepEqual(availableSizeIds(tee, "bone", "wave"), ["m"]);
});

test("a design with no stock anywhere is reported as depleted", () => {
  const tee = embroidered({
    variants: [variant("bone", "s", "palm", 3), variant("bone", "s", "wave", 0)],
  });
  assert.deepEqual(availableDesignIds(tee), ["palm"]);
});

test("a withdrawn design leaves the picker but keeps its record", () => {
  const tee = embroidered({ designs: [design("palm"), design("wave", { available: false })] });

  assert.deepEqual(sellableDesigns(tee).map((d) => d.id), ["palm"]);
  // Still resolvable by id, so an old order line can still print its name.
  assert.equal(designFor(tee, "wave")?.name.en, "wave");
});

test("designs are ordered by position, not by array order", () => {
  const tee = p({
    designs: [design("b", { position: 2 }), design("a", { position: 1 })],
  });
  assert.deepEqual(sellableDesigns(tee).map((d) => d.id), ["a", "b"]);
});

/* -------------------------------------------------------------------------- */
/*  Backwards compatibility                                                   */
/* -------------------------------------------------------------------------- */

test("a product with no designs behaves exactly as before", () => {
  const plain = p({ variants: [variant("bone", "s", undefined, 5)] });

  assert.equal(hasDesigns(plain), false);
  assert.equal(stockFor(plain, "bone", "s"), 5);
  assert.equal(resolveSelection(plain, "bone", "s").buyable, true);
  assert.equal(cartKey("tee", "bone", "s"), "tee:bone:s", "the key keeps its old shape");
});

test("a variant written before designs existed serves every design", () => {
  // The migration case: the merchant adds two designs to a product whose
  // variant rows predate them. Refusing to match would make the whole product
  // unbuyable the moment a design was added.
  const migrating = p({
    designs: [design("palm"), design("wave")],
    variants: [variant("bone", "s", undefined, 7)],
  });

  assert.equal(stockFor(migrating, "bone", "s", "palm"), 7);
  assert.equal(stockFor(migrating, "bone", "s", "wave"), 7);
  assert.equal(variantFor(migrating, "bone", "s", "palm")?.sku, "SKU-bone-s-any");
});

test("an exact design row wins over the unscoped fallback", () => {
  const mixed = p({
    designs: [design("palm")],
    variants: [variant("bone", "s", undefined, 7), variant("bone", "s", "palm", 2)],
  });
  assert.equal(stockFor(mixed, "bone", "s", "palm"), 2);
});

/* -------------------------------------------------------------------------- */
/*  Buyability and price                                                      */
/* -------------------------------------------------------------------------- */

test("a product that offers artwork is not buyable until one is chosen", () => {
  const tee = embroidered();
  assert.equal(resolveSelection(tee, "bone", "s").buyable, false, "no design chosen");
  assert.equal(resolveSelection(tee, "bone", "s", "palm").buyable, true);
});

test("a design surcharge is added to the price, and stacks with an override", () => {
  const tee = p({
    designs: [design("gold", { priceDelta: 5 })],
    variants: [{ ...variant("bone", "s", "gold", 3), priceOverride: 40 }],
  });

  assert.equal(resolveSelection(tee, "bone", "s", "gold").price, 45);
});

test("a negative delta cannot drive a price below zero", () => {
  const tee = p({
    price: 3,
    designs: [design("plain", { priceDelta: -10 })],
    variants: [variant("bone", "s", "plain", 1)],
  });
  assert.equal(resolveSelection(tee, "bone", "s", "plain").price, 0);
});

/* -------------------------------------------------------------------------- */
/*  Gallery and cart line                                                     */
/* -------------------------------------------------------------------------- */

test("a design shows its own images, and falls back to the product's", () => {
  const withShots = p({
    images: [img("/demo/tee.svg")],
    designs: [
      design("palm", { images: [img("/demo/palm-1.svg"), img("/demo/palm-2.svg")] }),
      design("wave"),
    ],
  });

  assert.deepEqual(imagesFor(withShots, "palm").map((i) => i.url), [
    "/demo/palm-1.svg",
    "/demo/palm-2.svg",
  ]);
  assert.deepEqual(
    imagesFor(withShots, "wave").map((i) => i.url),
    ["/demo/tee.svg"],
    "a design without its own shots is not left blank",
  );
});

test("the cart key separates two designs of the same colour and size", () => {
  const tee = embroidered({
    variants: [variant("bone", "s", "palm", 4), variant("bone", "s", "wave", 4)],
  });

  const palm = buildCartItem(tee, resolveSelection(tee, "bone", "s", "palm"), "bone", "s", 1, "palm");
  const wave = buildCartItem(tee, resolveSelection(tee, "bone", "s", "wave"), "bone", "s", 1, "wave");

  assert.notEqual(palm.key, wave.key, "two artworks are two lines, not one merged line");
  assert.equal(palm.key, "tee:bone:s:palm");
  assert.equal(palm.designId, "palm");
  assert.equal(palm.designName?.en, "palm");
});

test("a line with no design carries no design fields at all", () => {
  const plain = p({ variants: [variant("bone", "s", undefined, 5)] });
  const line = buildCartItem(plain, resolveSelection(plain, "bone", "s"), "bone", "s", 1);

  assert.equal(line.designId, undefined);
  assert.equal(line.designName, undefined);
  assert.equal(line.key, "tee:bone:s");
});

test("the bag thumbnail is the artwork the customer chose", () => {
  const tee = p({
    images: [img("/demo/tee.svg")],
    designs: [design("palm", { images: [img("/demo/palm-1.svg")] })],
    variants: [variant("bone", "s", "palm", 2)],
  });

  const line = buildCartItem(tee, resolveSelection(tee, "bone", "s", "palm"), "bone", "s", 1, "palm");
  assert.equal(line.image.url, "/demo/palm-1.svg");
});

/* -------------------------------------------------------------------------- */
/*  Low-stock alerts                                                          */
/* -------------------------------------------------------------------------- */

test("alerts are per variant, not against the product total", () => {
  // The case the whole feature exists for: 40 units in stock, and every size
  // anybody actually orders is gone.
  const coat = p({
    id: "coat",
    totalStock: 40,
    sizes: [
      { id: "s", label: "S", system: "alpha" },
      { id: "m", label: "M", system: "alpha" },
      { id: "l", label: "L", system: "alpha" },
    ],
    variants: [
      variant("bone", "s", undefined, 0),
      variant("bone", "m", undefined, 1),
      variant("bone", "l", undefined, 39),
    ],
  });

  const alerts = lowStockAlerts([coat], 3);
  assert.equal(alerts.length, 2, "the healthy total hides nothing");
  assert.equal(alerts[0]?.state, "out", "sold out leads");
  assert.equal(alerts[1]?.stock, 1);
});

test("the threshold is inclusive, and above it is silence", () => {
  const tee = p({
    variants: [variant("bone", "s", undefined, 3), variant("ink", "s", undefined, 4)],
  });
  const alerts = lowStockAlerts([tee], 3);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.colorName, "Bone");
});

test("draft and archived products are not in the buying queue", () => {
  const draft = p({ status: "draft", variants: [variant("bone", "s", undefined, 0)] });
  const archived = p({ status: "archived", variants: [variant("bone", "s", undefined, 0)] });
  assert.deepEqual(lowStockAlerts([draft, archived], 3), []);
});

test("a simple product reports one row from its own total", () => {
  const comb = p({ type: "simple", colors: [], sizes: [], variants: [], totalStock: 2 });
  const alerts = lowStockAlerts([comb], 3);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.stock, 2);
  assert.equal(alerts[0]?.colorName, "", "there is no colour to name");
});

test("an alert names the design, so the SKU is not the only clue", () => {
  const tee = embroidered({
    variants: [variant("bone", "s", "palm", 1), variant("bone", "m", "wave", 30)],
  });
  const alerts = lowStockAlerts([tee], 3);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.designName, "palm");
});

test("ties break on a stable key, so the list does not reshuffle", () => {
  const a = p({ id: "a", title: { en: "Aaa", ar: "أ" }, variants: [variant("bone", "s", undefined, 1)] });
  const b = p({ id: "b", title: { en: "Bbb", ar: "ب" }, variants: [variant("bone", "s", undefined, 1)] });

  const one = lowStockAlerts([a, b], 3).map((x) => x.title.en);
  const two = lowStockAlerts([b, a], 3).map((x) => x.title.en);
  assert.deepEqual(one, two);
  assert.deepEqual(one, ["Aaa", "Bbb"]);
});

test("stockState tells the two urgencies apart", () => {
  assert.equal(stockState(0, 3), "out");
  assert.equal(stockState(3, 3), "low");
  assert.equal(stockState(4, 3), "ok");
});
