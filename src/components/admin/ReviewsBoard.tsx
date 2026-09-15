"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { getIdToken } from "@/lib/firebase/auth";
import { summariseAll } from "@/lib/reviews";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import type { AdminKey } from "@/lib/i18n/admin";
import { Panel, StatTile } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import type { Product, Review, ReviewStatus } from "@/types";

/**
 * Review moderation.
 *
 * The queue is what this screen is for, so it opens on it: pending reviews
 * first, everything else behind a filter. A moderation tool that opens on
 * "all" makes the merchant find the work.
 *
 * Note what is missing, deliberately: there is no field to edit the rating or
 * the body. Staff can publish, hide with a reason, and reply in the shop's
 * voice. Being able to rewrite a two-star review would make every rating on
 * the site meaningless, including the good ones.
 */

const STATUS_STYLE: Record<ReviewStatus, { label: AdminKey; tone: string }> = {
  published: { label: "reviews.published", tone: "bg-mint/12 text-mint" },
  pending: { label: "reviews.pending", tone: "bg-brand-mist text-brand-deep" },
  hidden: { label: "reviews.hidden", tone: "bg-paper-sunken text-mist" },
};

export function ReviewsBoard({
  reviews,
  products,
}: {
  reviews: Review[];
  products: Product[];
}) {
  const { t } = useAdminLocale();
  const router = useRouter();
  const [filter, setFilter] = useState<ReviewStatus | "all">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const counts = useMemo(() => {
    const out: Record<ReviewStatus, number> = { published: 0, pending: 0, hidden: 0 };
    for (const review of reviews) out[review.status] += 1;
    return out;
  }, [reviews]);

  const summaries = useMemo(() => summariseAll(reviews), [reviews]);

  const rows = useMemo(
    () =>
      reviews
        .filter((r) => (filter === "all" ? true : r.status === filter))
        .sort((a, b) => b.createdAt - a.createdAt),
    [reviews, filter],
  );

  const titleOf = (productId: string) =>
    products.find((p) => p.id === productId)?.title.en ?? productId;

  async function patch(id: string, payload: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/reviews", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id, ...payload }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; persisted?: boolean };
      if (!response.ok || !data.ok) throw new Error(data.error ?? t("reviews.updateFailed"));
      if (data.persisted === false) {
        setError(t("reviews.notStored"));
        return;
      }
      setReplyFor(null);
      setReplyText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reviews.updateError"));
    } finally {
      setBusyId(null);
    }
  }

  function hide(review: Review) {
    const note = window.prompt(
      t("reviews.hideReason"),
      "",
    );
    if (!note || note.trim().length < 3) return;
    void patch(review.id, { status: "hidden", moderationNote: note.trim() });
  }

  return (
    <>
      <AdminPageHeader
        title={t("reviews.title")}
        description={t("reviews.subtitle")}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t("reviews.waiting")} value={counts.pending.toString()} emphasis={counts.pending > 0} />
        <StatTile label={t("reviews.published")} value={counts.published.toString()} />
        <StatTile label={t("reviews.hidden")} value={counts.hidden.toString()} />
        <StatTile
          label={t("reviews.withReviews")}
          value={Object.keys(summaries).length.toString()}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["pending", "published", "hidden", "all"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={cn(
              "rounded-pill cursor-pointer px-4 py-2 text-[0.8125rem] capitalize transition-colors",
              filter === key ? "bg-ink text-white" : "text-ink-muted hover:bg-paper-sunken",
            )}
            data-cursor="hover"
          >
            {key}
            {key !== "all" && (
              <span className="ms-1.5 tabular-nums opacity-60">{counts[key]}</span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-alert mb-3 text-[0.8125rem]">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <Panel>
          <p className="text-mist py-12 text-center text-[0.875rem]">
            {filter === "pending"
              ? t("reviews.queueClear")
              : t("reviews.empty")}
          </p>
        </Panel>
      ) : (
        <ul className="space-y-3">
          {rows.map((review) => {
            const style = STATUS_STYLE[review.status];
            const busy = busyId === review.id;

            return (
              <li key={review.id}>
                <Panel>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-ink text-[0.9375rem] font-semibold">
                        {titleOf(review.productId)}
                      </p>
                      <p className="text-mist mt-0.5 text-[0.75rem]">
                        {review.authorName} · {formatDate(review.createdAt)}
                        {review.verifiedPurchase && (
                          <span className="text-mint ms-2">{t("reviews.verified")}</span>
                        )}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-pill shrink-0 px-2.5 py-1 text-[0.6875rem] font-semibold",
                        style.tone,
                      )}
                    >
                      {t(style.label)}
                    </span>
                  </div>

                  <div className="mt-3">
                    <span className="text-brand text-[0.875rem]" aria-label={`${review.rating} / 5`}>
                      {"★".repeat(review.rating)}
                      <span className="text-line-strong">{"★".repeat(5 - review.rating)}</span>
                    </span>
                    {review.title && (
                      <p className="text-ink mt-1.5 text-[0.875rem] font-medium">{review.title}</p>
                    )}
                    {/* Read-only. There is no input here by design. */}
                    <p className="text-ink-muted mt-1.5 text-[0.875rem] leading-relaxed">
                      {review.body}
                    </p>
                  </div>

                  {review.images.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {review.images.map((image) => (
                        <li key={image.url}>
                          <span className="bg-paper-sunken rounded-md relative block h-20 w-20 overflow-hidden">
                            <Image
                              src={image.url}
                              alt={image.alt}
                              fill
                              sizes="80px"
                              className="object-cover"
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {review.moderationNote && (
                    <p className="text-mist bg-paper-sunken rounded-sm mt-3 px-3 py-2 text-[0.75rem]">
                      Held: {review.moderationNote}
                    </p>
                  )}

                  {review.reply && (
                    <div className="border-brand/30 bg-brand-veil rounded-md mt-3 border-s-2 p-3">
                      <p className="text-brand text-[0.75rem] font-semibold">
                        {review.reply.authorName}
                      </p>
                      <p className="text-ink-muted mt-1 text-[0.8125rem]">{review.reply.body}</p>
                    </div>
                  )}

                  {replyFor === review.id && (
                    <div className="mt-3">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        rows={3}
                        placeholder={t("reviews.replyPlaceholder")}
                        className="border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setReplyFor(null);
                            setReplyText("");
                          }}
                          className="text-smoke hover:text-ink cursor-pointer text-[0.75rem]"
                        >
                          {t("common.cancel")}
                        </button>
                        <Button
                          variant="brand"
                          size="sm"
                          loading={busy}
                          onClick={() => patch(review.id, { reply: replyText })}
                        >
                          {t("reviews.postReply")}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="border-line mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                    {review.status !== "published" && (
                      <Action busy={busy} onClick={() => patch(review.id, { status: "published" })}>
                        {t("reviews.publish")}
                      </Action>
                    )}
                    {review.status !== "hidden" && (
                      <Action busy={busy} danger onClick={() => hide(review)}>
                        {t("reviews.hideAction")}
                      </Action>
                    )}
                    <Action
                      busy={busy}
                      onClick={() => {
                        setReplyFor(review.id);
                        setReplyText(review.reply?.body ?? "");
                      }}
                    >
                      {review.reply ? t("reviews.editReply") : t("reviews.reply")}
                    </Action>
                    {review.reply && (
                      <Action busy={busy} onClick={() => patch(review.id, { reply: null })}>
                        {t("reviews.removeReply")}
                      </Action>
                    )}
                  </div>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-mist mt-4 max-w-2xl text-[0.75rem] leading-relaxed">
        Hiding keeps the review and shows the author your reason. Averages are
        recomputed from published reviews only, so a hidden one stops counting
        immediately — on the product page and in the structured data search
        engines read.
      </p>
    </>
  );
}

function Action({
  children,
  onClick,
  busy = false,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "border-line rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors disabled:opacity-40",
        danger
          ? "text-alert hover:border-alert"
          : "text-ink-muted hover:border-ink hover:text-ink",
      )}
      data-cursor="hover"
    >
      {busy ? "…" : children}
    </button>
  );
}
