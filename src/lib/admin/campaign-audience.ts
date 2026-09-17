import type { Locale } from "@/types";

/**
 * Who a campaign goes to.
 *
 * Two collections hold addresses and they mean different things:
 *
 *  - **`users`** — people with an account. `marketingOptIn` is a real consent:
 *    they were asked and they said yes.
 *  - **`subscribers`** — the newsletter box on the homepage. Somebody typed
 *    their address into a field labelled "newsletter", which is an intention,
 *    but `confirmed` is written `false` on create and **nothing in this
 *    codebase ever sets it true** — the double opt-in was left to a Cloud
 *    Function that does not exist. So the flag is reported as it is rather
 *    than treated as a confirmation that never happened.
 *
 * ## The suppression list is separate from both, on purpose
 *
 * When somebody unsubscribes, `users.marketingOptIn` is the obvious place to
 * write it — and it is not enough. The same address can be a subscriber row
 * *and* an account, the account may not exist yet, and a segment of "everyone
 * with an account" would walk straight past the flag anyway. So every
 * unsubscribe also writes a document to `unsubscribes`, keyed by the
 * lowercased address, and **every segment is filtered through it last**.
 *
 * One list, checked once, after the segment has been chosen. That is the only
 * arrangement where adding a new segment later cannot accidentally bypass it.
 */

/*
 * No `server-only` here, deliberately.
 *
 * The composer is a client component and it needs the labels, the notes and
 * the segment ids to render the audience picker. A module marked server-only
 * throws the moment it is pulled into a browser bundle, so the Firestore reads
 * live next door in `campaign-audience.server.ts` and this half stays pure —
 * which is also what makes the suppression rules testable without a database.
 */

export type SegmentId = "opted-in" | "subscribers" | "all-customers";

export interface Recipient {
  email: string;
  name?: string;
  locale: Locale;
  source: "account" | "subscriber";
}

export interface SegmentSummary {
  id: SegmentId;
  /** Addresses in the segment before suppression. */
  found: number;
  /** How many of those have unsubscribed. */
  suppressed: number;
  /** What would actually be sent. */
  sendable: number;
}

/** A working send, not a migration. Anything larger belongs in a real ESP. */
export const MAX_AUDIENCE = 5000;

/**
 * Normalise an address for comparison and for the suppression key.
 *
 * Lowercasing only. Stripping dots or `+tags` would be a guess about one
 * provider's rules applied to every provider, and the addresses that guess
 * gets wrong are the ones that silently never receive anything.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export function isPlausibleEmail(email: string): boolean {
  const value = normaliseEmail(email);
  return EMAIL.test(value) && value.length <= 254;
}

/**
 * Turn raw rows into a sendable list.
 *
 * Pure, and the reason it is pure: this is where a campaign either respects an
 * unsubscribe or does not, and that is worth being able to assert on without a
 * database.
 *
 * Order matters. Deduplication comes before suppression so that one address
 * held by both an account and a subscriber row is one recipient, and one
 * suppression check covers it — deduplicating afterwards could keep the copy
 * that happened not to match.
 */
export function resolveAudience(
  candidates: Recipient[],
  suppressed: Iterable<string>,
): { recipients: Recipient[]; found: number; suppressedCount: number } {
  const blocked = new Set([...suppressed].map(normaliseEmail));

  const byEmail = new Map<string, Recipient>();
  for (const candidate of candidates) {
    if (!isPlausibleEmail(candidate.email)) continue;
    const key = normaliseEmail(candidate.email);
    /*
     * An account wins over a subscriber row for the same address: it carries a
     * name and a chosen locale, and the subscriber row carries neither.
     */
    const existing = byEmail.get(key);
    if (!existing || (existing.source === "subscriber" && candidate.source === "account")) {
      byEmail.set(key, { ...candidate, email: key });
    }
  }

  const found = byEmail.size;
  const recipients: Recipient[] = [];
  for (const [key, recipient] of byEmail) {
    if (blocked.has(key)) continue;
    recipients.push(recipient);
  }

  return { recipients, found, suppressedCount: found - recipients.length };
}

/** What each segment is, in the operator's own language. */
export const SEGMENT_LABELS: Record<SegmentId, Record<Locale, string>> = {
  "opted-in": {
    en: "Customers who opted in",
    ar: "العملاء الموافقون على التسويق",
  },
  subscribers: {
    en: "Newsletter subscribers",
    ar: "مشتركو النشرة البريدية",
  },
  "all-customers": {
    en: "Every customer with an account",
    ar: "كل عميل لديه حساب",
  },
};

/**
 * The sentence under each segment.
 *
 * `all-customers` says what it is plainly rather than being quietly offered
 * alongside the others. Somebody who bought a coat did not ask for a
 * newsletter, and whether to send to them anyway is the merchant's decision to
 * make knowingly — not one to slide past them in a dropdown.
 */
export const SEGMENT_NOTES: Record<SegmentId, Record<Locale, string>> = {
  "opted-in": {
    en: "They ticked the marketing box on their account. The safe default.",
    ar: "وافقوا على التسويق في حساباتهم. الخيار الآمن.",
  },
  subscribers: {
    en: "They typed their address into the newsletter box. Nothing in the shop confirms these addresses yet, so treat it as single opt-in.",
    ar: "أدخلوا بريدهم في خانة النشرة البريدية. لا يوجد في المتجر ما يؤكد هذه العناوين بعد، فاعتبرها موافقة واحدة غير مؤكدة.",
  },
  "all-customers": {
    en: "Including people who never asked for marketing. Legal exposure and spam complaints both start here.",
    ar: "بما فيهم من لم يطلب رسائل تسويقية. المسؤولية القانونية وشكاوى الإزعاج تبدأ من هنا.",
  },
};
