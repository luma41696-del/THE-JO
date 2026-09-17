import { createHmac, timingSafeEqual } from "node:crypto";

import { absoluteUrl, siteUrl } from "@/lib/site";

/**
 * The unsubscribe link, and the reason it is signed.
 *
 * A campaign email must carry a way out. That is the law in most of the places
 * this shop will send to, and it is also the only thing standing between a
 * marketing send and the recipient pressing "spam" — which costs the sending
 * domain far more than the one address ever would.
 *
 * ## Why a signature and not a lookup
 *
 * The obvious design is a random token per recipient, stored in Firestore and
 * checked on click. It works, and it means a write for every recipient of
 * every campaign, plus a document that lives forever because a link in an
 * inbox never expires.
 *
 * A signature carries the same guarantee with no storage: the address is in
 * the URL, and an HMAC over it proves the shop is the one that put it there.
 * Without it, `?email=someone@else.com` in the address bar would let anybody
 * unsubscribe anybody — a small piece of vandalism that is invisible until a
 * customer asks why they stopped hearing from the shop.
 *
 * ## The secret
 *
 * `CAMPAIGN_SECRET`, its own variable, not borrowed from another. A secret
 * reused across purposes means a leak in one place is a forgery in the other,
 * and this one ends up in every marketing email the shop ever sends.
 *
 * Without it, `unsubscribeLink` returns undefined and the campaign builder
 * refuses to build — a campaign that cannot be unsubscribed from is not a
 * campaign this shop sends.
 */

/** A version marker, so the scheme can change without stranding old links. */
const VERSION = "v1";

function secret(): string | undefined {
  const value = process.env.CAMPAIGN_SECRET?.trim();
  /*
   * A short secret is refused rather than accepted quietly. Somebody setting
   * this to "changeme" should find out now, not when a forged link works.
   */
  return value && value.length >= 24 ? value : undefined;
}

/**
 * Whether campaigns can be sent at all, and what is missing if not.
 *
 * The site URL is checked here too, and it is not a formality: the campaign
 * builder refuses any link that is not https, so a deployment still on the
 * `http://localhost:3000` fallback cannot produce a sendable campaign at all.
 * Left unchecked that surfaces as every recipient failing with "no unsubscribe
 * link could be made", which names the symptom and not the cause.
 */
export function unsubscribeStatus(): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!secret()) missing.push("CAMPAIGN_SECRET");
  if (!siteUrl().startsWith("https://")) missing.push("NEXT_PUBLIC_SITE_URL (must be https)");
  return { ready: missing.length === 0, missing };
}

/**
 * The token for one address.
 *
 * The address is lowercased first, so the token does not depend on how the
 * customer happened to type it — `Lina@x.com` and `lina@x.com` are one
 * subscription and must produce one token.
 */
export function unsubscribeToken(email: string): string | undefined {
  const key = secret();
  if (!key) return undefined;
  return createHmac("sha256", key)
    .update(`${VERSION}:${email.trim().toLowerCase()}`)
    .digest("base64url");
}

/**
 * Check a token against an address.
 *
 * Compared in constant time. A plain `===` on an HMAC leaks how much of a
 * guess was right through how long the comparison took, which is enough to
 * recover a token one byte at a time.
 */
export function verifyUnsubscribe(email: string, token: string): boolean {
  const expected = unsubscribeToken(email);
  if (!expected || !token) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  // timingSafeEqual throws on a length mismatch, which is itself a comparison.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The full link to put in an email.
 *
 * Returns undefined when there is no secret, which is what makes a campaign
 * without a working unsubscribe impossible to build rather than merely
 * discouraged.
 */
export function unsubscribeLink(email: string, locale: "ar" | "en" = "ar"): string | undefined {
  const token = unsubscribeToken(email);
  if (!token) return undefined;

  const address = email.trim().toLowerCase();
  return absoluteUrl(
    `${locale}/unsubscribe?e=${encodeURIComponent(address)}&t=${encodeURIComponent(token)}`,
  );
}
