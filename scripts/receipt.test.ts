import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  PAPERS,
  buildReceipt,
  code128,
  code128Encodable,
  fitToColumns,
  paperFor,
} from "../src/lib/receipt";
import type { Order } from "../src/types";

/**
 * Receipts for a thermal printer.
 *
 * Run with:
 *
 *     npm run test:receipt
 */

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "o1",
    reference: "NS-7K4M2X",
    uid: "u1",
    email: "customer@example.com",
    items: [
      {
        key: "p:white:m",
        productId: "p",
        sku: "TEE-WHITE-M",
        slug: "tee",
        title: { en: "Oversized Cotton T-Shirt", ar: "تي شيرت قطن واسع" },
        image: { url: "/demo/tee.svg", alt: "Tee", width: 10, height: 10 },
        colorId: "white",
        colorName: { en: "White", ar: "أبيض" },
        sizeId: "m",
        sizeLabel: "M",
        unitPrice: 12,
        currency: "JOD",
        quantity: 2,
        maxQuantity: 5,
        maxReason: "stock",
        addedAt: 0,
      },
    ],
    totals: { subtotal: 24, discount: 0, shipping: 3, tax: 0, total: 27, currency: "JOD" },
    shippingAddress: {
      id: "a1",
      fullName: "Lina Haddad",
      phone: "+962790000000",
      line1: "12 Rainbow St",
      city: "Amman",
      region: "Amman",
      countryCode: "JO",
      isDefault: true,
    },
    shippingMethod: {
      id: "standard",
      speed: "standard",
      name: { en: "Standard", ar: "عادي" },
      price: 3,
      minDays: 2,
      maxDays: 4,
    },
    paymentMethod: "cod",
    status: "paid",
    timeline: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  } as Order;
}

describe("paper", () => {
  test("the wide roll is the default, and an unknown width does not crash the receipt", () => {
    assert.equal(paperFor(undefined).id, "80mm");
    assert.equal(paperFor("73mm").id, "80mm");
    assert.equal(paperFor("58mm").id, "58mm");
  });

  /*
   * The printable strip is narrower than the roll — a thermal head does not
   * reach the edges. Laying out to the full width puts the amount column half
   * off the paper, which is exactly the column that must not be cut.
   */
  test("the printable strip is narrower than the paper", () => {
    for (const paper of Object.values(PAPERS)) {
      assert.ok(parseInt(paper.printable, 10) < parseInt(paper.width, 10), paper.id);
    }
  });
});

describe("fitting a name to the roll", () => {
  test("something short is left exactly as it is", () => {
    assert.equal(fitToColumns("Wool Coat", 22), "Wool Coat");
  });

  test("a long name breaks on a word, not mid-word", () => {
    const fitted = fitToColumns("Sculpted Shoulder Blazer", 20);
    assert.ok(fitted.length <= 20, fitted);
    assert.equal(fitted, "Sculpted Shoulder…");
  });

  /*
   * A first word longer than the paper has to be cut somewhere. Returning the
   * untouched name instead would push the amount column off the roll.
   */
  test("a single word longer than the paper is still cut", () => {
    const fitted = fitToColumns("Unpronounceablegarment", 10);
    assert.ok(fitted.length <= 10, fitted);
    assert.ok(fitted.endsWith("…"));
  });

  test("runs of whitespace collapse rather than eating the width", () => {
    assert.equal(fitToColumns("Wool   \n  Coat", 22), "Wool Coat");
  });

  test("Arabic is fitted too", () => {
    const fitted = fitToColumns("تي شيرت قطن واسع بقصة عريضة جداً", 14);
    assert.ok(fitted.length <= 14, fitted);
  });
});

