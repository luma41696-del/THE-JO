import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { MAX_BATCH, batchFor, filterOrders } from "../src/lib/admin/orders-filter";
import type { Order, OrderStatus } from "../src/types";

/**
 * Which orders a batch print will actually print.
 *
 * This filter is shared by the board and the print route on purpose: two
 * implementations would eventually disagree, and the day they did the
 * warehouse would print a different set from the one on screen. These tests
 * are what stop that.
 *
 * Run with:
 *
 *     npm run test:orders-filter
 */

let sequence = 0;

function order(overrides: Partial<Order> = {}): Order {
  sequence += 1;
  return {
    id: `o${sequence}`,
    reference: `NS-${String(sequence).padStart(6, "0")}`,
    uid: "u1",
    email: "customer@example.com",
    items: [
      {
        key: "k",
        productId: "p",
        sku: "SKU",
        slug: "tee",
        title: { en: "Wool Coat", ar: "معطف صوف" },
        image: { url: "/demo/x.svg", alt: "x", width: 1, height: 1 },
        colorId: "ink",
        colorName: { en: "Ink", ar: "حبري" },
        sizeId: "m",
        sizeLabel: "M",
        unitPrice: 10,
        currency: "JOD",
        quantity: 1,
        maxQuantity: 5,
        maxReason: "stock",
        addedAt: 0,
      },
    ],
    totals: { subtotal: 10, discount: 0, shipping: 0, tax: 0, total: 10, currency: "JOD" },
    shippingAddress: {
      id: "a",
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
      price: 0,
      minDays: 2,
      maxDays: 4,
    },
    paymentMethod: "cod",
    status: "paid",
    timeline: [],
    createdAt: sequence,
    updatedAt: sequence,
    ...overrides,
  } as Order;
}

const statuses: OrderStatus[] = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"];
const catalogue = statuses.map((status) => order({ status }));

describe("filtering", () => {
  test("no filter at all is every order", () => {
    assert.equal(filterOrders(catalogue).length, catalogue.length);
    assert.equal(filterOrders(catalogue, { status: "all" }).length, catalogue.length);
  });

  /*
   * A status nobody recognises matches nothing, and that is the safe answer
   * rather than the obvious one. The alternative — falling back to "all" —
   * means a stale or hand-edited link prints the entire board, which on a busy
   * shop is two hundred pages the operator never asked for. Nothing printed is
   * a question; everything printed is a bin full of paper.
   */
  test("an unknown status matches nothing rather than everything", () => {
    assert.equal(filterOrders(catalogue, { status: "banana" }).length, 0);
  });

  test("one status is exactly that status", () => {
    const paid = filterOrders(catalogue, { status: "paid" });
    assert.equal(paid.length, 1);
    assert.equal(paid[0]!.status, "paid");
  });

  /*
   * The default view of the board, and the one the morning batch is printed
   * from. Getting this set wrong means picking orders nobody has paid for.
   */
  test("needs-action is pending, paid and processing — and nothing else", () => {
    const rows = filterOrders(catalogue, { status: "needs-action" });
    assert.deepEqual(
      rows.map((o) => o.status).sort(),
      ["paid", "pending", "processing"],
    );
  });

  test("search matches the reference, the customer, the city and the tracking", () => {
    const rows = [
      order({ reference: "NS-AAA111" }),
      order({ shippingAddress: { ...catalogue[0]!.shippingAddress, fullName: "Omar Khalil" } as never }),
      order({ shippingAddress: { ...catalogue[0]!.shippingAddress, city: "Irbid" } as never }),
      order({ trackingNumber: "TRK-9" }),
    ];
    assert.equal(filterOrders(rows, { search: "aaa111" }).length, 1);
    assert.equal(filterOrders(rows, { search: "omar" }).length, 1);
    assert.equal(filterOrders(rows, { search: "irbid" }).length, 1);
    assert.equal(filterOrders(rows, { search: "trk-9" }).length, 1);
  });

  test("search matches a product in the order", () => {
    assert.equal(filterOrders(catalogue, { search: "wool" }).length, catalogue.length);
    assert.equal(filterOrders(catalogue, { search: "kettle" }).length, 0);
  });

  test("whitespace alone is not a search", () => {
    assert.equal(filterOrders(catalogue, { search: "   " }).length, catalogue.length);
  });

  test("status and search compose", () => {
    const rows = filterOrders(catalogue, { status: "paid", search: "wool" });
    assert.equal(rows.length, 1);
    assert.equal(filterOrders(catalogue, { status: "paid", search: "kettle" }).length, 0);
  });

  test("an order with no address does not crash the filter", () => {
    const broken = [order({ shippingAddress: undefined as never })];
    assert.equal(filterOrders(broken, { search: "lina" }).length, 0);
    assert.equal(filterOrders(broken).length, 1);
  });
});

describe("the batch cap", () => {
  /*
   * "Print all" on a shop with four thousand orders is one click from a print
   * queue nobody can stop. The cap prints the newest and *reports* the rest.
   */
  test("a big board is capped, and says how many it left", () => {
    const many = Array.from({ length: MAX_BATCH + 12 }, () => order());
    const { printing, omitted } = batchFor(many);
    assert.equal(printing.length, MAX_BATCH);
    assert.equal(omitted, 12);
  });

  test("a small board prints whole, with nothing omitted", () => {
    const { printing, omitted } = batchFor(catalogue);
    assert.equal(printing.length, catalogue.length);
    assert.equal(omitted, 0);
  });

  test("the newest are the ones that print", () => {
    const old = order({ createdAt: 1 });
    const recent = order({ createdAt: 9_999 });
    const { printing } = batchFor([old, recent]);
    assert.equal(printing[0]!.id, recent.id);
  });

  test("an empty board prints nothing rather than throwing", () => {
    const { printing, omitted } = batchFor([]);
    assert.deepEqual(printing, []);
    assert.equal(omitted, 0);
  });
});
