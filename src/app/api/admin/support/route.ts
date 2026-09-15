import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { millis } from "@/lib/support";
import type { SupportTicket, TicketMessage, TicketStatus } from "@/types";

/**
 * Support replies.
 *
 * The admin's reply box used to be optimistic-only — it appended the message to
 * local state and returned, with a comment promising a Cloud Function that was
 * never written. Staff saw their reply on screen, the customer never received
 * it, and a refresh erased it. This is the write path.
 *
 * Replies are appended inside a transaction rather than with `arrayUnion`,
 * because the ticket's `status` and `firstResponseMinutes` have to move with
 * the message: two staff replying at once would otherwise each compute a first
 * response time from the same stale read.
 */

interface Body {
  ticketId?: string;
  body?: string;
  status?: TicketStatus;
}

/**
 * The inbox, re-read.
 *
 * The board is server-rendered, which was fine when only staff could write to
 * a ticket: nothing changed unless the person looking at it changed something.
 * Now the customer can write too, so a thread left open on screen goes stale
 * the moment they answer. This is what the board polls while it is in front.
 */
export async function GET(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, tickets: [], persisted: false });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to read tickets.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const snap = await getAdminDb().collection("tickets").limit(500).get();

    const tickets = snap.docs
      .map((doc) => {
        const data = doc.data();
        const messages = Array.isArray(data.messages) ? (data.messages as TicketMessage[]) : [];
        return {
          ...(data as SupportTicket),
          id: doc.id,
          // Tickets are written with epoch numbers now; anything older holds a
          // Timestamp, which does not survive JSON in a usable shape.
          createdAt: millis(data.createdAt),
          updatedAt: millis(data.updatedAt),
          messages: messages.map((message) => ({ ...message, at: millis(message.at) })),
        } as SupportTicket;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return NextResponse.json({ ok: true, tickets });
  } catch {
    return bad("The inbox could not be read.", 500);
  }
}

const STATUSES: TicketStatus[] = ["open", "pending", "resolved", "closed"];
const MAX_BODY = 4000;

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

  const ticketId = String(body.ticketId ?? "").trim();
  if (!ticketId) return bad("A ticket id is required.");

  const message = String(body.body ?? "").trim();
  const statusChange = STATUSES.includes(body.status as TicketStatus)
    ? (body.status as TicketStatus)
    : null;

  if (!message && !statusChange) return bad("Nothing to send.");
  if (message.length > MAX_BODY) return bad(`A reply is limited to ${MAX_BODY} characters.`);

  if (!isAdminConfigured()) {
    return NextResponse.json({
      ok: true,
      persisted: false,
      note:
        "Firebase Admin is not configured, so nothing was written. The reply was " +
        "validated but not stored or sent.",
    });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to answer tickets.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const ref = db.collection("tickets").doc(ticketId);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("That ticket no longer exists.");

      const data = snap.data() ?? {};
      const now = Date.now();
      const messages = Array.isArray(data.messages) ? [...data.messages] : [];

      if (message) {
        messages.push({
          id: `${now}-${caller.uid.slice(0, 6)}`,
          authorId: caller.uid,
          authorName: caller.email ?? "Support",
          fromStaff: true,
          body: message,
          at: now,
        });
      }

      /*
       * First response time is the metric support is actually judged on, so it
       * is stamped once and never overwritten — a second reply must not reset
       * it, and a slow first reply must not be hidden by a fast second one.
       */
      /*
       * `millis`, not `Number`. Tickets carry epoch numbers, but one written
       * before that was settled holds a Firestore `Timestamp`, and
       * `Number(timestamp)` is NaN — which would stamp NaN into the single
       * metric support is judged on, silently and permanently.
       */
      const createdAt = millis(data.createdAt) || now;
      const firstResponseMinutes =
        typeof data.firstResponseMinutes === "number"
          ? data.firstResponseMinutes
          : message
            ? Math.max(0, Math.round((now - createdAt) / 60_000))
            : undefined;

      const nextStatus = statusChange ?? (message ? "pending" : (data.status as TicketStatus));

      tx.update(ref, {
        ...(message ? { messages } : {}),
        status: nextStatus,
        ...(firstResponseMinutes === undefined ? {} : { firstResponseMinutes }),
        // A number, matching `SupportTicket` and the customer's own route. A
        // field holding both numbers and Timestamps sorts by type before
        // value, which would scramble the order of the inbox.
        updatedAt: now,
      });

      return { status: nextStatus, at: now };
    });

    await db.collection("auditLog").add({
      action: message ? "ticket.reply" : "ticket.status",
      ticketId,
      status: result.status,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    return NextResponse.json({
      ok: true,
      persisted: true,
      status: result.status,
      at: result.at,
      /*
       * Emailing the customer needs a transactional provider that is not
       * configured yet. Saying so is the point: the reply *is* stored and will
       * show in the customer's ticket view, but nothing has left the building,
       * and staff must not assume it has.
       */
      delivered: false,
      deliveryNote:
        "Saved to the ticket. No email was sent — no transactional email provider is configured.",
    });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "The reply could not be saved.",
      500,
    );
  }
}
