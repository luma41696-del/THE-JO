/**
 * Review aggregation.
 *
 * One rule runs through all of it: **only published reviews count**. A hidden
 * review still exists — its author can see it, moderation can restore it — but
 * it contributes nothing to the average, the count or the distribution.
 *
 * That matters more than it sounds. If hiding a review left the average alone,
 * moderation would become a way to silence a complaint while keeping its two
 * stars off the books, or to delete a five-star review and keep the number.
 * Recomputing from the published set is what makes the rating on the page mean
 * "this is what published reviewers said", which is the only claim it can
 * honestly make.
 */

import type { Review, ReviewSummary } from "@/types";

export type ReviewSort = "recent" | "helpful" | "highest" | "lowest";

/** The empty summary, so a product with no reviews renders without branching. */
export function emptySummary(productId: string): ReviewSummary {
  return {
    productId,
    average: 0,
    count: 0,
    distribution: [0, 0, 0, 0, 0],
    verifiedCount: 0,
  };
}

export function isPublished(review: Review): boolean {
  return review.status === "published";
}

/**
 * Summarise a product's reviews.
 *
 * The average is rounded to one decimal at the *end*, never per-review: a
 * running rounded mean drifts, and a product sitting at 4.45 must not show
 * 4.5 in one place and 4.4 in another.
 */
export function summarise(productId: string, reviews: Review[]): ReviewSummary {
  const published = reviews.filter((r) => r.productId === productId && isPublished(r));
  if (published.length === 0) return emptySummary(productId);

  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let total = 0;
  let verified = 0;

  for (const review of published) {
    total += review.rating;
    // `noUncheckedIndexedAccess` is on and the compiler cannot know a 1-5
    // rating indexes a 5-tuple safely, so the bucket is read explicitly.
    const bucket = review.rating - 1;
    distribution[bucket] = (distribution[bucket] ?? 0) + 1;
    if (review.verifiedPurchase) verified += 1;
  }

  return {
    productId,
    average: Math.round((total / published.length) * 10) / 10,
    count: published.length,
    distribution,
    verifiedCount: verified,
  };
}

/** Summaries for a whole catalogue in one pass, for listing pages. */
export function summariseAll(reviews: Review[]): Record<string, ReviewSummary> {
  const byProduct = new Map<string, Review[]>();
  for (const review of reviews) {
    if (!isPublished(review)) continue;
    const list = byProduct.get(review.productId) ?? [];
    list.push(review);
    byProduct.set(review.productId, list);
  }

  const out: Record<string, ReviewSummary> = {};
  for (const [productId, list] of byProduct) out[productId] = summarise(productId, list);
  return out;
}

/**
 * Sort published reviews for display.
 *
 * "Helpful" falls back to recency on a tie rather than leaving the order to
 * the database: a list that reshuffles between page loads makes pagination
 * skip and repeat entries.
 */
export function sortReviews(reviews: Review[], sort: ReviewSort): Review[] {
  const rows = [...reviews];
  switch (sort) {
    case "helpful":
      return rows.sort(
        (a, b) => b.helpfulCount - a.helpfulCount || b.createdAt - a.createdAt,
      );
    case "highest":
      return rows.sort((a, b) => b.rating - a.rating || b.createdAt - a.createdAt);
    case "lowest":
      return rows.sort((a, b) => a.rating - b.rating || b.createdAt - a.createdAt);
    case "recent":
    default:
      return rows.sort((a, b) => b.createdAt - a.createdAt);
  }
}

export function filterByRating(reviews: Review[], rating: number | null): Review[] {
  return rating ? reviews.filter((r) => r.rating === rating) : reviews;
}

/* -------------------------------------------------------------------------- */
/*  Validation                                                                */
/* -------------------------------------------------------------------------- */

export const REVIEW_MAX_BODY = 2000;
export const REVIEW_MAX_TITLE = 120;
export const REVIEW_MAX_IMAGES = 4;

export type ReviewRejection =
  | "not-signed-in"
  | "bad-rating"
  | "empty-body"
  | "body-too-long"
  | "too-many-images"
  | "duplicate";

/**
 * Validate a submission. Returns a reason, in both languages, or null.
 *
 * The duplicate rule is one review per person per product. A customer who
 * changes their mind edits what they wrote; letting them post again would let
 * one enthusiastic buyer move a product's average on their own.
 */
export function validateReview(input: {
  uid: string | null;
  rating: number;
  body: string;
  imageCount: number;
  existing?: Review | null;
  isEdit?: boolean;
}) {
  const fail = (reason: ReviewRejection, en: string, ar: string) => ({
    ok: false as const,
    reason,
    message: { en, ar },
  });

  if (!input.uid) {
    return fail(
      "not-signed-in",
      "Sign in to leave a review.",
      "سجّل الدخول لكتابة تقييم.",
    );
  }
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return fail("bad-rating", "Choose a rating from 1 to 5.", "اختر تقييماً من ١ إلى ٥.");
  }
  const body = input.body.trim();
  if (body.length === 0) {
    return fail("empty-body", "Write a few words about the piece.", "اكتب بضع كلمات عن القطعة.");
  }
  if (body.length > REVIEW_MAX_BODY) {
    return fail(
      "body-too-long",
      `Keep it under ${REVIEW_MAX_BODY} characters.`,
      `أبقِ النص دون ${REVIEW_MAX_BODY} حرفاً.`,
    );
  }
  if (input.imageCount > REVIEW_MAX_IMAGES) {
    return fail(
      "too-many-images",
      `Up to ${REVIEW_MAX_IMAGES} photos.`,
      `حتى ${REVIEW_MAX_IMAGES} صور.`,
    );
  }
  if (!input.isEdit && input.existing) {
    return fail(
      "duplicate",
      "You have already reviewed this piece — edit your review instead.",
      "لقد قيّمت هذه القطعة من قبل — عدّل تقييمك بدلاً من ذلك.",
    );
  }

  return { ok: true as const };
}

/** Deterministic id, so one person cannot hold two reviews of one product. */
export function reviewId(productId: string, uid: string): string {
  return `${productId}__${uid}`;
}
