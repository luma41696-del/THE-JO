import { TAX_RATE, money } from "@/lib/pricing";
import { t } from "@/lib/format";
import type { CartItem, Invoice, Locale, Localized, Order } from "@/types";

/**
 * Invoices, built from orders.
 *
 * Pure: everything here is a function of an order plus a number. Allocating
 * that number is the part that needs a transaction, and it lives in
 * `issueInvoice` on the server — kept apart so the shape of a document can be
 * tested without a database.
 *
 * The rule that drives the design is **gapless sequential numbering**. Most
 * tax authorities require it, including Jordan's: INV-2026-00001, -00002, with
 * nothing missing in between. That is why a number is never assigned
 * optimistically and never derived from a timestamp or a count of documents —
 * two orders paid in the same second would collide, and a failed write after
 * an incremented counter would leave a hole nobody can explain at audit.
 */

/** Jordan's general sales tax, as applied at checkout. */
export { TAX_RATE };

/**
 * `INV-{year}-{00001}`.
 *
 * Per year, because a sequence that runs for ever makes the fifth year's
 * invoices unreadable, and because the year is what a tax return is filed
 * against. Five digits: a shop doing a hundred orders a day takes three years
 * to need a sixth, and the format can widen without renumbering history.
 */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(5, "0")}`;
}

/**
 * An invoice line's description, in both languages.
 *
 * The options are part of the description, not a footnote. An invoice reading
 * "Boxy Cotton Tee" four times over — four embroideries, at four different
 * prices — is not a document anyone can reconcile, least of all a customer
 * querying a charge on their card.
 */
export function describeLine(item: CartItem): Localized {
  const compose = (locale: Locale) =>
    [
      t(item.title, locale),
      item.designName ? t(item.designName, locale) : "",
      t(item.colorName, locale),
      item.sizeLabel,
    ]
      .filter(Boolean)
      .join(" · ");

  return { en: compose("en"), ar: compose("ar") };
}

export function invoiceLines(items: CartItem[]): Invoice["lines"] {
  return items.map((item) => ({
    description: describeLine(item),
    sku: item.sku,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    total: money(item.unitPrice * item.quantity, item.currency),
  }));
}

/**
 * Build the invoice for an order.
 *
 * The totals are **copied from the order, not recomputed**. An invoice is a
 * record of what was charged; recalculating it here would mean a tax-rate
 * change silently rewriting the history of orders already paid, and a customer
 * holding a receipt that no longer matches their bank statement.
 */
export function invoiceFrom(
  order: Order,
  number: string,
  issuedAt: number,
): Omit<Invoice, "id"> {
  const address = order.shippingAddress;

  return {
    number,
    orderId: order.id,
    orderReference: order.reference,
    status: "paid",
    issuedAt,
    paidAt: issuedAt,
    billTo: {
      name: address.fullName,
      email: order.email,
      ...(address.phone ? { phone: address.phone } : {}),
      line1: address.line1,
      ...(address.line2 ? { line2: address.line2 } : {}),
      city: address.city,
      countryCode: address.countryCode,
    },
    lines: invoiceLines(order.items),
    subtotal: order.totals.subtotal,
    discount: order.totals.discount,
    shipping: order.totals.shipping,
    taxRate: TAX_RATE,
    tax: order.totals.tax,
    total: order.totals.total,
    currency: order.totals.currency,
    paymentMethod: order.paymentMethod,
  };
}

/**
 * The credit note for a refunded order.
 *
 * A new document with its own number, not an edit of the original. An issued
 * invoice is a legal record: cancelling one by overwriting it destroys the
 * trail, and the sequence would then have a number that describes nothing.
 * The original is marked `credited` and both stay.
 *
 * Amounts stay positive and the status carries the sign, so a ledger that sums
 * `total` without reading `status` cannot quietly halve the year's revenue.
 */
export function creditNoteFrom(
  invoice: Invoice,
  number: string,
  issuedAt: number,
): Omit<Invoice, "id"> {
  return {
    ...invoice,
    number,
    status: "credited",
    issuedAt,
    paidAt: issuedAt,
    notes: {
      en: `Credit note for invoice ${invoice.number}.`,
      ar: `إشعار دائن للفاتورة ${invoice.number}.`,
    },
  };
}

/**
 * Which orders should carry an invoice.
 *
 * A pending order has not been paid, and a cancelled one never will be —
 * issuing for either would put a number in the sequence that has to be voided
 * immediately, which is exactly the hole gapless numbering exists to prevent.
 */
export function shouldInvoice(status: Order["status"]): boolean {
  return status !== "pending" && status !== "cancelled";
}
