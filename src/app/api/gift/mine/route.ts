import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import type { Offer } from "@/types";

/**
 * The signed-in customer's own gifts.
 *
 * A route rather than a Firestore read from the browser, because a personal
 * gift code must never be reachable in public data. The `offers` collection is
 * world-readable so the cart can validate a code — which means an assigned
 * code sitting in it would be listed by anyone who queried the collection.
 *
 * So this reads with the Admin SDK, filtered to the caller's own uid, and
 * returns only the fields a customer needs. The security rules refuse the same
 * query from a client (see `offers` in firestore.rules), so there is no second
 * door.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, gifts: [], persisted: false });
  }

  const caller = await verifyRequest(request);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const now = Date.now();

    const snap = await db
      .collection("offers")
      .where("assignedUid", "==", caller.uid)
      .limit(100)
      .get();

    const gifts = snap.docs
      .map((doc) => ({ ...(doc.data() as Offer), id: doc.id }))
      .map((offer) => ({
        id: offer.id,
        code: offer.code,
        title: offer.title,
        description: offer.description ?? null,
        type: offer.type,
        value: offer.value,
        minSubtotal: offer.minSubtotal ?? null,
        expiresAt: offer.endsAt,
        /*
         * Three states a customer actually cares about, computed here so the
         * UI does not re-derive them and get one wrong: spent, expired, or
         * usable.
         */
        used: (offer.usageCount ?? 0) > 0,
        expired: offer.endsAt <= now,
      }))
      // Usable first, then most recently expiring — a wallet sorted by
      // "what can I use today" rather than by database order.
      .sort((a, b) => {
        const aLive = !a.used && !a.expired;
        const bLive = !b.used && !b.expired;
        if (aLive !== bLive) return aLive ? -1 : 1;
        return a.expiresAt - b.expiresAt;
      });

    return NextResponse.json({ ok: true, gifts });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not read your gifts." },
      { status: 500 },
    );
  }
}
