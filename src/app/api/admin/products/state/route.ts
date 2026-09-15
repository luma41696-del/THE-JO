import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { revalidateCatalogue } from "@/lib/revalidate";
import { ACTION_LABELS, applyAction, isProductAction } from "@/lib/product-state";
import type { ProductAction } from "@/lib/product-state";
import type { Product } from "@/types";

/**
 * Changing a product's state — one product or fifty, through one door.
 *
 * The three axes this route moves are deliberately separate: publication
 * (draft/published/archived), display (shopfront/warehouse) and sale
 * (automatic/stopped). The rules live in `lib/product-state`, pure and tested;
 * this route reads the current document, asks that module what the action
 * does, and writes only the fields it is told to.
 *
 * ## Why a per-item result rather than a single ok/failed
 *
 * A merchant selecting thirty products and pressing Publish will usually have
 * a few that cannot be published — a missing Arabic title, no image. The
 * useful answer is "26 published, 4 refused, here is why", not a single
 * failure that tells them nothing and rolls back the 26 that were fine. So
 * each product is evaluated on its own and the response carries a line per
 * refusal.
 *
 * ## Why it re-reads rather than trusting the client
 *
 * The board shows what it loaded. By the time somebody presses the button that
 * may be minutes old — another operator may have archived one, a sale may have
 * emptied another. The state a decision is made against is the one in the
 * document now, not the one in the browser.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bulk is for a working session, not a migration; anything larger is a script. */
const MAX_IDS = 200;

interface Body {
  ids?: string[];
  action?: ProductAction;
}

interface Outcome {
  id: string;
  ok: boolean;
  /** Present when refused, in the operator's own language. */
  reason?: string;
  title?: string;
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

  if (!isProductAction(body.action)) return bad("Unknown action.");
  const action = body.action;

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
    return bad("This account does not have permission to change product state.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const refs = ids.map((id) => db.collection("products").doc(id));
    const snaps = await db.getAll(...refs);

    const outcomes: Outcome[] = [];
    const batch = db.batch();
    let changed = 0;

    for (const snap of snaps) {
      if (!snap.exists) {
        outcomes.push({ id: snap.id, ok: false, reason: "That product no longer exists." });
        continue;
      }

      const product = { ...(snap.data() as Product), id: snap.id };
      const title = product.title?.en || product.title?.ar || snap.id;

      const verdict = applyAction(product, action);
      if (!verdict.ok || !verdict.patch) {
        outcomes.push({ id: snap.id, ok: false, title, reason: verdict.message.en });
        continue;
      }

      batch.set(snap.ref, { ...verdict.patch, updatedAt: Date.now() }, { merge: true });
      outcomes.push({ id: snap.id, ok: true, title });
      changed += 1;
    }

    // Nothing to write is a legitimate answer, not an error — every selected
    // product may already be in the state that was asked for.
    if (changed > 0) await batch.commit();

    /*
     * Who changed what, and when. A state change is the kind of thing a
     * merchant asks about a week later — "why is this off sale?" — and without
     * a record the answer is a guess.
     */
    await db.collection("auditLog").add({
      action: `product.${action}`,
      label: ACTION_LABELS[action].en,
      productIds: ids.slice(0, 50),
      requested: ids.length,
      changed,
      refused: outcomes.filter((o) => !o.ok).length,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    if (changed > 0) revalidateCatalogue();

    return NextResponse.json({
      ok: true,
      persisted: true,
      action,
      requested: ids.length,
      changed,
      refused: outcomes.filter((o) => !o.ok),
    });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "The products could not be updated.",
      500,
    );
  }
}
