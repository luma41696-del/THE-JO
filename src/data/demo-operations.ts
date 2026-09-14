import { demoProducts, demoShippingMethods } from "./demo";
import { priceCart } from "@/lib/pricing";
import { cartKey } from "@/lib/utils";
import { resolveSelection } from "@/lib/product";
import type {
  CartItem,
  Invoice,
  Order,
  OrderEvent,
  OrderStatus,
  PaymentMethod,
  SupportTicket,
  TicketMessage,
  TicketStatus,
  TicketTopic,
} from "@/types";

/**
 * Generated operations data — orders, invoices and support tickets.
 *
 * The admin is unusable against an empty database: you cannot judge a dashboard,
 * a chart axis or a table layout with no rows in it. This module synthesises a
 * realistic 120-day trading history so every admin screen can be designed,
 * reviewed and demoed before a single real order exists.
 *
 * It is **deterministic**. A seeded PRNG means the same figures appear on every
 * machine and every reload, so a number on screen can be checked against a
 * number in a review, and a chart does not reshuffle itself between screenshots.
 *
 * `src/lib/admin/data.ts` prefers Firestore and falls back here, exactly as the
 * storefront catalogue does.
 */

/* -------------------------------------------------------------------------- */
/*  Deterministic randomness                                                  */
/* -------------------------------------------------------------------------- */

/** mulberry32 — small, fast, and stable across engines. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = seeded(20260115);

const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const DAY = 86_400_000;
/** Matches `NOW` in `demo.ts` so the two datasets describe the same world. */
const NOW = Date.UTC(2026, 0, 15);
const WINDOW_DAYS = 120;

/* -------------------------------------------------------------------------- */
/*  Customers                                                                 */
/* -------------------------------------------------------------------------- */

const CUSTOMERS = [
  { name: "Lina Haddad", email: "lina.haddad@example.com", city: "Amman", region: "Amman" },
  { name: "Omar Khalil", email: "omar.khalil@example.com", city: "Amman", region: "Amman" },
  { name: "Dana Sayegh", email: "dana.sayegh@example.com", city: "Irbid", region: "Irbid" },
  { name: "Yara Nasser", email: "yara.nasser@example.com", city: "Zarqa", region: "Zarqa" },
  { name: "Rami Odeh", email: "rami.odeh@example.com", city: "Amman", region: "Amman" },
  { name: "Sara Mansour", email: "sara.mansour@example.com", city: "Aqaba", region: "Aqaba" },
  { name: "Tareq Barakat", email: "tareq.barakat@example.com", city: "Amman", region: "Amman" },
  { name: "Nour Salameh", email: "nour.salameh@example.com", city: "Madaba", region: "Madaba" },
  { name: "Hala Darwish", email: "hala.darwish@example.com", city: "Amman", region: "Amman" },
  { name: "Ziad Fahmy", email: "ziad.fahmy@example.com", city: "Irbid", region: "Irbid" },
  { name: "Maya Tannous", email: "maya.tannous@example.com", city: "Amman", region: "Amman" },
  { name: "Faris Jaber", email: "faris.jaber@example.com", city: "Salt", region: "Balqa" },
] as const;

const PAYMENTS: PaymentMethod[] = ["card", "card", "card", "apple-pay", "cliq", "cod"];

/**
 * Where an order of a given age has got to.
 *
 * Recent orders are still moving; anything older than a fortnight has landed.
 * A small share cancels or is refunded, because a dashboard that never shows a
 * cancellation teaches you nothing about how the cancellation UI behaves.
 */
function statusForAge(ageDays: number, roll: number): OrderStatus {
  if (roll < 0.04) return "cancelled";
  if (roll < 0.07 && ageDays > 10) return "refunded";

  if (ageDays < 1) return roll < 0.5 ? "paid" : "processing";
  if (ageDays < 2) return roll < 0.5 ? "processing" : "packed";
  if (ageDays < 4) return roll < 0.5 ? "packed" : "shipped";
  if (ageDays < 6) return roll < 0.5 ? "shipped" : "out-for-delivery";
  return "delivered";
}

const STATUS_FLOW: OrderStatus[] = [
  "pending",
  "paid",
  "processing",
  "packed",
  "shipped",
  "out-for-delivery",
  "delivered",
];

