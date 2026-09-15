"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { getIdToken } from "@/lib/firebase/auth";
import { ACCEPT_ATTRIBUTE, uploadReviewImage } from "@/lib/firebase/upload";
import { useAuth } from "@/components/providers/AuthProvider";
import { Link } from "@/components/ui/Link";
import { Button } from "@/components/ui/Button";
import {
  REVIEW_MAX_BODY,
  REVIEW_MAX_IMAGES,
  filterByRating,
  sortReviews,
  type ReviewSort,
} from "@/lib/reviews";
import type { Locale, ProductImage, Review, ReviewSummary } from "@/types";

/**
 * Reviews on a product page.
 *
 * The summary leads with the distribution rather than the average alone,
 * because "4.6 from 200" and "4.6 from 3" are very different claims and the
 * bar chart is what tells them apart. The star filter is driven from those
 * same bars: a shopper who wants to read the one-star reviews is the shopper
 * most worth serving, and making them hunt is how a review section reads as
 * defensive.
 *
 * Only published reviews are ever received here — the query filters on status
 * server-side — so nothing in this component can leak a held review.
 */

const PAGE = 5;

export interface ProductReviewsProps {
  productId: string;
  productTitle: string;
  summary: ReviewSummary;
  reviews: Review[];
  /** The signed-in customer's own review, published or not. */
  ownReview?: Review | null;
  locale?: Locale;
}

