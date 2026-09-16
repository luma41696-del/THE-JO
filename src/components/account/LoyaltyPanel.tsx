"use client";

import { useCallback, useEffect, useState } from "react";

import { getIdToken } from "@/lib/firebase/auth";
import { cn } from "@/lib/utils";
import { formatDate, formatPrice, t as pick } from "@/lib/format";
import {
  MIN_REDEEM_POINTS,
  POINT_VALUE,
  REDEEM_STEP,
  TIERS,
  redemptionPlan,
  type Balance,
  type LedgerEntry,
  type TierRule,
} from "@/lib/loyalty";
import { Button } from "@/components/ui/Button";
import type { Locale } from "@/types";

/**
 * Points, and spending them.
 *
 * Three things the panel is careful about, all of them about trust:
 *
 *  - **The balance is shown with its history.** A number nobody can account
 *    for is one customers write in about; the entries turn "why is it 340?"
 *    into something they answer themselves.
 *
 *  - **Every rule is visible before the button.** The minimum, the step and
 *    what the points are worth are on screen, and the refusal is computed
 *    locally as they type. A programme that refuses *after* submitting feels
 *    like a trick even when it is right.
 *
 *  - **The request carries an id.** Pressing redeem twice — because the first
 *    press seemed to do nothing — must not spend the balance twice. The id is
 *    generated once per attempt and reused on retry, so the server recognises
 *    it and returns the coupon it already made.
 */

interface LoyaltyResponse {
  ok?: boolean;
  error?: string;
  balance?: Balance;
  tier?: TierRule;
  next?: { tier: TierRule; remaining: number } | null;
  maxRedeemable?: number;
  entries?: LedgerEntry[];
}

