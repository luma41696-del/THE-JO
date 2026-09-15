import { strict as assert } from "node:assert";
import { test } from "node:test";

import { applyZone, quoteShipping, zoneFor } from "@/lib/shipping";
import { priceCart } from "@/lib/pricing";
import type { CartItem, ShippingMethod, ShippingZone } from "@/types";

/* -------------------------------------------------------------------------- */

const method: ShippingMethod = {
  id: "standard",
  speed: "standard",
  name: { en: "Standard", ar: "عادي" },
  price: 4,
  minDays: 3,
  maxDays: 5,
  freeAbove: 75,
};

const zone = (over: Partial<ShippingZone> = {}): ShippingZone => ({
  id: "amman",
  name: { en: "Amman", ar: "عمّان" },
  areas: ["Amman", "عمّان"],
  surcharge: 0,
  ...over,
});

const line = (price: number, quantity = 1): CartItem =>
  ({
    key: `k${price}`,
    productId: "p",
    sku: "SKU",
    slug: "p",
    title: { en: "Piece", ar: "قطعة" },
    image: { url: "/demo/x.svg", alt: "", width: 1, height: 1 },
    colorId: "",
    colorName: { en: "", ar: "" },
    sizeId: "",
    sizeLabel: "",
    unitPrice: price,
    currency: "JOD",
    quantity,
    maxQuantity: 10,
    addedAt: 0,
  }) as CartItem;

/* -------------------------------------------------------------------------- */
/*  Matching                                                                  */
/* -------------------------------------------------------------------------- */

test("an address matches its zone in either language, and either case", () => {
  const zones = [zone()];
  assert.equal(zoneFor(zones, { city: "amman", region: "" })?.id, "amman");
  assert.equal(zoneFor(zones, { city: "AMMAN", region: "" })?.id, "amman");
  assert.equal(zoneFor(zones, { city: "  Amman  ", region: "" })?.id, "amman");
  assert.equal(zoneFor(zones, { city: "عمّان", region: "" })?.id, "amman");
});

test("region wins over city, so a city listed in two places is not ambiguous", () => {
  const zones = [
    zone({ id: "north", name: { en: "North", ar: "شمال" }, areas: ["Irbid"] }),
    zone({ id: "capital", name: { en: "Capital", ar: "العاصمة" }, areas: ["Amman"] }),
  ];
  assert.equal(zoneFor(zones, { region: "Irbid", city: "Amman" })?.id, "north");
});

test("an unlisted address is not refused — it just has no zone", () => {
  // A shopper in a town the merchant has not got round to listing must not
  // hit a wall at checkout over an omission in a settings table.
  assert.equal(zoneFor([zone()], { city: "Karak", region: "Karak" }), undefined);
  assert.equal(zoneFor([zone()], null), undefined);
  assert.equal(zoneFor([zone()], { city: "", region: "" }), undefined);
});

/* -------------------------------------------------------------------------- */
/*  Charging                                                                  */
/* -------------------------------------------------------------------------- */

test("no zone means the method's own price, unchanged", () => {
  const quote = quoteShipping(method, [line(10)], [], 10);
  assert.equal(applyZone(quote, undefined, 10).total, 4);
});

test("a zone surcharge is added on top of the method", () => {
  const quote = quoteShipping(method, [line(10)], [], 10);
  const far = applyZone(quote, zone({ id: "aqaba", surcharge: 6 }), 10);
  assert.equal(far.total, 10);
  assert.equal(far.zone?.id, "aqaba");
});

test("a zone threshold replaces the method's rather than stacking", () => {
  const quote = quoteShipping(method, [line(90)], [], 90);
  // The method would be free at 75; this zone demands 120, so it is not.
  const strict = applyZone(quote, zone({ surcharge: 6, freeAbove: 120 }), 90);
  assert.equal(strict.freeApplied, true, "the method already waived it at 75");

  const below = applyZone(
    quoteShipping({ ...method, freeAbove: undefined }, [line(90)], [], 90),
    zone({ surcharge: 6, freeAbove: 120 }),
    90,
  );
  assert.equal(below.freeApplied, false, "90 does not clear the zone's 120");
  assert.equal(below.total, 10);
});

test("a zone can be more generous than the shop", () => {
  const quote = quoteShipping({ ...method, freeAbove: 75 }, [line(50)], [], 50);
  const generous = applyZone(quote, zone({ freeAbove: 40 }), 50);
  assert.equal(generous.freeApplied, true);
  assert.equal(generous.total, 0);
});

test("an excluded zone is flagged with its own reason", () => {
  const quote = quoteShipping(method, [line(10)], [], 10);
  const refused = applyZone(quote, zone({ excluded: true }), 10);
  assert.equal(refused.unavailableReason, "zone-excluded");
  // Not "class-excluded": one is about the goods, the other the address, and
  // they are two different sentences for the customer.
  assert.notEqual(refused.unavailableReason, "class-excluded");
});

/* -------------------------------------------------------------------------- */
/*  The totals the customer actually sees                                     */
/* -------------------------------------------------------------------------- */

test("priceCart quotes the zone, so cart and checkout cannot disagree", () => {
  const items = [line(30)];
  const withoutZone = priceCart({ items, shippingMethod: method });
  const withZone = priceCart({
    items,
    shippingMethod: method,
    shippingZone: zone({ surcharge: 5 }),
  });

  assert.equal(withoutZone.shipping, 4);
  assert.equal(withZone.shipping, 9);
  assert.equal(withZone.total, withoutZone.total + 5);
});

test("a shop with no shipping classes still honours its zones", () => {
  // The path that skips `quoteShipping` entirely — it used to ignore the zone.
  const totals = priceCart({
    items: [line(20)],
    shippingMethod: method,
    shippingClasses: [],
    shippingZone: zone({ surcharge: 3 }),
  });
  assert.equal(totals.shipping, 7);
});