describe("building the receipt", () => {
  test("lines carry the permutation, not just the product", () => {
    const receipt = buildReceipt(order(), "en", PAPERS["80mm"]);
    assert.equal(receipt.lines.length, 1);
    assert.match(receipt.lines[0]!.options, /White/);
    assert.match(receipt.lines[0]!.options, /M/);
    assert.equal(receipt.lines[0]!.quantity, 2);
  });

  test("the line total is unit price times quantity, not the unit price", () => {
    const receipt = buildReceipt(order(), "en", PAPERS["80mm"]);
    assert.match(receipt.lines[0]!.total, /24/);
    assert.match(receipt.lines[0]!.unitPrice, /12/);
  });

  test("units are counted across the order, for the packer", () => {
    assert.equal(buildReceipt(order(), "en", PAPERS["80mm"]).units, 2);
  });

  /*
   * Paper costs money per millimetre and a zero line is read as a mistake.
   * "Discount 0.000" on a receipt makes a customer ask what discount.
   */
  test("a zero discount and a zero tax are left off entirely", () => {
    const receipt = buildReceipt(order(), "en", PAPERS["80mm"]);
    const labels = receipt.totals.map((line) => line.label);
    assert.deepEqual(labels, ["Subtotal", "Delivery", "TOTAL"]);
  });

  test("a real discount is printed, and as a subtraction", () => {
    const discounted = order({
      totals: { subtotal: 24, discount: 4, shipping: 3, tax: 1, total: 24, currency: "JOD" },
    });
    const receipt = buildReceipt(discounted, "en", PAPERS["80mm"]);
    assert.deepEqual(
      receipt.totals.map((line) => line.label),
      ["Subtotal", "Discount", "Delivery", "Tax", "TOTAL"],
    );
    assert.match(receipt.totals[1]!.value, /^−/);
  });

  test("free delivery is not printed as a zero charge", () => {
    const free = order({
      totals: { subtotal: 90, discount: 0, shipping: 0, tax: 0, total: 90, currency: "JOD" },
    });
    const labels = buildReceipt(free, "en", PAPERS["80mm"]).totals.map((l) => l.label);
    assert.deepEqual(labels, ["Subtotal", "TOTAL"]);
  });

  test("the total is the one marked for emphasis, and only it", () => {
    const receipt = buildReceipt(order(), "en", PAPERS["80mm"]);
    assert.equal(receipt.totals.filter((line) => line.emphasis).length, 1);
    assert.equal(receipt.totals.at(-1)!.emphasis, true);
  });

  test("Arabic prints Arabic words", () => {
    const receipt = buildReceipt(order(), "ar", PAPERS["80mm"]);
    assert.equal(receipt.totals.at(-1)!.label, "الإجمالي");
    assert.equal(receipt.delivery, "عادي");
  });

  test("the narrow roll trims harder than the wide one", () => {
    const wide = buildReceipt(order(), "en", PAPERS["80mm"]).lines[0]!.name;
    const narrow = buildReceipt(order(), "en", PAPERS["58mm"]).lines[0]!.name;
    assert.ok(narrow.length < wide.length, `${narrow} vs ${wide}`);
  });

  /*
   * The internal id is not a word. A receipt reading "apple-pay" is what the
   * one person holding proof of payment sees.
   */
  test("payment is named the way the customer chose it, in their language", () => {
    assert.equal(buildReceipt(order(), "en", PAPERS["80mm"]).payment, "Cash on delivery");
    assert.equal(buildReceipt(order(), "ar", PAPERS["80mm"]).payment, "الدفع عند الاستلام");
  });

  test("an order with no address still produces a receipt", () => {
    const walkIn = order({ shippingAddress: undefined as never });
    const receipt = buildReceipt(walkIn, "en", PAPERS["80mm"]);
    assert.equal(receipt.customer.name, "");
    assert.equal(receipt.customer.phone, undefined);
  });
});

/* -------------------------------------------------------------------------- */
/*  Code 128                                                                  */
/* -------------------------------------------------------------------------- */

/** Widths back to a digit string, so a known encoding can be compared. */
const asPattern = (bars: number[]) => bars.join("");

describe("code128", () => {
  /*
   * A barcode nobody proofreads. These are checked against the published
   * Code 128-B encoding rather than against what the function happens to do,
   * so a change that quietly breaks scanning shows up here and not at a till.
   */
  test("encodes a known string exactly, checksum and all", () => {
    // "A" is value 33: start-B (104) + 33*1 = 137, 137 % 103 = 34.
    const bars = code128("A");
    assert.ok(bars);
    assert.equal(
      asPattern(bars.bars),
      // start-B   "A"        checksum 34   stop + its final 2-module bar
      "211214" + "111323" + "131123" + "2331112",
    );
    // start 11 + data 11 + check 11 + stop 13. A module count that drifts is
    // a barcode that scans short.
    assert.equal(bars.modules, 46);
  });

  test("the checksum weights the start character as one, not zero", () => {
    // Two strings of equal length differing in one place must differ in the
    // check symbol; an off-by-one in the weighting is the classic way to get a
    // barcode that looks right and scans as nothing.
    const a = code128("AB")!;
    const b = code128("BA")!;
    assert.notEqual(asPattern(a.bars), asPattern(b.bars));
  });

  test("a real order reference encodes", () => {
    const bars = code128("NS-7K4M2X");
    assert.ok(bars);
    // start + 9 characters + checksum + stop, six modules each, plus the
    // stop symbol's final two-module bar.
    assert.equal(bars.bars.length, (1 + 9 + 1 + 1) * 6 + 1);
    assert.equal(bars.text, "NS-7K4M2X");
  });

  test("the module count matches the widths, so the viewBox cannot clip it", () => {
    const bars = code128("NS-7K4M2X")!;
    assert.equal(bars.modules, bars.bars.reduce((sum, w) => sum + w, 0));
  });

  /*
   * Undefined, never an empty barcode. A blank box tells the operator
   * something is wrong; bars that scan as nothing waste their time first.
   */
  test("what subset B cannot carry is refused rather than mangled", () => {
    assert.equal(code128(""), undefined);
    assert.equal(code128("مرحبا"), undefined);
    assert.equal(code128("NSX"), undefined);
    assert.equal(code128Encodable("NS-7K4M2X"), true);
    assert.equal(code128Encodable("naïve"), false);
  });

  test("every symbol is a real pattern — no gaps in the table", () => {
    const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
    const bars = code128(printable);
    assert.ok(bars);
    assert.ok(bars.bars.every((width) => width >= 1 && width <= 4));
  });
});
