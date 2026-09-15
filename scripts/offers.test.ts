/**
 * Coupon rules — the cases that cost money when they are wrong.
 *
 *   npm run test:offers
 *
 * These are unit tests over `evaluateOffer`, which is the single implementation
 * the cart, the checkout API and the admin all call. Testing it here is worth
 * more than testing any one caller, because the bug this module was written to
 * kill was precisely that the three callers each had their own rules.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { evaluateOffer, offerStatus, findOfferByCode } from "../src/lib/offers";
import { priceCart, shippingCostFor } from "../src/lib/pricing";
import type { CartItem, Offer, ShippingMethod } from "../src/types";

const NOW = Date.UTC(2026, 5, 1);
const DAY = 86_400_000;

function line(overrides: Partial<CartItem> = {}): CartItem {
  return {
    key: "p1::",
    productId: "p1",
    sku: "NS-P1",
    slug: "p1",
    title: { en: "Coat", ar: "معطف" },
    image: { url: "/x.svg", alt: "", width: 1, height: 1 },
    colorId: "",
    colorName: { en: "", ar: "" },
    sizeId: "",
    sizeLabel: "",
    unitPrice: 100,
    currency: "JOD",
    quantity: 1,
    maxQuantity: 10,
    addedAt: 0,
    ...overrides,
  };
}

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: "o1",
    code: "SAVE10",
    type: "percentage",
    value: 10,
    title: { en: "10% off", ar: "خصم ١٠٪" },
    appliesToCategoryIds: [],
    appliesToProductIds: [],
    excludesCategoryIds: [],
    excludesProductIds: [],
    startsAt: NOW - DAY,
    endsAt: NOW + DAY,
    usageCount: 0,
    firstOrderOnly: false,
    stackable: false,
    status: "active",
    active: true,
    ...overrides,
  };
}

const ctx = (items: CartItem[], extra = {}) => ({
  items,
  subtotal: items.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
  now: NOW,
  ...extra,
});

/* -------------------------------------------------------------------------- */

test("a valid percentage coupon discounts the eligible subtotal", () => {
  const r = evaluateOffer(offer(), ctx([line()]));
  assert.equal(r.ok, true);
  assert.equal(r.discount, 10);
});

test("an expired coupon is refused", () => {
  const r = evaluateOffer(offer({ endsAt: NOW - 1 }), ctx([line()]));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired");
  assert.equal(r.discount, 0);
  // The refusal must be sayable in both languages, never a raw enum.
  assert.ok(r.message.ar.length > 0 && r.message.en.length > 0);
});

test("a coupon that has not started is refused", () => {
  const r = evaluateOffer(offer({ startsAt: NOW + DAY }), ctx([line()]));
  assert.equal(r.reason, "not-started");
});

test("the last redemption is the last: usage limit is enforced", () => {
  const r = evaluateOffer(offer({ usageLimit: 100, usageCount: 100 }), ctx([line()]));
  assert.equal(r.reason, "usage-limit");
});

test("per-user limit is enforced from the caller's usage count", () => {
  const o = offer({ perUserLimit: 1 });
  assert.equal(evaluateOffer(o, ctx([line()], { userUsage: 0 })).ok, true);
  assert.equal(evaluateOffer(o, ctx([line()], { userUsage: 1 })).reason, "user-limit");
});

test("first-order-only is refused for a returning customer", () => {
  const o = offer({ firstOrderOnly: true });
  assert.equal(evaluateOffer(o, ctx([line()], { isFirstOrder: true })).ok, true);
  assert.equal(
    evaluateOffer(o, ctx([line()], { isFirstOrder: false })).reason,
    "first-order-only",
  );
});

test("a personal code is refused on another account", () => {
  const o = offer({ assignedUid: "user-a" });
  assert.equal(evaluateOffer(o, ctx([line()], { uid: "user-a" })).ok, true);
  assert.equal(evaluateOffer(o, ctx([line()], { uid: "user-b" })).reason, "wrong-account");
});

test("minimum spend is enforced against the whole basket", () => {
  const r = evaluateOffer(offer({ minSubtotal: 150 }), ctx([line()]));
  assert.equal(r.reason, "min-subtotal");
});

test("a category-scoped coupon matches through the category path", () => {
  // The regression: the old implementation checked `appliesToCategoryIds` in
  // its guard but then filtered by product id only, so this discounted zero.
  const o = offer({ appliesToCategoryIds: ["outerwear"] });
  const paths = { p1: ["outerwear", "outerwear-coats"] };
  const r = evaluateOffer(o, ctx([line()], { categoryPaths: paths }));
  assert.equal(r.ok, true);
  assert.equal(r.discount, 10);

  const miss = evaluateOffer(o, ctx([line()], { categoryPaths: { p1: ["bags"] } }));
  assert.equal(miss.reason, "no-eligible-items");
});

