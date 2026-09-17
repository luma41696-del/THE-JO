import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import {
  canAppend,
  canOpenTicket,
  cleanMessage,
  cleanSubject,
  isTopic,
  millis,
  statusAfterCustomerMessage,
  subjectFrom,
  ticketReference,
} from "@/lib/support";
import type { Locale, SupportTicket, TicketMessage, TicketTopic } from "@/types";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

/**
 * The customer's side of a support conversation.
 *
 * Until now there was only staff's side: `/api/admin/support` could reply to a
 * ticket, and nothing in the shop could create one or read one back. Support
 * was a room with a microphone and no door.
 *
 * Writes go through this route rather than from the browser, for the same
 * reason staff replies do. A client with write access to its own ticket could
 * set `fromStaff: true` on a message and forge an answer from the shop, edit
 * what support actually said, or mark its own complaint resolved. None of that
 * is reachable here: the server decides the author, the timestamps, the
 * reference and the status, and the only thing taken from the request is the
 * text of the message itself.
 *
 * Reads are here too, rather than an `onSnapshot` in the browser, which keeps
 * ~190KB of Firestore out of the bundle for a page most visitors never open.
 * The thread refreshes on a short poll while it is on screen — see
 * `SupportChat`. That is slower than a live socket and honest about it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  ticketId?: string;
  body?: string;
  subject?: string;
  topic?: TicketTopic;
  orderReference?: string;
  locale?: Locale;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Only what a customer may see of their own thread. */
function publicTicket(id: string, data: Record<string, unknown>): SupportTicket {
  const messages = Array.isArray(data.messages) ? (data.messages as TicketMessage[]) : [];
  return {
    id,
    reference: String(data.reference ?? ""),
    uid: (data.uid as string) ?? null,
    customerName: String(data.customerName ?? ""),
    email: String(data.email ?? ""),
    subject: String(data.subject ?? ""),
    topic: (data.topic as SupportTicket["topic"]) ?? "other",
    status: (data.status as SupportTicket["status"]) ?? "open",
    priority: (data.priority as SupportTicket["priority"]) ?? "normal",
    ...(data.orderReference ? { orderReference: String(data.orderReference) } : {}),
    messages: messages.map((message) => ({
      id: String(message.id),
      // `assignedTo` and the staff uid stay on the server: a customer needs to
      // know an answer came from support, not which person wrote it.
      authorId: message.fromStaff ? "support" : String(message.authorId),
      authorName: String(message.authorName ?? ""),
      fromStaff: Boolean(message.fromStaff),
      body: String(message.body ?? ""),
      at: millis(message.at),
    })),
    createdAt: millis(data.createdAt),
    updatedAt: millis(data.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/*  Read                                                                      */
/* -------------------------------------------------------------------------- */

export async function GET(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, tickets: [], persisted: false });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const snap = await getAdminDb()
      .collection("tickets")
      .where("uid", "==", caller.uid)
      .limit(50)
      .get();

    /*
     * Sorted here rather than in the query. `where` plus `orderBy` on two
     * different fields needs a composite index, and one index per screen is
     * how a deploy starts failing on a query nobody changed. Fifty rows sort
     * in microseconds.
     */
    const tickets = snap.docs
      .map((doc) => publicTicket(doc.id, doc.data()))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return NextResponse.json({ ok: true, tickets });
  } catch {
    return bad("Your conversations could not be loaded.", 500);
  }
}

