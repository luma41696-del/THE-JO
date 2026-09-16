import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  ALERT_LIFETIME_DAYS,
  alertKey,
  alertMessage,
  planSweep,
  shouldFire,
  unitsFor,
  type StockAlert,
} from "../src/lib/alerts";
import {
  MIN_CO_OCCURRENCE,
  boughtWith,
  coOccurrence,
  recommendationsFor,
  type OrderBasket,
} from "../src/lib/recommend";
import type { Product } from "../src/types";

/**
 * Remembering somebody who wanted a piece, and suggesting the next one.
 *
 * Both features are ways to mail or recommend at a customer, so most of these
 * tests are about *not* doing it: not about a product they cannot buy, not
 * twice for one restock, not a bestseller on every page, and not a pairing
 * seen once.
 *
 * Run with:
 *
 *     npm run test:retention
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1);

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    slug: "tee",
    title: { en: "Cotton Tee", ar: "تي شيرت قطن" },
    description: { en: "", ar: "" },
    categoryId: "tees",
    categoryPath: ["knitwear", "tees"],
    type: "variable",
    price: 35,
    currency: "JOD",
    images: [],
    colors: [],
    sizes: [],
    variants: [
      { sku: "T-WHT-M", colorId: "white", sizeId: "m", stock: 0 },
      { sku: "T-WHT-L", colorId: "white", sizeId: "l", stock: 4 },
    ],
    tags: [],
    badges: [],
    inStock: true,
    totalStock: 4,
    status: "active",
    crossSellIds: [],
    publishedAt: 0,
    updatedAt: 0,
    ...over,
  } as Product;
}

function alert(over: Partial<StockAlert> = {}): StockAlert {
  return {
    id: "a1",
    uid: "u1",
    email: "her@example.test",
    locale: "en",
    kind: "back-in-stock",
    productId: "p1",
    colorId: "white",
    sizeId: "m",
    priceAtSubscribe: 35,
    createdAt: NOW - 10 * DAY,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/*  Counting the right units                                                  */
/* -------------------------------------------------------------------------- */

describe("unitsFor", () => {
  test("counts the permutation asked for, not the product", () => {
    /*
     * The failure this prevents: telling somebody waiting on a medium that
     * their size is back because a large arrived.
     */
    assert.equal(unitsFor(product(), "white", "m"), 0);
    assert.equal(unitsFor(product(), "white", "l"), 4);
  });

  test("a colour with no size named sums that colourway", () => {
    assert.equal(unitsFor(product(), "white"), 4);
  });

  test("a permutation that no longer exists is zero, not the total", () => {
    assert.equal(unitsFor(product(), "cobalt", "xl"), 0);
  });

  test("a product with no variant rows uses its own count", () => {
    assert.equal(unitsFor(product({ variants: [], totalStock: 7 })), 7);
  });

  test("a negative count never adds", () => {
    const odd = product({ variants: [{ sku: "A", colorId: "white", sizeId: "m", stock: -5 }] });
    assert.equal(unitsFor(odd, "white", "m"), 0);
  });
});

/* -------------------------------------------------------------------------- */
/*  When to send                                                              */
/* -------------------------------------------------------------------------- */

