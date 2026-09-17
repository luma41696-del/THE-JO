import type { Locale } from "@/types";

/**
 * The parts every Net Sale email is built from.
 *
 * Three emails now leave this shop — confirm your account, your order, and a
 * campaign — and they have to look like the same shop wrote them. Before this
 * file the account email carried its own palette and its own table scaffold;
 * a second copy would have drifted within a month, because nobody opens two
 * email templates side by side to check a hex value.
 *
 * ## Why this is hand-written HTML and not a component library
 *
 * Email clients are a browser from 2003. Outlook renders through Word, Gmail
 * strips `<style>` blocks from any message it decides to clip, and every
 * layout that survives both is a table. React email renderers exist and they
 * all end up emitting exactly this; going straight to it keeps the thing a
 * person reads next to the thing a client receives.
 *
 * ## The rules that are not style choices
 *
 *  - **Inline styles only.** A stylesheet in `<head>` is the first casualty of
 *    Gmail's clipping.
 *  - **Tables for layout.** `flex` and `grid` do not exist in Outlook.
 *  - **No web fonts.** They do not load in most clients; a stack that falls
 *    back cleanly is the whole typography budget.
 *  - **Every interpolated value is escaped.** A customer's own name is
 *    attacker-controlled — somebody can register as `<img src=x onerror=…>` —
 *    and it lands in HTML that other software renders.
 *  - **The layout must survive images being blocked**, because by default
 *    they are. Every image sits in a cell with its own size and background,
 *    so a blocked one leaves a tidy swatch rather than collapsing the row.
 */

/* -------------------------------------------------------------------------- */
/*  Escaping and links                                                        */
/* -------------------------------------------------------------------------- */

/**
 * HTML-escape a value bound for element text or an attribute.
 *
 * Covers the five characters that matter, quotes included, so the same
 * function is safe in both positions — a template that escapes for text and
 * then interpolates into `href="…"` is the usual way this goes wrong.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * An https URL, or nothing.
 *
 * Anything else in a link position means the value came from somewhere it
 * should not have. Refusing beats rendering a button that takes a customer
 * somewhere the shop did not choose — `javascript:` in an href is the obvious
 * one, but a `http:` link in a message about an account is its own problem.
 */
