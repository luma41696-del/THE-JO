import { strict as assert } from "node:assert";
import { test } from "node:test";

import { EVENT_FOR_STATUS, describeState, messageFor } from "@/lib/notify/templates";
import { notificationId } from "@/lib/notify/queue";
import { storeSettings } from "@/data/site-content";
import type { CartItem, Notification, Order } from "@/types";

/* -------------------------------------------------------------------------- */

const item = (): CartItem =>
  ({
    key: "k",
    productId: "tee",
    sku: "NS-TEE",
    slug: "tee",
    title: { en: "Boxy Cotton Tee", ar: "تيشيرت" },
    image: { url: "/demo/tee.svg", alt: "", width: 1, height: 1 },
    colorId: "bone",
    colorName: { en: "Bone", ar: "عظمي" },
    sizeId: "m",
    sizeLabel: "M",
    unitPrice: 35,
    currency: "JOD",
    quantity: 1,
    maxQuantity: 5,
    addedAt: 0,
  }) as CartItem;

const order = (over: Partial<Order> = {}): Order =>
  ({
    id: "order-1",
    reference: "NS-7K4M2X",
    uid: "u1",
    email: "lina@example.com",
    locale: "en",
    items: [item()],
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
    totals: { subtotal: 35, discount: 0, shipping: 4, tax: 6.24, total: 45.24, currency: "JOD" },
    timeline: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as unknown as Order;

/* -------------------------------------------------------------------------- */
/*  Which statuses speak                                                      */
/* -------------------------------------------------------------------------- */

test("warehouse states are silent", () => {
  /*
   * A customer who gets four emails between paying and dispatch learns to
   * ignore all of them — including the one that mattered.
   */
  assert.equal(EVENT_FOR_STATUS.processing, undefined);
  assert.equal(EVENT_FOR_STATUS.packed, undefined);
  assert.equal(EVENT_FOR_STATUS.pending, undefined);
  assert.equal(EVENT_FOR_STATUS.cancelled, undefined);

  assert.equal(EVENT_FOR_STATUS.paid, "order-paid");
  assert.equal(EVENT_FOR_STATUS.shipped, "order-shipped");
  assert.equal(EVENT_FOR_STATUS.delivered, "order-delivered");
  assert.equal(EVENT_FOR_STATUS.refunded, "order-refunded");
});

/* -------------------------------------------------------------------------- */
/*  What they say                                                             */
/* -------------------------------------------------------------------------- */

test("every message carries the order reference", () => {
  // The first thing support asks for, and the only thing that identifies it.
  for (const event of [
    "order-received",
    "order-paid",
    "order-shipped",
    "order-delivered",
    "order-refunded",
  ] as const) {
    const message = messageFor(event, order(), storeSettings, "en");
    assert.ok(message, `${event} has a message`);
    assert.match(message.subject + message.body, /NS-7K4M2X/, `${event} names the order`);
  }
});

test("messages are written in the language the order was placed in", () => {
  const ar = messageFor("order-shipped", order({ locale: "ar" }), storeSettings, "ar");
  const en = messageFor("order-shipped", order(), storeSettings, "en");

  assert.match(ar!.subject, /[؀-ۿ]/, "Arabic subject");
  assert.doesNotMatch(en!.subject, /[؀-ۿ]/, "English subject");
});

test("dispatch quotes the tracking number only when there is one", () => {
  const without = messageFor("order-shipped", order(), storeSettings, "en");
  assert.doesNotMatch(without!.body, /Tracking number/);
  // A line reading "Tracking: undefined" is worse than no line at all.
  assert.doesNotMatch(without!.body, /undefined/);

  const with_ = messageFor(
    "order-shipped",
    order({ trackingNumber: "JO123456789" } as Partial<Order>),
    storeSettings,
    "en",
  );
  assert.match(with_!.body, /JO123456789/);
});

test("nothing promises the parcel has moved before it has", () => {
  // The payment notice must not say "on its way" — that belongs to dispatch,
  // and a notice running ahead of the parcel has someone waiting at the door
  // a day early.
  const paid = messageFor("order-paid", order(), storeSettings, "en")!;
  assert.doesNotMatch(paid.body, /on its way|has left|dispatched/i);

  const shipped = messageFor("order-shipped", order(), storeSettings, "en")!;
  assert.match(shipped.body, /left our warehouse/i);
});

test("the delivery notice quotes the real return window", () => {
  const message = messageFor("order-delivered", order(), storeSettings, "en")!;
  assert.match(message.body, new RegExp(`${storeSettings.returnWindowDays} days`));
});

test("the refund notice states the amount that went back", () => {
  const message = messageFor("order-refunded", order(), storeSettings, "en")!;
  assert.match(message.body, /45\.240/, "the order's own total, formatted as JOD");
});

test("every message signs off with the shop's real contact details", () => {
  const message = messageFor("order-received", order(), storeSettings, "en")!;
  assert.match(message.body, new RegExp(storeSettings.contact.email.replace(".", "\\.")));
});

/* -------------------------------------------------------------------------- */
/*  Once per order per event                                                  */
/* -------------------------------------------------------------------------- */

test("the id is derived from the order and the event, so a repeat overwrites", () => {
  // An operator moving an order back and forth must not put a second "your
  // order shipped" in somebody's inbox.
  assert.equal(notificationId("order-1", "order-shipped"), "order-1__order-shipped");
  assert.equal(
    notificationId("order-1", "order-shipped"),
    notificationId("order-1", "order-shipped"),
  );
  assert.notEqual(
    notificationId("order-1", "order-shipped"),
    notificationId("order-1", "order-delivered"),
  );
  assert.notEqual(
    notificationId("order-1", "order-shipped"),
    notificationId("order-2", "order-shipped"),
  );
});

/* -------------------------------------------------------------------------- */
/*  Reporting                                                                 */
/* -------------------------------------------------------------------------- */

const record = (over: Partial<Notification> = {}): Notification =>
  ({
    id: "n1",
    orderId: "order-1",
    orderReference: "NS-7K4M2X",
    event: "order-shipped",
    channel: "email",
    to: "lina@example.com",
    locale: "en",
    subject: "Order NS-7K4M2X is on its way",
    state: "sent",
    attempts: 1,
    queuedAt: 0,
    ...over,
  }) as Notification;

test("an unconfigured provider reads as 'not sent', never as a failure", () => {
  /*
   * The distinction the whole `skipped` state exists for: a message that
   * bounced is a delivery problem, one the shop was never able to send is a
   * setup task. Collapsing them buries the second in a list of the first.
   */
  const skipped = describeState(record({ state: "skipped" }));
  assert.match(skipped, /not sent/);
  assert.doesNotMatch(skipped, /failed/);

  const failed = describeState(record({ state: "failed", error: "403: domain not verified" }));
  assert.match(failed, /failed/);
  assert.match(failed, /domain not verified/, "the provider's own words survive");
});

test("a failure with no message still reads as a failure", () => {
  const described = describeState(record({ state: "failed" }));
  assert.match(described, /failed/);
  assert.doesNotMatch(described, /undefined/);
});
