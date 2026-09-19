import "server-only";

import { expiryFor } from "@/lib/loyalty";
import {
  DEFAULT_EARN_RULES,
  earnKey,
  sanitiseRules,
  type EarnRules,
  type EarnSource,
} from "@/lib/loyalty-earning";

/**
 * Paying points, and reading what they are worth.
 *
 * One function writes an award, and every source goes through it. The
 * alternative — each feature writing its own ledger entry — is four places to
 * get the expiry wrong and four places to forget the idempotency key, and the
 * one that forgets is the one that pays twice.
 */

type Db = FirebaseFirestore.Firestore;

/* -------------------------------------------------------------------------- */
/*  The rules                                                                 */
/* -------------------------------------------------------------------------- */

const TTL_MS = 60_000;
let cached: { rules: EarnRules; readAt: number } | null = null;

/** Clear the cache in the instance that just changed the settings. */
export function invalidateEarnRules(): void {
  cached = null;
}

/**
 * The shop's current earning rules.
 *
 * Cached for a minute: this is read on every checkout and every review, and
 * it changes when a merchant edits a form. Falls back to the defaults on any
 * failure — a settings read that fails must not stop a customer being paid
 * for the order they just placed.
 */
export async function getEarnRules(db: Db): Promise<EarnRules> {
  if (cached && Date.now() - cached.readAt < TTL_MS) return cached.rules;

  try {
    const snap = await db.collection("settings").doc("loyalty").get();
    const rules = sanitiseRules(snap.data());
    cached = { rules, readAt: Date.now() };
    return rules;
  } catch (error) {
    console.error("[net sale] could not read the loyalty rules; using defaults:", error);
    return DEFAULT_EARN_RULES;
  }
}

/* -------------------------------------------------------------------------- */
/*  Paying                                                                    */
/* -------------------------------------------------------------------------- */

export interface AwardInput {
  uid: string;
  source: EarnSource;
  /** The thing being paid for: a review id, a referred uid, a play id. */
  sourceId: string;
  points: number;
  /** Shown in the customer's history. */
  note?: string;
  now?: number;
}

/**
 * The ledger entry for an award, ready to write.
 *
 * Separated from the writing so a caller already inside a transaction — the
 * checkout is — can add it to theirs rather than opening a second one.
 */
export function awardEntry({
  uid,
  source,
  sourceId,
  points,
  note,
  now = Date.now(),
}: AwardInput): { docId: string; data: Record<string, unknown> } {
  return {
    docId: earnKey(source, sourceId),
    data: {
      uid,
      kind: "earn" as const,
      points,
      at: now,
      expiresAt: expiryFor(now),
      source,
      sourceId,
      ...(note ? { note } : {}),
    },
  };
}

/**
 * Pay somebody, once.
 *
 * `create` rather than `set`: writing the same award twice is not an update to
 * be merged, it is a mistake to be refused. A moderator approving a review
 * that was already approved, a retried request, a replayed job — all of them
 * land here, and all of them must leave the balance where it was.
 *
 * Returns whether this call was the one that paid. Never throws for a repeat;
 * a duplicate is the system working.
 */
export async function award(db: Db, input: AwardInput): Promise<boolean> {
  if (input.points <= 0) return false;

  const entry = awardEntry(input);
  const ref = db
    .collection("loyalty")
    .doc(input.uid)
    .collection("entries")
    .doc(entry.docId);

  try {
    await ref.create(entry.data);
    return true;
  } catch (error) {
    /*
     * `ALREADY_EXISTS` is the expected outcome of a repeat and is not an
     * error worth raising. Anything else is, and is logged with the key rather
     * than swallowed — a write failing for a real reason would otherwise look
     * exactly like a duplicate.
     */
    const code = (error as { code?: number | string }).code;
    if (code === 6 || code === "already-exists") return false;
    console.error(`[net sale] could not award ${entry.docId} to ${input.uid}:`, error);
    return false;
  }
}
