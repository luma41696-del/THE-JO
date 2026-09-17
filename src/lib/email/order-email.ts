import { formatPrice, t } from "@/lib/format";
import { absoluteUrl } from "@/lib/site";
import {
  DISPLAY,
  PALETTE,
  SANS,
  button,
  emailDocument,
  escapeHtml,
  paragraph,
  rule,
  textDocument,
  thumbnail,
  totalRow,
} from "@/lib/email/shell";
import type { CartItem, Locale, NotificationEvent, Order } from "@/types";
import type { StoreSettings } from "@/data/site-content";

/**
 * The order email, with the bag in it.
 *
 * What the shop used to send was a paragraph: "We have your order NS-7K4M2X
 * for 129.000 JOD." Correct, and it tells a customer nothing they can check.
 * The thing they want to look at is what they bought — the photograph, the
 * colour, the size, and which of the three trousers they were deciding
 * between actually went through.
 *
 * So the lines are here, as a table, with the images.
 *
 * ## The part that is easy to get wrong
 *
 * **Images are blocked by default** in most clients, and a layout that only
 * works once somebody clicks "show images" is a layout that is broken for the
 * majority of the people who open it. Every thumbnail sits in a cell with its
 * own width, height and background, so a message read with images off is a
 * neat column of swatches beside the titles rather than a collapsed heap.
 *
 * ## No unsubscribe link, deliberately
 *
 * This is transactional. Somebody who bought something is owed the dispatch
 * notice whatever they think of the newsletter, and an unsubscribe link on it
 * invites a customer to turn off the one message they actually need. The
 * campaign email — the one that *does* carry an unsubscribe link, because it
 * must — is a separate builder for exactly this reason.
 *
 * Pure: an order and settings in, strings out. That is what makes the wording
 * reviewable without a mail provider.
 */

export interface OrderEmail {
  subject: string;
  html: string;
  text: string;
}

/** What the heading says, per event. Never ahead of what the shop has done. */
interface Copy {
  subject: string;
  heading: string;
  lead: string;
  cta: string;
  preheader: string;
}

function copyFor(
  event: NotificationEvent,
  order: Order,
  settings: StoreSettings,
  locale: Locale,
): Copy | null {
  const rtl = locale === "ar";
  const ref = order.reference;
  const total = formatPrice(order.totals.total, order.totals.currency, locale);
  const [from, to] = settings.standardDeliveryDays;

  switch (event) {
    case "order-received":
      return rtl
        ? {
            subject: `استلمنا طلبك ${ref}`,
            heading: "استلمنا طلبك",
            lead: "سنراجعه ونبدأ بتجهيزه، وسنعلمك فور شحنه.",
            cta: "تتبّع طلبك",
            preheader: `طلب ${ref} — ${total}`,
          }
        : {
            subject: `We have your order ${ref}`,
            heading: "We have your order",
            lead: "We will check it over, start preparing it, and tell you the moment it ships.",
            cta: "Track your order",
            preheader: `Order ${ref} — ${total}`,
          };

    case "order-paid":
      return rtl
        ? {
            subject: `تأكيد الدفع — ${ref}`,
            heading: "تم تأكيد الدفع",
            lead: "فاتورتك جاهزة في حسابك، ونبدأ التجهيز الآن.",
            cta: "عرض الطلب",
            preheader: `تم تأكيد دفع ${total}`,
          }
        : {
            subject: `Payment confirmed — ${ref}`,
            heading: "Payment confirmed",
            lead: "Your invoice is on your account, and we are preparing the order now.",
            cta: "View your order",
            preheader: `Payment of ${total} confirmed`,
          };

    case "order-shipped":
      return rtl
        ? {
            subject: `طلبك ${ref} في الطريق`,
            heading: "طلبك في الطريق",
            lead: `غادر طلبك مستودعنا، ومن المتوقع وصوله خلال ${from}–${to} أيام عمل.`,
            cta: "تتبّع الشحنة",
            preheader: `${ref} غادر المستودع`,
          }
        : {
            subject: `Order ${ref} is on its way`,
            heading: "On its way",
            lead: `Your order has left our warehouse and should reach you in ${from}–${to} business days.`,
            cta: "Track the parcel",
            preheader: `${ref} has left the warehouse`,
          };

    case "order-delivered":
      return rtl
        ? {
            subject: `تم تسليم طلبك ${ref}`,
            heading: "تم التسليم",
            lead: `إن لم يكن شيء منه مناسباً، لديك ${settings.returnWindowDays} يوماً للإرجاع — ردّ على هذه الرسالة ونرتّب الاستلام.`,
            cta: "عرض الطلب",
            preheader: `${ref} وصل`,
          }
        : {
            subject: `Order ${ref} delivered`,
            heading: "Delivered",
            lead: `If anything is not right, you have ${settings.returnWindowDays} days to return it — reply to this message and we will arrange collection.`,
            cta: "View your order",
            preheader: `${ref} has arrived`,
          };

    case "order-refunded":
      return rtl
        ? {
            subject: `تم استرداد مبلغ طلبك ${ref}`,
            heading: "تم الاسترداد",
            lead: `استرددنا ${total} وأصدرنا إشعاراً دائناً. قد يستغرق ظهور المبلغ في حسابك عدة أيام عمل حسب مصرفك.`,
            cta: "عرض الطلب",
            preheader: `تم استرداد ${total}`,
          }
        : {
            subject: `Refund issued for ${ref}`,
            heading: "Refund issued",
            lead: `We have refunded ${total} and issued a credit note. Depending on your bank it can take a few working days to appear.`,
            cta: "View your order",
            preheader: `${total} refunded`,
          };

    default:
      return null;
  }
}