describe("back-in-stock", () => {
  test("fires when the exact size returns", () => {
    const restocked = product({
      variants: [{ sku: "T-WHT-M", colorId: "white", sizeId: "m", stock: 3 }],
    });
    const verdict = shouldFire(alert(), restocked, NOW);
    assert.equal(verdict.fire, true);
    assert.equal(verdict.fire && verdict.stock, 3);
  });

  test("stays quiet while it is still gone", () => {
    assert.deepEqual(shouldFire(alert(), product(), NOW), { fire: false, reason: "not-yet" });
  });

  test("never fires twice", () => {
    /*
     * A size that comes back in ones and twos would otherwise mail the same
     * person every few days. One notification is a service; the fourth is why
     * people filter a shop's mail.
     */
    const restocked = product({
      variants: [{ sku: "T-WHT-M", colorId: "white", sizeId: "m", stock: 3 }],
    });
    const spent = alert({ notifiedAt: NOW - DAY });
    assert.deepEqual(shouldFire(spent, restocked, NOW), { fire: false, reason: "already-sent" });
  });

  test("an old request stops being one", () => {
    const stale = alert({ createdAt: NOW - (ALERT_LIFETIME_DAYS + 1) * DAY });
    const restocked = product({
      variants: [{ sku: "T-WHT-M", colorId: "white", sizeId: "m", stock: 3 }],
    });
    assert.deepEqual(shouldFire(stale, restocked, NOW), { fire: false, reason: "expired" });
  });

  test("a deleted product is a separate reason from a sold-out one", () => {
    // The customer hears the same silence either way; whoever reads the sweep
    // needs to tell them apart.
    assert.deepEqual(shouldFire(alert(), undefined, NOW), { fire: false, reason: "gone" });
  });
});

describe("what must never be announced", () => {
  const restocked = (over: Partial<Product> = {}) =>
    product({
      variants: [{ sku: "T-WHT-M", colorId: "white", sizeId: "m", stock: 3 }],
      ...over,
    });

  test("a draft, an archived piece, or one stopped by hand", () => {
    /*
     * None of these is "back". Mailing about one sends the customer to a page
     * that refuses them, which is worse than the silence they were expecting.
     */
    for (const over of [
      { status: "draft" as const },
      { status: "archived" as const },
      { visibility: "hidden" as const },
      { saleState: "sold-out" as const },
    ]) {
      const verdict = shouldFire(alert(), restocked(over), NOW);
      assert.equal(verdict.fire, false, JSON.stringify(over));
      assert.equal(verdict.fire === false && verdict.reason, "not-buyable");
    }
  });
});

describe("price-drop", () => {
  const watching = alert({ kind: "price-drop", colorId: undefined, sizeId: undefined });

  test("fires below the price they saw", () => {
    const verdict = shouldFire(watching, product({ price: 28 }), NOW);
    assert.equal(verdict.fire, true);
    assert.equal(verdict.fire && verdict.price, 28);
  });

  test("does not fire at the same price, or above it", () => {
    assert.equal(shouldFire(watching, product({ price: 35 }), NOW).fire, false);
    assert.equal(shouldFire(watching, product({ price: 40 }), NOW).fire, false);
  });

  test("compares against what the customer saw, not against today", () => {
    /*
     * Reading the price live would fire the moment any sale started —
     * including one that leaves the piece dearer than when they asked.
     */
    const sawItDear = alert({ kind: "price-drop", priceAtSubscribe: 20, colorId: undefined, sizeId: undefined });
    assert.equal(shouldFire(sawItDear, product({ price: 28 }), NOW).fire, false);
  });

  test("an explicit target wins over the remembered price", () => {
    const wants = alert({
      kind: "price-drop",
      priceAtSubscribe: 35,
      targetPrice: 25,
      colorId: undefined,
      sizeId: undefined,
    });
    assert.equal(shouldFire(wants, product({ price: 30 }), NOW).fire, false);
    assert.equal(shouldFire(wants, product({ price: 24 }), NOW).fire, true);
  });

  test("a drop on something sold out is not news", () => {
    // A sold-out piece going on sale is exactly when a merchant reprices, and
    // mailing about it produces a click and a disappointment.
    const gone = product({ price: 20, variants: [], totalStock: 0 });
    assert.deepEqual(shouldFire(watching, gone, NOW), { fire: false, reason: "not-yet" });
  });
});

describe("alertKey", () => {
  test("is one row per person, per thing, per kind", () => {
    // The first tap's confirmation is easy to miss, so people tap twice.
    assert.equal(alertKey(alert()), alertKey(alert({ id: "different" })));
    assert.notEqual(alertKey(alert()), alertKey(alert({ sizeId: "l" })));
    assert.notEqual(alertKey(alert()), alertKey(alert({ kind: "price-drop" })));
    assert.notEqual(alertKey(alert()), alertKey(alert({ uid: "u2" })));
  });
});

