import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { revalidateCatalogue } from "@/lib/revalidate";
import { applyEdits, editProblems, type Edit } from "@/lib/bulk-edit";
import { getCategories } from "@/lib/catalog";
import { categoryPathFor } from "@/lib/categories";
import type { Product } from "@/types";

/**
 * Quick edit and bulk edit — one door, because they are one operation.
 *
 * Changing the price of a single product from its row in the list and changing
 * the price of thirty selected products are the same instruction with a
 * different number of ids. Splitting them into two routes means two places to
 * get the was-price check wrong, and only one of them ever gets fixed.
 *
 * ## Why every product is re-read
 *
 * "Reduce by 25%" is a *relative* instruction, and the number it is relative
 * to has to be the stored one. The board's copy can be minutes old: a colleague
 * may have repriced something, an offer may have ended. Computing from what the
 * browser is displaying applies the discount to a price that no longer exists.
 *
 * ## Why refusals are per product
 *
 * A selection of thirty will usually contain a few the edit cannot touch — a
 * variable product whose stock lives in its variant rows, one whose was-price
 * would end up below its price. The useful answer is "26 changed, 4 refused,
 * here is why", not a single failure that rolls back the 26 that were fine.
 *
 * Within *one* product the opposite holds: a refusal refuses the whole
 * product, so a two-part change never half-lands.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A working session, not a migration. Anything larger belongs in a script. */
const MAX_IDS = 200;
const MAX_EDITS = 6;

interface Body {
  ids?: string[];
  edits?: Edit[];
}

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
    ? [...new Set(body.ids.map((id) => String(id).trim()).filter(Boolean))].slice(0, MAX_IDS)
    : [];
  if (ids.length === 0) return bad("Select at least one product.");

  const edits = Array.isArray(body.edits) ? body.edits.slice(0, MAX_EDITS) : [];
  if (edits.length === 0) return bad("Pick what to change.");

  /*
   * The instruction is checked once, before anything is read. A malformed one
   * — a letter in the price box, a 500% cut — should fail with one clear
   * sentence rather than thirty identical refusals to read through.
   */
  const problems = edits.flatMap((edit) => editProblems(edit, ids.length));
  if (problems.length > 0) {
    return NextResponse.json(
      { ok: false, error: problems[0]!.en, errorAr: problems[0]!.ar },
      { status: 400 },
    );
  }

  if (!isAdminConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        persisted: false,
        error: "Firebase Admin is not configured here, so nothing was changed.",
      },
      { status: 503 },
    );
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to edit products.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const refs = ids.map((id) => db.collection("products").doc(id));
    const snaps = await db.getAll(...refs);

    /*
     * Category ancestry is denormalised onto the product so a listing filtered
     * on a parent matches every descendant with one query. Moving a product
     * without recomputing it leaves the product filed under its old parent in
     * every listing — invisible in the admin, wrong on the storefront.
     */
    const movingCategory = edits.some((edit) => edit.field === "categoryId");
    const categories = movingCategory ? await getCategories() : [];

    const slugEdit = edits.find((edit) => edit.field === "slug");
    if (slugEdit) {
      // A slug is the product's address. A collision takes a live page down.
      const wanted = String(slugEdit.value ?? "").trim().toLowerCase();
      const clash = await db.collection("products").where("slug", "==", wanted).limit(2).get();
      const taken = clash.docs.some((doc) => !ids.includes(doc.id));
      if (taken) return bad(`Another product already uses the address "${wanted}".`, 409);
    }

    const outcomes: {
      id: string;
      ok: boolean;
      title?: string;
      reason?: string;
      reasonAr?: string;
    }[] = [];
    const batch = db.batch();
    let changed = 0;

    for (const snap of snaps) {
      if (!snap.exists) {
        outcomes.push({ id: snap.id, ok: false, reason: "That product no longer exists." });
        continue;
      }

      const stored = { ...(snap.data() as Product), id: snap.id };
      const title = stored.title?.en || stored.title?.ar || snap.id;

      const outcome = applyEdits(stored, edits);
      if (!outcome.ok) {
        outcomes.push({ id: snap.id, ok: false, title, reason: outcome.reason, reasonAr: outcome.reasonAr });
        continue;
      }
      // Already in the state asked for. Reported as fine, written as nothing —
      // a no-op write moves `updatedAt` and invalidates every open editor.
      if (!outcome.patch) {
        outcomes.push({ id: snap.id, ok: true, title });
        continue;
      }

      const patch: Record<string, unknown> = { ...outcome.patch, updatedAt: Date.now() };

      /*
       * `undefined` means "remove this field" here, and Firestore will not
       * store it. Translated to an explicit delete so clearing a was-price
       * actually ends the sale rather than being silently dropped.
       */
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) patch[key] = FieldValue.delete();
      }

      if (movingCategory && outcome.patch.categoryId) {
        patch.categoryPath = categoryPathFor(categories, outcome.patch.categoryId);
      }

      batch.set(snap.ref, patch, { merge: true });
      outcomes.push({ id: snap.id, ok: true, title });
      changed += 1;
    }

    if (changed > 0) await batch.commit();

    /*
     * What was changed, by whom, and what it was changed to. A repricing is
     * exactly the kind of thing somebody asks about a fortnight later, and
     * without the instruction recorded the answer is archaeology.
     */
    await db.collection("auditLog").add({
      action: "product.bulkEdit",
      edits: edits.map((edit) => ({
        field: edit.field,
        mode: edit.mode,
        value: edit.value ?? null,
      })),
      productIds: ids.slice(0, 50),
      requested: ids.length,
      changed,
      refused: outcomes.filter((outcome) => !outcome.ok).length,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    if (changed > 0) revalidateCatalogue();

    return NextResponse.json({
      ok: true,
      persisted: true,
      requested: ids.length,
      changed,
      refused: outcomes.filter((outcome) => !outcome.ok),
    });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "The products could not be updated.",
      500,
    );
  }
}