export function safeLink(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An image URL safe to put in `src`.
 *
 * Same rule as a link, plus one: a `data:` URI is refused. Clients treat
 * inline image data as an attachment, several refuse it outright, and a
 * campaign carrying a megabyte of base64 gets clipped by Gmail — which hides
 * the unsubscribe footer along with everything else below the cut.
 */
export function safeImage(url: string): string | undefined {
  return safeLink(url);
}

/* -------------------------------------------------------------------------- */
/*  The brand, in the values an email can carry                               */
/* -------------------------------------------------------------------------- */

export const PALETTE = {
  cream: "#f5f1e6",
  card: "#fffdf8",
  ink: "#14110f",
  muted: "#6f6862",
  red: "#d21f26",
  line: "#e6e0d2",
  /** Behind an image that has not loaded, so a blocked one is a tidy swatch. */
  swatch: "#efe9dc",
} as const;

/** Body copy. Tahoma is in the stack because it carries Arabic on Windows. */
export const SANS = "'Segoe UI',Tahoma,Helvetica,Arial,sans-serif";
/** The wordmark and numbers. */
export const DISPLAY = "'Helvetica Neue',Helvetica,Arial,sans-serif";

/* -------------------------------------------------------------------------- */
/*  Pieces                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A call-to-action button.
 *
 * A table rather than a styled `<a>`: a padded link collapses in Outlook, and
 * this shape is the one that survives everywhere. `bgcolor` on the cell is for
 * the clients that drop the inline `background`.
 */
export function button(label: string, href: string, align: "center" | "left" = "center"): string {
  const safe = safeLink(href);
  if (!safe) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 ${align === "center" ? "auto" : "0"} 26px;">
  <tr>
    <td align="center" bgcolor="${PALETTE.red}" style="border-radius:999px;">
      <a href="${escapeHtml(safe)}" style="display:inline-block;padding:15px 34px;border-radius:999px;background:${PALETTE.red};color:#ffffff;text-decoration:none;font-family:${SANS};font-size:16px;font-weight:700;line-height:1;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

/**
 * A product thumbnail that looks deliberate whether or not it loads.
 *
 * The cell keeps its width, height and background no matter what happens to
 * the `<img>`, so a message read with images off is a neat column of swatches
 * next to the titles — not a collapsed row of alt text.
 */
export function thumbnail(url: string | undefined, alt: string, size = 64): string {
  const src = url ? safeImage(url) : undefined;
  const cell = `width:${size}px;height:${size}px;background:${PALETTE.swatch};border-radius:8px;`;
  if (!src) return `<div style="${cell}"></div>`;
  return `<img src="${escapeHtml(src)}" width="${size}" height="${size}" alt="${escapeHtml(alt)}" style="${cell}display:block;object-fit:cover;border:0;outline:none;text-decoration:none;">`;
}

/** A hairline. `border` on an `<hr>` is the only form Outlook honours. */
export function rule(margin = "0 0 18px"): string {
  return `<hr style="border:none;border-top:1px solid ${PALETTE.line};margin:${margin};">`;
}

/**
 * A paragraph of body copy.
 *
 * `text` is escaped here, so callers pass raw strings — the alternative is
 * every call site remembering, and one forgetting.
 */
export function paragraph(
  text: string,
  { align, size = 15, color = PALETTE.ink, margin = "0 0 16px" }: ParagraphOptions,
): string {
  return `<p style="margin:${margin};font-family:${SANS};font-size:${size}px;line-height:1.75;color:${color};text-align:${align};">${escapeHtml(text)}</p>`;
}

interface ParagraphOptions {
  align: "right" | "left";
  size?: number;
  color?: string;
  margin?: string;
}

/**
 * A label/value row, for totals and order facts.
 *
 * `strong` is the last row — the number somebody is actually looking for.
 */
export function totalRow(
  label: string,
  value: string,
  { align, strong = false, color }: { align: "right" | "left"; strong?: boolean; color?: string },
): string {
  const end = align === "right" ? "left" : "right";
  const weight = strong ? "700" : "400";
  const size = strong ? 16 : 14;
  const tone = color ?? (strong ? PALETTE.ink : PALETTE.muted);
  return `<tr>
  <td style="padding:5px 0;font-family:${SANS};font-size:${size}px;font-weight:${weight};color:${tone};text-align:${align};">${escapeHtml(label)}</td>
  <td style="padding:5px 0;font-family:${DISPLAY};font-size:${size}px;font-weight:${weight};color:${tone};text-align:${end};white-space:nowrap;" dir="ltr">${escapeHtml(value)}</td>
</tr>`;
}

/* -------------------------------------------------------------------------- */
/*  The document                                                              */
/* -------------------------------------------------------------------------- */

export interface DocumentInput {
  locale: Locale;
  /** The `<title>`, and the fallback preheader. */
  subject: string;
  /**
   * The grey line a client shows beside the subject.
   *
   * Worth setting deliberately: left alone, clients take the first text in the
   * message, which for a card with a heading is the heading — so the inbox
   * shows the subject twice and says nothing new.
   */
  preheader: string;
  /** The card's inner HTML. Already escaped by its builder. */
  body: string;
  /** Below the card, outside it: shop name, contact, unsubscribe. */
  footer: string;
}

/**
 * Wrap a card in the shop's chrome.
 *
 * The wordmark is text, not an image. Most clients block remote images by
 * default, and a logo nobody sees is a blank space where the brand should be.
 */
export function emailDocument({
  locale,
  subject,
  preheader,
  body,
  footer,
}: DocumentInput): string {
  const rtl = locale === "ar";
  const dir = rtl ? "rtl" : "ltr";

  return `<!doctype html>
<html lang="${rtl ? "ar" : "en"}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.cream};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

        <tr>
          <td align="center" style="padding:0 0 24px;">
            <span style="font-family:${DISPLAY};font-size:20px;font-weight:700;letter-spacing:0.02em;color:${PALETTE.ink};">Net Sale</span>
          </td>
        </tr>

        <tr>
          <td style="background:${PALETTE.card};border:1px solid ${PALETTE.line};border-radius:14px;padding:32px 28px;" dir="${dir}">
${body}
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:24px 8px 0;" dir="${dir}">
${footer}
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * The plain-text alternative is not a courtesy.
 *
 * A message with no text part scores worse with every spam filter there is,
 * and for a shop whose mail must not land in spam that is reason enough on its
 * own — never mind the clients that show it. Blank lines are collapsed so a
 * builder can push optional sections in without minding the gaps.
 */
export function textDocument(lines: (string | undefined | false)[]): string {
  const kept = lines.filter((line): line is string => typeof line === "string");
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
