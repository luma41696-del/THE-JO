import { NextResponse } from "next/server";

import { isAdminConfigured, getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { clientIp } from "@/lib/security/ip";
import { isRecentlyRecorded, recordSignIn, type SeenAddress } from "@/lib/security/sign-in-log";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

/**
 * Record where an account signed in from.
 *
 * Firebase authenticates in the browser, so a customer signing in touches no
 * server of ours at all — there was nowhere for this to happen. This is that
 * place: the client calls it once after a successful sign-in, with the token
 * it just received.
 *
 * ## The address comes from the platform, never from the caller
 *
 * Nothing in the request body is read. The address is taken from the headers
 * Vercel sets, which the caller cannot forge. A body field would turn this
 * endpoint into a way to write any address onto your own account — and then
 * into a way to get somebody else's address blocked by signing in with it
 * attached.
 *
 * ## It cannot be used to write onto another account
 *
 * The uid comes from the verified token and nothing else. There is no uid
 * parameter to tamper with.
 *
 * ## It is quiet about failing
 *
 * A sign-in must not fail because this did. The client does not wait on it and
 * does not surface its errors; what it returns is for diagnosis, not display.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How long the same address stays "already recorded".
 *
 * Without this, a customer with several tabs pays a transaction per tab, and
 * an hour of shopping is a write every time the token refreshes. Six hours
 * keeps the useful signal — which address, roughly when — at one write a day
 * per person.
 */
const QUIET_MS = 6 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const limit = await rateLimit(`seen:${callerKey(request)}`, RULES.session);
  if (!limit.ok) return tooManyRequests(limit);

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "not-configured" }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return NextResponse.json({ ok: false, error: "no-token" }, { status: 401 });

  const ip = clientIp(request.headers);
  if (!ip) {
    // Nothing to record. Not an error the customer should ever see — running
    // behind something that strips the header is the shop's problem, not
    // theirs, so it answers cheerfully and writes nothing.
    return NextResponse.json({ ok: true, recorded: false, reason: "no-address" });
  }

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken, true);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ ok: false, error: "bad-token" }, { status: 401 });
  }

  const at = Date.now();
  const db = getAdminDb();
  const ref = db.collection("users").doc(uid);

  try {
    /*
     * A transaction, because the stored value is an array of maps: there is no
     * atomic "increment the count on the entry whose ip is X". Two sign-ins
     * landing together without one would have the second overwrite the first.
     */
    const wrote = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = (snap.data()?.signInIps ?? []) as SeenAddress[];

      if (isRecentlyRecorded(current, ip, at, QUIET_MS)) return false;

      tx.set(ref, { signInIps: recordSignIn(current, ip, at), lastSeenAt: at }, { merge: true });
      return true;
    });

    return NextResponse.json({ ok: true, recorded: wrote });
  } catch (error) {
    /*
     * Logged with the uid and not the address. The address is the personal
     * part, and a log line is the one place it would outlive the bounded list
     * it was going into.
     */
    console.error(`[net sale] could not record a sign-in address for ${uid}:`, error);
    return NextResponse.json({ ok: false, error: "write-failed" }, { status: 500 });
  }
}
