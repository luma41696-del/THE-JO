import { messageFor } from "@/lib/notify/templates";
import { notifyStatus, send } from "@/lib/notify/provider";
import type { Notification, NotificationEvent, Order } from "@/types";
import type { StoreSettings } from "@/data/site-content";

/**
 * Queue, send, and record.
 *
 * The important property is **once per order per event**. An operator moving an
 * order back and forth, a retried request, a double-click — none of them should
 * put a second "your order shipped" in somebody's inbox. The document id is
 * derived from the order and the event, so a repeat is a write to the same
 * document rather than a second message.
 *
 * The record is written **before** the attempt and updated after. If the
 * process dies mid-send the notification is left `queued` with its attempt
 * counted, which is recoverable and visible; recording only on success would
 * leave no trace of a message that may well have gone out.
 */

type Db = FirebaseFirestore.Firestore;

/** Deterministic id: one document per order per event. */
export function notificationId(orderId: string, event: NotificationEvent): string {
  return `${orderId}__${event}`;
}

export interface NotifyResult {
  notification: Notification | null;
  /** False when this event had already been handled for this order. */
  fresh: boolean;
}

/**
 * Notify the customer about one event on their order.
 *
 * Never throws. A notification failure must not roll back the status change
 * that triggered it — the warehouse has already acted on it, and an operator
 * being shown a 500 would retry a transition that already happened.
 */
export async function notifyOrder(
  db: Db,
  order: Order,
  event: NotificationEvent,
  settings: StoreSettings,
  at = Date.now(),
): Promise<NotifyResult> {
  const id = notificationId(order.id, event);
  const ref = db.collection("notifications").doc(id);

  try {
    const existing = await ref.get();
    if (existing.exists) {
      const current = existing.data() as Notification;
      // Already sent or deliberately skipped: nothing more to do. A failed one
      // may be retried, which is the only reason to fall through.
      if (current.state === "sent" || current.state === "skipped") {
        return { notification: { ...current, id }, fresh: false };
      }
    }

    const locale = order.locale ?? "en";
    const message = messageFor(event, order, settings, locale);
    if (!message) return { notification: null, fresh: false };

    const attempts = ((existing.data() as Notification | undefined)?.attempts ?? 0) + 1;
    const status = notifyStatus();

    const base: Notification = {
      id,
      orderId: order.id,
      orderReference: order.reference,
      event,
      channel: "email",
      to: order.email,
      locale,
      subject: message.subject,
      state: status.configured ? "queued" : "skipped",
      attempts,
      queuedAt: at,
      ...(status.configured
        ? {}
        : { error: `No mail provider configured (missing ${status.missing.join(", ")}).` }),
    };

    // Written first, so a crash mid-send leaves a visible record rather than
    // silence about a message that may already have left.
    await ref.set(base, { merge: true });

    if (!status.configured) {
      /*
       * `skipped`, not `failed`. The shop has no channel — that is a setup
       * task, not a delivery problem, and collapsing the two would bury an
       * unconfigured provider in a list of bounces.
       */
      return { notification: base, fresh: true };
    }

    const result = await send({
      to: order.email,
      subject: message.subject,
      body: message.body,
      locale,
    });

    const settled: Notification = result.ok
      ? { ...base, state: "sent", sentAt: Date.now() }
      : { ...base, state: "failed", error: result.error };

    await ref.set(settled, { merge: true });
    return { notification: settled, fresh: true };
  } catch (error) {
    // Even the bookkeeping failing must not take the caller down with it.
    console.error("[notify] could not record", id, error);
    return { notification: null, fresh: false };
  }
}

/** Every notification for one order, newest first — for the admin's log. */
export async function notificationsForOrder(db: Db, orderId: string): Promise<Notification[]> {
  const snap = await db.collection("notifications").where("orderId", "==", orderId).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as Notification), id: d.id }))
    .sort((a, b) => b.queuedAt - a.queuedAt);
}
