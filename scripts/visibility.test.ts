import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  effectiveVisibility, isPurchasable, isShoppable, seasonsOf,
  storefrontState, unavailableReason, visibleProducts,
} from "@/lib/visibility";
import type { Product } from "@/types";

const NOW = Date.UTC(2026, 6, 1);
const DAY = 86_400_000;

const base = {
  id: "p1", slug: "p1", type: "simple", title: { en: "Coat", ar: "معطف" },
  description: { en: "", ar: "" }, categoryId: "c", categoryPath: ["c"],
  collectionIds: [], tags: [], upsellIds: [], crossSellIds: [],
  price: 100, currency: "JOD", images: [], colors: [], sizes: [],
  sizeSystem: "one-size", sku: "SKU", inStock: true, totalStock: 10,
  badges: [], status: "active", publishedAt: 0, updatedAt: 0,
} as unknown as Product;

const p = (o: Partial<Product> = {}) => ({ ...base, ...o }) as Product;

test("an unclassified product counts as all-season, not as nothing", () => {
  assert.deepEqual(seasonsOf(p()), ["all-season"]);
  assert.deepEqual(seasonsOf(p({ seasons: ["winter"] })), ["winter"]);
});

test("hiding does not touch stock, status or the order history", () => {
  const hidden = p({ visibility: "hidden" });
  assert.equal(storefrontState(hidden, NOW), "hidden");
  assert.equal(hidden.totalStock, 10, "stock survives");
  assert.equal(hidden.status, "active", "status survives");
});

test("the four states are told apart", () => {
  assert.equal(storefrontState(p(), NOW), "live");
  assert.equal(storefrontState(p({ inStock: false, totalStock: 0 }), NOW), "out-of-stock");
  assert.equal(storefrontState(p({ visibility: "hidden" }), NOW), "hidden");
  assert.equal(storefrontState(p({ status: "draft" }), NOW), "draft");
  assert.equal(storefrontState(p({ status: "archived" }), NOW), "archived");
});

test("sold-out products stay browsable; hidden ones do not", () => {
  assert.equal(isShoppable(p({ inStock: false, totalStock: 0 }), NOW), true);
  assert.equal(isShoppable(p({ visibility: "hidden" }), NOW), false);
});

test("nothing but a live product can be bought", () => {
  assert.equal(isPurchasable(p(), NOW), true);
  assert.equal(isPurchasable(p({ inStock: false, totalStock: 0 }), NOW), false);
  assert.equal(isPurchasable(p({ visibility: "hidden" }), NOW), false);
  assert.equal(isPurchasable(p({ status: "draft" }), NOW), false);
});

test("a hidden product never claims to be sold out", () => {
  const hidden = unavailableReason(p({ visibility: "hidden" }), NOW);
  assert.ok(hidden && !/sold out/i.test(hidden.en), "no false scarcity claim");
  const gone = unavailableReason(p({ inStock: false, totalStock: 0 }), NOW);
  assert.ok(gone && /sold out/i.test(gone.en));
});

test("a show-at schedule flips the product at its instant", () => {
  const later = p({ visibility: "hidden", visibilitySchedule: { showAt: NOW + DAY } });
  assert.equal(effectiveVisibility(later, NOW), "hidden");
  assert.equal(effectiveVisibility(later, NOW + DAY + 1), "visible");
});

test("a hide-at schedule pulls the product at its instant", () => {
  const soon = p({ visibilitySchedule: { hideAt: NOW + DAY } });
  assert.equal(effectiveVisibility(soon, NOW), "visible");
  assert.equal(effectiveVisibility(soon, NOW + DAY + 1), "hidden");
});

test("showAt before hideAt is a run: visible only between them", () => {
  const run = p({ visibilitySchedule: { showAt: NOW, hideAt: NOW + 10 * DAY } });
  assert.equal(effectiveVisibility(run, NOW - DAY), "hidden");
  assert.equal(effectiveVisibility(run, NOW + 5 * DAY), "visible");
  assert.equal(effectiveVisibility(run, NOW + 20 * DAY), "hidden");
});

test("hideAt before showAt is a blackout: hidden only between them", () => {
  // A summer blackout for a winter coat: hide in June, show again in October.
  const blackout = p({ visibilitySchedule: { hideAt: NOW, showAt: NOW + 90 * DAY } });
  assert.equal(effectiveVisibility(blackout, NOW - DAY), "visible");
  assert.equal(effectiveVisibility(blackout, NOW + 30 * DAY), "hidden");
  assert.equal(effectiveVisibility(blackout, NOW + 100 * DAY), "visible");
});

test("a manual override beats a forgotten schedule", () => {
  const forced = p({
    visibility: "visible",
    visibilityOverride: true,
    visibilitySchedule: { hideAt: NOW - DAY },
  });
  assert.equal(effectiveVisibility(forced, NOW), "visible", "the override wins");

  const without = p({ visibility: "visible", visibilitySchedule: { hideAt: NOW - DAY } });
  assert.equal(effectiveVisibility(without, NOW), "hidden", "without it, the schedule wins");
});

test("visibleProducts drops hidden, draft and archived but keeps sold-out", () => {
  const list = [
    p({ id: "a" }),
    p({ id: "b", visibility: "hidden" }),
    p({ id: "c", status: "draft" }),
    p({ id: "d", inStock: false, totalStock: 0 }),
  ];
  assert.deepEqual(visibleProducts(list, NOW).map((x) => x.id), ["a", "d"]);
});
