import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  TAX_RATE,
  creditNoteFrom,
  describeLine,
  formatInvoiceNumber,
  invoiceFrom,
  invoiceLines,
  shouldInvoice,
} from "@/lib/invoice";
import type { CartItem, Invoice, Order } from "@/types";

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* -------------------------------------------------------------------------- */

const line = (over: Partial<CartItem> = {}): CartItem =>
  ({
    key: "k",
    productId: "tee",
    sku: "NS-TEE-BONE-M",
    slug: "tee",
    title: { en: "Boxy Cotton Tee", ar: "تيشيرت قطن واسع" },
    image: { url: "/demo/tee.svg", alt: "", width: 1, height: 1 },
    colorId: "bone",
    colorName: { en: "Bone", ar: "عظمي" },
    sizeId: "m",
    sizeLabel: "M",
    unitPrice: 35,
    currency: "JOD",
    quantity: 2,
    maxQuantity: 10,
    addedAt: 0,
    ...over,
  }) as CartItem;

const order = (over: Partial<Order> = {}): Order =>
  ({
    id: "order-1",
    reference: "NS-2026-0001",
    uid: "u1",
    email: "lina@example.com",
    items: [line()],
    status: "paid",
    paymentMethod: "cod",
    shippingAddress: {
      id: "shipping",
      fullName: "Lina Haddad",
      phone: "+962790000000",
      line1: "12 Rainbow Street",
      city: "Amman",
      region: "Amman",
      countryCode: "JO",
      isDefault: false,
    },
    totals: {
      subtotal: 70,
      discount: 10,
      shipping: 4,
      tax: 10.24,
      total: 74.24,
      currency: "JOD",
    },
    timeline: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as unknown as Order;

/* -------------------------------------------------------------------------- */
/*  Numbering                                                                 */
/* -------------------------------------------------------------------------- */

test("numbers are zero-padded, per year, and sort lexically in issue order", () => {
  assert.equal(formatInvoiceNumber(2026, 1), "INV-2026-00001");
  assert.equal(formatInvoiceNumber(2026, 42), "INV-2026-00042");
  assert.equal(formatInvoiceNumber(2026, 99999), "INV-2026-99999");

  // Padding is what makes a plain string sort match the real sequence — an
  // unpadded "INV-2026-10" would sort before "INV-2026-9".
  const sorted = [
    formatInvoiceNumber(2026, 9),
    formatInvoiceNumber(2026, 10),
    formatInvoiceNumber(2026, 100),
  ].sort();
  assert.deepEqual(sorted, ["INV-2026-00009", "INV-2026-00010", "INV-2026-00100"]);
});

test("the sequence restarts each year, which is what a tax return is filed on", () => {
  assert.equal(formatInvoiceNumber(2025, 1), "INV-2025-00001");
  assert.notEqual(formatInvoiceNumber(2026, 1), formatInvoiceNumber(2025, 1));
});

/* -------------------------------------------------------------------------- */
/*  What gets invoiced                                                        */
/* -------------------------------------------------------------------------- */

test("pending and cancelled orders are never invoiced", () => {
  // Issuing for either would put a number in the sequence that has to be
  // voided immediately — the exact hole gapless numbering prevents.
  assert.equal(shouldInvoice("pending"), false);
  assert.equal(shouldInvoice("cancelled"), false);

  for (const status of ["paid", "processing", "packed", "shipped", "delivered", "refunded"] as const) {
    assert.equal(shouldInvoice(status), true, `${status} should invoice`);
  }
});

/* -------------------------------------------------------------------------- */
/*  Lines                                                                     */
/* -------------------------------------------------------------------------- */

test("a line names the design, in both languages", () => {
  const described = describeLine(
    line({ designId: "palm", designName: { en: "Palm", ar: "نخلة" } }),
  );
  assert.equal(described.en, "Boxy Cotton Tee · Palm · Bone · M");
  assert.equal(described.ar, "تيشيرت قطن واسع · نخلة · عظمي · M");
});

test("a simple product's line carries no empty separators", () => {
  const described = describeLine(
    line({ colorName: { en: "", ar: "" }, sizeLabel: "", designName: undefined }),
  );
  assert.equal(described.en, "Boxy Cotton Tee", "no trailing ' · · '");
});

test("line totals are quantity × unit price, rounded once", () => {
  const [row] = invoiceLines([line({ unitPrice: 12.345, quantity: 3 })]);
  assert.equal(row?.total, 37.035);
});

/* -------------------------------------------------------------------------- */
/*  The document                                                              */
/* -------------------------------------------------------------------------- */

test("totals are copied from the order, never recomputed", () => {
  /*
   * The guard that matters most here. Recalculating tax on the invoice would
   * mean a future rate change silently rewriting orders already paid, and a
   * customer holding a receipt that no longer matches their bank statement.
   */
  const source = order({
    totals: { subtotal: 100, discount: 0, shipping: 5, tax: 999, total: 1104, currency: "JOD" },
  } as Partial<Order>);

  const invoice = invoiceFrom(source, "INV-2026-00001", 1_000);
  assert.equal(invoice.tax, 999, "the order's tax wins, however odd");
  assert.equal(invoice.total, 1104);
  assert.equal(invoice.taxRate, TAX_RATE, "the rate is recorded alongside it");
});

test("the invoice carries the order's identity and the customer's details", () => {
  const invoice = invoiceFrom(order(), "INV-2026-00007", 5_000);

  assert.equal(invoice.number, "INV-2026-00007");
  assert.equal(invoice.orderId, "order-1");
  assert.equal(invoice.orderReference, "NS-2026-0001");
  assert.equal(invoice.status, "paid");
  assert.equal(invoice.issuedAt, 5_000);
  assert.equal(invoice.billTo.name, "Lina Haddad");
  assert.equal(invoice.billTo.email, "lina@example.com");
  assert.equal(invoice.billTo.city, "Amman");
  assert.equal(invoice.paymentMethod, "cod");
});

test("optional address fields are omitted rather than written as undefined", () => {
  // Firestore rejects an explicit undefined, so an absent line2 must not
  // appear as a key at all.
  const invoice = invoiceFrom(order(), "INV-2026-00001", 1);
  assert.equal("line2" in invoice.billTo, false);
  assert.equal(JSON.stringify(invoice).includes("undefined"), false);
});

/* -------------------------------------------------------------------------- */
/*  Credit notes                                                              */
/* -------------------------------------------------------------------------- */

test("a credit note is a new document with its own number", () => {
  const original = { ...invoiceFrom(order(), "INV-2026-00010", 1_000), id: "inv-1" } as Invoice;
  const note = creditNoteFrom(original, "INV-2026-00011", 2_000);

  assert.equal(note.number, "INV-2026-00011", "its own number, not the original's");
  assert.equal(note.status, "credited");
  assert.equal(note.orderId, original.orderId, "still points at the same order");
  assert.match(note.notes?.en ?? "", /INV-2026-00010/, "and names what it credits");
});

test("credit note amounts stay positive, with the status carrying the sign", () => {
  /*
   * A ledger that sums `total` without reading `status` must not quietly
   * halve the year's revenue — and a negative on a printed document reads as
   * a mistake rather than a credit.
   */
  const original = { ...invoiceFrom(order(), "INV-2026-00010", 1_000), id: "inv-1" } as Invoice;
  const note = creditNoteFrom(original, "INV-2026-00011", 2_000);

  assert.equal(note.total, original.total);
  assert.ok(note.total > 0);
  assert.ok(note.lines.every((l) => l.total > 0));
});

/* -------------------------------------------------------------------------- */
/*  The issuer — gapless, and idempotent per order                            */
/* -------------------------------------------------------------------------- */

/**
 * A minimal in-memory Firestore.
 *
 * Enough to exercise `issueInvoice`: documents, `where` filters, and a
 * `runTransaction` that buffers writes and applies them at the end — so a
 * transaction that throws leaves nothing behind, which is the property the
 * gapless guarantee rests on.
 */
function fakeDb() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let ids = 0;

  const col = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };

  const makeQuery = (name: string, filters: [string, unknown][]) => ({
    where(field: string, _op: string, value: unknown) {
      return makeQuery(name, [...filters, [field, value]]);
    },
    limit() {
      return this;
    },
    _run() {
      const docs = [...col(name).entries()]
        .filter(([, data]) => filters.every(([f, v]) => data[f] === v))
        .map(([id, data]) => ({ id, data: () => data, ref: { _col: name, _id: id } }));
      return { empty: docs.length === 0, docs };
    },
  });

  const collection = (name: string) => ({
    doc(id?: string) {
      const docId = id ?? `auto-${++ids}`;
      return { _col: name, _id: docId, get: () => ({ data: () => col(name).get(docId) }) };
    },
    where(field: string, op: string, value: unknown) {
      return makeQuery(name, []).where(field, op, value);
    },
  });

  return {
    _store: store,
    collection,
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const writes: (() => void)[] = [];
      const tx = {
        async get(target: { _col?: string; _id?: string; _run?: () => unknown }) {
          if (typeof target._run === "function") return target._run();
          const data = col(target._col!).get(target._id!);
          return { exists: data !== undefined, data: () => data };
        },
        set(ref: { _col: string; _id: string }, data: Record<string, unknown>) {
          writes.push(() => col(ref._col).set(ref._id, data));
        },
        update(ref: { _col: string; _id: string }, patch: Record<string, unknown>) {
          writes.push(() =>
            col(ref._col).set(ref._id, { ...col(ref._col).get(ref._id), ...patch }),
          );
        },
      };
      const result = await fn(tx);
      // Applied only on success: a throw must leave the counter untouched.
      for (const write of writes) write();
      return result;
    },
  };
}

