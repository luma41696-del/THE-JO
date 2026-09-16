import type { Locale, Product } from "@/types";

/**
 * "Tell me when it's back", and "tell me if it drops".
 *
 * The most valuable thing a shop can do with somebody who wanted a piece and
 * could not have it: remember, and say so once. A sold-out size is otherwise
 * the end of that visit and usually of that customer.
 *
 * ## Why the condition is checked against the catalogue, not against a write
 *
 * The obvious implementation fires alerts from whatever code path raised the
 * stock. There are five such paths already — the editor, bulk edit, import,
 * the checkout's own restock on a cancelled order, and somebody typing in the
 * Firebase console — and an alert system that only knows about three of them
 * is one that silently fails for the other two. Nobody notices, because the
 * failure is an email that was never sent.
 *
 * So a sweep asks the opposite question: for each waiting alert, is its
 * condition true *now*? That is robust to every way a product can change,
 * including ones that do not exist yet.
 *
 * ## Why an alert fires once and is then spent
 *
 * A size that comes back in ones and twos, selling out within the hour, would
 * otherwise mail the same person every few days. One notification is a
 * service; the fourth is the reason people filter a shop's mail. Re-arming is
 * the customer's to do, by asking again.
 *
 * Pure, so the decision to mail somebody can be tested without a mail server.
 */

export type AlertKind = "back-in-stock" | "price-drop";

export interface StockAlert {
  id: string;
  uid: string;
  email: string;
  locale: Locale;
  kind: AlertKind;

  productId: string;
  /** The exact permutation asked for. Absent means the product as a whole. */
  colorId?: string;
  sizeId?: string;

  /**
   * The price when the alert was created.
   *
   * Recorded rather than read live, because "dropped" is a comparison with
   * what the customer saw. Without it a price-drop alert created today would
   * fire the moment any sale started, including one that leaves the piece
   * dearer than when they asked.
   */
  priceAtSubscribe: number;
  /** An explicit "tell me under this", if they named one. */
  targetPrice?: number;

  createdAt: number;
  notifiedAt?: number;
  /** What was true when it fired, so a support question has an answer. */
  notifiedPrice?: number;
  notifiedStock?: number;
}

/** How long an unfired alert waits before it stops being a real intention. */
export const ALERT_LIFETIME_DAYS = 90;

/** Per account. Enough for a real wishlist, few enough not to be a mail cannon. */
export const MAX_ALERTS_PER_ACCOUNT = 50;

/**
 * One row per person, per thing, per kind.
 *
 * Without it a customer who taps the button twice — which they will, because
 * the first tap's confirmation is easy to miss — gets two emails for one
 * restock.
 */
export function alertKey(
  alert: Pick<StockAlert, "uid" | "productId" | "kind" | "colorId" | "sizeId">,
): string {
  return [alert.uid, alert.productId, alert.kind, alert.colorId ?? "", alert.sizeId ?? ""].join(
    "|",
  );
}

/* -------------------------------------------------------------------------- */
/*  Is it true yet?                                                           */
/* -------------------------------------------------------------------------- */

export type AlertVerdict =
  | { fire: true; stock: number; price: number }
  | { fire: false; reason: "already-sent" | "expired" | "gone" | "not-yet" | "not-buyable" };

/** Units available for exactly what the customer asked for. */
export function unitsFor(product: Product, colorId?: string, sizeId?: string): number {
  const rows = product.variants ?? [];

  if (rows.length === 0) return Math.max(0, product.totalStock ?? 0);

  const matching = rows.filter(
    (variant) =>
      (colorId === undefined || variant.colorId === colorId) &&
      (sizeId === undefined || variant.sizeId === sizeId),
  );

  /*
   * A permutation that no longer exists is zero, not the product total.
   * Falling back to the total would tell somebody waiting on a medium that
   * their size is back because a large arrived.
   */
  return matching.reduce((sum, variant) => sum + Math.max(0, variant.stock), 0);
}

/**
 * Should this alert be sent now?
 *
 * Every refusal is a separate reason on purpose: "the product was deleted" and
 * "it is still sold out" are the same silence to the customer and completely
 * different problems to whoever is looking at the sweep's output.
 */