function timelineFor(status: OrderStatus, createdAt: number): OrderEvent[] {
  const events: OrderEvent[] = [
    { status: "pending", at: createdAt, note: { en: "Order received", ar: "تم استلام الطلب" } },
  ];

  if (status === "cancelled") {
    events.push({
      status: "cancelled",
      at: createdAt + between(2, 20) * 3_600_000,
      note: { en: "Cancelled at customer request", ar: "أُلغي بناءً على طلب العميل" },
    });
    return events;
  }

  const target = status === "refunded" ? "delivered" : status;
  const reached = STATUS_FLOW.slice(1, STATUS_FLOW.indexOf(target) + 1);

  let at = createdAt;
  for (const step of reached) {
    at += between(4, 20) * 3_600_000;
    events.push({ status: step, at });
  }

  if (status === "refunded") {
    events.push({
      status: "refunded",
      at: at + between(1, 5) * DAY,
      note: { en: "Refunded — size exchange declined", ar: "استُرد المبلغ — رُفض استبدال المقاس" },
    });
  }

  return events;
}

/* -------------------------------------------------------------------------- */
/*  Orders                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Daily order volume with a shape a real store would have: a weekend lift, a
 * gentle upward trend, and a spike during the private-sale window. Flat random
 * noise would make every chart look the same and hide layout problems.
 */
function ordersOnDay(ageDays: number): number {
  const date = new Date(NOW - ageDays * DAY);
  const weekday = date.getUTCDay();

  // Thursday–Saturday is the Jordanian weekend shopping peak.
  const weekendLift = weekday === 4 || weekday === 5 || weekday === 6 ? 1.55 : 1;
  // Slow growth across the window, newest strongest.
  const trend = 1 + (WINDOW_DAYS - ageDays) / WINDOW_DAYS;
  // The private sale ran 2–6 days before "now".
  const saleSpike = ageDays >= 2 && ageDays <= 6 ? 2.1 : 1;

  const base = 2.2 * weekendLift * trend * saleSpike;
  return Math.max(0, Math.round(base + (rand() - 0.45) * 2.2));
}

function buildItems(): CartItem[] {
  const lineCount = rand() < 0.55 ? 1 : rand() < 0.85 ? 2 : 3;
  const chosen = new Set<string>();
  const items: CartItem[] = [];

  for (let i = 0; i < lineCount; i += 1) {
    const product = pick(demoProducts);
    if (chosen.has(product.id)) continue;
    chosen.add(product.id);

    /*
     * A simple product has no colours and no sizes, so `pick` over an empty
     * array returns undefined. Both ids stay empty strings, exactly as the
     * live cart builds them, and the order line reads as an object rather
     * than a garment with a blank size.
     */
    const color = product.colors.length > 0 ? pick(product.colors) : undefined;
    const size = product.sizes.length > 0 ? pick(product.sizes) : undefined;
    const colorId = color?.id ?? "";
    const sizeId = size?.id ?? "";

    const image = product.images.find((img) => img.colorId === colorId) ?? product.images[0];
    if (!image) continue;

    // Resolve the real variant so the seeded history carries SKUs and GTINs
    // that exist — an invoice quoting a SKU the catalogue never had is a
    // document nobody can reconcile.
    const selection = resolveSelection(product, colorId, sizeId);
    const quantity = Math.min(rand() < 0.88 ? 1 : 2, Math.max(1, selection.cap.max));

    items.push({
      key: cartKey(product.id, colorId, sizeId),
      productId: product.id,
      sku: selection.sku,
      ...(selection.gtin === undefined ? {} : { gtin: selection.gtin }),
      slug: product.slug,
      title: product.title,
      image,
      colorId,
      colorName: color?.name ?? { en: "", ar: "" },
      sizeId,
      sizeLabel: size?.label ?? "",
      unitPrice: selection.price,
      compareAtPrice: product.compareAtPrice,
      currency: product.currency,
      quantity,
      maxQuantity: Math.max(1, selection.cap.max),
      maxReason: selection.cap.reason,
      ...(product.shippingClassId === undefined
        ? {}
        : { shippingClassId: product.shippingClassId }),
      addedAt: 0,
    });
  }

  return items.length > 0 ? items : buildItems();
}

function reference(n: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  let value = n * 7919 + 104729;
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length) + 31;
  }
  return `NS-${out}`;
}