test("an exclusion beats an inclusion", () => {
  const o = offer({
    appliesToCategoryIds: ["outerwear"],
    excludesProductIds: ["p1"],
  });
  const r = evaluateOffer(o, ctx([line()], { categoryPaths: { p1: ["outerwear"] } }));
  assert.equal(r.reason, "no-eligible-items");
});

test("a percentage discount is capped by maxDiscount", () => {
  const o = offer({ value: 25, maxDiscount: 15 });
  const r = evaluateOffer(o, ctx([line({ unitPrice: 400 })]));
  assert.equal(r.discount, 15, "25% of 400 is 100, but the cap is 15");
});

test("a fixed discount never exceeds the eligible subtotal", () => {
  const o = offer({ type: "fixed", value: 500 });
  const r = evaluateOffer(o, ctx([line({ unitPrice: 30 })]));
  assert.equal(r.discount, 30);
});

test("a discount only applies to the eligible lines, not the whole bag", () => {
  const o = offer({ value: 50, appliesToProductIds: ["p1"] });
  const items = [line(), line({ key: "p2::", productId: "p2", unitPrice: 900 })];
  const r = evaluateOffer(o, ctx(items));
  assert.equal(r.eligibleSubtotal, 100);
  assert.equal(r.discount, 50, "50% of the eligible 100, not of the 1000 basket");
});

/* ---- free shipping: the bug that prompted all of this ------------------- */

const method: ShippingMethod = {
  id: "standard",
  speed: "standard",
  name: { en: "Standard", ar: "عادي" },
  price: 5,
  minDays: 3,
  maxDays: 5,
};

test("a valid free-shipping coupon waives the fee", () => {
  const o = offer({ type: "free-shipping", value: 0 });
  assert.equal(shippingCostFor(100, method, o, [line()], [], evaluateOffer(o, ctx([line()]))), 0);
});

test("an EXPIRED free-shipping coupon does NOT waive the fee", () => {
  /*
   * The regression. `shippingCostFor` used to read
   * `offer.type === "free-shipping" && offer.active`, which checks neither
   * the dates nor the redemption limit — so a campaign that closed in March
   * kept delivering free forever to anyone still holding the code, and the
   * only symptom was a slightly smaller number on the order.
   */
  const expired = offer({ type: "free-shipping", value: 0, endsAt: NOW - 1 });
  const verdict = evaluateOffer(expired, ctx([line()]));
  assert.equal(verdict.ok, false);
  assert.equal(shippingCostFor(100, method, expired, [line()], [], verdict), 5);
});

test("a free-shipping coupon below its minimum does not waive the fee", () => {
  const o = offer({ type: "free-shipping", value: 0, minSubtotal: 500 });
  const verdict = evaluateOffer(o, ctx([line()]));
  assert.equal(verdict.reason, "min-subtotal");
  assert.equal(shippingCostFor(100, method, o, [line()], [], verdict), 5);
});

test("a fully-redeemed free-shipping coupon does not waive the fee", () => {
  const o = offer({ type: "free-shipping", value: 0, usageLimit: 10, usageCount: 10 });
  const verdict = evaluateOffer(o, ctx([line()]));
  assert.equal(verdict.reason, "usage-limit");
  assert.equal(shippingCostFor(100, method, o, [line()], [], verdict), 5);
});

/* ---- totals ------------------------------------------------------------- */

test("priceCart applies the coupon once, to both discount and shipping", () => {
  const o = offer({ type: "free-shipping", value: 0 });
  const totals = priceCart({
    items: [line()],
    shippingMethod: method,
    offer: o,
    offerEvaluation: evaluateOffer(o, ctx([line()])),
  });
  assert.equal(totals.discount, 0, "free shipping is not a line discount");
  assert.equal(totals.shipping, 0);
});

test("an invalid coupon changes no number in the totals", () => {
  const expired = offer({ endsAt: NOW - 1 });
  const totals = priceCart({ items: [line()], shippingMethod: method, offer: expired });
  assert.equal(totals.discount, 0);
  assert.equal(totals.shipping, 5);
});

/* ---- status + lookup ---------------------------------------------------- */

test("a coupon written before `status` existed reads as active, not draft", () => {
  // Reading a missing status as "draft" would switch off every running
  // campaign the moment this deploys.
  const legacy = { ...offer(), status: undefined as never, active: true };
  assert.equal(offerStatus(legacy), "active");

  const paused = { ...offer(), status: undefined as never, active: false };
  assert.equal(offerStatus(paused), "paused");
});

test("codes match the way customers type them", () => {
  const list = [offer({ code: "SAVE10" })];
  assert.ok(findOfferByCode(list, " save10 "));
  assert.ok(findOfferByCode(list, "Save 10"));
  assert.equal(findOfferByCode(list, "SAVE11"), null);
  assert.equal(findOfferByCode(list, "   "), null);
});

test("an archived coupon is refused but its wording does not leak its history", () => {
  const r = evaluateOffer(offer({ status: "archived" }), ctx([line()]));
  assert.equal(r.reason, "archived");
  assert.equal(r.ok, false);
});