export function shouldFire(
  alert: StockAlert,
  product: Product | undefined,
  now = Date.now(),
): AlertVerdict {
  if (alert.notifiedAt) return { fire: false, reason: "already-sent" };

  const age = now - alert.createdAt;
  if (age > ALERT_LIFETIME_DAYS * 24 * 60 * 60 * 1000) {
    return { fire: false, reason: "expired" };
  }

  if (!product) return { fire: false, reason: "gone" };

  /*
   * Nothing is announced about a product a shopper cannot then buy. A draft,
   * an archived piece, or one the merchant has deliberately stopped selling is
   * not "back" — mailing about it sends people to a page that refuses them,
   * which is worse than the silence.
   */
  if (product.status !== "active") return { fire: false, reason: "not-buyable" };
  if (product.visibility === "hidden") return { fire: false, reason: "not-buyable" };
  if (product.saleState === "sold-out") return { fire: false, reason: "not-buyable" };

  const stock = unitsFor(product, alert.colorId, alert.sizeId);
  const price = product.price;

  if (alert.kind === "back-in-stock") {
    if (stock <= 0) return { fire: false, reason: "not-yet" };
    return { fire: true, stock, price };
  }

  // price-drop
  const ceiling = alert.targetPrice ?? alert.priceAtSubscribe;
  if (price >= ceiling) return { fire: false, reason: "not-yet" };
  /*
   * A price drop on something nobody can buy is not news. Checked for this
   * kind too, because a sold-out piece going on sale is exactly when a
   * merchant reprices, and mailing about it produces a click and a
   * disappointment.
   */
  if (stock <= 0) return { fire: false, reason: "not-yet" };
  return { fire: true, stock, price };
}

/**
 * Split a batch of alerts into what to send and what to leave.
 *
 * Returned together rather than filtered, because the ones left behind carry
 * the reason — and a sweep that reports "412 checked, 3 sent" with no account
 * of the other 409 is one nobody can debug when it goes quiet.
 */
export function planSweep(
  alerts: StockAlert[],
  products: Map<string, Product>,
  now = Date.now(),
): {
  send: { alert: StockAlert; stock: number; price: number }[];
  skipped: Record<string, number>;
  expired: StockAlert[];
} {
  const send: { alert: StockAlert; stock: number; price: number }[] = [];
  const skipped: Record<string, number> = {};
  const expired: StockAlert[] = [];

  for (const alert of alerts) {
    const verdict = shouldFire(alert, products.get(alert.productId), now);
    if (verdict.fire) {
      send.push({ alert, stock: verdict.stock, price: verdict.price });
      continue;
    }
    skipped[verdict.reason] = (skipped[verdict.reason] ?? 0) + 1;
    if (verdict.reason === "expired") expired.push(alert);
  }

  return { send, skipped, expired };
}

/* -------------------------------------------------------------------------- */
/*  What the message says                                                     */
/* -------------------------------------------------------------------------- */

export interface AlertMessage {
  subject: string;
  body: string;
}

/**
 * The email, in the language the customer was using when they asked.
 *
 * Recorded on the alert rather than looked up now: it is the only reliable
 * record of which language this person reads, and guessing from an address
 * months later gets it wrong for exactly the bilingual customers this shop has
 * most of.
 *
 * The size is named. "Your item is back" on a shop that sells five sizes is a
 * message the customer cannot act on without going to look.
 */
export function alertMessage(
  alert: StockAlert,
  product: Product,
  price: number,
  variantLabel?: string,
): AlertMessage {
  const ar = alert.locale === "ar";
  const name = ar ? (product.title.ar || product.title.en) : (product.title.en || product.title.ar);
  const what = variantLabel ? `${name} — ${variantLabel}` : name;

  if (alert.kind === "back-in-stock") {
    return {
      subject: ar ? `${what} متوفر الآن` : `${what} is back`,
      body: ar
        ? `القطعة التي انتظرتها عادت. الكمية محدودة، ولن نرسل تذكيراً آخر.`
        : `The piece you asked about is available again. Quantities are limited, and we will not send another reminder.`,
    };
  }

  const saved = round2(alert.priceAtSubscribe - price);
  return {
    subject: ar ? `انخفض سعر ${what}` : `${what} has dropped in price`,
    body: ar
      ? `كان ${alert.priceAtSubscribe} وصار ${price} — أقل بـ ${saved}.`
      : `It was ${alert.priceAtSubscribe} and is now ${price} — ${saved} less.`,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
