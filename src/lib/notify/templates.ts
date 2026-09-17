import { t } from "@/lib/format";
import { buildOrderEmail } from "@/lib/email/order-email";
import type { Locale, Notification, NotificationEvent, Order } from "@/types";
import type { StoreSettings } from "@/data/site-content";

/**
 * What the shop actually says to a customer about their order.
 *
 * Pure: an order plus settings in, a subject and a body out. That is what
 * makes the wording reviewable and testable without a mail provider, and it
 * keeps the one genuinely risky part — the network call — down to a single
 * function elsewhere.
 *
 * Three rules the copy follows:
 *
 *  1. **Never promise what the shop has not done.** "Your order is on its way"
 *     goes out on dispatch, not on payment. A notice that runs ahead of the
 *     parcel is how a customer starts waiting at the door a day early.
 *  2. **Every message carries the reference.** It is the first thing support
 *     asks for and the only thing that identifies the order.
 *  3. **Plain text, in the customer's own language.** The locale is the one
 *     they ordered in, stored on the order, not guessed from the address.
 */

export interface Message {
  subject: string;
  /** Plain text. The alternative part, never the only part — see `html`. */
  body: string;
  /**
   * The designed version.
   *
   * Both come from `buildOrderEmail`, so the text a spam filter reads and the
   * HTML a customer sees are written once and cannot drift into saying
   * different things about the same order.
   */
  html?: string;
}

/** Which statuses are worth a message, and which would be noise. */
export const EVENT_FOR_STATUS: Partial<Record<Order["status"], NotificationEvent>> = {
  /*
   * `processing` and `packed` are missing on purpose. They are warehouse
   * states, and a customer who gets four emails between paying and dispatch
   * learns to ignore all of them — including the one that mattered.
   */
  paid: "order-paid",
  shipped: "order-shipped",
  delivered: "order-delivered",
  refunded: "order-refunded",
};

/**
 * Compose the message for one event.
 *
 * Thin on purpose: the wording, the bag and the totals all live in
 * `buildOrderEmail`, which is where they can be looked at as a whole. This
 * stays because it is the shape the queue and the admin's delivery log have
 * always depended on.
 *
 * Returns null for an event with nothing worth saying, so a caller cannot
 * accidentally send an empty notice.
 */
export function messageFor(
  event: NotificationEvent,
  order: Order,
  settings: StoreSettings,
  locale: Locale = "en",
): Message | null {
  const email = buildOrderEmail({ event, order, settings, locale });
  if (!email) return null;
  return { subject: email.subject, body: email.text, html: email.html };
}

/** The human label for a notification, for the admin's delivery log. */
export const EVENT_LABEL: Record<NotificationEvent, Record<Locale, string>> = {
  "order-received": { en: "Order received", ar: "استلام الطلب" },
  "order-paid": { en: "Payment confirmed", ar: "تأكيد الدفع" },
  "order-shipped": { en: "Dispatched", ar: "الشحن" },
  "order-delivered": { en: "Delivered", ar: "التسليم" },
  "order-refunded": { en: "Refunded", ar: "الاسترداد" },
};

/** A one-line summary of a notification's outcome, for the admin. */
export function describeState(notification: Notification, locale: Locale = "en"): string {
  const label = t(EVENT_LABEL[notification.event], locale);
  switch (notification.state) {
    case "sent":
      return `${label} — sent`;
    case "failed":
      return `${label} — failed: ${notification.error ?? "unknown error"}`;
    case "skipped":
      return `${label} — not sent: no mail provider configured`;
    default:
      return `${label} — queued`;
  }
}
