import { NextResponse } from "next/server";

import { isAdminConfigured, requireVerified, verifyRequest } from "@/lib/firebase/admin";
import { MAX_ALERTS_PER_ACCOUNT, alertKey, type AlertKind, type StockAlert } from "@/lib/alerts";
import { isLocale } from "@/lib/i18n/config";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

/**
 * "Tell me when it's back."
 *
 * The customer's own side of the alert system: subscribing, seeing what they
 * are waiting on, and cancelling. The sending lives in the sweep — see
 * `/api/admin/alerts`.
 *
 * ## Why an account is required
 *
 * An email address alone would be enough to make this work, and would also be
 * enough for anyone to sign a stranger up for mail from this shop. Requiring a
 * signed-in account means the address is one Firebase has already verified as
 * reachable by the person asking, and it gives them somewhere to cancel from.
 * A shop that can be used to send unsolicited mail becomes one whose mail
 * nobody receives.
 *
 * ## Why the price is recorded now
 *
 * A price-drop alert is a comparison with what the customer *saw*. Read live
 * at sweep time it would fire on any sale, including one that leaves the piece
 * dearer than when they asked — so the price they were looking at is stored
 * with the request, and the server reads it from the catalogue rather than
 * trusting the browser to say what it was.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: AlertKind[] = ["back-in-stock", "price-drop"];

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function notConfigured() {
  return NextResponse.json(
    { ok: false, error: "Firebase Admin is not configured here." },
    { status: 503 },
  );
}

/* -------------------------------------------------------------------------- */
/*  What I am waiting on                                                      */
/* -------------------------------------------------------------------------- */

export async function GET(request: Request) {
  if (!isAdminConfigured()) return notConfigured();

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const snap = await db
      .collection("stockAlerts")
      .where("uid", "==", caller.uid)
      .limit(MAX_ALERTS_PER_ACCOUNT * 2)
      .get();

    return NextResponse.json({
      ok: true,
      alerts: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "Your alerts could not be read.",
      500,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Ask to be told                                                            */
/* -------------------------------------------------------------------------- */

interface SubscribeBody {
  productId?: string;
  colorId?: string;
  sizeId?: string;
  kind?: AlertKind;
  targetPrice?: number;
  locale?: string;
}

export async function POST(request: Request) {
  /*
   * Counted before the body is read. A flood should cost this route a
   * transaction, not a JSON parse of whatever the caller felt like sending.
   */
  const limit = await rateLimit(`alerts:${callerKey(request)}`, RULES.messaging);
  if (!limit.ok) return tooManyRequests(limit);
  if (!isAdminConfigured()) return notConfigured();

  const caller = await verifyRequest(request);
  if (!caller) return bad("Sign in and we will tell you when it is back.", 401);
  if (!caller.email) {
    return bad("This account has no email address to send to.", 400);
  }

  /*
   * This queues a message the shop will later send to that address. An
   * unconfirmed one is an address somebody typed, not one they own — and
   * sending to it is how a shop's domain ends up used for harassment and then
   * in a spam filter.
   */
  const verified = requireVerified(caller);
  if (!verified.ok) return bad(verified.error, verified.status);

  let body: SubscribeBody;
  try {
    body = (await request.json()) as SubscribeBody;
  } catch {
    return bad("Malformed request body.");
  }

  const productId = String(body.productId ?? "").trim();
  if (!productId) return bad("Which piece?");

  const kind: AlertKind = KINDS.includes(body.kind as AlertKind)
    ? (body.kind as AlertKind)
    : "back-in-stock";

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    /*
     * The price comes from the catalogue, never from the request.
     *
     * A browser that can name the price it is comparing against can name one
     * that has already been beaten, and every sweep from then on mails this
     * customer about a drop that never happened.
     */
    const productSnap = await db.collection("products").doc(productId).get();
    if (!productSnap.exists) return bad("That piece is no longer in the catalogue.", 404);
    const product = productSnap.data() as { price?: number; status?: string };
    if (product.status === "archived") {
      return bad("That piece has been retired.", 404);
    }

    const existing = await db
      .collection("stockAlerts")
      .where("uid", "==", caller.uid)
      .limit(MAX_ALERTS_PER_ACCOUNT + 1)
      .get();

    const alert: Omit<StockAlert, "id"> = {
      uid: caller.uid,
      email: caller.email,
      locale: isLocale(body.locale ?? "") ? (body.locale as StockAlert["locale"]) : "en",
      kind,
      productId,
      ...(body.colorId ? { colorId: String(body.colorId) } : {}),
      ...(body.sizeId ? { sizeId: String(body.sizeId) } : {}),
      priceAtSubscribe: Number(product.price ?? 0),
      ...(Number.isFinite(Number(body.targetPrice)) && Number(body.targetPrice) > 0
        ? { targetPrice: Number(body.targetPrice) }
        : {}),
      createdAt: Date.now(),
    };

    /*
     * The key is the document id, so asking twice updates one row rather than
     * creating two. The first tap's confirmation is easy to miss, and people
     * reasonably tap again.
     */
    const id = Buffer.from(alertKey({ ...alert, uid: caller.uid })).toString("base64url");
    const ref = db.collection("stockAlerts").doc(id);

    // The cap is checked against alerts that are not already this one, so
    // re-subscribing at the limit is not refused.
    const others = existing.docs.filter((doc) => doc.id !== id && !doc.data().notifiedAt);
    if (others.length >= MAX_ALERTS_PER_ACCOUNT) {
      return bad(
        `You are already waiting on ${MAX_ALERTS_PER_ACCOUNT} pieces. Cancel one first.`,
        409,
      );
    }

    // `set` without merge, so re-subscribing after being notified genuinely
    // re-arms rather than leaving the old `notifiedAt` in place.
    await ref.set(alert);

    return NextResponse.json({ ok: true, persisted: true, id, kind });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "That alert could not be saved.",
      500,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Stop telling me                                                           */
/* -------------------------------------------------------------------------- */

export async function DELETE(request: Request) {
  if (!isAdminConfigured()) return notConfigured();

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return bad("Malformed request body.");
  }

  const id = String(body.id ?? "").trim();
  if (!id) return bad("Which alert?");

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const ref = db.collection("stockAlerts").doc(id);
    const snap = await ref.get();

    // A missing alert is a satisfied request: the goal is "stop telling me",
    // and one that was never there satisfies it.
    if (!snap.exists) return NextResponse.json({ ok: true, persisted: true });

    // Checked rather than assumed: the id is derived from the uid, but the
    // client supplies it, and an id that decodes to somebody else's row must
    // not delete it.
    if (snap.data()?.uid !== caller.uid) {
      return bad("That alert belongs to another account.", 403);
    }

    await ref.delete();
    return NextResponse.json({ ok: true, persisted: true });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "That alert could not be cancelled.",
      500,
    );
  }
}