test("numbers run 1, 2, 3 with no gaps", async () => {
  const { issueInvoice } = await import("@/lib/invoice.server");
  const db = fakeDb();
  const at = Date.UTC(2026, 5, 1);

  const numbers: string[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const { invoice } = await issueInvoice(
      db as never,
      order({ id: `order-${i}`, reference: `NS-2026-000${i}` }),
      at,
    );
    numbers.push(invoice.number);
  }

  assert.deepEqual(numbers, ["INV-2026-00001", "INV-2026-00002", "INV-2026-00003"]);
});

test("issuing twice for one order returns the first invoice, not a second", async () => {
  const { issueInvoice } = await import("@/lib/invoice.server");
  const db = fakeDb();
  const at = Date.UTC(2026, 5, 1);

  // An operator double-clicking "mark paid", or a retried request.
  const first = await issueInvoice(db as never, order(), at);
  const second = await issueInvoice(db as never, order(), at);

  assert.equal(first.created, true);
  assert.equal(second.created, false, "the second call created nothing");
  assert.equal(second.invoice.number, first.invoice.number);
  assert.equal(db._store.get("invoices")?.size, 1);
  assert.equal(db._store.get("counters")?.get("invoices-2026")?.next, 1, "no number was burnt");
});

test("a failed transaction burns no number", async () => {
  const { issueInvoice } = await import("@/lib/invoice.server");
  const db = fakeDb();
  const at = Date.UTC(2026, 5, 1);

  await issueInvoice(db as never, order({ id: "a" }), at);

  // Simulate a write failure part-way through.
  const broken = {
    ...db,
    runTransaction: async () => {
      throw new Error("network");
    },
  };
  await assert.rejects(() => issueInvoice(broken as never, order({ id: "b" }), at));

  // The next real order takes 2, not 3 — the hole never opened.
  const next = await issueInvoice(db as never, order({ id: "c" }), at);
  assert.equal(next.invoice.number, "INV-2026-00002");
});

