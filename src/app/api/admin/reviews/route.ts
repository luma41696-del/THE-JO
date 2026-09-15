import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { revalidateCatalogue } from "@/lib/revalidate";
import type { ReviewStatus } from "@/types";

/**
 * Review moderation.
 *
 * What staff may do: publish, hide with a reason, and reply in the shop's own
 * voice.
 *
 * What staff may **not** do, and what this route therefore refuses to accept:
 * change the rating, change the body, or change the author. A moderation tool
 * that can rewrite a two-star review into a five-star one is not moderation —
 * it turns the whole rating into something the shop wrote about itself, and
 * every genuine review on the site becomes unfalsifiable.
 *
 * Hiding keeps the document. The author can still see their own review and
 * the reason it was held, which is the difference between moderation and
 * silent deletion.
 */

interface Body {
  id?: string;
  status?: ReviewStatus;
  moderationNote?: string;
  reply?: string | null;
}

const STATUSES: ReviewStatus[] = ["published", "pending", "hidden"];
const MAX_NOTE = 500;
const MAX_REPLY = 1500;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function PATCH(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  const id = String(body.id ?? "").trim();
  if (!id) return bad("A review id is required.");

  const status = STATUSES.includes(body.status as ReviewStatus)
    ? (body.status as ReviewStatus)
    : null;
  const note =
    typeof body.moderationNote === "string"
      ? body.moderationNote.trim().slice(0, MAX_NOTE)
      : null;
  const reply =
    body.reply === null
      ? null
      : typeof body.reply === "string"
        ? body.reply.trim().slice(0, MAX_REPLY)
        : undefined;

  if (status === null && note === null && reply === undefined) {
    return bad("Nothing to change.");
  }

  /*
   * Hiding without a reason is how a moderation queue becomes unaccountable.
   * The note is shown to the author, so it has to exist and has to say
   * something.
   */
  if (status === "hidden" && (!note || note.length < 3)) {
    return bad("Give a reason when hiding a review — the author is shown it.");
  }

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false, validated: { id, status } });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to moderate reviews.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const ref = db.collection("reviews").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return bad("That review no longer exists.", 404);

    const before = snap.data() ?? {};
    const now = Date.now();

    await ref.update({
      /*
       * Note the fields that are absent: `rating`, `body`, `title`,
       * `authorName`. They are not read from the request at all, so a client
       * that sends them changes nothing — the customer's words stay theirs.
       */
      ...(status ? { status } : {}),
      ...(note === null ? {} : { moderationNote: note }),
      ...(reply === undefined
        ? {}
        : reply === null || reply === ""
          ? { reply: null }
          : {
              reply: {
                body: reply,
                // Attributed to the shop, not to the individual member of
                // staff: a customer is answered by net sale, and naming an
                // employee exposes them personally to whatever follows.
                authorName: "net sale",
                at: now,
              },
            }),
      ...(status ? { moderatedBy: caller.uid, moderatedAt: now } : {}),
      updatedAt: now,
    });

    await db.collection("auditLog").add({
      action: "review.moderate",
      reviewId: id,
      productId: before.productId ?? null,
      from: before.status ?? null,
      to: status ?? before.status ?? null,
      hasReply: reply !== undefined && reply !== null && reply !== "",
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    /*
     * Any status change moves the average, because the average is computed
     * from published reviews only. Revalidating here is what keeps the number
     * on the product page and the number in the structured data agreeing with
     * the list underneath them.
     */
    if (status) revalidateCatalogue();

    return NextResponse.json({ ok: true, persisted: true, id, status });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The review could not be updated.", 500);
  }
}
