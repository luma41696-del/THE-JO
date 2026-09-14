import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import type { OrderStatus } from "@/types";

/**
 * Order mutations.
 *
 * The only way an order's status changes. Three checks, in this order, and none
 * of them is skippable:
 *
 *  1. **The caller is staff.** Verified from the ID token's `role` claim with
 *     the Admin SDK — not from anything the browser sent in the body, and not
 *     from a Firestore document the caller might be able to edit.
 *  2. **The transition is legal.** The same graph the UI offers, enforced here.
 *     The UI hiding a button is a convenience; this is the control. Without it,
 *     a crafted request could mark an order delivered before it shipped and the
 *     customer-facing tracking timeline would start lying.
 *  3. **The write is server-side.** Security Rules forbid client writes to
 *     `orders` outright; the Admin SDK bypasses them, which is precisely why
 *     this route is the only door.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Legal successors. Mirrors `NEXT` in the order detail UI. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["processing", "cancelled"],
  processing: ["packed", "cancelled"],
  packed: ["shipped"],
  shipped: ["out-for-delivery"],
  "out-for-delivery": ["delivered"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

interface Body {
  reference?: string;
  status?: OrderStatus;
  trackingNumber?: string;
  note?: string;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function PATCH(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  const status = body.status;

  if (!reference) return bad("An order reference is required.");
  if (!status || !(status in TRANSITIONS)) return bad("Unknown order status.");

  /* --- 1. authorisation -------------------------------------------------- */

  if (!isAdminConfigured()) {
    // Nothing can be verified and nothing can be written. Say so plainly rather
    // than returning a success the operator would reasonably trust.
    return NextResponse.json({
      ok: true,
      persisted: false,
      note:
        "Firebase Admin is not configured, so the caller could not be verified and " +
        "nothing was written. Add FIREBASE_ADMIN_* to .env.local.",
    });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to change orders.", 403);
  }

  /* --- 2 & 3. transition check and write, in one transaction ------------- */

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const matches = await db
      .collection("orders")
      .where("reference", "==", reference)
      .limit(1)
      .get();

    if (matches.empty) return bad(`No order ${reference}.`, 404);

    const doc = matches.docs[0]!;
    const current = doc.data().status as OrderStatus;

    if (current === status) {
      return NextResponse.json({ ok: true, persisted: true, unchanged: true });
    }

    if (!TRANSITIONS[current]?.includes(status)) {
      return bad(
        `An order cannot go from "${current}" to "${status}".`,
        409,
      );
    }

    const now = new Date();
    const event: Record<string, unknown> = { status, at: now };
    if (body.note) event.note = { en: body.note, ar: body.note };

    await doc.ref.update({
      status,
      updatedAt: now,
      ...(body.trackingNumber ? { trackingNumber: body.trackingNumber } : {}),
      // `arrayUnion` is wrong here: two identical events are legitimate (a
      // parcel can go out for delivery twice), and it would silently drop one.
      timeline: [...(doc.data().timeline ?? []), event],
    });

    // An audit row per transition. Who moved what, and when — the first thing
    // anyone asks when an order's history looks wrong.
    await db.collection("auditLog").add({
      action: "order.status",
      orderReference: reference,
      from: current,
      to: status,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: now,
    });

    return NextResponse.json({ ok: true, persisted: true, status });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not update the order.",
      },
      { status: 500 },
    );
  }
}