/**
 * The options under a line: colour, size, artwork, and anything else the
 * product carries.
 *
 * Joined into one line rather than stacked. A bag of six items becomes a very
 * tall email otherwise, and the option names are a reminder, not a spec.
 */
function optionsOf(item: CartItem, locale: Locale): string {
  const parts: string[] = [];
  if (item.colorId && item.colorName) parts.push(t(item.colorName, locale));
  if (item.sizeLabel) parts.push(item.sizeLabel);
  if (item.designName) parts.push(t(item.designName, locale));
  for (const attribute of item.attributes ?? []) parts.push(t(attribute.valueLabel, locale));
  return parts.join(" · ");
}

/** One row of the bag. */
function lineRow(item: CartItem, locale: Locale, align: "right" | "left"): string {
  const end = align === "right" ? "left" : "right";
  const title = t(item.title, locale);
  const options = optionsOf(item, locale);
  const lineTotal = formatPrice(item.unitPrice * item.quantity, item.currency, locale);

  /*
   * The quantity is only shown when it is not one. "× 1" on every line is
   * noise that makes the one line saying "× 3" harder to notice.
   */
  const quantity =
    item.quantity > 1
      ? `<span style="font-family:${DISPLAY};font-size:13px;color:${PALETTE.muted};" dir="ltr">× ${item.quantity}</span>`
      : "";

  return `<tr>
  <td width="64" style="padding:12px 0;vertical-align:top;">${thumbnail(item.image?.url, title)}</td>
  <td style="padding:12px 14px;vertical-align:top;text-align:${align};">
    <div style="font-family:${SANS};font-size:14px;font-weight:600;line-height:1.45;color:${PALETTE.ink};">${escapeHtml(title)}</div>
    ${options ? `<div style="margin-top:3px;font-family:${SANS};font-size:12px;line-height:1.5;color:${PALETTE.muted};">${escapeHtml(options)}</div>` : ""}
    ${quantity ? `<div style="margin-top:4px;">${quantity}</div>` : ""}
  </td>
  <td width="90" style="padding:12px 0;vertical-align:top;text-align:${end};font-family:${DISPLAY};font-size:14px;font-weight:600;color:${PALETTE.ink};white-space:nowrap;" dir="ltr">${escapeHtml(lineTotal)}</td>
</tr>`;
}

export interface OrderEmailInput {
  event: NotificationEvent;
  order: Order;
  settings: StoreSettings;
  locale?: Locale;
}

/**
 * Build the order email.
 *
 * Returns null for an event with nothing worth saying, so a caller cannot
 * accidentally send an empty notice.
 */
