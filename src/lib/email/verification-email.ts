import type { Locale } from "@/types";

/**
 * The account-confirmation email, as HTML and as plain text.
 *
 * Pure: it takes a name and a link and returns strings. That is deliberate —
 * an email template is the one thing in a codebase nobody looks at twice and
 * everybody sees, so it is kept where it can be asserted on rather than
 * inspected by sending one to yourself.
 *
 * ## Why this is written by hand and not with a component library
 *
 * Email clients are a browser from 2003. Outlook renders through Word, Gmail
 * strips `<style>` blocks it dislikes and every layout that survives is a
 * table. React email renderers exist and they all end up emitting this; going
 * straight to it keeps the thing a person can read next to the thing a client
 * receives.
 *
 * ## The rules that are not style choices
 *
 *  - **Inline styles only.** Gmail's web client drops `<head><style>` for
 *    any message it decides to clip, and a stylesheet in a `<style>` block is
 *    the first casualty.
 *  - **Tables for layout.** `flex` and `grid` do not exist in Outlook.
 *  - **No web fonts.** They do not load in most clients; a stack that falls
 *    back cleanly is the whole typography budget.
 *  - **Every interpolated value is escaped.** A customer's own name is
 *    attacker-controlled input — somebody can register as
 *    `<img src=x onerror=…>` — and it lands in HTML that other software
 *    renders.
 */

/* -------------------------------------------------------------------------- */
/*  Escaping                                                                  */
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
 * A verification link, or nothing.
 *
 * Firebase's own links are always `https` on a Google or project domain, so
 * anything else in this position means the caller has been handed a value from
 * somewhere it should not have been. Refusing beats rendering a button that
 * takes a customer somewhere the shop did not choose.
 */
