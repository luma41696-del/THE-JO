import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { notifyStatus } from "@/lib/notify/provider";
import { unsubscribeStatus } from "@/lib/email/unsubscribe";
import { resolveAudience, type SegmentSummary } from "@/lib/admin/campaign-audience";
import { SEGMENTS, readSegment, readSuppressed } from "@/lib/admin/campaign-audience.server";

/**
 * How many people a campaign would reach, per segment.
 *
 * Counted rather than estimated, and counted *after* the suppression list, so
 * the number on the button is the number of messages that will leave. An
 * operator who sends to "1,200 customers" and is billed for 1,140 has been
 * told something untrue about their own shop.
 *
 * It also reports whether a campaign could be sent at all — the mail provider
 * and the unsubscribe secret — because "why did nothing happen" is worth
 * answering before the send rather than after.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(request: Request) {
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ ok: false, error: "Firebase Admin is not configured here." }, { status: 503 }) } as const;
  }
  const caller = await verifyRequest(request);
  if (!caller) {
    return { error: NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 }) } as const;
  }
  if (caller.role !== "admin") {
    return {
      error: NextResponse.json(
        { ok: false, error: "Only an administrator can send a campaign." },
        { status: 403 },
      ),
    } as const;
  }
  return { caller } as const;
}

export async function GET(request: Request) {
  const guard = await gate(request);
  if (guard.error) return guard.error;

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  const suppressed = await readSuppressed(db);

  const segments: SegmentSummary[] = [];
  for (const id of SEGMENTS) {
    const candidates = await readSegment(db, id);
    const resolved = resolveAudience(candidates, suppressed);
    segments.push({
      id,
      found: resolved.found,
      suppressed: resolved.suppressedCount,
      sendable: resolved.recipients.length,
    });
  }

  const provider = notifyStatus();
  const unsubscribe = unsubscribeStatus();

  return NextResponse.json({
    ok: true,
    segments,
    unsubscribed: suppressed.length,
    /*
     * Reported as booleans and variable *names*. A key must never reach an
     * admin screen, and "NOTIFY_API_KEY is missing" is the actionable half.
     */
    ready: provider.configured && unsubscribe.ready,
    missing: [...provider.missing, ...unsubscribe.missing],
  });
}
