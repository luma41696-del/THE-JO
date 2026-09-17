import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

/**
 * Blocking and deleting customer accounts.
 *
 * Three actions, and they are not equally dangerous:
 *
 *  - **block** stops somebody signing in, and is instantly reversible. Their
 *    orders, addresses and history are untouched.
 *  - **unblock** puts it back.
 *  - **delete** cannot be undone by anyone, including Google.
 *
 * So the first two are staff work and the third is not.
 *
 * ## What "delete" actually deletes
 *
 * The sign-in account, and the personal data on the profile document. **Not**
 * the orders. An order is an accounting record: it is on an invoice, it is in
 * the shop's tax return, and a business that deletes the customer row out from
 * under a paid invoice has broken its own books to satisfy a request it could
 * have honoured by redacting. So the order keeps its reference, its totals and
 * its lines, and the name, email, phone and address on it are replaced with a
 * marker saying the account was removed.
 *
 * That is also what the comment in `firestore.rules` next to `allow delete: if
 * false` has always promised; this is the server-side path it referred to.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "block" | "unblock" | "delete";

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** What replaces a deleted customer's details on records that must survive. */
const REDACTED = "[account removed]";

export async function POST(request: Request) {
  const limit = await rateLimit(`admin-customers:${callerKey(request)}`, RULES.content);
  if (!limit.ok) return tooManyRequests(limit);

  if (!isAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Firebase Admin is not configured here." },
      { status: 503 },
    );
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  let body: { uid?: string; action?: Action };
  try {
    body = (await request.json()) as { uid?: string; action?: Action };
  } catch {
    return bad("Malformed request body.");
  }

  const uid = String(body.uid ?? "").trim();
  const action = body.action;
  if (!uid) return bad("Which account?");
  if (action !== "block" && action !== "unblock" && action !== "delete") {
    return bad("Unknown action.");
  }

  /*
   * Blocking is staff work; deleting is not. A shop assistant should be able
   * to stop an abusive account at the counter, and should not be able to erase
   * a customer's history on their own.
   */
  const needed = action === "delete" ? "admin" : "staff";
  if (caller.role !== "admin" && (needed === "admin" || caller.role !== "staff")) {
    return bad(
      action === "delete"
        ? "Only an administrator can delete an account."
        : "This account cannot manage customers.",
      403,
    );
  }

  /*
   * Never yourself. Locking the only administrator out of the shop is a
   * one-click mistake with no way back in from the admin.
   */
  if (uid === caller.uid) return bad("You cannot block or delete your own account.", 400);

  const { getAdminAuth, getAdminDb } = await import("@/lib/firebase/admin");
  const auth = getAdminAuth();
  const db = getAdminDb();

  let target;
  try {
    target = await auth.getUser(uid);
  } catch {
    return bad("No such account.", 404);
  }

  /*
   * Staff and administrators are managed on the Access screen, which knows
   * about roles and about not removing the last administrator. Letting them be
   * blocked from here would route around that.
   */
  const targetRole = target.customClaims?.role;
  if (targetRole === "staff" || targetRole === "admin") {
    return bad("This is a staff account — manage it on the Access screen.", 400);
  }

  try {
    if (action === "block" || action === "unblock") {
      const disabled = action === "block";
      await auth.updateUser(uid, { disabled });

      /*
       * Existing sessions are revoked on a block, or the customer stays signed
       * in on whatever device they are already holding until their token
       * expires — which is up to an hour of continued access after being
       * blocked.
       */
      if (disabled) await auth.revokeRefreshTokens(uid);

      await db.collection("users").doc(uid).set({ disabled }, { merge: true });
      await audit(db, caller, action, uid, target.email ?? null);

      return NextResponse.json({ ok: true, disabled });
    }

    // ---- delete ---------------------------------------------------------

    /*
     * Order of operations matters. The sign-in account goes first, so that
     * even if the redaction below fails halfway the person can no longer
     * reach the shop with it — a half-deleted account that can still sign in
     * is the worse of the two failures.
     */
    await auth.revokeRefreshTokens(uid);
    await auth.deleteUser(uid);

    // The profile document holds addresses, a fit profile and a wishlist.
    await db.collection("users").doc(uid).delete();

    // Orders survive, redacted. Batched in chunks because a long-standing
    // customer can have more orders than one batch may carry.
    const orders = await db.collection("orders").where("uid", "==", uid).get();
    for (let i = 0; i < orders.docs.length; i += 400) {
      const batch = db.batch();
      for (const doc of orders.docs.slice(i, i + 400)) {
        batch.set(
          doc.ref,
          {
            email: REDACTED,
            shippingAddress: { fullName: REDACTED, phone: REDACTED, line1: REDACTED },
            billingAddress: { fullName: REDACTED, phone: REDACTED, line1: REDACTED },
            customerDeletedAt: new Date(),
          },
          { merge: true },
        );
      }
      await batch.commit();
    }

    await audit(db, caller, "delete", uid, target.email ?? null, orders.size);

    return NextResponse.json({ ok: true, deleted: true, ordersRedacted: orders.size });
  } catch (error) {
    const message = error instanceof Error ? error.message : "That did not work.";
    console.error("[net sale] customer action failed", action, uid, message);
    return bad(message, 500);
  }
}

/**
 * Every action is recorded, with who did it.
 *
 * Blocking somebody's account and erasing their history are the two things in
 * this admin most likely to be asked about afterwards — by the customer, or by
 * whoever has to answer them.
 */
async function audit(
  db: FirebaseFirestore.Firestore,
  caller: { uid: string; email: string | null },
  action: Action,
  uid: string,
  email: string | null,
  ordersRedacted?: number,
) {
  await db.collection("auditLog").add({
    action: `customer.${action}`,
    targetUid: uid,
    targetEmail: email,
    ...(ordersRedacted === undefined ? {} : { ordersRedacted }),
    actorUid: caller.uid,
    actorEmail: caller.email,
    at: new Date(),
  });
}