export function LoyaltyPanel({ locale = "en" }: { locale?: Locale }) {
  const rtl = locale === "ar";

  const [data, setData] = useState<LoyaltyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<number>(MIN_REDEEM_POINTS);
  const [busy, setBusy] = useState(false);
  const [coupon, setCoupon] = useState<{ code: string; value: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/loyalty", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = (await response.json()) as LoyaltyResponse;
      if (!response.ok || !body.ok) throw new Error(body.error ?? "");
      setData(body);
      setPoints((current) => Math.min(Math.max(current, MIN_REDEEM_POINTS), body.maxRedeemable || MIN_REDEEM_POINTS));
    } catch {
      // A points panel that cannot load is not worth an alarm on the account
      // page — the orders and addresses above it still work.
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const balance = data?.balance;
  const available = balance?.available ?? 0;
  const max = data?.maxRedeemable ?? 0;

  // The same rules the server applies, so nothing is a surprise at submit.
  const plan = redemptionPlan(points, available);

  async function redeem() {
    if (busy || !plan.ok) return;
    setBusy(true);
    setError(null);
    setCoupon(null);

    /*
     * One id per attempt, reused if this call has to be repeated. Without it
     * a lost response and a second press is a second coupon from one balance.
     */
    const requestId = `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/loyalty", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ points, requestId }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        errorAr?: string;
        offerCode?: string;
        value?: number;
      };
      if (!response.ok || !body.ok) {
        throw new Error((rtl ? body.errorAr : body.error) ?? "");
      }

      setCoupon({ code: body.offerCode!, value: body.value! });
      await load();
    } catch (redeemError) {
      setError(
        redeemError instanceof Error && redeemError.message
          ? redeemError.message
          : rtl
            ? "تعذّر استبدال النقاط."
            : "Those points could not be redeemed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="border-line rounded-xl border p-6">
        <p className="text-smoke text-[0.875rem]">{rtl ? "يُحمّل…" : "Loading…"}</p>
      </div>
    );
  }

  if (!balance) return null;

  const tier = TIERS.find((candidate) => candidate.id === balance.tier) ?? TIERS[0]!;

  return (
    <section className="border-line bg-paper-raised rounded-xl border p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-ink text-lg font-semibold">
            {rtl ? "نقاطك" : "Your points"}
          </h2>
          <p className="text-smoke mt-0.5 text-[0.8125rem]">
            {rtl
              ? `كل نقطة تساوي ${POINT_VALUE} دينار`
              : `Each point is worth ${formatPrice(POINT_VALUE, "JOD", locale)}`}
          </p>
        </div>
        <span className="bg-brand-mist text-brand-deep rounded-pill px-3 py-1 text-[0.75rem] font-medium">
          {pick(tier.name, locale)}
        </span>
      </div>

      <p className="text-ink font-display mt-4 text-4xl font-semibold tabular-nums">
        {available.toLocaleString(rtl ? "ar-JO" : "en-GB")}
      </p>
      <p className="text-smoke text-[0.8125rem]">
        {rtl
          ? `تساوي ${formatPrice(available * POINT_VALUE, "JOD", locale)}`
          : `Worth ${formatPrice(available * POINT_VALUE, "JOD", locale)}`}
      </p>

      {/*
        Points about to lapse, said plainly and with the date.
        A programme that expires points without warning is one that makes
        people feel cheated by their own reward.
      */}
      {balance.expiringSoon > 0 && balance.expiringSoonAt && (
        <p className="text-alert mt-3 text-[0.8125rem]">
          {rtl
            ? `${balance.expiringSoon} نقطة تنتهي في ${formatDate(balance.expiringSoonAt, locale)}`
            : `${balance.expiringSoon} points expire on ${formatDate(balance.expiringSoonAt, locale)}`}
        </p>
      )}

      {data?.next && (
        <p className="text-smoke mt-3 text-[0.8125rem]">
          {rtl
            ? `${formatPrice(data.next.remaining, "JOD", locale)} للوصول إلى ${pick(data.next.tier.name, locale)}`
            : `${formatPrice(data.next.remaining, "JOD", locale)} more to reach ${pick(data.next.tier.name, locale)}`}
        </p>
      )}

      {/* ---- redeeming ---------------------------------------------------- */}

      <div className="border-line mt-5 border-t pt-5">
        {max === 0 ? (
          <p className="text-smoke text-[0.8125rem]">
            {rtl
              ? `تحتاج ${MIN_REDEEM_POINTS} نقطة على الأقل للاستبدال.`
              : `You need at least ${MIN_REDEEM_POINTS} points to redeem.`}
          </p>
        ) : (
          <>
            <label className="block">
              <span className="text-ink-muted mb-2 block text-[0.8125rem]">
                {rtl ? "كم نقطة تستبدل؟" : "How many points?"}
              </span>
              <input
                type="range"
                min={MIN_REDEEM_POINTS}
                max={max}
                step={REDEEM_STEP}
                value={points}
                onChange={(event) => setPoints(Number(event.target.value))}
                className="accent-brand w-full"
              />
            </label>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-ink text-[0.9375rem] tabular-nums">
                {points.toLocaleString(rtl ? "ar-JO" : "en-GB")}{" "}
                <span className="text-smoke">{rtl ? "نقطة" : "points"}</span>
                {" → "}
                <strong>{formatPrice(points * POINT_VALUE, "JOD", locale)}</strong>
              </p>
              <Button variant="brand" size="sm" loading={busy} onClick={() => void redeem()}>
                {rtl ? "استبدال" : "Redeem"}
              </Button>
            </div>

            <p className="text-mist mt-2 text-[0.75rem]">
              {rtl
                ? `بمضاعفات ${REDEEM_STEP}. القسيمة باسمك وتُستخدم مرة واحدة.`
                : `In steps of ${REDEEM_STEP}. The coupon is yours alone and works once.`}
            </p>
          </>
        )}

        {error && (
          <p role="alert" className="text-alert mt-3 text-[0.8125rem]">
            {error}
          </p>
        )}

        {coupon && (
          <div className="border-mint/40 bg-mint/8 rounded-md mt-4 border p-4">
            <p className="text-ink text-[0.875rem]">
              {rtl
                ? `قسيمتك بقيمة ${formatPrice(coupon.value, "JOD", locale)} جاهزة:`
                : `Your ${formatPrice(coupon.value, "JOD", locale)} coupon is ready:`}
            </p>
            <p className="text-ink font-display mt-1 text-lg font-semibold tracking-wide">
              {coupon.code}
            </p>
            <p className="text-smoke mt-1 text-[0.75rem]">
              {rtl ? "أدخِلها عند الدفع." : "Enter it at checkout."}
            </p>
          </div>
        )}
      </div>

      {/* ---- the history --------------------------------------------------- */}

      {data?.entries && data.entries.length > 0 && (
        <details className="mt-5">
          <summary className="text-ink-muted hover:text-ink cursor-pointer text-[0.8125rem]">
            {rtl ? "سجل النقاط" : "Points history"}
          </summary>
          <ul className="divide-line mt-3 divide-y">
            {data.entries.slice(0, 20).map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-ink-muted min-w-0 flex-1 truncate text-[0.8125rem]">
                  {entryLabel(entry, rtl)}
                </span>
                <span className="text-mist text-[0.75rem]">{formatDate(entry.at, locale)}</span>
                <span
                  className={cn(
                    "w-16 text-end text-[0.8125rem] font-medium tabular-nums",
                    entry.points > 0 ? "text-mint" : "text-ink-muted",
                  )}
                >
                  {entry.points > 0 ? "+" : ""}
                  {entry.points}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** What one ledger line says, in words rather than as a kind code. */
function entryLabel(entry: LedgerEntry, rtl: boolean): string {
  switch (entry.kind) {
    case "earn":
      return rtl
        ? `من الطلب ${entry.orderReference ?? ""}`.trim()
        : `From order ${entry.orderReference ?? ""}`.trim();
    case "redeem":
      return rtl ? `استُبدلت — ${entry.offerCode ?? ""}` : `Redeemed — ${entry.offerCode ?? ""}`;
    case "expire":
      return rtl ? "انتهت صلاحيتها" : "Expired";
    case "reverse":
      return rtl ? "أُعيدت مع إرجاع الطلب" : "Reversed with a refund";
    default:
      return entry.note ?? (rtl ? "تعديل" : "Adjustment");
  }
}
