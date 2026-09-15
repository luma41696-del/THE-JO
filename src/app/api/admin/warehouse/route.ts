import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { revalidateCatalogue } from "@/lib/revalidate";
import { SEASONS } from "@/lib/visibility";
import type { ProductVisibility, Season } from "@/types";

/**
 * The seasonal warehouse.
 *
 * Moves products on and off the storefront without changing what they are.
 * Three rules hold this together, and each exists because the obvious
 * alternative loses data:
 *
 *  - Hiding never touches `status`. An archived product is one that is gone
 *    for good; a hidden one is coming back in October.
 *  - Hiding never touches stock. Zeroing it would destroy a real count that
 *    has to be correct when the product returns, and would make the warehouse
 *    indistinguishable from a sell-out in every report.
 *  - Hiding never touches orders. A customer who bought a coat in February
 *    still sees it in their history in July.
 *
 * Every change is written to `auditLog` with the actor, because "who pulled
 * the whole outerwear department, and when" is the first question asked when
 * a department disappears.
 */

interface Body {
  /** Product ids to act on. */
  ids?: string[];
  visibility?: ProductVisibility;
  /** Replaces the products' seasons when present. */
  seasons?: Season[];
  /** Epoch millis. `null` clears the bound. */
  showAt?: number | null;
  hideAt?: number | null;
  /**
   * When true, the schedule is ignored until it is cleared — "show this now"
   * must not be undone an hour later by a rule set last season.
   */
  override?: boolean;
  /** Drop any schedule and return to plain manual control. */
  clearSchedule?: boolean;
}

const MAX_BATCH = 400;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map(String).filter(Boolean))].slice(0, MAX_BATCH)
    : [];
  if (ids.length === 0) return bad("Select at least one product.");

  const visibility =
    body.visibility === "visible" || body.visibility === "hidden" ? body.visibility : null;

  const seasons = Array.isArray(body.seasons)
    ? ([...new Set(body.seasons)].filter((s) => SEASONS.includes(s as Season)) as Season[])
    : null;

  const showAt = body.showAt === null ? null : body.showAt === undefined ? undefined : Number(body.showAt);
  const hideAt = body.hideAt === null ? null : body.hideAt === undefined ? undefined : Number(body.hideAt);

  if (
    visibility === null &&
    seasons === null &&
    showAt === undefined &&
    hideAt === undefined &&
    body.override === undefined &&
    !body.clearSchedule
  ) {
    return bad("Nothing to change.");
  }

  if (typeof showAt === "number" && typeof hideAt === "number" && showAt === hideAt) {
    return bad("The show and hide times cannot be identical.");
  }

  if (!isAdminConfigured()) {
    return NextResponse.json({
      ok: true,
      persisted: false,
      validated: { ids: ids.length, visibility, seasons, showAt, hideAt },
    });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to move stock off sale.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const db = getAdminDb();
    const batch = db.batch();

    for (const id of ids) {
      const ref = db.collection("products").doc(id);

      const update: Record<string, unknown> = { updatedAt: new Date() };

      if (visibility) update.visibility = visibility;
      if (seasons) update.seasons = seasons;

      if (body.clearSchedule) {
        // `delete` rather than an empty object: an empty schedule still reads
        // as "a schedule exists" to anything checking for the field.
        update.visibilitySchedule = FieldValue.delete();
        update.visibilityOverride = FieldValue.delete();
      } else {
        /*
         * A nested object, not a dotted key.
         *
         * `update()` reads "visibilitySchedule.showAt" as a path into a map.
         * `set()` does not — even with `{merge: true}` it creates a top-level
         * field whose *name* contains a dot. So every schedule written here
         * landed next to `visibilitySchedule` instead of inside it, and the
         * reader (`product.visibilitySchedule?.showAt`) never saw one. The
         * feature has never fired.
         *
         * A merged nested map is the fix that keeps `set`'s create-or-update
         * behaviour: it merges field by field, so writing `showAt` alone does
         * not erase `hideAt`, and `FieldValue.delete()` inside the map removes
         * just that key.
         */
        const schedule: Record<string, unknown> = {};
        if (showAt !== undefined) {
          schedule.showAt = showAt === null ? FieldValue.delete() : showAt;
        }
        if (hideAt !== undefined) {
          schedule.hideAt = hideAt === null ? FieldValue.delete() : hideAt;
        }
        if (Object.keys(schedule).length > 0) {
          update.visibilitySchedule = schedule;
        }
        /*
         * A manual visibility change is itself an override. Without this, a
         * merchant who pulls a product by hand watches a forgotten schedule
         * put it straight back, and has no way to see why.
         */
        if (body.override !== undefined) {
          update.visibilityOverride = body.override === true;
        } else if (visibility) {
          update.visibilityOverride = true;
        }
      }

      batch.set(ref, update, { merge: true });
    }

    await batch.commit();

    await db.collection("auditLog").add({
      action: "warehouse.bulk",
      productIds: ids.slice(0, 50),
      count: ids.length,
      ...(visibility ? { visibility } : {}),
      ...(seasons ? { seasons } : {}),
      ...(showAt === undefined ? {} : { showAt }),
      ...(hideAt === undefined ? {} : { hideAt }),
      ...(body.clearSchedule ? { clearSchedule: true } : {}),
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    revalidateCatalogue();
    return NextResponse.json({ ok: true, persisted: true, count: ids.length });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "The products could not be updated.",
      500,
    );
  }
}
