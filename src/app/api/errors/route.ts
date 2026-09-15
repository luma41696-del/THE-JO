import { NextResponse } from "next/server";

import { isAdminConfigured } from "@/lib/firebase/admin";
import { fingerprintOf, toReport } from "@/lib/monitoring/fingerprint";
import type { ErrorInput } from "@/lib/monitoring/fingerprint";

/**
 * Where crashes go.
 *
 * The error boundaries showed the customer something calm and then called
 * `console.error` — into a browser nobody is watching. So every crash on the
 * live shop was invisible: the customer knew, and no one else ever did.
 *
 * Reports arrive here rather than being written to Firestore from the browser,
 * for three reasons:
 *
 *  1. A client-writable collection is a spam target, and this one would be
 *     writable by every visitor by definition.
 *  2. Grouping has to happen somewhere trustworthy. A bad deploy produces one
 *     crash per visitor; a document per occurrence would cost money and bury
 *     the second, rarer bug under the obvious one.
 *  3. The request's own headers are a better source of truth for the user
 *     agent than anything the page can claim.
 *
 * Deliberately **not** gated on analytics consent. This is not behavioural
 * tracking: it records that a page broke, carries no identifier, and is the
 * operational equivalent of a server log. What it must never do is carry
 * personal data — hence the redaction in `fingerprint.ts`, and the route
 * *pattern* rather than the URL.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A crash report is small. Anything larger is not one. */
const MAX_BYTES = 4_000;

export async function POST(request: Request) {
  let body: ErrorInput;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BYTES) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }
    body = JSON.parse(raw) as ErrorInput;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Nothing identifying is taken from the body; the UA comes from the request.
  const input: ErrorInput = {
    digest: typeof body.digest === "string" ? body.digest : undefined,
    message: typeof body.message === "string" ? body.message : undefined,
    path: typeof body.path === "string" ? body.path : undefined,
    locale: body.locale === "ar" ? "ar" : "en",
    boundary: body.boundary === "global" ? "global" : "route",
    userAgent: request.headers.get("user-agent") ?? undefined,
  };

  if (!input.digest && !input.message) {
    return NextResponse.json({ ok: false, error: "Nothing to report." }, { status: 400 });
  }

  if (!isAdminConfigured()) {
    // Nowhere to write. Say so in the payload rather than reporting success —
    // a monitoring endpoint that lies about storing things is worse than none.
    return NextResponse.json({ ok: true, persisted: false });
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const db = getAdminDb();

    const at = Date.now();
    const id = fingerprintOf(input);
    const ref = db.collection("errorReports").doc(id);

    /*
     * Upsert with an increment rather than a read-then-write. Two visitors
     * hitting the same broken page in the same second is the normal case, not
     * the edge case, and a read-modify-write would lose one of them.
     *
     * `firstSeenAt` is written only on create — `toReport` supplies it, and
     * the merge below keeps the existing value because the update path never
     * includes it.
     */
    const report = toReport(input, at);
    const { firstSeenAt, ...mutable } = report;

    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        tx.update(ref, { ...mutable, lastSeenAt: at, count: FieldValue.increment(1) });
      } else {
        tx.set(ref, { ...report, firstSeenAt, count: 1, resolved: false });
      }
    });

    return NextResponse.json({ ok: true, persisted: true });
  } catch {
    /*
     * Swallowed on purpose, and this is the one place that is right.
     *
     * The caller is an error boundary. A failure here would mean a crash
     * while reporting a crash, and there is nothing useful left to do with
     * it — certainly not show the customer a second error on top of the
     * first.
     */
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