function buildOrders(): Order[] {
  const orders: Order[] = [];
  let counter = 0;

  for (let ageDays = WINDOW_DAYS; ageDays >= 0; ageDays -= 1) {
    const count = ordersOnDay(ageDays);

    for (let i = 0; i < count; i += 1) {
      const customer = pick(CUSTOMERS);
      const items = buildItems();

      // Spread orders through business hours rather than all at midnight.
      const createdAt = NOW - ageDays * DAY + between(8, 21) * 3_600_000 + between(0, 59) * 60_000;

      const method =
        rand() < 0.62
          ? demoShippingMethods[0]!
          : rand() < 0.85
            ? demoShippingMethods[1]!
            : pick(demoShippingMethods);

      const totals = priceCart({ items, shippingMethod: method });
      const status = statusForAge(ageDays, rand());
      const timeline = timelineFor(status, createdAt);
      const updatedAt = timeline[timeline.length - 1]?.at ?? createdAt;
      counter += 1;

      orders.push({
        id: `demo-order-${counter}`,
        reference: reference(counter),
        uid: `demo-uid-${CUSTOMERS.indexOf(customer)}`,
        email: customer.email,
        items,
        totals,
        shippingAddress: {
          id: "shipping",
          fullName: customer.name,
          phone: `+9627${between(7000000, 9999999)}`,
          line1: `${between(1, 90)} ${pick(["Rainbow St", "Mecca St", "Abdoun Circle", "Wasfi Al-Tal St", "University St"])}`,
          city: customer.city,
          region: customer.region,
          countryCode: "JO",
          isDefault: true,
        },
        shippingMethod: method,
        paymentMethod: pick(PAYMENTS),
        status,
        timeline,
        trackingNumber: ["shipped", "out-for-delivery", "delivered"].includes(status)
          ? `JOEX${between(100000000, 999999999)}`
          : undefined,
        estimatedDeliveryAt: createdAt + method.maxDays * DAY,
        createdAt,
        updatedAt,
      });
    }
  }

  return orders.sort((a, b) => b.createdAt - a.createdAt);
}

export const demoOrders: Order[] = buildOrders();

/* -------------------------------------------------------------------------- */
/*  Invoices                                                                  */
/* -------------------------------------------------------------------------- */

const TAX_RATE = 0.16;

/**
 * One invoice per order that reached payment. Numbering is sequential and
 * gapless in issue order — most tax authorities require exactly that, and it is
 * far easier to build in from the start than to retrofit.
 */
export const demoInvoices: Invoice[] = demoOrders
  .filter((order) => order.status !== "pending" && order.status !== "cancelled")
  .sort((a, b) => a.createdAt - b.createdAt)
  .map((order, index) => {
    const year = new Date(order.createdAt).getUTCFullYear();
    const paid = order.status !== "refunded";

    return {
      id: `demo-invoice-${index + 1}`,
      number: `INV-${year}-${String(index + 1).padStart(5, "0")}`,
      orderId: order.id,
      orderReference: order.reference,
      status: order.status === "refunded" ? "credited" : "paid",
      issuedAt: order.createdAt,
      paidAt: paid ? order.createdAt : undefined,
      billTo: {
        name: order.shippingAddress.fullName,
        email: order.email,
        phone: order.shippingAddress.phone,
        line1: order.shippingAddress.line1,
        city: order.shippingAddress.city,
        countryCode: order.shippingAddress.countryCode,
      },
      lines: order.items.map((item) => ({
        description: item.title,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: Math.round(item.unitPrice * item.quantity * 1000) / 1000,
      })),
      subtotal: order.totals.subtotal,
      discount: order.totals.discount,
      shipping: order.totals.shipping,
      taxRate: TAX_RATE,
      tax: order.totals.tax,
      total: order.totals.total,
      currency: order.totals.currency,
      paymentMethod: order.paymentMethod,
    } satisfies Invoice;
  })
  .sort((a, b) => b.issuedAt - a.issuedAt);

/* -------------------------------------------------------------------------- */
/*  Support tickets                                                           */
/* -------------------------------------------------------------------------- */