export function buildOrderEmail({
  event,
  order,
  settings,
  locale = "en",
}: OrderEmailInput): OrderEmail | null {
  const copy = copyFor(event, order, settings, locale);
  if (!copy) return null;

  const rtl = locale === "ar";
  const align: "right" | "left" = rtl ? "right" : "left";
  const end: "right" | "left" = rtl ? "left" : "right";
  const ref = order.reference;
  const link = absoluteUrl(`${locale}/orders/${ref}`);
  const currency = order.totals.currency;
  const money = (amount: number) => formatPrice(amount, currency, locale);

  const name = order.shippingAddress.fullName.trim().split(" ")[0] ?? "";
  const greeting = rtl
    ? name
      ? `مرحباً ${name}،`
      : "مرحباً،"
    : name
      ? `Hello ${name},`
      : "Hello,";

  const label = rtl
    ? {
        order: "رقم الطلب",
        items: "ما طلبته",
        subtotal: "المجموع الفرعي",
        discount: "الخصم",
        shipping: "الشحن",
        tax: "الضريبة",
        total: "الإجمالي",
        free: "مجاني",
        shipTo: "يُشحن إلى",
        tracking: "رقم التتبّع",
        method: "طريقة الشحن",
      }
    : {
        order: "Order",
        items: "What you ordered",
        subtotal: "Subtotal",
        discount: "Discount",
        shipping: "Shipping",
        tax: "Tax",
        total: "Total",
        free: "Free",
        shipTo: "Shipping to",
        tracking: "Tracking number",
        method: "Shipping method",
      };

  /*
   * The reference, big and on its own.
   *
   * It is the first thing support asks for and the only thing that identifies
   * the order, so it is not buried in a sentence. `dir=ltr` because bidi
   * reorders `NS-7K4M2X` into nonsense inside an Arabic paragraph.
   */
  const referenceBlock = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
  <tr>
    <td style="text-align:${align};">
      <div style="font-family:${SANS};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.muted};">${escapeHtml(label.order)}</div>
      <div dir="ltr" style="margin-top:2px;font-family:${DISPLAY};font-size:19px;font-weight:700;letter-spacing:0.03em;color:${PALETTE.ink};text-align:${align};">${escapeHtml(ref)}</div>
    </td>
  </tr>
</table>`;

  const lines = order.items.map((item) => lineRow(item, locale, align)).join("\n");

  const totals = [
    totalRow(label.subtotal, money(order.totals.subtotal), { align }),
    order.totals.discount > 0
      ? totalRow(label.discount, `− ${money(order.totals.discount)}`, {
          align,
          color: PALETTE.red,
        })
      : "",
    totalRow(
      label.shipping,
      order.totals.shipping > 0 ? money(order.totals.shipping) : label.free,
      { align },
    ),
    order.totals.tax > 0 ? totalRow(label.tax, money(order.totals.tax), { align }) : "",
    totalRow(label.total, money(order.totals.total), { align, strong: true }),
  ]
    .filter(Boolean)
    .join("\n");

  const address = order.shippingAddress;
  const addressLines = [
    address.fullName,
    address.line1,
    address.line2,
    [address.city, address.region].filter(Boolean).join(", "),
    address.phone,
  ].filter((line): line is string => Boolean(line && line.trim()));

  /*
   * Tracking appears only when there is one. A line reading "Tracking:
   * undefined" is worse than no line at all.
   */
  const tracking = order.trackingNumber
    ? `<tr>
  <td style="padding:4px 0;font-family:${SANS};font-size:12px;color:${PALETTE.muted};text-align:${align};">${escapeHtml(label.tracking)}</td>
  <td dir="ltr" style="padding:4px 0;font-family:${DISPLAY};font-size:13px;font-weight:600;color:${PALETTE.ink};text-align:${end};">${escapeHtml(order.trackingNumber)}</td>
</tr>`
    : "";

  const body = `
${paragraph(greeting, { align, margin: "0 0 6px" })}
<h1 style="margin:0 0 10px;font-family:${SANS};font-size:23px;line-height:1.35;font-weight:700;color:${PALETTE.ink};text-align:${align};">${escapeHtml(copy.heading)}</h1>
${paragraph(copy.lead, { align, margin: "0 0 24px" })}

${referenceBlock}
${rule("0 0 6px")}

<div style="margin:16px 0 8px;font-family:${SANS};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.muted};text-align:${align};">${escapeHtml(label.items)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${lines}
</table>

${rule("14px 0 10px")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${totals}
</table>

${rule("20px 0 16px")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="padding:0 0 10px;font-family:${SANS};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.muted};text-align:${align};">${escapeHtml(label.shipTo)}</td>
  </tr>
  <tr>
    <td style="font-family:${SANS};font-size:13px;line-height:1.7;color:${PALETTE.ink};text-align:${align};">${addressLines.map((line) => `<div dir="auto">${escapeHtml(line)}</div>`).join("")}</td>
  </tr>
</table>

${
  tracking
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">${tracking}</table>`
    : ""
}

<div style="margin-top:26px;">${button(copy.cta, link)}</div>
`;

  const footer = `<p style="margin:0 0 4px;font-family:${DISPLAY};font-size:13px;font-weight:600;color:${PALETTE.ink};">${escapeHtml(settings.legal.tradingName)}</p>
<p style="margin:0;font-family:${DISPLAY};font-size:12px;line-height:1.7;color:${PALETTE.muted};">
  <span dir="ltr">${escapeHtml(settings.contact.email)}</span> · <span dir="ltr">${escapeHtml(settings.contact.phone)}</span>
</p>`;

  const html = emailDocument({
    locale,
    subject: copy.subject,
    preheader: copy.preheader,
    body,
    footer,
  });

  const text = textDocument([
    "Net Sale",
    "",
    copy.heading,
    "",
    greeting,
    copy.lead,
    "",
    `${label.order}: ${ref}`,
    "",
    label.items,
    ...order.items.map((item) => {
      const options = optionsOf(item, locale);
      const qty = item.quantity > 1 ? ` × ${item.quantity}` : "";
      return `- ${t(item.title, locale)}${options ? ` (${options})` : ""}${qty} — ${money(item.unitPrice * item.quantity)}`;
    }),
    "",
    `${label.subtotal}: ${money(order.totals.subtotal)}`,
    order.totals.discount > 0 ? `${label.discount}: − ${money(order.totals.discount)}` : undefined,
    `${label.shipping}: ${order.totals.shipping > 0 ? money(order.totals.shipping) : label.free}`,
    order.totals.tax > 0 ? `${label.tax}: ${money(order.totals.tax)}` : undefined,
    `${label.total}: ${money(order.totals.total)}`,
    "",
    `${label.shipTo}: ${addressLines.join(", ")}`,
    order.trackingNumber ? `${label.tracking}: ${order.trackingNumber}` : undefined,
    "",
    `${copy.cta}: ${link}`,
    "",
    `${settings.legal.tradingName} — ${settings.contact.email} · ${settings.contact.phone}`,
  ]);

  return { subject: copy.subject, html, text };
}