export function ProductReviews({
  productId,
  productTitle,
  summary,
  reviews,
  ownReview = null,
  locale = "en",
}: ProductReviewsProps) {
  const router = useRouter();
  const rtl = locale === "ar";
  const { status: authStatus } = useAuth();
  const signedIn = authStatus === "authenticated";

  const [sort, setSort] = useState<ReviewSort>("recent");
  const [starFilter, setStarFilter] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [composerOpen, setComposerOpen] = useState(false);

  const visible = useMemo(() => {
    const filtered = filterByRating(reviews, starFilter);
    return sortReviews(filtered, sort);
  }, [reviews, starFilter, sort]);

  return (
    <section className="ns-container pb-16 md:pb-24" id="reviews" aria-labelledby="reviews-heading">
      <h2
        id="reviews-heading"
        className="font-display text-ink text-2xl font-semibold tracking-tight md:text-3xl"
      >
        {rtl ? "آراء العملاء" : "Customer reviews"}
      </h2>

      <div className="mt-6 grid gap-8 lg:grid-cols-[18rem_1fr] [&>*]:min-w-0">
        {/* ---- Summary ------------------------------------------------- */}
        <div>
          {summary.count === 0 ? (
            <p className="text-smoke text-[0.9375rem]">
              {rtl
                ? "لا توجد تقييمات بعد. كن أول من يكتب."
                : "No reviews yet. Be the first to write one."}
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-3">
                <span className="font-display text-ink text-4xl font-semibold tabular-nums">
                  {summary.average.toFixed(1)}
                </span>
                <span className="text-smoke text-[0.875rem]">
                  {rtl
                    ? `من ${summary.count} تقييم`
                    : `from ${summary.count} review${summary.count === 1 ? "" : "s"}`}
                </span>
              </div>

              <Stars value={Math.round(summary.average)} className="mt-2" />

              {/* The distribution, as filters. */}
              <ul className="mt-5 space-y-1.5">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = summary.distribution[star - 1] ?? 0;
                  const share = summary.count > 0 ? count / summary.count : 0;
                  const on = starFilter === star;
                  return (
                    <li key={star}>
                      <button
                        type="button"
                        onClick={() => {
                          setStarFilter(on ? null : star);
                          setShown(PAGE);
                        }}
                        aria-pressed={on}
                        disabled={count === 0}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-[0.75rem] transition-colors",
                          on ? "bg-paper-sunken" : "hover:bg-paper-sunken/60",
                          count === 0 && "cursor-default opacity-40",
                        )}
                        data-cursor={count === 0 ? undefined : "hover"}
                      >
                        <span className="text-ink-muted w-7 shrink-0 tabular-nums">{star}★</span>
                        <span className="bg-paper-sunken h-1.5 flex-1 overflow-hidden rounded-full">
                          <span
                            className="bg-brand block h-full rounded-full"
                            style={{ width: `${share * 100}%` }}
                          />
                        </span>
                        <span className="text-mist w-7 shrink-0 text-end tabular-nums">
                          {count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {summary.verifiedCount > 0 && (
                <p className="text-mist mt-3 text-[0.75rem]">
                  {rtl
                    ? `${summary.verifiedCount} منها من مشترين موثّقين`
                    : `${summary.verifiedCount} from verified buyers`}
                </p>
              )}
            </>
          )}

          <div className="mt-6">
            {signedIn ? (
              <Button variant="secondary" size="sm" onClick={() => setComposerOpen((v) => !v)}>
                {ownReview
                  ? rtl
                    ? "عدّل تقييمك"
                    : "Edit your review"
                  : rtl
                    ? "اكتب تقييماً"
                    : "Write a review"}
              </Button>
            ) : (
              <p className="text-smoke text-[0.8125rem]">
                <Link href="/login" className="text-brand underline-offset-4 hover:underline">
                  {rtl ? "سجّل الدخول" : "Sign in"}
                </Link>{" "}
                {rtl ? "لكتابة تقييم." : "to leave a review."}
              </p>
            )}
          </div>

          {/* The author's own held review, and why. Nobody else sees this. */}
          {ownReview && ownReview.status !== "published" && (
            <div className="bg-paper-sunken rounded-md mt-4 p-3.5">
              <p className="text-ink text-[0.8125rem] font-medium">
                {ownReview.status === "pending"
                  ? rtl
                    ? "تقييمك قيد المراجعة."
                    : "Your review is being checked."
                  : rtl
                    ? "تقييمك غير منشور."
                    : "Your review is not published."}
              </p>
              {ownReview.moderationNote && (
                <p className="text-smoke mt-1 text-[0.75rem]">{ownReview.moderationNote}</p>
              )}
            </div>
          )}
        </div>

        {/* ---- List ---------------------------------------------------- */}
        <div>
          {composerOpen && (
            <ReviewComposer
              productId={productId}
              productTitle={productTitle}
              existing={ownReview}
              locale={locale}
              onDone={() => {
                setComposerOpen(false);
                router.refresh();
              }}
            />
          )}

          {visible.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-mist text-[0.75rem] tabular-nums">
                {starFilter
                  ? rtl
                    ? `${visible.length} تقييم بـ${starFilter} نجوم`
                    : `${visible.length} with ${starFilter} stars`
                  : rtl
                    ? `${visible.length} تقييم`
                    : `${visible.length} reviews`}
              </p>
              <label className="flex items-center gap-2">
                <span className="text-mist text-[0.75rem]">{rtl ? "ترتيب" : "Sort"}</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as ReviewSort)}
                  aria-label={rtl ? "ترتيب التقييمات" : "Sort reviews"}
                  className="border-line focus:border-brand bg-paper text-ink rounded-md border px-2.5 py-1.5 text-[0.75rem] outline-none"
                >
                  <option value="recent">{rtl ? "الأحدث" : "Most recent"}</option>
                  <option value="helpful">{rtl ? "الأكثر إفادة" : "Most helpful"}</option>
                  <option value="highest">{rtl ? "الأعلى تقييماً" : "Highest rated"}</option>
                  <option value="lowest">{rtl ? "الأدنى تقييماً" : "Lowest rated"}</option>
                </select>
              </label>
            </div>
          )}

          {visible.length === 0 ? (
            <p className="text-mist py-8 text-[0.875rem]">
              {starFilter
                ? rtl
                  ? "لا تقييمات بهذا العدد من النجوم."
                  : "No reviews with that rating."
                : rtl
                  ? "لا توجد تقييمات منشورة بعد."
                  : "No published reviews yet."}
            </p>
          ) : (
            <ul className="divide-line divide-y">
              {visible.slice(0, shown).map((review) => (
                <li key={review.id} className="py-5 first:pt-0">
                  <ReviewCard review={review} locale={locale} />
                </li>
              ))}
            </ul>
          )}

          {visible.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="border-line text-ink hover:border-ink mt-4 w-full rounded-pill border py-2.5 text-[0.8125rem] font-semibold transition-colors"
              data-cursor="hover"
            >
              {rtl ? "عرض المزيد" : "Show more"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function ReviewCard({ review, locale }: { review: Review; locale: Locale }) {
  const rtl = locale === "ar";
  return (
    <article>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars value={review.rating} />
        <span className="text-ink text-[0.875rem] font-medium">{review.authorName}</span>
        {review.verifiedPurchase && (
          <span className="text-mint bg-mint/10 rounded-pill px-2 py-0.5 text-[0.6875rem] font-semibold">
            {rtl ? "شراء موثّق" : "Verified purchase"}
          </span>
        )}
        <span className="text-mist ms-auto text-[0.75rem] tabular-nums">
          {formatDate(review.createdAt, locale)}
        </span>
      </div>

      {review.title && (
        <h3 className="text-ink mt-2 text-[0.9375rem] font-semibold">{review.title}</h3>
      )}
      <p className="text-ink-muted mt-1.5 text-[0.9375rem] leading-relaxed text-pretty">
        {review.body}
      </p>

      {review.images.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {review.images.map((image) => (
            <li key={image.url}>
              <span className="bg-paper-sunken rounded-md relative block h-20 w-20 overflow-hidden">
                <Image src={image.url} alt={image.alt} fill sizes="80px" className="object-cover" />
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The shop's reply, clearly the shop's — indented and attributed, never
          mixed into the customer's own text. */}
      {review.reply && (
        <div className="border-brand/30 bg-brand-veil rounded-md mt-3 border-s-2 p-3.5">
          <p className="text-brand text-[0.75rem] font-semibold">{review.reply.authorName}</p>
          <p className="text-ink-muted mt-1 text-[0.875rem]">{review.reply.body}</p>
        </div>
      )}
    </article>
  );
}

function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn("text-[0.875rem]", i <= value ? "text-brand" : "text-line-strong")}
        >
          ★
        </span>
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

function ReviewComposer({
  productId,
  productTitle,
  existing,
  locale,
  onDone,
}: {
  productId: string;
  productTitle: string;
  existing: Review | null;
  locale: Locale;
  onDone: () => void;
}) {
  // The uid scopes the Storage path, so an upload can only ever land in the
  // uploader's own folder.
  const uid = useAuth().user?.uid ?? "";
  const rtl = locale === "ar";
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [images, setImages] = useState<ProductImage[]>(existing?.images ?? []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function addPhoto(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (images.length >= REVIEW_MAX_IMAGES) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadReviewImage(
        uid,
        files[0]!,
        `${productTitle} — customer photo`,
      );
      setImages((current) => [...current, uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That photo could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setError(null);
    if (rating < 1) {
      return setError(rtl ? "اختر تقييماً من ١ إلى ٥." : "Choose a rating from 1 to 5.");
    }
    if (!body.trim()) {
      return setError(rtl ? "اكتب بضع كلمات عن القطعة." : "Write a few words about the piece.");
    }

    setBusy(true);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ productId, rating, title, body, images }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        persisted?: boolean;
        message?: { en: string; ar: string };
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not save your review.");
      if (data.persisted === false) {
        setError("Saved locally only — the store's backend is not configured here.");
        return;
      }
      setDone(data.message?.[locale] ?? (rtl ? "شكراً لك." : "Thank you."));
      window.setTimeout(onDone, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your review.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="bg-mint/10 rounded-lg mb-6 p-5" role="status">
        <p className="text-mint text-[0.9375rem] font-medium">{done}</p>
      </div>
    );
  }

  return (
    <div className="border-line rounded-lg mb-6 border p-5">
      <fieldset>
        <legend className="text-ink-muted mb-2 text-[0.8125rem]">
          {rtl ? "تقييمك" : "Your rating"}
        </legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              aria-label={`${star} / 5`}
              aria-pressed={rating === star}
              className={cn(
                "cursor-pointer px-1 text-2xl transition-colors",
                star <= rating ? "text-brand" : "text-line-strong hover:text-brand/50",
              )}
              data-cursor="hover"
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 block">
        <span className="text-ink-muted mb-1.5 block text-[0.8125rem]">
          {rtl ? "عنوان (اختياري)" : "Title (optional)"}
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.875rem] outline-none"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-ink-muted mb-1.5 block text-[0.8125rem]">
          {rtl ? "رأيك" : "Your review"}
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, REVIEW_MAX_BODY))}
          rows={4}
          className="border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.875rem] outline-none"
        />
        <span className="text-mist mt-1 block text-end text-[0.6875rem] tabular-nums">
          {body.length} / {REVIEW_MAX_BODY}
        </span>
      </label>

      <div className="mt-2">
        <span className="text-ink-muted mb-1.5 block text-[0.8125rem]">
          {rtl ? `صور (حتى ${REVIEW_MAX_IMAGES})` : `Photos (up to ${REVIEW_MAX_IMAGES})`}
        </span>
        <div className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <span key={image.url} className="relative">
              <span className="bg-paper-sunken rounded-md relative block h-16 w-16 overflow-hidden">
                <Image src={image.url} alt="" fill sizes="64px" className="object-cover" />
              </span>
              <button
                type="button"
                onClick={() => setImages((c) => c.filter((_, i) => i !== index))}
                aria-label={rtl ? "إزالة الصورة" : "Remove photo"}
                className="bg-ink absolute -end-1 -top-1 grid h-5 w-5 cursor-pointer place-items-center rounded-full text-[0.625rem] text-white"
              >
                ✕
              </button>
            </span>
          ))}

          {images.length < REVIEW_MAX_IMAGES && (
            <label
              className={cn(
                "border-line hover:border-brand text-mist hover:text-brand grid h-16 w-16 place-items-center rounded-md border border-dashed text-[0.6875rem]",
                uploading ? "cursor-wait opacity-60" : "cursor-pointer",
              )}
            >
              {uploading ? "…" : "+"}
              <input
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                disabled={uploading}
                onChange={(e) => addPhoto(e.target.files)}
                className="sr-only"
              />
            </label>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-alert mt-3 text-[0.8125rem]">
          {error}
        </p>
      )}

      <p className="text-mist mt-3 text-[0.75rem]">
        {rtl
          ? "تُراجَع التقييمات التي تحتوي صوراً قبل نشرها."
          : "Reviews with photos are checked before they appear."}
      </p>

      <div className="mt-4 flex justify-end">
        <Button variant="brand" size="sm" loading={busy} onClick={submit}>
          {existing ? (rtl ? "حفظ" : "Save") : rtl ? "إرسال" : "Submit"}
        </Button>
      </div>
    </div>
  );
}