/* -------------------------------------------------------------------------- */
/*  The sweep                                                                 */
/* -------------------------------------------------------------------------- */

describe("planSweep", () => {
  test("separates what to send from what to leave, with reasons", () => {
    const catalogue = new Map([
      ["p1", product({ variants: [{ sku: "A", colorId: "white", sizeId: "m", stock: 2 }] })],
      ["p2", product({ id: "p2", status: "draft" })],
    ]);

    const plan = planSweep(
      [
        alert({ id: "send" }),
        alert({ id: "sent", notifiedAt: NOW - DAY }),
        alert({ id: "old", createdAt: NOW - 200 * DAY }),
        alert({ id: "missing", productId: "nope" }),
        alert({ id: "draft", productId: "p2" }),
      ],
      catalogue,
      NOW,
    );

    assert.deepEqual(plan.send.map((s) => s.alert.id), ["send"]);
    assert.equal(plan.skipped["already-sent"], 1);
    assert.equal(plan.skipped.expired, 1);
    assert.equal(plan.skipped.gone, 1);
    assert.equal(plan.skipped["not-buyable"], 1);
  });

  test("expired alerts are handed back so they can be cleared", () => {
    // A sweep that leaves them in place re-reads the same dead rows forever.
    const plan = planSweep([alert({ createdAt: NOW - 200 * DAY })], new Map(), NOW);
    assert.equal(plan.expired.length, 1);
  });

  test("an empty queue is an empty plan", () => {
    const plan = planSweep([], new Map(), NOW);
    assert.deepEqual(plan.send, []);
  });
});

/* -------------------------------------------------------------------------- */
/*  What it says                                                              */
/* -------------------------------------------------------------------------- */

