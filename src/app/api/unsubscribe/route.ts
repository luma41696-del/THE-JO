import { NextResponse } from "next/server";

import { isAdminConfigured } from "@/lib/firebase/admin";
import { verifyUnsubscribe } from "@/lib/email/unsubscribe";
import { normaliseEmail, isPlausibleEmail } from "@/lib/admin/campaign-audience";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

/**
 * Leaving the mailing list.
 *
 * Public by necessity — the person clicking is in their inbox, not signed in,
 * and requiring a login to stop receiving email is the pattern that produces
 * spam complaints instead of unsubscribes.
 *
 * Public *and* safe because the link is signed. Without the signature,
 * `?e=someone@else.com` would let anyone unsubscribe anyone: a small piece of
 * vandalism that stays invisible until a customer asks why the shop went
 * quiet.
 *
 * ## Two writes, because one is not enough
 *
 *  1. `unsubscribes/<email>` — the suppression list every campaign segment is
 *     filtered through. This is the one that actually stops mail, including
 *     for an address with no account and for the "every customer" segment.
 *  2. `users.marketingOptIn = false` where an account exists, so the customer's
 *     own preferences screen agrees with what just happened. A settings page
 *     still showing the box ticked after they unsubscribed is the shop calling
 *     them a liar.
 *
 * ## Why it answers the same way to everything
 *
 * A valid token for an unknown address, and a valid token for a known one,
 * return the same thing. The alternative is an endpoint that confirms whether
 * a given person shops here, to anyone holding a link.
 *
 * ## Why GET does not unsubscribe anybody
 *
 * Corporate mail filters and security scanners fetch every link in a message
 * before a human sees it. An endpoint that opts somebody out on `GET` opts
 * them out the moment the mail lands, silently, and the shop finds out when a
 * customer asks why they stopped hearing from it.
 *
 * So `GET` only says whether the link is valid, and the page it loads asks for
 * one click. That click is the `POST` that changes something.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function unsubscribe(email: string, token: string) {
  const address = normaliseEmail(email);

  if (!isPlausibleEmail(address) || !verifyUnsubscribe(address, token)) {
    return NextResponse.json({ ok: false, error: "That link is not valid." }, { status: 400 });
  }

  if (!isAdminConfigured()) {
    /*
     * Nowhere to write. Said plainly rather than returning a cheerful "you are
     * unsubscribed" for a change that did not happen — the person would go on
     * receiving mail and have no reason to try again.
     */
    return NextResponse.json(
      { ok: false, error: "This is not set up to record that right now." },
      { status: 503 },
    );
  }

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  // The suppression list first: it is the write that actually stops mail.
  await db.collection("unsubscribes").doc(address).set(
    {
      email: address,
      at: new Date(),
      source: "email-link",
    },
    { merge: true },
  );

  /*
   * Then the account, if there is one. Its failure must not undo the first
   * write — the person is unsubscribed either way, and an error here would
   * send them back to click a link that already worked.
   */
  try {
    const accounts = await db.collection("users").where("email", "==", address).limit(5).get();
    await Promise.all(
      accounts.docs.map((doc) => doc.ref.set({ marketingOptIn: false }, { merge: true })),
    );
  } catch (error) {
    console.error("[net sale] unsubscribed but could not update the account:", error);
  }

  return NextResponse.json({ ok: true, unsubscribed: true });
}

/** Is this link real? Answers, and changes nothing. */
export async function GET(request: Request) {
  const limit = await rateLimit(`unsubscribe:${callerKey(request)}`, RULES.messaging);
  if (!limit.ok) return tooManyRequests(limit);

  const url = new URL(request.url);
  const address = normaliseEmail(url.searchParams.get("e") ?? "");
  const token = url.searchParams.get("t") ?? "";

  const valid = isPlausibleEmail(address) && verifyUnsubscribe(address, token);
  return NextResponse.json({ ok: true, valid, email: valid ? address : null });
}

export async function POST(request: Request) {
  const limit = await rateLimit(`unsubscribe:${callerKey(request)}`, RULES.messaging);
  if (!limit.ok) return tooManyRequests(limit);

  let body: { e?: string; t?: string };
  try {
    body = (await request.json()) as { e?: string; t?: string };
  } catch {
    body = {};
  }
  return unsubscribe(body.e ?? "", body.t ?? "");
}
