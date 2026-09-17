import "server-only";

import {
  MAX_AUDIENCE,
  type Recipient,
  type SegmentId,
} from "@/lib/admin/campaign-audience";
import type { Locale } from "@/types";

/**
 * Reading the audience out of Firestore.
 *
 * Split from `campaign-audience.ts` so that file can stay pure and be imported
 * by the composer, which runs in a browser. Everything here takes a `db`
 * handle and returns rows; deciding who is actually sent to is the pure half's
 * job, and keeping the two apart is what lets the suppression rules be
 * asserted on without a database.
 */

/**
 * Every address that has unsubscribed.
 *
 * The list every segment is filtered through, read whole. It is small by
 * nature — it only grows when somebody opts out — and reading it in one go is
 * what lets the filtering be a pure function.
 */
export async function readSuppressed(db: FirebaseFirestore.Firestore): Promise<string[]> {
  const snap = await db.collection("unsubscribes").get();
  return snap.docs.map((doc) => doc.id);
}

/**
 * The candidates for one segment, before suppression.
 *
 * Capped at `MAX_AUDIENCE`. A shop with more addresses than this has outgrown
 * sending from its own app, and a silent partial read would be worse than a
 * stated ceiling.
 */
export async function readSegment(
  db: FirebaseFirestore.Firestore,
  segment: SegmentId,
): Promise<Recipient[]> {
  if (segment === "subscribers") {
    const snap = await db.collection("subscribers").limit(MAX_AUDIENCE).get();
    return snap.docs.map((doc) => {
      const data = doc.data() as { email?: string; locale?: Locale };
      return {
        email: data.email ?? doc.id,
        locale: data.locale === "en" ? ("en" as const) : ("ar" as const),
        source: "subscriber" as const,
      };
    });
  }

  /*
   * `opted-in` is a real consent and is queried for. `all-customers` is every
   * account, and the difference between them is the whole reason the segment
   * is a choice rather than a default.
   */
  const query =
    segment === "opted-in"
      ? db.collection("users").where("marketingOptIn", "==", true)
      : db.collection("users");

  const snap = await query.limit(MAX_AUDIENCE).get();
  return snap.docs
    .map((doc) => {
      const data = doc.data() as {
        email?: string | null;
        displayName?: string | null;
        locale?: Locale;
      };
      return {
        email: data.email ?? "",
        name: data.displayName ?? undefined,
        locale: data.locale === "en" ? ("en" as const) : ("ar" as const),
        source: "account" as const,
      };
    })
    .filter((recipient) => recipient.email);
}

/** The order the composer shows them in: safest first. */
export const SEGMENTS: SegmentId[] = ["opted-in", "subscribers", "all-customers"];