test("a credit note takes the next number and marks the original", async () => {
  const { issueCreditNote, issueInvoice } = await import("@/lib/invoice.server");
  const db = fakeDb();
  const at = Date.UTC(2026, 5, 1);

  const { invoice } = await issueInvoice(db as never, order(), at);
  const note = await issueCreditNote(db as never, order({ status: "refunded" }), at + 1000);

  assert.equal(invoice.number, "INV-2026-00001");
  assert.equal(note?.number, "INV-2026-00002", "the note is in the sequence too");
  assert.equal(note?.status, "credited");

  const stored = [...(db._store.get("invoices")?.values() ?? [])] as unknown as Invoice[];
  assert.equal(stored.length, 2, "the original is kept, not overwritten");
  assert.equal(
    stored.filter((i) => i.status === "credited").length,
    2,
    "the original is marked credited and the note is a credit",
  );
});

test("refunding twice does not issue a second credit note", async () => {
  const { issueCreditNote, issueInvoice } = await import("@/lib/invoice.server");
  const db = fakeDb();
  const at = Date.UTC(2026, 5, 1);

  await issueInvoice(db as never, order(), at);
  const first = await issueCreditNote(db as never, order({ status: "refunded" }), at + 1);
  const second = await issueCreditNote(db as never, order({ status: "refunded" }), at + 2);

  assert.equal(second?.number, first?.number);
  assert.equal(db._store.get("invoices")?.size, 2, "still one invoice and one note");
});

test("an order that was never invoiced cannot be credited", async () => {
  const { issueCreditNote } = await import("@/lib/invoice.server");
  const db = fakeDb();

  // A refund on a cancelled order has nothing to credit; inventing a note
  // would put a negative against revenue that was never recognised.
  const note = await issueCreditNote(db as never, order({ status: "refunded" }), Date.now());
  assert.equal(note, null);
  assert.equal(db._store.get("invoices")?.size ?? 0, 0, "nothing was written");
});