const TICKET_SEEDS: {
  subject: string;
  topic: TicketTopic;
  body: string;
  status: TicketStatus;
  reply?: string;
}[] = [
  {
    subject: "Coat arrived with a loose button",
    topic: "product",
    body: "The second button on the Atelier Wool Coat was loose out of the box. I do not want to return it — can you send a spare?",
    status: "open",
  },
  {
    subject: "Between sizes on the slip dress",
    topic: "sizing",
    body: "The fitting room said M but I usually wear S in silk. Which should I take?",
    status: "pending",
    reply: "The bias cut runs generous through the hip — with your measurements I would take the S.",
  },
  {
    subject: "Where is my order?",
    topic: "delivery",
    body: "Tracking has not updated in two days. Has it left the warehouse?",
    status: "resolved",
    reply: "It cleared the Amman hub this morning and is out for delivery today. Apologies for the silent stretch.",
  },
  {
    subject: "Exchange the trousers for a 30",
    topic: "returns",
    body: "The 28 is too tight at the waist. Can I exchange rather than refund?",
    status: "open",
  },
  {
    subject: "CliQ payment did not go through",
    topic: "payment",
    body: "The transfer left my account but the order still says pending.",
    status: "pending",
    reply: "I can see the reference — the bank settles CliQ in batches. I have marked the order paid manually.",
  },
  {
    subject: "Cashmere care instructions",
    topic: "product",
    body: "Can the Featherweight tee go in a wool-cycle wash or is it hand-wash only?",
    status: "resolved",
    reply: "Hand wash cold and dry flat. A wool cycle will survive it but will shorten the life of the knit.",
  },
  {
    subject: "Invoice needs a company tax number",
    topic: "other",
    body: "I need the invoice reissued with our company VAT number for expenses.",
    status: "open",
  },
  {
    subject: "Delivery to Aqaba timing",
    topic: "delivery",
    body: "Is express actually next-day to Aqaba, or is that Amman only?",
    status: "closed",
    reply: "Next business day covers Amman, Zarqa and Irbid. Aqaba is two days on express.",
  },
];

export const demoTickets: SupportTicket[] = TICKET_SEEDS.map((seed, index) => {
  const customer = CUSTOMERS[index % CUSTOMERS.length]!;
  const createdAt = NOW - between(0, 21) * DAY - between(0, 20) * 3_600_000;
  const linkedOrder = demoOrders[index * 3];

  // Explicitly typed: inferred from its first element, the array would narrow
  // `authorName` to that one customer's literal name and reject the staff reply.
  const messages: TicketMessage[] = [
    {
      id: `m-${index}-1`,
      authorId: `demo-uid-${index % CUSTOMERS.length}`,
      authorName: customer.name,
      fromStaff: false,
      body: seed.body,
      at: createdAt,
    },
  ];

  let firstResponseMinutes: number | undefined;
  if (seed.reply) {
    const replyAt = createdAt + between(20, 300) * 60_000;
    firstResponseMinutes = Math.round((replyAt - createdAt) / 60_000);
    messages.push({
      id: `m-${index}-2`,
      authorId: "staff-1",
      authorName: "net sale Support",
      fromStaff: true,
      body: seed.reply,
      at: replyAt,
    });
  }

  return {
    id: `demo-ticket-${index + 1}`,
    reference: `SUP-${String(index + 1).padStart(4, "0")}`,
    uid: `demo-uid-${index % CUSTOMERS.length}`,
    customerName: customer.name,
    email: customer.email,
    subject: seed.subject,
    topic: seed.topic,
    status: seed.status,
    priority: seed.status === "open" && seed.topic === "payment" ? "urgent" : seed.topic === "delivery" ? "high" : "normal",
    orderReference: linkedOrder?.reference,
    messages,
    createdAt,
    updatedAt: messages[messages.length - 1]!.at,
    firstResponseMinutes,
  } satisfies SupportTicket;
}).sort((a, b) => b.updatedAt - a.updatedAt);

/* -------------------------------------------------------------------------- */
/*  Customers, derived                                                        */
/* -------------------------------------------------------------------------- */

export interface CustomerSummary {
  uid: string;
  name: string;
  email: string;
  city: string;
  orders: number;
  revenue: number;
  firstOrderAt: number;
  lastOrderAt: number;
}

/**
 * Customers are derived from orders rather than stored separately here: the
 * figures that matter on this screen — lifetime value, order count, recency —
 * are all properties of the order history, and deriving them means they can
 * never disagree with it.
 */
export const demoCustomers: CustomerSummary[] = Object.values(
  demoOrders.reduce<Record<string, CustomerSummary>>((acc, order) => {
    // Cancelled orders are not revenue and must not inflate lifetime value.
    if (order.status === "cancelled") return acc;

    const existing = acc[order.uid];
    if (existing) {
      existing.orders += 1;
      existing.revenue += order.status === "refunded" ? 0 : order.totals.total;
      existing.firstOrderAt = Math.min(existing.firstOrderAt, order.createdAt);
      existing.lastOrderAt = Math.max(existing.lastOrderAt, order.createdAt);
    } else {
      acc[order.uid] = {
        uid: order.uid,
        name: order.shippingAddress.fullName,
        email: order.email,
        city: order.shippingAddress.city,
        orders: 1,
        revenue: order.status === "refunded" ? 0 : order.totals.total,
        firstOrderAt: order.createdAt,
        lastOrderAt: order.createdAt,
      };
    }
    return acc;
  }, {}),
).sort((a, b) => b.revenue - a.revenue);