describe("alertMessage", () => {
  test("names the size, because the shop sells five of them", () => {
    // "Your item is back" is a message the customer cannot act on without
    // going to look.
    const message = alertMessage(alert(), product(), 35, "White / M");
    assert.equal(message.subject.includes("White / M"), true);
  });

  test("is written in the language they asked in", () => {
    /*
     * Recorded on the alert rather than guessed from an address months later,
     * which gets it wrong for exactly the bilingual customers this shop has
     * most of.
     */
    const arabic = alertMessage(alert({ locale: "ar" }), product(), 35);
    assert.equal(arabic.subject.includes("تي شيرت قطن"), true);
    assert.equal(/[؀-ۿ]/.test(arabic.body), true);
  });

  test("a price drop says what it was and what it is", () => {
    const message = alertMessage(
      alert({ kind: "price-drop", priceAtSubscribe: 35 }),
      product({ price: 28 }),
      28,
    );
    assert.equal(message.body.includes("35"), true);
    assert.equal(message.body.includes("28"), true);
    assert.equal(message.body.includes("7"), true);
  });

  test("says there will not be another reminder", () => {
    // Because there will not be, and saying so is what makes one email a
    // service rather than the start of a series.
    assert.equal(alertMessage(alert(), product(), 35).body.includes("another reminder"), true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Recommendations                                                           */
/* -------------------------------------------------------------------------- */

describe("coOccurrence", () => {
  test("counts a basket once per product, however many were bought", () => {
    // Otherwise a product bought in multiples looks like its own best
    // companion.
    const { singles, baskets } = coOccurrence([{ id: "o1", productIds: ["a", "a", "a", "b"] }]);
    assert.equal(singles.get("a"), 1);
    assert.equal(baskets, 1);
  });

  test("an empty basket is not a basket", () => {
    assert.equal(coOccurrence([{ id: "o1", productIds: [] }]).baskets, 0);
  });
});

describe("boughtWith", () => {
  /*
   * "coat" is the bestseller: it is in almost every order. "scarf" appears
   * rarely, but nearly always beside "gloves".
   */
  const orders: OrderBasket[] = [
    { id: "1", productIds: ["coat", "tee"] },
    { id: "2", productIds: ["coat", "tee"] },
    { id: "3", productIds: ["coat", "dress"] },
    { id: "4", productIds: ["coat", "dress"] },
    { id: "5", productIds: ["coat", "scarf", "gloves"] },
    { id: "6", productIds: ["scarf", "gloves"] },
    { id: "7", productIds: ["coat"] },
    { id: "8", productIds: ["coat"] },
  ];

  test("a genuinely related pair outranks a popular one", () => {
    /*
     * Raw counts would put the bestseller on every page, which is the same as
     * recommending nothing. Scarf and gloves appear together twice; scarf and
     * coat appear together once — but scarf-and-gloves is far more than chance
     * explains, and coat-with-anything is not.
     */
    const forScarf = boughtWith("scarf", orders, 4);
    assert.equal(forScarf[0]!.productId, "gloves");
  });

  test("a pair seen once is not evidence", () => {
    // Presenting a coincidence as "customers also bought" is a claim the data
    // does not support.
    const forGloves = boughtWith("gloves", orders, 4);
    assert.equal(forGloves.every((r) => r.together >= MIN_CO_OCCURRENCE), true);
  });

  test("a product nobody has bought recommends nothing", () => {
    assert.deepEqual(boughtWith("brand-new", orders, 4), []);
  });

  test("no orders at all recommends nothing, rather than throwing", () => {
    assert.deepEqual(boughtWith("coat", [], 4), []);
  });

  test("the limit is respected", () => {
    assert.equal(boughtWith("coat", orders, 1).length <= 1, true);
  });
});

describe("recommendationsFor", () => {
  const catalogue = new Map<string, Product>([
    ["p1", product({ id: "p1" })],
    ["gloves", product({ id: "gloves" })],
    ["retired", product({ id: "retired", status: "archived" })],
    ["curated", product({ id: "curated" })],
  ]);

  const orders: OrderBasket[] = [
    { id: "1", productIds: ["p1", "gloves"] },
    { id: "2", productIds: ["p1", "gloves"] },
  ];

  test("evidence comes first", () => {
    const rail = recommendationsFor(
      product({ id: "p1", crossSellIds: ["curated"] }),
      orders,
      catalogue,
      4,
    );
    assert.equal(rail[0]!.id, "gloves");
  });

  test("the merchant's own list fills what evidence cannot", () => {
    // An empty rail on a new product is worse than the merchant's guess.
    const rail = recommendationsFor(
      product({ id: "brand-new", crossSellIds: ["curated"] }),
      orders,
      catalogue,
      4,
    );
    assert.deepEqual(rail.map((p) => p.id), ["curated"]);
  });

  test("a retired product is never recommended", () => {
    /*
     * The most common way these rails rot: the data is fine and the catalogue
     * moved. A recommendation for an archived piece is a click into a dead
     * end.
     */
    const rail = recommendationsFor(
      product({ id: "p1", crossSellIds: ["retired", "curated"] }),
      [],
      catalogue,
      4,
    );
    assert.deepEqual(rail.map((p) => p.id), ["curated"]);
  });

  test("the product never recommends itself", () => {
    const rail = recommendationsFor(
      product({ id: "p1", crossSellIds: ["p1"] }),
      [],
      catalogue,
      4,
    );
    assert.equal(rail.some((p) => p.id === "p1"), false);
  });

  test("nothing is listed twice", () => {
    const rail = recommendationsFor(
      product({ id: "p1", crossSellIds: ["gloves"] }),
      orders,
      catalogue,
      4,
    );
    assert.equal(new Set(rail.map((p) => p.id)).size, rail.length);
  });

  test("a product missing from the catalogue is skipped, not rendered empty", () => {
    const rail = recommendationsFor(
      product({ id: "p1", crossSellIds: ["deleted-long-ago", "curated"] }),
      [],
      catalogue,
      4,
    );
    assert.deepEqual(rail.map((p) => p.id), ["curated"]);
  });
});