function safeLink(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/*  The brand, in the four values an email can carry                          */
/* -------------------------------------------------------------------------- */

const CREAM = "#f5f1e6";
const CARD = "#fffdf8";
const INK = "#14110f";
const MUTED = "#6f6862";
const RED = "#d21f26";
const LINE = "#e6e0d2";

export interface VerificationEmail {
  subject: string;
  html: string;
  text: string;
}

export interface VerificationEmailInput {
  /** The customer's display name. Escaped here; pass it raw. */
  name: string;
  /** The Firebase-generated action link. Must be https. */
  link: string;
  locale?: Locale;
}

/**
 * Build the email.
 *
 * Returns `undefined` for a link that is not a plausible https URL rather than
 * sending a message whose only button goes nowhere.
 */
export function buildVerificationEmail({
  name,
  link,
  locale = "ar",
}: VerificationEmailInput): VerificationEmail | undefined {
  const href = safeLink(link);
  if (!href) return undefined;

  const rtl = locale === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";

  /*
   * A greeting that works with no name.
   *
   * A phone-first customer may have signed up with nothing but an address, and
   * "مرحباً ،" with a dangling comma is worse than a plain hello.
   */
  const trimmed = name.trim();
  const greeting = rtl
    ? trimmed
      ? `مرحباً ${escapeHtml(trimmed)}،`
      : "مرحباً،"
    : trimmed
      ? `Hello ${escapeHtml(trimmed)},`
      : "Hello,";

  const copy = rtl
    ? {
        subject: "فعّل حسابك في نت سيل",
        heading: "فعّل حسابك",
        body: "شكراً لإنشاء حسابك في Net Sale. بقيت خطوة واحدة فقط لتفعيل حسابك.",
        cta: "تأكيد البريد الإلكتروني",
        note: "سينتهي رابط التحقق لأسباب أمنية، وإذا لم تقم بإنشاء هذا الحساب يمكنك تجاهل هذه الرسالة.",
        fallback: "إذا لم يعمل الزر، انسخ هذا الرابط إلى متصفحك:",
      }
    : {
        subject: "Confirm your Net Sale account",
        heading: "Confirm your account",
        body: "Thank you for creating your Net Sale account. One step left to activate it.",
        cta: "Confirm my email address",
        note: "This link expires for security. If you did not create this account, you can ignore this message.",
        fallback: "If the button does not work, copy this link into your browser:",
      };

  /*
   * The link appears twice: once as the button's href, once as visible text.
   *
   * The second is not clutter. Corporate mail filters rewrite hrefs, some
   * clients refuse to render buttons at all, and a customer who cannot click
   * has no other way through. It is the same URL, escaped both times.
   */
  const escapedHref = escapeHtml(href);

  const html = `<!doctype html>
<html lang="${rtl ? "ar" : "en"}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
<!-- Preheader: the grey line a client shows next to the subject. Hidden in
     the message itself, so it is not said twice. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.body)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:520px;width:100%;">

        <!-- Wordmark. Text, not an image: most clients block remote images by
             default, and a logo nobody sees is a blank space where the brand
             should be. -->
        <tr>
          <td align="center" style="padding:0 0 24px;">
            <span style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                         font-size:20px;font-weight:700;letter-spacing:0.02em;color:${INK};">
              Net Sale
            </span>
          </td>
        </tr>

        <tr>
          <td style="background:${CARD};border:1px solid ${LINE};border-radius:14px;
                     padding:36px 32px;" dir="${dir}">

            <h1 style="margin:0 0 18px;font-family:'Segoe UI',Tahoma,Helvetica,Arial,sans-serif;
                       font-size:24px;line-height:1.35;font-weight:700;color:${INK};
                       text-align:${align};">
              ${escapeHtml(copy.heading)}
            </h1>

            <p style="margin:0 0 8px;font-family:'Segoe UI',Tahoma,Helvetica,Arial,sans-serif;
                      font-size:15px;line-height:1.75;color:${INK};text-align:${align};">
              ${greeting}
            </p>

            <p style="margin:0 0 28px;font-family:'Segoe UI',Tahoma,Helvetica,Arial,sans-serif;
                      font-size:15px;line-height:1.75;color:${INK};text-align:${align};">
              ${escapeHtml(copy.body)}
            </p>

            <!-- The button. A table, because a styled <a> collapses in Outlook
                 and a padded link is the only shape that survives everywhere. -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin:0 auto 26px;">
              <tr>
                <td align="center" bgcolor="${RED}" style="border-radius:999px;">
                  <a href="${escapedHref}"
                     style="display:inline-block;padding:15px 34px;border-radius:999px;
                            background:${RED};color:#ffffff;text-decoration:none;
                            font-family:'Segoe UI',Tahoma,Helvetica,Arial,sans-serif;
                            font-size:16px;font-weight:700;line-height:1;">
                    ${escapeHtml(copy.cta)}
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 20px;font-family:'Segoe UI',Tahoma,Helvetica,Arial,sans-serif;
                      font-size:13px;line-height:1.7;color:${MUTED};text-align:${align};">
              ${escapeHtml(copy.note)}
            </p>

            <hr style="border:none;border-top:1px solid ${LINE};margin:0 0 18px;">

            <p style="margin:0 0 6px;font-family:'Segoe UI',Tahoma,Helvetica,Arial,sans-serif;
                      font-size:12px;line-height:1.6;color:${MUTED};text-align:${align};">
              ${escapeHtml(copy.fallback)}
            </p>
            <!-- dir=ltr on the URL: a link inside an Arabic paragraph is
                 reordered by bidi and comes out unusable. -->
            <p dir="ltr" style="margin:0;font-family:Consolas,Menlo,monospace;font-size:11px;
                      line-height:1.6;color:${MUTED};word-break:break-all;text-align:left;">
              ${escapedHref}
            </p>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:24px 0 0;">
            <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                      font-size:13px;font-weight:600;color:${INK};">Net Sale</p>
            <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                      font-size:12px;color:${MUTED};">
              <a href="https://netsale.shop" style="color:${MUTED};text-decoration:none;">netsale.shop</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  /*
   * The plain-text part is not a courtesy.
   *
   * A message with no text alternative scores worse with every spam filter
   * there is, and for a shop whose mail must not land in spam that is reason
   * enough on its own — never mind the clients that show it.
   */
  const text = [
    "Net Sale",
    "",
    copy.heading,
    "",
    rtl ? (trimmed ? `مرحباً ${trimmed}،` : "مرحباً،") : trimmed ? `Hello ${trimmed},` : "Hello,",
    copy.body,
    "",
    `${copy.cta}:`,
    href,
    "",
    copy.note,
    "",
    "Net Sale — netsale.shop",
  ].join("\n");

  return { subject: copy.subject, html, text };
}