/* -------------------------------------------------------------------------- */
/*  Write                                                                     */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
  /*
   * Counted before the body is read. A flood should cost this route a
   * transaction, not a JSON parse of whatever the caller felt like sending.
   */
  const limit = await rateLimit(`support:${callerKey(request)}`, RULES.messaging);
  if (!limit.ok) return tooManyRequests(limit);
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  const message = cleanMessage(body.body);
  if (!message) return bad("Write a message first.");

  const locale: Locale = body.locale === "ar" ? "ar" : "en";
  const topic: TicketTopic = isTopic(body.topic) ? body.topic : "other";
  const ticketId = String(body.ticketId ?? "").trim();

  if (!isAdminConfigured()) {
    /*
     * Nothing was stored, and the customer is told so. A contact form that
     * quietly drops a message is worse than no contact form: the customer
     * believes they have asked, and waits.
     */
    return NextResponse.json({
      ok: false,
      error: "Support is not available in this environment — nothing was sent.",
      persisted: false,
    });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Sign in to message support.", 401);

  try {
    const { getAdminDb, getAdminAuth } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const now = Date.now();

    // The account's own name, from Firebase rather than from the request. A
    // display name taken from the body is a display name an attacker chooses.
    const account = await getAdminAuth()
      .getUser(caller.uid)
      .catch(() => null);
    const customerName = account?.displayName?.trim() || (caller.email ?? "Customer");
    const email = account?.email ?? caller.email ?? "";

    /* ---- an existing thread ------------------------------------------- */

    if (ticketId) {
      const ref = db.collection("tickets").doc(ticketId);

      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { error: "That conversation no longer exists." };

        const data = snap.data() ?? {};
        // The ownership check is inside the transaction and against the stored
        // uid — the only thing that makes this a *private* thread.
        if (data.uid !== caller.uid) return { error: "That conversation is not yours." };

        const messages = Array.isArray(data.messages) ? [...(data.messages as TicketMessage[])] : [];
        const room = canAppend(messages.length);
        if (!room.ok) return { error: room.message[locale] };

        messages.push({
          id: `${now}-${caller.uid.slice(0, 6)}`,
          authorId: caller.uid,
          authorName: customerName,
          fromStaff: false,
          body: message,
          at: now,
        });

        tx.update(ref, {
          messages,
          status: statusAfterCustomerMessage(),
          updatedAt: now,
        });

        return { ok: true as const, reference: String(data.reference ?? "") };
      });

      if ("error" in result && result.error) return bad(result.error, 403);
      return NextResponse.json({ ok: true, persisted: true, ticketId, at: now });
    }

    /* ---- a new thread -------------------------------------------------- */

    /*
     * Counted from an equality query on `uid` alone and filtered here, rather
     * than `where uid == … and status in [...]`, which is a composite index —
     * and an index that exists only for a rate limit is an index that fails a
     * deploy one day for a query nobody remembers needing.
     */
    const mine = await db.collection("tickets").where("uid", "==", caller.uid).limit(50).get();
    const openCount = mine.docs.filter((doc) => {
      const status = doc.data().status;
      return status === "open" || status === "pending";
    }).length;

    const allowed = canOpenTicket(openCount);
    if (!allowed.ok) return bad(allowed.message[locale], 429);

    const ref = db.collection("tickets").doc();
    const subject = cleanSubject(body.subject) || subjectFrom(message, topic, locale);
    const orderReference = cleanSubject(body.orderReference);

    const first: TicketMessage = {
      id: `${now}-${caller.uid.slice(0, 6)}`,
      authorId: caller.uid,
      authorName: customerName,
      fromStaff: false,
      body: message,
      at: now,
    };

    await ref.set({
      reference: ticketReference(ref.id),
      uid: caller.uid,
      customerName,
      email,
      subject,
      topic,
      status: "open",
      // Priority is support's call, not the customer's. Letting the person
      // reporting the problem set "urgent" makes the field mean nothing.
      priority: "normal",
      ...(orderReference ? { orderReference } : {}),
      messages: [first],
      // Numbers, not `Date`s: `SupportTicket` declares them as numbers, the
      // admin list orders on `updatedAt`, and a collection holding both types
      // sorts by type before value.
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      ok: true,
      persisted: true,
      ticketId: ref.id,
      reference: ticketReference(ref.id),
      at: now,
    });
  } catch {
    return bad("Your message could not be sent. Please try again.", 500);
  }
}

