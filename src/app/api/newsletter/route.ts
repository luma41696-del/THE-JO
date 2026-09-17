import { NextResponse } from "next/server";

import { isAdminConfigured } from "@/lib/firebase/admin";
import type { Locale } from "@/types";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

/**
 * Newsletter subscription.
 *
 * Deliberately boring, with two non-obvious details:
 *
 *  1. The response is identical whether the address is new or already
 *     subscribed. Returning "already subscribed" turns the endpoint into an
 *     oracle that confirms whether a given person shops here.
 *
 *  2. The document id is the lowercased email, which makes the write idempotent
 *     — a double-submit cannot create two records.
 *
 * Double opt-in (sending a confirmation link before marking `confirmed: true`)
 * is left to a Cloud Function triggered on create.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export async function POST(request: Request) {
  /*
   * Counted before the body is read. A flood should cost this route a
   * transaction, not a JSON parse of whatever the caller felt like sending.
   */
  const limit = await rateLimit(`newsletter:${callerKey(request)}`, RULES.messaging);
  if (!limit.ok) return tooManyRequests(limit);
  let body: { email?: string; locale?: Locale };
  try {
    body = (await request.json()) as { email?: string; locale?: Locale };
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }

  if (!isAdminConfigured()) {
    // Without a service account there is nowhere to write. Succeed loudly in
    // the payload rather than silently pretending to have stored the address.
    return NextResponse.json({ ok: true, persisted: false });
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    await getAdminDb()
      .collection("subscribers")
      .doc(email)
      .set(
        {
          email,
          locale: body.locale === "ar" ? "ar" : "en",
          confirmed: false,
          source: "homepage",
          createdAt: new Date(),
        },
        { merge: true },
      );

    return NextResponse.json({ ok: true, persisted: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not subscribe right now." },
      { status: 500 },
    );
  }
}
