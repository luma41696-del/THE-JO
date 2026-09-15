import type { Locale, Localized, TicketStatus, TicketTopic } from "@/types";

/**
 * The rules of a support conversation.
 *
 * Support existed as an inbox with nobody able to write to it: staff could
 * reply, and a customer had no surface at all — no way to open a ticket, no
 * way to read an answer, no way to say "that did not fix it". A reply nobody
 * can receive is a reply nobody sent.
 *
 * Everything decidable without a database lives here so it can be tested
 * exhaustively: what counts as a message, when a thread reopens, and how many
 * threads one person may have going. The route applies these; it does not
 * re-decide them.
 */

/* -------------------------------------------------------------------------- */
/*  Limits                                                                    */
/* -------------------------------------------------------------------------- */

/** Long enough for a real problem, short enough not to be an upload channel. */
export const MAX_MESSAGE = 4_000;

/** Enough for a subject line; anything longer is the message, not the title. */
export const MAX_SUBJECT = 140;

/**
 * Threads one account may have unanswered at once.
 *
 * Not a spam defence — App Check and a verified token already cost an attacker
 * more than this does. It is a *support* limit: five open threads from one
 * person is a sign they should be in one thread, and a queue full of duplicates
 * is how the sixth person waits a day.
 */
export const MAX_OPEN_TICKETS = 5;

/** A thread this long has stopped being a thread. */
export const MAX_MESSAGES = 200;

export const TOPICS: TicketTopic[] = [
  "delivery",
  "returns",
  "sizing",
  "payment",
  "product",
  "other",
];

export const TOPIC_LABELS: Record<TicketTopic, Localized> = {
  delivery: { en: "Delivery", ar: "التوصيل" },
  returns: { en: "Returns", ar: "الإرجاع" },
  sizing: { en: "Sizing", ar: "المقاسات" },
  payment: { en: "Payment", ar: "الدفع" },
  product: { en: "A product", ar: "منتج" },
  other: { en: "Something else", ar: "شيء آخر" },
};

export const STATUS_LABELS: Record<TicketStatus, Localized> = {
  open: { en: "With support", ar: "لدى الدعم" },
  pending: { en: "Replied", ar: "تم الرد" },
  resolved: { en: "Resolved", ar: "تم الحل" },
  closed: { en: "Closed", ar: "مغلقة" },
};

export function topicLabel(topic: TicketTopic, locale: Locale): string {
  return (TOPIC_LABELS[topic] ?? TOPIC_LABELS.other)[locale];
}

export function statusLabel(status: TicketStatus, locale: Locale): string {
  return (STATUS_LABELS[status] ?? STATUS_LABELS.open)[locale];
}

export function isTopic(value: unknown): value is TicketTopic {
  return typeof value === "string" && TOPICS.includes(value as TicketTopic);
}

/* -------------------------------------------------------------------------- */
/*  Reading what the database gives back                                      */
/* -------------------------------------------------------------------------- */

/**
 * Epoch milliseconds, whatever shape the value arrived in.
 *
 * Firestore hands back a `Timestamp` for a field written as a `Date`, a number
 * for one written as a number, and the two are not interchangeable: the reply
 * route computed `Number(data.createdAt)` on a field the same codebase wrote
 * as a `Date`, which is `NaN` — and a first-response time of `NaN` is a metric
 * that silently stops existing.
 *
 * Tickets are written with numbers from here on, and this reads the ones that
 * were not.
 */
export function millis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object") {
    const record = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof record.toMillis === "function") return record.toMillis();
    const seconds = record.seconds ?? record._seconds;
    if (typeof seconds === "number") return seconds * 1000;
  }
  return 0;
}

/* -------------------------------------------------------------------------- */
/*  Conversation rules                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Where a thread lands after the customer writes in it.
 *
 * Always `open`, including from `resolved` and `closed`. A customer replying
 * to a thread support considered finished is the clearest signal there is that
 * it was not finished, and making them open a second ticket to say so loses
 * the history that explains the problem.
 */
export function statusAfterCustomerMessage(): TicketStatus {
  return "open";
}

/** A customer's message is theirs; this only trims and caps it. */
export function cleanMessage(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, MAX_MESSAGE);
}

export function cleanSubject(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SUBJECT);
}

/**
 * A subject line drawn from the message, for a customer who did not write one.
 *
 * Asking for a title before someone can report a problem is a small tax on the
 * person already having a bad day. The first line of what they wrote is a
 * better title than "No subject" and costs them nothing.
 */
export function subjectFrom(message: string, topic: TicketTopic, locale: Locale): string {
  const firstLine = message.split("\n")[0]?.trim() ?? "";
  if (firstLine.length >= 3) {
    return firstLine.length > 72 ? `${firstLine.slice(0, 69).trimEnd()}…` : firstLine;
  }
  return topicLabel(topic, locale);
}

export type OpenRefusal = "empty" | "too-many-open" | "too-long";

/** May this account open another thread? */
export function canOpenTicket(openTickets: number): {
  ok: boolean;
  reason?: OpenRefusal;
  message: Localized;
} {
  if (openTickets >= MAX_OPEN_TICKETS) {
    return {
      ok: false,
      reason: "too-many-open",
      message: {
        en: `You already have ${MAX_OPEN_TICKETS} conversations open. Please continue in one of them.`,
        ar: `لديك ${MAX_OPEN_TICKETS} محادثات مفتوحة. تابع في إحداها من فضلك.`,
      },
    };
  }
  return { ok: true, message: { en: "", ar: "" } };
}

/** May this thread take another message? */
export function canAppend(messageCount: number): {
  ok: boolean;
  message: Localized;
} {
  if (messageCount >= MAX_MESSAGES) {
    return {
      ok: false,
      message: {
        en: "This conversation has run long. Please start a new one.",
        ar: "طالت هذه المحادثة. ابدأ محادثة جديدة من فضلك.",
      },
    };
  }
  return { ok: true, message: { en: "", ar: "" } };
}

/* -------------------------------------------------------------------------- */
/*  References                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A reference a customer can read down a phone line.
 *
 * Derived from the document id rather than counted, because unlike an invoice
 * number a ticket reference carries no legal weight — it only has to be
 * unique, short, and unambiguous when spoken. Counting would mean a second
 * transaction on a shared document, which is contention bought for nothing.
 *
 * Excludes I, O, 0 and 1, for the same reason `giftCode` does.
 */
export function ticketReference(docId: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let hash = 2166136261;
  for (let i = 0; i < docId.length; i += 1) {
    hash ^= docId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let n = Math.abs(hash);
  let out = "";
  for (let i = 0; i < 5; i += 1) {
    out += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length);
  }
  return `SUP-${out}`;
}
