import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { alertMessage, planSweep, type StockAlert } from "@/lib/alerts";
import { send, notifyStatus } from "@/lib/notify/provider";
import { t as pick } from "@/lib/format";
import type { Product } from "@/types";

/**
 * The sweep: who is waiting, and is it true yet.
 *
 * Runs over every alert that has not fired, asks `lib/alerts` whether its
 * condition holds against the catalogue as it is *now*, and sends the ones
 * that do.
 *
 * ## Why a sweep rather than a hook on the write
 *
 * Stock is raised by the product editor, by bulk edit, by import, by a
 * cancelled order putting units back, and by somebody typing in the Firebase
 * console. Hooking the ones we know about means the feature silently does
 * nothing for the ones we forget — and the failure is an email that was never
 * sent, which nobody notices. Asking the question from the other end works for
 * every path, including ones that do not exist yet.
 *
 * ## Why it is safe to run twice
 *
 * The alert is marked before the message leaves, and a marked alert is never
 * reconsidered. A sweep that crashes halfway has sent some mail and recorded
 * every one it sent; running it again picks up where it stopped rather than
 * mailing the first half a second time.
 *
 * `GET` reports what *would* be sent and writes nothing, which is how a
 * merchant can see the queue before letting it go out.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One run. Beyond this the sweep is paged, so a big restock cannot time out. */
const MAX_PER_RUN = 200;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function gate(request: Request) {
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ ok: false, error: "Firebase Admin is not configured here." }, { status: 503 }) };
  }
  const caller = await verifyRequest(request);
  if (!caller) return { error: bad("Not signed in.", 401) };
  if (caller.role !== "admin" && caller.role !== "staff") {
    return { error: bad("This account cannot run alerts.", 403) };
  }
  return { caller };
}

/** Everything waiting, and the products they are waiting on. */
async function load(db: FirebaseFirestore.Firestore) {
  /*
   * Read, then filter in memory — deliberately not `where("notifiedAt", "==",
   * null)`.
   *
   * An unfired alert does not carry the field at all, and Firestore's `== null`
   * matches a field explicitly set to null, never a missing one. That query
   * returns an empty page for a queue full of waiting alerts, succeeds, and
   * reports "0 to send" — a silence indistinguishable from there being nothing
   * to do. It was written that way here first, and only the end-to-end test
   * caught it.
   *
   * The alternative is writing `notifiedAt: null` on every subscribe and
   * trusting that nothing ever creates one another way. Filtering in memory
   * needs no such promise, and at this size the read is the same read.
   */
  const snap = await db.collection("stockAlerts").limit(MAX_PER_RUN * 4).get();

  const alerts = snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<StockAlert, "id">) }))
    .filter((alert) => !alert.notifiedAt)
    .slice(0, MAX_PER_RUN);

  const ids = [...new Set(alerts.map((alert) => alert.productId))];
  const products = new Map<string, Product>();

  if (ids.length > 0) {
    const refs = ids.map((id) => db.collection("products").doc(id));
    const snaps = await db.getAll(...refs);
    for (const productSnap of snaps) {
      if (productSnap.exists) {
        products.set(productSnap.id, { ...(productSnap.data() as Product), id: productSnap.id });
      }
    }
  }

  return { alerts, products };
}

/* -------------------------------------------------------------------------- */
/*  What would go out                                                         */
/* -------------------------------------------------------------------------- */

export async function GET(request: Request) {
  const allowed = await gate(request);
  if (allowed.error) return allowed.error;

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const { alerts, products } = await load(db);
    const plan = planSweep(alerts, products);
    const status = notifyStatus();

    return NextResponse.json({
      ok: true,
      waiting: alerts.length,
      wouldSend: plan.send.length,
      skipped: plan.skipped,
      expired: plan.expired.length,
      // Said plainly rather than discovered when the run reports zero sent.
      mailConfigured: status.configured,
      preview: plan.send.slice(0, 20).map(({ alert, stock, price }) => ({
        id: alert.id,
        email: alert.email,
        kind: alert.kind,
        productId: alert.productId,
        colorId: alert.colorId ?? null,
        sizeId: alert.sizeId ?? null,
        stock,
        price,
      })),
    });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The sweep could not be read.", 500);
  }
}

/* -------------------------------------------------------------------------- */
/*  Send them                                                                 */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
  const allowed = await gate(request);
  if (allowed.error) return allowed.error;
  const caller = allowed.caller!;

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const { alerts, products } = await load(db);
    const plan = planSweep(alerts, products);
    const status = notifyStatus();

    let sent = 0;
    let failed = 0;

    for (const { alert, stock, price } of plan.send) {
      const product = products.get(alert.productId)!;
      const ref = db.collection("stockAlerts").doc(alert.id);

      /*
       * Marked before the message leaves.
       *
       * The other order — send, then mark — loses the record if the process
       * dies in between, and the next run mails the same person again. A
       * duplicate email is the failure customers actually punish; an alert
       * marked sent that was not is one person who does not hear, once.
       */
      await ref.set(
        { notifiedAt: Date.now(), notifiedPrice: price, notifiedStock: stock },
        { merge: true },
      );

      if (!status.configured) {
        // Nothing to send through. The alert is spent either way — see above.
        continue;
      }

      const label = variantLabel(product, alert);
      const message = alertMessage(alert, product, price, label);

      const result = await send({
        to: alert.email,
        subject: message.subject,
        body: message.body,
        locale: alert.locale,
      });

      if (result.ok) sent += 1;
      else {
        failed += 1;
        await ref.set({ error: result.error }, { merge: true });
      }
    }

    /*
     * Expired alerts are cleared in the same run. Left in place they are
     * re-read on every sweep forever, and a queue that only grows is one
     * nobody can read.
     */
    for (const alert of plan.expired) {
      await db.collection("stockAlerts").doc(alert.id).delete().catch(() => {});
    }

    await db.collection("auditLog").add({
      action: "alerts.sweep",
      waiting: alerts.length,
      sent,
      failed,
      cleared: plan.expired.length,
      mailConfigured: status.configured,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    return NextResponse.json({
      ok: true,
      persisted: true,
      waiting: alerts.length,
      sent,
      failed,
      cleared: plan.expired.length,
      skipped: plan.skipped,
      mailConfigured: status.configured,
      ...(status.configured
        ? {}
        : {
            note: "No mail provider is configured, so nothing was sent. The alerts were still marked, because re-running would otherwise mail everyone once a provider is added.",
          }),
    });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The sweep could not run.", 500);
  }
}

/** "White / M", from whatever the alert actually named. */
function variantLabel(product: Product, alert: StockAlert): string | undefined {
  const parts: string[] = [];
  if (alert.colorId) {
    const colour = product.colors?.find((candidate) => candidate.id === alert.colorId);
    parts.push(colour ? pick(colour.name, alert.locale) : alert.colorId);
  }
  if (alert.sizeId) {
    const size = product.sizes?.find((candidate) => candidate.id === alert.sizeId);
    parts.push(size?.label ?? alert.sizeId);
  }
  return parts.length > 0 ? parts.join(" / ") : undefined;
}
