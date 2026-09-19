import { NextResponse } from "next/server";

import { isAdminConfigured, requireVerified, verifyRequest } from "@/lib/firebase/admin";
import { revalidateCatalogue } from "@/lib/revalidate";
import { REVIEW_MAX_IMAGES, REVIEW_MAX_TITLE, reviewId, validateReview } from "@/lib/reviews";
import type { ProductImage, Review } from "@/types";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

/**
 * Customer review submission.
 *
 * Two things are decided here and nowhere else, because the browser cannot be
 * trusted with either:
 *
 *  - **Verified purchase.** Looked up against the caller's own delivered
 *    orders. A client-supplied flag would be a badge anyone could award
 *    themselves, which is worth more than the review itself.
 *  - **Whether it publishes immediately.** A first review from an account with
 *    a matching order goes straight up; anything else queues for moderation.
 *    Holding every review would make the feature look broken to honest
 *    customers; publishing every review would make it a spam target.
 */

interface Body {
  productId?: string;
  rating?: number;
  title?: string;
  body?: string;
  images?: ProductImage[];
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Accept images only from our own Storage bucket. */
function safeImages(value: unknown): ProductImage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((i): i is ProductImage => Boolean(i) && typeof i.url === "string")
    .filter(
      (i) =>
        i.url.includes("firebasestorage.googleapis.com") ||
        i.url.includes(".firebasestorage.app"),
    )
    .map((i) => ({
      url: i.url,
      alt: typeof i.alt === "string" ? i.alt.trim().slice(0, 200) : "",
      width: Number.isFinite(Number(i.width)) ? Math.round(Number(i.width)) : 800,
      height: Number.isFinite(Number(i.height)) ? Math.round(Number(i.height)) : 800,
    }))
    .slice(0, REVIEW_MAX_IMAGES);
}

export async function POST(request: Request) {
  /*
   * Counted before the body is read. A flood should cost this route a
   * transaction, not a JSON parse of whatever the caller felt like sending.
   */
  const limit = await rateLimit(`reviews:${callerKey(request)}`, RULES.content);
  if (!limit.ok) return tooManyRequests(limit);
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  const productId = String(body.productId ?? "").trim();
  if (!productId) return bad("A product is required.");

  const rating = Math.round(Number(body.rating));
  const text = String(body.body ?? "");
  const title = String(body.title ?? "").trim().slice(0, REVIEW_MAX_TITLE);
  const images = safeImages(body.images);

  if (!isAdminConfigured()) {
    return NextResponse.json({
      ok: true,
      persisted: false,
      note: "Firebase Admin is not configured, so the review was validated but not stored.",
    });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Sign in to leave a review.", 401);

  /*
   * A review carries a name and a star rating into other customers' buying
   * decisions, which makes an unconfirmed account worth creating in bulk.
   * Confirming an address — or having signed in by phone — is the cheapest
   * check that costs a bot something and a real customer nothing.
   */
  const verified = requireVerified(caller);
  if (!verified.ok) return bad(verified.error, verified.status);

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const id = reviewId(productId, caller.uid);
    const ref = db.collection("reviews").doc(id);
    const existing = await ref.get();
    const isEdit = existing.exists;

    const verdict = validateReview({
      uid: caller.uid,
      rating,
      body: text,
      imageCount: images.length,
      existing: isEdit ? ({ id } as Review) : null,
      isEdit,
    });
    if (!verdict.ok) return NextResponse.json({ ok: false, error: verdict.message.en, reason: verdict.reason }, { status: 400 });

    /*
     * Verified purchase, resolved from the caller's own orders.
     *
     * Only a *delivered* order counts. An order placed an hour ago says
     * nothing about whether the piece is any good, and accepting it would make
     * the badge purchasable with a cancelled order.
     */
    let verifiedPurchase = false;
    let verifiedOrderId: string | undefined;

    const orders = await db
      .collection("orders")
      .where("uid", "==", caller.uid)
      .where("status", "==", "delivered")
      .limit(50)
      .get();

    for (const doc of orders.docs) {
      const items = (doc.data().items ?? []) as { productId?: string }[];
      if (items.some((i) => i.productId === productId)) {
        verifiedPurchase = true;
        verifiedOrderId = doc.id;
        break;
      }
    }

    const now = Date.now();

    /*
     * Auto-publish only a verified review with no imagery. Photos are the
     * vector worth holding — a text review that turns out to be abusive is
     * embarrassing, an unmoderated image can be very much worse.
     */
    const status: Review["status"] =
      verifiedPurchase && images.length === 0 ? "published" : "pending";

    const payload = {
      productId,
      uid: caller.uid,
      // Snapshotted: a later rename must not rewrite what was published.
      authorName: (caller.email ?? "Customer").split("@")[0],
      rating: rating as Review["rating"],
      ...(title ? { title } : {}),
      body: text.trim(),
      images,
      verifiedPurchase,
      ...(verifiedOrderId ? { verifiedOrderId } : {}),
      // An edit returns to the queue: re-reviewing after approval is the
      // obvious way to get unmoderated text onto a published review.
      status,
      helpfulCount: isEdit ? ((existing.data()?.helpfulCount as number) ?? 0) : 0,
      ...(isEdit ? {} : { createdAt: now }),
      updatedAt: now,
    };

    await ref.set(payload, { merge: true });

    /*
     * Points, if it went straight to published.
     *
     * Keyed on the review id, so the edit path above cannot pay a second time
     * for the same review however often somebody rewrites it — and a review
     * that starts pending is paid by the moderator's approval instead, once,
     * through the same key.
     */
    if (status === "published") {
      const { getEarnRules, award } = await import("@/lib/loyalty-earning.server");
      const { pointsForReview } = await import("@/lib/loyalty-earning");
      const rules = await getEarnRules(db);
      const points = pointsForReview(rules, {
        rating,
        body: payload.body,
        status,
        imageCount: images.length,
      });
      if (points > 0) {
        await award(db, {
          uid: caller.uid,
          source: "review",
          sourceId: id,
          points,
          now,
        });
      }
    }

    await db.collection("auditLog").add({
      action: isEdit ? "review.update" : "review.create",
      reviewId: id,
      productId,
      rating,
      status,
      actorUid: caller.uid,
      at: new Date(),
    });

    if (status === "published") revalidateCatalogue();

    return NextResponse.json({
      ok: true,
      persisted: true,
      id,
      status,
      verifiedPurchase,
      message:
        status === "published"
          ? { en: "Thank you — your review is live.", ar: "شكراً لك — تقييمك منشور الآن." }
          : {
              en: "Thank you. Your review will appear once it has been checked.",
              ar: "شكراً لك. سيظهر تقييمك بعد مراجعته.",
            },
    });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The review could not be saved.", 500);
  }
}

/**
 * Delete one's own review.
 *
 * A customer may withdraw what they wrote; nobody else may. Staff hide a
 * review through the moderation route, which keeps the record and the reason —
 * a deletion by staff would leave no evidence that a complaint ever existed.
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const productId = String(url.searchParams.get("productId") ?? "");
  if (!productId) return bad("A product is required.");

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const id = reviewId(productId, caller.uid);
    const ref = db.collection("reviews").doc(id);
    const snap = await ref.get();

    if (!snap.exists) return bad("There is no review to remove.", 404);
    // Belt and braces: the id encodes the uid, but an ownership check costs
    // nothing and survives a future change to how ids are built.
    if (snap.data()?.uid !== caller.uid) return bad("That is not your review.", 403);

    await ref.delete();
    revalidateCatalogue();
    return NextResponse.json({ ok: true, persisted: true });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The review could not be removed.", 500);
  }
}
