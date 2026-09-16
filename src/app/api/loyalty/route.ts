import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import {
  balanceOf,
  couponFor,
  maxRedeemable,
  nextTier,
  redemptionPlan,
  tierFor,
  type LedgerEntry,
} from "@/lib/loyalty";

/**
 * An account's points, and turning them into a coupon.
 *
 * ## Why redeeming is one transaction
 *
 * A redemption is two writes: take the points off the ledger, and create the
 * coupon. Done separately, every way it can half-fail costs somebody money.
 * Coupon first and the debit fails: a free discount, balance untouched, and
 * the customer can do it again. Debit first and the coupon fails: points gone
 * and nothing to show for them — the worse of the two, because the customer
 * is the one out of pocket and has no way to prove it.
 *
 * The same reasoning covers the retry. A response lost on the way back is
 * indistinguishable, from the browser, from a request that never arrived; the
 * obvious thing to do is press the button again. `requestId` makes that safe:
 * the second attempt finds the first one's record and returns the coupon it
 * already made, rather than minting another from a balance that has already
 * paid for one.
 *
 * ## Why the balance is never read from a counter
 *
 * It is computed from the ledger on every request. A running total kept beside
 * the entries is wrong the first time anything writes one without the other,
 * and a balance that disagrees with its own history is the one number a
 * customer will notice and nobody can explain afterwards.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enough for any real account; a ledger longer than this wants paging. */
const MAX_ENTRIES = 500;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function notConfigured() {
  return NextResponse.json(
    { ok: false, error: "Firebase Admin is not configured here." },
    { status: 503 },
  );
}

async function readLedger(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<LedgerEntry[]> {
  const snap = await db
    .collection("loyalty")
    .doc(uid)
    .collection("entries")
    .orderBy("at", "desc")
    .limit(MAX_ENTRIES)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<LedgerEntry, "id">) }));
}

/* -------------------------------------------------------------------------- */
/*  What I have                                                               */
/* -------------------------------------------------------------------------- */

export async function GET(request: Request) {
  if (!isAdminConfigured()) return notConfigured();

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const entries = await readLedger(db, caller.uid);
    const balance = balanceOf(entries);

    return NextResponse.json({
      ok: true,
      balance,
      tier: tierFor(balance.lifetimeSpend),
      next: nextTier(balance.lifetimeSpend),
      maxRedeemable: maxRedeemable(balance.available),
      /*
       * The history, most recent first. A points balance nobody can account
       * for is a balance customers write in about — showing the entries turns
       * "why is it 340?" into something they answer themselves.
       */
      entries: entries.slice(0, 50),
    });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "Your points could not be read.",
      500,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Turning points into a coupon                                              */
/* -------------------------------------------------------------------------- */

interface RedeemBody {
  points?: number;
  /**
   * The browser's own id for this attempt, so a retry is recognised rather
   * than charged twice. Supplied by the client and stable across retries.
   */
  requestId?: string;
}

export async function POST(request: Request) {
  if (!isAdminConfigured()) return notConfigured();

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  let body: RedeemBody;
  try {
    body = (await request.json()) as RedeemBody;
  } catch {
    return bad("Malformed request body.");
  }

  const points = Number(body.points);
  const requestId = String(body.requestId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) {
    return bad("This redemption needs an id, so a retry cannot spend twice.");
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const accountRef = db.collection("loyalty").doc(caller.uid);
    const attemptRef = accountRef.collection("redemptions").doc(requestId);
    const entriesRef = accountRef.collection("entries");

    const result = await db.runTransaction(async (tx) => {
      /*
       * The same request, already served. Returning what it produced is the
       * only honest answer: the points are already spent, and a second coupon
       * would be a second payout for one balance.
       */
      const attempt = await tx.get(attemptRef);
      if (attempt.exists) {
        const done = attempt.data() as { offerCode: string; value: number; points: number };
        return { replayed: true, ...done };
      }

      // Read inside the transaction, so a concurrent redemption cannot let two
      // requests both see enough points and both succeed.
      const ledgerSnap = await tx.get(entriesRef.orderBy("at", "desc").limit(MAX_ENTRIES));
      const entries = ledgerSnap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<LedgerEntry, "id">),
      }));
      const balance = balanceOf(entries);

      const plan = redemptionPlan(points, balance.available);
      if (!plan.ok) {
        throw new RedeemRejection(plan.message.en, plan.message.ar, plan.reason ?? "refused");
      }

      const now = Date.now();
      const coupon = couponFor(caller.uid, plan.points!, now);
      const offerRef = db.collection("offers").doc();

      tx.set(offerRef, {
        ...coupon,
        id: offerRef.id,
        /*
         * `active` mirrors `status`, as every other offer write does. The
         * Security Rules read it to decide what a shopper may see, and a
         * coupon written without it is one the rules cannot classify.
         */
        active: true,
        createdAt: now,
        updatedAt: now,
        /*
         * Marked as having come from points, so the offers board can show it
         * for what it is rather than as a campaign somebody forgot creating —
         * and so a report of discount spend can separate the two.
         */
        source: "loyalty",
        sourceUid: caller.uid,
      });

      tx.set(entriesRef.doc(), {
        uid: caller.uid,
        kind: "redeem",
        points: -plan.points!,
        at: now,
        offerId: offerRef.id,
        offerCode: coupon.code,
      });

      tx.set(attemptRef, {
        at: now,
        points: plan.points!,
        value: plan.value!,
        offerId: offerRef.id,
        offerCode: coupon.code,
      });

      return {
        replayed: false,
        points: plan.points!,
        value: plan.value!,
        offerCode: coupon.code,
        offerId: offerRef.id,
      };
    });

    return NextResponse.json({ ok: true, persisted: true, ...result });
  } catch (error) {
    if (error instanceof RedeemRejection) {
      return NextResponse.json(
        { ok: false, error: error.message, errorAr: error.arabic, reason: error.reason },
        { status: 409 },
      );
    }
    return bad(
      error instanceof Error ? error.message : "Those points could not be redeemed.",
      500,
    );
  }
}

/** Carries the customer's own language alongside the reason. */
class RedeemRejection extends Error {
  constructor(
    message: string,
    readonly arabic: string,
    readonly reason: string,
  ) {
    super(message);
  }
}
