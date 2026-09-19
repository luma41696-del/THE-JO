import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { getEarnRules } from "@/lib/loyalty-earning.server";
import {
  CLAIM_REFUSALS,
  claimRefusal,
  generateReferralCode,
  normaliseReferralCode,
} from "@/lib/referral";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { absoluteUrl } from "@/lib/site";

/**
 * A customer's invitation code, and claiming somebody else's.
 *
 * ## Two documents, because a code needs looking up both ways
 *
 * The code lives on the account, and `referralCodes/<code>` points back at the
 * uid. Firestore cannot search for "the account whose code is this" without
 * the second one, and a collection scan on every claim is not a lookup.
 *
 * The mapping is created with `create`, not `set`, so two accounts generating
 * codes at the same moment cannot both take the same one — the loser retries
 * with a fresh code rather than silently overwriting somebody's.
 *
 * ## Claiming writes an intent, not a payment
 *
 * A claim records who invited whom. Nobody is paid here: the reward is
 * released by the invited person's first paid order, in the checkout, which is
 * what makes the programme cost a farmer the price of an order. See
 * `src/lib/referral.ts` for the rest of the guards.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400, reason?: string) {
  return NextResponse.json({ ok: false, error, ...(reason ? { reason } : {}) }, { status });
}

/** The addresses an account has signed in from, for the same-connection check. */
function ipsOf(data: FirebaseFirestore.DocumentData | undefined): string[] {
  const rows = (data?.signInIps ?? []) as { ip?: string }[];
  return rows.map((row) => row.ip).filter((ip): ip is string => Boolean(ip));
}

/* -------------------------------------------------------------------------- */

export async function GET(request: Request) {
  if (!isAdminConfigured()) return bad("Not configured here.", 503);
  const caller = await verifyRequest(request);
  if (!caller) return bad("Sign in first.", 401);

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  const rules = await getEarnRules(db);
  const userRef = db.collection("users").doc(caller.uid);
  const snap = await userRef.get();

  let code = (snap.data()?.referralCode as string | undefined) ?? "";

  /*
   * Minted on first read rather than at sign-up, so the shop is not carrying a
   * code for every account that will never share one.
   */
  if (!code) {
    for (let attempt = 0; attempt < 5 && !code; attempt += 1) {
      const candidate = generateReferralCode();
      try {
        await db
          .collection("referralCodes")
          .doc(candidate)
          .create({ uid: caller.uid, at: Date.now() });
        code = candidate;
      } catch {
        // Taken. Try another — see the note about `create` above.
      }
    }
    if (!code) return bad("Could not create an invitation code. Try again.", 503);
    await userRef.set({ referralCode: code }, { merge: true });
  }

  /*
   * How many invitations have been paid. Counted from the ledger, which is the
   * record that decides it — a separate counter would be a second truth.
   */
  const paid = await db
    .collection("loyalty")
    .doc(caller.uid)
    .collection("entries")
    .where("source", "==", "referral")
    .get()
    .catch(() => null);

  return NextResponse.json({
    ok: true,
    code,
    link: absoluteUrl(`ar/register?ref=${encodeURIComponent(code)}`),
    invited: paid?.size ?? 0,
    enabled: rules.referral.enabled,
    inviterPoints: rules.referral.inviterPoints,
    inviteePoints: rules.referral.inviteePoints,
    requiresOrder: rules.referral.requiresOrder,
  });
}

/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
  const limit = await rateLimit(`referral:${callerKey(request)}`, RULES.content);
  if (!limit.ok) return tooManyRequests(limit);

  if (!isAdminConfigured()) return bad("Not configured here.", 503);
  const caller = await verifyRequest(request);
  if (!caller) return bad("Sign in first.", 401);

  let body: { code?: string };
  try {
    body = (await request.json()) as { code?: string };
  } catch {
    return bad("Malformed request body.");
  }

  const code = normaliseReferralCode(body.code ?? "");
  if (!code) return bad(CLAIM_REFUSALS["unknown-code"].en, 400, "unknown-code");

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();
  const rules = await getEarnRules(db);

  const [mapping, mine] = await Promise.all([
    db.collection("referralCodes").doc(code).get(),
    db.collection("users").doc(caller.uid).get(),
  ]);

  const inviterUid = (mapping.data()?.uid as string | undefined) ?? null;

  const inviter = inviterUid
    ? await db.collection("users").doc(inviterUid).get()
    : null;

  // Only whether any exist; the count is not needed and one read is cheaper.
  const orders = await db
    .collection("orders")
    .where("uid", "==", caller.uid)
    .limit(1)
    .get();

  const refusal = claimRefusal({
    inviterUid,
    uid: caller.uid,
    existingReferredBy: (mine.data()?.referredBy as string | undefined) ?? null,
    ordersPlaced: orders.size,
    inviterIps: ipsOf(inviter?.data()),
    claimantIps: ipsOf(mine.data()),
    enabled: rules.referral.enabled,
  });

  if (refusal) return bad(CLAIM_REFUSALS[refusal].en, 400, refusal);

  /*
   * The claim, written once. `referredBy` is only ever set here and never
   * cleared, so a second claim is refused by the guard above rather than
   * overwriting the first — which would let somebody shop their sign-up around
   * until they found the most generous code.
   */
  await db.collection("users").doc(caller.uid).set(
    {
      referredBy: inviterUid,
      referredAt: Date.now(),
      referredCode: code,
    },
    { merge: true },
  );

  await db.collection("auditLog").add({
    action: "referral.claim",
    code,
    inviterUid,
    uid: caller.uid,
    at: new Date(),
  });

  return NextResponse.json({
    ok: true,
    claimed: true,
    /*
     * Said explicitly so the person knows nothing has landed yet. A screen
     * that says "invitation accepted" next to a balance that has not moved is
     * one that gets a support message.
     */
    paysOnFirstOrder: rules.referral.requiresOrder,
    inviteePoints: rules.referral.inviteePoints,
  });
}
