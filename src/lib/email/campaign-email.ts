import { formatPrice } from "@/lib/format";
import {
  DISPLAY,
  PALETTE,
  SANS,
  button,
  emailDocument,
  escapeHtml,
  paragraph,
  safeImage,
  safeLink,
  textDocument,
} from "@/lib/email/shell";
import type { CurrencyCode, Locale } from "@/types";

/**
 * A campaign — the announcement the shop writes and sends.
 *
 * Same chrome as the order email, deliberately: a customer should recognise
 * the second message as coming from the shop that sent the first. What differs
 * is everything below the heading, and one thing below that.
 *
 * ## The unsubscribe link is structural, not a footer detail
 *
 * `buildCampaignEmail` returns **undefined** without a working unsubscribe
 * link. Not a warning, not a campaign missing a footer — nothing to send. A
 * marketing email with no way out is illegal in most of the places this shop
 * will send to, and the practical cost arrives sooner than the legal one: the
 * recipient's only remaining option is the spam button, and enough of those
 * take the sending domain down with them, including the order confirmations.
 *
 * This is why the order email is a different builder. It is transactional, it
 * carries no unsubscribe link, and keeping the two apart means neither rule
 * can leak into the other.
 *
 * ## Everything the operator typed is escaped
 *
 * The composer is a text box in an admin screen, and what comes out of it goes
 * into HTML that other people's software renders. Staff are not attackers, but
 * a pasted product description with an `&` in it should not break the layout
 * either.
 */

export interface CampaignProduct {
  title: string;
  /** Absolute https, or the tile shows a swatch. */
  imageUrl?: string;
  price?: number;
  currency?: CurrencyCode;
  /** Absolute https. A tile with no link is still rendered, just not clickable. */
  url?: string;
}

export interface CampaignDraft {
  subject: string;
  /** The grey line beside the subject. Falls back to the opening body text. */
  preheader?: string;
  heading: string;
  /** Paragraphs. Blank lines in the composer split them. */
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /** A wide image above the heading. */
  heroUrl?: string;
  /** Up to four picks, shown as a two-column grid. */
  products?: CampaignProduct[];
  locale: Locale;
}

export interface CampaignEmail {
  subject: string;
  html: string;
  text: string;
}

export interface CampaignRecipient {
  email: string;
  /** Empty is fine and common — a newsletter address has no name. */
  name?: string;
  /** The signed link. Built by the caller; absence refuses the whole email. */
  unsubscribeUrl?: string;
}

/** Four is the limit: a two-by-two grid is a glance, six is a catalogue. */
export const MAX_PRODUCTS = 4;

/**
 * Split the composer's text into paragraphs.
 *
 * A blank line starts a new one, which is how people already write in a text
 * box. Single newlines are left alone rather than turned into `<br>` — a
 * pasted paragraph that wrapped in the textarea should not arrive with ragged
 * line breaks baked in.
 */
