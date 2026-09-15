import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import type { FitProfile, Outfit } from "@/types";

/**
 * Measurements and saved outfits.
 *
 * Body measurements are among the most personal things this shop stores, and
 * the handling reflects that:
 *
 *  - They live on the customer's own profile document and are written only by
 *    the customer, as themselves.
 *  - They are **never** copied into analytics. `chestCm` and `waistCm` are not
 *    on the analytics allow-list, and both the client and the server drop
 *    unknown keys — so a future caller cannot leak them by accident.
 *  - Nothing here is ever returned for another uid. There is no "look up a
 *    customer's measurements" endpoint, and staff have no read path to them.
 */

const RANGE: Record<string, [number, number]> = {
  heightCm: [120, 220],
  chestCm: [60, 160],
  waistCm: [50, 160],
  hipCm: [60, 170],
  weightKg: [30, 250],
};

const FITS = ["slim", "regular", "relaxed"];

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Keep only known, in-range numbers. Anything else is dropped silently. */
function sanitise(input: unknown): FitProfile {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, [min, max]] of Object.entries(RANGE)) {
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value >= min && value <= max) {
      out[key] = Math.round(value);
    }
  }

  if (typeof raw.preferredFit === "string" && FITS.includes(raw.preferredFit)) {
    out.preferredFit = raw.preferredFit;
  }

  if (raw.usualSizes && typeof raw.usualSizes === "object") {
    const sizes: Record<string, string> = {};
    for (const [system, label] of Object.entries(raw.usualSizes as Record<string, unknown>)) {
      if (typeof label === "string" && label.length <= 12) sizes[system] = label;
    }
    if (Object.keys(sizes).length > 0) out.usualSizes = sizes;
  }

  out.updatedAt = Date.now();
  return out as FitProfile;
}

export async function POST(request: Request) {
  let body: { fitProfile?: unknown; outfit?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("Malformed request body.");
  }

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Sign in to save your measurements.", 401);

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    if (body.fitProfile) {
      const profile = sanitise(body.fitProfile);
      // Merged into the caller's own document, addressed by their verified
      // uid — never by an id supplied in the request.
      await db.collection("users").doc(caller.uid).set({ fitProfile: profile }, { merge: true });

      /*
       * Deliberately no audit-log entry. The audit log records staff actions
       * on shop data; writing "this customer's chest is 96cm" into a
       * staff-readable log would defeat the point of keeping measurements
       * out of staff reach.
       */
      return NextResponse.json({ ok: true, persisted: true });
    }

    if (body.outfit) {
      const raw = body.outfit as Partial<Outfit>;
      const items = raw.items && typeof raw.items === "object" ? raw.items : {};

      /*
       * A subcollection under the owner, not a top-level `outfits` collection
       * filtered by a `uid` field.
       *
       * Ownership is then a property of the path rather than of a where-clause
       * somebody has to remember to write, it matches the rule that already
       * guards `users/{uid}/outfits`, and no id a caller sends can address
       * another account's document — the "does this belong to you" check it
       * replaces could only ever be as good as its last edit.
       */
      const collection = db.collection("users").doc(caller.uid).collection("outfits");
      const ref = raw.id ? collection.doc(String(raw.id)) : collection.doc();

      await ref.set(
        {
          uid: caller.uid,
          ...(typeof raw.name === "string" ? { name: raw.name.slice(0, 80) } : {}),
          items,
          createdAt: Date.now(),
        },
        { merge: true },
      );

      return NextResponse.json({ ok: true, persisted: true, id: ref.id });
    }

    return bad("Nothing to save.");
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Could not save.", 500);
  }
}

/**
 * Remove a saved look, or the measurements themselves.
 *
 * Anything a customer can store, they must be able to remove. Measurements are
 * personal data they gave us for one purpose, and "you can add them but not
 * take them back" is not a defensible position to be in — for the customer or
 * for whoever answers the request in writing later.
 */
export async function DELETE(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  const { searchParams } = new URL(request.url);
  const outfitId = searchParams.get("outfit");
  const target = searchParams.get("target");

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const db = getAdminDb();
    const user = db.collection("users").doc(caller.uid);

    if (outfitId) {
      // Addressed under the caller's own document, so an id from another
      // account resolves to a document that does not exist rather than to
      // somebody else's look.
      await user.collection("outfits").doc(outfitId).delete();
      return NextResponse.json({ ok: true });
    }

    if (target === "measurements") {
      await user.set({ fitProfile: FieldValue.delete() }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    return bad("Nothing to delete.");
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Could not delete.", 500);
  }
}

/** The caller's own profile and outfits. Never anyone else's. */
export async function GET(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, fitProfile: null, outfits: [] });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const [user, outfits] = await Promise.all([
      db.collection("users").doc(caller.uid).get(),
      db
        .collection("users")
        .doc(caller.uid)
        .collection("outfits")
        .orderBy("createdAt", "desc")
        .limit(50)
        .get(),
    ]);

    return NextResponse.json({
      ok: true,
      fitProfile: (user.data()?.fitProfile as FitProfile | undefined) ?? null,
      outfits: outfits.docs.map((d) => ({ ...(d.data() as Outfit), id: d.id })),
    });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Could not read your profile.", 500);
  }
}
