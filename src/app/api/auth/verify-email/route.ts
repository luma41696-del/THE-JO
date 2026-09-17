import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { buildVerificationEmail } from "@/lib/email/verification-email";
import { notifyStatus, send } from "@/lib/notify/provider";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { absoluteUrl } from "@/lib/site";
import type { Locale } from "@/types";

/**
 * The branded verification email.
 *
 * ## Why this is a server route at all
 *
 * `generateEmailVerificationLink` is an **Admin SDK** call. It mints a link
 * carrying an `oobCode` that confirms an address, and the service account that
 * can mint one can mint it for *any* address in the project. That credential
 * belongs on a server and nowhere else, which is the whole reason this
 * endpoint exists rather than a client helper.
 *
 * ## What it refuses, and why each one
 *
 *  - **Not signed in** — the link is minted for the caller's own account and
 *    nobody else's. Taking an address from the request body would turn this
 *    into a way to have the shop email a confirmation link to a stranger.
 *  - **A Google account** — Google already proved the address. A confirmation
 *    for one is a wasted send at best and a confusing message at worst.
 *  - **Already confirmed** — nothing to do, and a second link in an inbox
 *    reads as the first one having failed.
 *  - **Too soon** — Firebase throttles this hard per account, and its refusal
 *    reaches the customer as an accusation.
 *
 * ## What never appears in a log
 *
 * The link. It *is* the credential — anyone holding it can confirm that
 * address — so it is built, handed to the mail provider, and dropped. Logs
 * carry the uid and the outcome, never the URL, the code, or the address.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where a customer lands once the address is confirmed.
 *
 * Absolute, and on the shop's own domain: Firebase requires the continue URL
 * to be on the project's authorized-domains list, and a relative one is not a
 * URL it will accept.
 */
function continueUrl(locale: Locale): string {
  return absoluteUrl(`${locale}/account?verified=1`);
}

function bad(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    /*
     * `fallback` is the contract with the client: it means "this route cannot
     * do it, use Firebase's own send". The plain flow stays available the
     * whole time the branded one is being set up, so a shop mid-migration
     * never has a sign-up with no email at all.
     */
    return bad("Firebase Admin is not configured here.", 503, { fallback: true });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Sign in first.", 401);

  /*
   * Keyed on the account, not the address. A signed-in caller cannot escape
   * their own limit by changing network, and one household behind a single
   * NAT address does not share one.
   */
  const limit = await rateLimit(`verify-email:${callerKey(request, caller.uid)}`, RULES.messaging);
  if (!limit.ok) return tooManyRequests(limit);

  let body: { locale?: Locale };
  try {
    body = (await request.json().catch(() => ({}))) as { locale?: Locale };
  } catch {
    body = {};
  }
  const locale: Locale = body.locale === "en" ? "en" : "ar";

  const { getAdminAuth } = await import("@/lib/firebase/admin");
  const auth = getAdminAuth();

  const user = await auth.getUser(caller.uid).catch(() => null);
  if (!user) return bad("No such account.", 404);
  if (!user.email) return bad("This account has no email address.", 400);

  // Google proved the address; so did a completed confirmation.
  const federated = user.providerData.some((entry) => entry.providerId !== "password");
  if (federated) {
    return bad("This account signs in with Google — its address is already confirmed.", 400);
  }
  if (user.emailVerified) {
    return NextResponse.json({ ok: true, alreadyVerified: true, sent: false });
  }

  /*
   * No provider configured means no branded email — but it must not mean no
   * email. The client falls back to Firebase's own send, which is plain and
   * works today.
   */
  const provider = notifyStatus();
  if (!provider.configured) {
    return bad(
      `No mail provider configured (missing ${provider.missing.join(", ")}).`,
      503,
      { fallback: true },
    );
  }

  let link: string;
  try {
    link = await auth.generateEmailVerificationLink(user.email, {
      url: continueUrl(locale),
      handleCodeInApp: false,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code: unknown }).code)
        : "unknown";
    // The code, never the address and never a partial link.
    console.error(`[net sale] verification link could not be generated for ${caller.uid}:`, code);
    return bad("The verification link could not be created.", 502, { code, fallback: true });
  }

  const email = buildVerificationEmail({
    name: user.displayName ?? "",
    link,
    locale,
  });
  if (!email) {
    // `buildVerificationEmail` refuses a link that is not plausible https.
    console.error(`[net sale] refused to send a verification email for ${caller.uid}: bad link.`);
    return bad("The verification link was not usable.", 502, { fallback: true });
  }

  const result = await send({
    to: user.email,
    subject: email.subject,
    body: email.text,
    html: email.html,
    locale,
  });

  if (!result.ok) {
    /*
     * The provider's own words, kept for the log and for the operator — a
     * "domain not verified" is actionable and a sanitised "send failed" is
     * not. The customer sees the sentence the client chooses; `fallback` lets
     * it try Firebase rather than leave them with nothing.
     */
    console.error(`[net sale] branded verification email failed for ${caller.uid}:`, result.error);
    return bad(result.error, 502, { fallback: true, retryable: result.retryable });
  }

  console.info(`[net sale] branded verification email sent for ${caller.uid}.`);
  return NextResponse.json({ ok: true, sent: true, branded: true });
}
