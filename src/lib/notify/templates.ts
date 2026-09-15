import { formatPrice, t } from "@/lib/format";
import { absoluteUrl } from "@/lib/site";
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
  /** Plain text. Deliberately not HTML — see `renderText`. */
  body: string;
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

function orderUrl(reference: string, locale: Locale, settings: StoreSettings): string {
  void settings;
  return absoluteUrl(`${locale}/orders/${reference}`);
}

/**
 * Compose the message for one event.
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
  const rtl = locale === "ar";
  const name = order.shippingAddress.fullName.split(" ")[0] ?? "";
  const ref = order.reference;
  const link = orderUrl(ref, locale, settings);
  const total = formatPrice(order.totals.total, order.totals.currency, locale);
  const shop = settings.legal.tradingName;

  const sign = rtl
    ? `\n\n${shop}\n${settings.contact.email} · ${settings.contact.phone}`
    : `\n\n${shop}\n${settings.contact.email} · ${settings.contact.phone}`;

  switch (event) {
    case "order-received":
      return {
        subject: rtl ? `استلمنا طلبك ${ref}` : `We have your order ${ref}`,
        body:
          (rtl
            ? `مرحباً ${name}،\n\nاستلمنا طلبك رقم ${ref} بقيمة ${total}. سنراجعه ونبدأ بتجهيزه، وسنعلمك عند شحنه.\n\nتتبّع طلبك: ${link}`
            : `Hello ${name},\n\nWe have your order ${ref} for ${total}. We will check it over, start preparing it, and tell you when it ships.\n\nTrack it here: ${link}`) +
          sign,
      };

    case "order-paid":
      return {
        subject: rtl ? `تأكيد الدفع — ${ref}` : `Payment confirmed — ${ref}`,
        body:
          (rtl
            ? `مرحباً ${name}،\n\nتم تأكيد دفع طلبك ${ref} بقيمة ${total}، وفاتورتك جاهزة في حسابك. نبدأ التجهيز الآن.\n\nتفاصيل الطلب: ${link}`
            : `Hello ${name},\n\nPayment for order ${ref} is confirmed at ${total}, and your invoice is on your account. We are preparing it now.\n\nOrder details: ${link}`) +
          sign,
      };

    case "order-shipped": {
      // The tracking number only appears when there is one. A line reading
      // "Tracking: undefined" is worse than no line at all.
      const tracking = order.trackingNumber
        ? rtl
          ? `\n\nرقم التتبّع: ${order.trackingNumber}`
          : `\n\nTracking number: ${order.trackingNumber}`
        : "";

      const window = rtl
        ? `خلال ${settings.standardDeliveryDays[0]}–${settings.standardDeliveryDays[1]} أيام عمل`
        : `in ${settings.standardDeliveryDays[0]}–${settings.standardDeliveryDays[1]} business days`;

      return {
        subject: rtl ? `طلبك ${ref} في الطريق` : `Order ${ref} is on its way`,
        body:
          (rtl
            ? `مرحباً ${name}،\n\nغادر طلبك ${ref} مستودعنا ومن المتوقع وصوله ${window}.${tracking}\n\nتتبّع طلبك: ${link}`
            : `Hello ${name},\n\nOrder ${ref} has left our warehouse and should reach you ${window}.${tracking}\n\nTrack it here: ${link}`) +
          sign,
      };
    }

    case "order-delivered":
      return {
        subject: rtl ? `تم تسليم طلبك ${ref}` : `Order ${ref} delivered`,
        body:
          (rtl
            ? `مرحباً ${name}،\n\nسُلّم طلبك ${ref}. إن لم يكن شيء منه مناسباً، لديك ${settings.returnWindowDays} يوماً للإرجاع — راسلنا ونرتّب الاستلام.\n\nتفاصيل الطلب: ${link}`
            : `Hello ${name},\n\nOrder ${ref} has been delivered. If anything is not right, you have ${settings.returnWindowDays} days to return it — reply to this message and we will arrange collection.\n\nOrder details: ${link}`) +
          sign,
      };

    case "order-refunded":
      return {
        subject: rtl ? `تم استرداد مبلغ طلبك ${ref}` : `Refund issued for ${ref}`,
        body:
          (rtl
            ? `مرحباً ${name}،\n\nاسترددنا مبلغ ${total} عن طلبك ${ref}، وأصدرنا إشعاراً دائناً. قد يستغرق ظهور المبلغ في حسابك عدة أيام عمل حسب مصرفك.\n\nتفاصيل الطلب: ${link}`
            : `Hello ${name},\n\nWe have refunded ${total} for order ${ref} and issued a credit note. Depending on your bank it can take a few working days to appear.\n\nOrder details: ${link}`) +
          sign,
      };

    default:
      return null;
  }
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