export function paragraphsOf(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** A two-column grid of picks. Tables, because this has to survive Outlook. */
function productGrid(products: CampaignProduct[], locale: Locale, align: "right" | "left"): string {
  const picks = products.slice(0, MAX_PRODUCTS);
  if (picks.length === 0) return "";

  /*
   * Every tile is the same height, whatever shape the photograph is.
   *
   * Left to `height:auto`, a portrait shot and a square one push their titles
   * to different baselines and the row stops reading as a row. A fixed height
   * with `object-fit:cover` crops instead — and the same height on the
   * placeholder means a product with no image, or one whose image is blocked,
   * still lines up with the tile beside it.
   */
  const TILE_HEIGHT = 210;

  const tile = (product: CampaignProduct) => {
    const src = product.imageUrl ? safeImage(product.imageUrl) : undefined;
    const href = product.url ? safeLink(product.url) : undefined;
    const box = `width:100%;height:${TILE_HEIGHT}px;border-radius:10px;background:${PALETTE.swatch};`;

    const image = src
      ? `<img src="${escapeHtml(src)}" width="240" height="${TILE_HEIGHT}" alt="${escapeHtml(product.title)}" style="${box}display:block;object-fit:cover;border:0;outline:none;text-decoration:none;">`
      : `<div style="${box}"></div>`;

    const price =
      typeof product.price === "number"
        ? `<div dir="ltr" style="margin-top:2px;font-family:${DISPLAY};font-size:13px;font-weight:700;color:${PALETTE.red};text-align:${align};">${escapeHtml(formatPrice(product.price, product.currency ?? "JOD", locale))}</div>`
        : "";

    /*
     * The title gets a fixed two-line box for the same reason: a name that
     * wraps must not drop its own price below the one next to it.
     */
    const inner = `${image}
<div style="margin-top:8px;height:38px;overflow:hidden;font-family:${SANS};font-size:13px;font-weight:600;line-height:1.45;color:${PALETTE.ink};text-align:${align};">${escapeHtml(product.title)}</div>
${price}`;

    return `<td width="50%" style="padding:0 6px 16px;vertical-align:top;">${
      href
        ? `<a href="${escapeHtml(href)}" style="text-decoration:none;color:inherit;display:block;">${inner}</a>`
        : inner
    }</td>`;
  };

  const rows: string[] = [];
  for (let i = 0; i < picks.length; i += 2) {
    const pair = picks.slice(i, i + 2);
    // An odd last tile gets an empty cell, so it stays half-width rather than
    // stretching across the message.
    const filler = pair.length === 1 ? `<td width="50%"></td>` : "";
    rows.push(`<tr>${pair.map(tile).join("")}${filler}</tr>`);
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px -6px 4px;">
${rows.join("\n")}
</table>`;
}

/**
 * Build one recipient's copy of a campaign.
 *
 * Per recipient rather than once, because the unsubscribe link is per address
 * — that is the whole reason this takes a recipient at all.
 *
 * Returns undefined when there is no unsubscribe link. See the note at the top
 * of this file: that is the one refusal that is not negotiable.
 */
export function buildCampaignEmail(
  draft: CampaignDraft,
  recipient: CampaignRecipient,
): CampaignEmail | undefined {
  const unsubscribe = recipient.unsubscribeUrl ? safeLink(recipient.unsubscribeUrl) : undefined;
  if (!unsubscribe) return undefined;

  const subject = draft.subject.trim();
  const heading = draft.heading.trim();
  if (!subject || !heading) return undefined;

  const locale = draft.locale;
  const rtl = locale === "ar";
  const align: "right" | "left" = rtl ? "right" : "left";

  const blocks = paragraphsOf(draft.body);

  const name = (recipient.name ?? "").trim();
  const greeting = rtl
    ? name
      ? `مرحباً ${name}،`
      : "مرحباً،"
    : name
      ? `Hello ${name},`
      : "Hello,";

  const hero = draft.heroUrl ? safeImage(draft.heroUrl) : undefined;
  const heroBlock = hero
    ? `<img src="${escapeHtml(hero)}" width="504" alt="" style="width:100%;height:auto;display:block;border-radius:10px;margin:0 0 22px;background:${PALETTE.swatch};border:0;">`
    : "";

  const cta =
    draft.ctaLabel?.trim() && draft.ctaUrl?.trim()
      ? `<div style="margin-top:22px;">${button(draft.ctaLabel.trim(), draft.ctaUrl.trim())}</div>`
      : "";

  const grid = productGrid(draft.products ?? [], locale, align);

  const body = `
${heroBlock}
<h1 style="margin:0 0 14px;font-family:${SANS};font-size:25px;line-height:1.3;font-weight:700;color:${PALETTE.ink};text-align:${align};">${escapeHtml(heading)}</h1>
${paragraph(greeting, { align, margin: "0 0 12px", color: PALETTE.muted, size: 14 })}
${blocks.map((block) => paragraph(block, { align })).join("\n")}
${grid}
${cta}
`;

  /*
   * The unsubscribe line sits outside the card with the shop's details, where
   * a reader's eye already goes looking for it — not hidden at six points in
   * the same colour as the background.
   */
  const footerCopy = rtl
    ? {
        why: "تصلك هذه الرسالة لأنك مشترك في أخبار نت سيل.",
        stop: "إلغاء الاشتراك",
      }
    : {
        why: "You are receiving this because you subscribed to Net Sale news.",
        stop: "Unsubscribe",
      };

  const footer = `<p style="margin:0 0 6px;font-family:${DISPLAY};font-size:13px;font-weight:600;color:${PALETTE.ink};">Net Sale</p>
<p style="margin:0 0 10px;font-family:${SANS};font-size:12px;line-height:1.7;color:${PALETTE.muted};">${escapeHtml(footerCopy.why)}</p>
<p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.7;color:${PALETTE.muted};">
  <a href="${escapeHtml(unsubscribe)}" style="color:${PALETTE.muted};text-decoration:underline;">${escapeHtml(footerCopy.stop)}</a>
  &nbsp;·&nbsp;
  <a href="https://netsale.shop" style="color:${PALETTE.muted};text-decoration:none;">netsale.shop</a>
</p>`;

  const html = emailDocument({
    locale,
    subject,
    preheader: draft.preheader?.trim() || blocks[0] || heading,
    body,
    footer,
  });

  const text = textDocument([
    "Net Sale",
    "",
    heading,
    "",
    greeting,
    ...blocks,
    "",
    ...(draft.products ?? [])
      .slice(0, MAX_PRODUCTS)
      .map((product) =>
        typeof product.price === "number"
          ? `- ${product.title} — ${formatPrice(product.price, product.currency ?? "JOD", locale)}`
          : `- ${product.title}`,
      ),
    "",
    draft.ctaLabel?.trim() && draft.ctaUrl?.trim()
      ? `${draft.ctaLabel.trim()}: ${draft.ctaUrl.trim()}`
      : undefined,
    "",
    footerCopy.why,
    `${footerCopy.stop}: ${unsubscribe}`,
  ]);

  return { subject, html, text };
}
