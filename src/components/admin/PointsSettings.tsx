"use client";

import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminUI";
import { PointsCoin } from "@/components/ui/PointsCoin";
import { useAdminLocale } from "./AdminLocale";
import { DEFAULT_EARN_RULES, pointsToMoney, type EarnRules } from "@/lib/loyalty-earning";

/**
 * What the shop pays for points, and what a point is worth.
 *
 * Two of these fields carry a warning rather than a hint, and both warnings
 * sit above the control rather than below it:
 *
 *  - **The lowest star rating that earns.** Paying only for five stars is
 *    review manipulation. Illegal in much of the world, and it devalues every
 *    review on the site including the honest ones.
 *  - **Paying a referral before the invited person has ordered.** Free to farm
 *    — one person, many accounts — where paying on a real order costs the
 *    farmer the price of the order.
 *
 * Both are the merchant's to set. Neither is set quietly.
 *
 * The worked example under `pointValue` is not decoration: the field is a
 * number with three decimal places and the thing it means is "a thousand
 * points is fifty dinars". One of those is checkable at a glance.
 */

const field =
  "border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] tabular-nums outline-none transition-colors";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{label}</span>
      {children}
      {hint && <span className="text-mist mt-1.5 block text-[0.6875rem] leading-relaxed">{hint}</span>}
    </label>
  );
}

export function PointsSettings() {
  const { t, rtl } = useAdminLocale();

  const [rules, setRules] = useState<EarnRules>(DEFAULT_EARN_RULES);
  const [loaded, setLoaded] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getIdToken().catch(() => null);
    return token
      ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      : { "Content-Type": "application/json" };
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/admin/loyalty-rules", { headers: await authHeaders() });
        if (response.status === 403) {
          if (live) setDenied(true);
          return;
        }
        const data = (await response.json()) as { ok?: boolean; error?: string; rules?: EarnRules };
        if (!live) return;
        if (!response.ok || !data.ok) throw new Error(data.error ?? "That could not be read.");
        if (data.rules) setRules(data.rules);
        setLoaded(true);
      } catch (failure) {
        if (live) setError(failure instanceof Error ? failure.message : "That could not be read.");
      }
    })();
    return () => {
      live = false;
    };
  }, [authHeaders]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/admin/loyalty-rules", {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({ rules }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; rules?: EarnRules };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "That did not work.");
      // The server clamps; showing what it stored rather than what was typed
      // is what makes the bounds visible instead of mysterious.
      if (data.rules) setRules(data.rules);
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof EarnRules>(key: K, value: EarnRules[K]) =>
    setRules((current) => ({ ...current, [key]: value }));

  if (denied) {
    return (
      <Panel title={t("pts.title")}>
        <p className="text-mist text-[0.8125rem]">{t("pts.adminOnly")}</p>
      </Panel>
    );
  }

  const worked = t("pts.example")
    .replace("{a}", "1,000")
    .replace("{b}", `${pointsToMoney(1000, rules).toFixed(3)} JOD`);

  return (
    <Panel
      title={t("pts.title")}
      description={t("pts.hint")}
      actions={
        <Button variant="brand" size="sm" loading={busy} disabled={!loaded} onClick={() => void save()}>
          {busy ? t("pts.saving") : t("pts.save")}
        </Button>
      }
    >
      <div className="space-y-6">
        {/* ---- what a point is worth ---------------------------------- */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[180px] flex-1">
            <Row label={t("pts.value")} hint={t("pts.valueHint")}>
              <input
                type="number"
                step="0.001"
                min={0.001}
                max={1}
                dir="ltr"
                value={rules.pointValue}
                onChange={(e) => set("pointValue", Number(e.target.value))}
                className={field}
              />
            </Row>
          </div>
          <p className="text-ink-muted flex items-center gap-2 pb-1 text-[0.8125rem]" dir="ltr">
            <PointsCoin size={20} />
            {worked}
          </p>
        </div>

        {/* ---- reviews ------------------------------------------------- */}
        <div className="border-line border-t pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-ink text-[0.8125rem] font-medium">{t("pts.reviewTitle")}</p>
            <label className="text-ink-muted flex cursor-pointer items-center gap-2 text-[0.75rem]">
              <input
                type="checkbox"
                checked={rules.review.enabled}
                onChange={(e) => set("review", { ...rules.review, enabled: e.target.checked })}
                className="accent-brand h-3.5 w-3.5"
              />
              {t("pts.enabled")}
            </label>
          </div>

          <p className="text-mist mb-3 text-[0.6875rem] leading-relaxed">
            {t("pts.reviewOnlyPublished")}
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <Row label={t("pts.reviewPoints")}>
              <input
                type="number"
                min={0}
                dir="ltr"
                value={rules.review.points}
                onChange={(e) => set("review", { ...rules.review, points: Number(e.target.value) })}
                className={field}
              />
            </Row>
            <Row label={t("pts.reviewMinLength")}>
              <input
                type="number"
                min={0}
                dir="ltr"
                value={rules.review.minLength}
                onChange={(e) => set("review", { ...rules.review, minLength: Number(e.target.value) })}
                className={field}
              />
            </Row>
            <Row label={t("pts.reviewPhoto")}>
              <input
                type="number"
                min={0}
                dir="ltr"
                value={rules.review.photoBonus}
                onChange={(e) => set("review", { ...rules.review, photoBonus: Number(e.target.value) })}
                className={field}
              />
            </Row>
          </div>

          {/*
            Above the control, because it changes whether to touch it at all.
          */}
          <div
            className={cn(
              "mt-4 rounded-md border px-3 py-2.5",
              rules.review.minRating > 1
                ? "border-alert/40 bg-alert/5"
                : "border-line bg-paper-sunken",
            )}
          >
            <p className="text-ink-muted text-[0.6875rem] leading-relaxed">
              {t("pts.reviewRatingWarn")}
            </p>
            <div className="mt-2 max-w-[220px]">
              <Row label={t("pts.reviewMinRating")}>
                <input
                  type="number"
                  min={1}
                  max={5}
                  dir="ltr"
                  value={rules.review.minRating}
                  onChange={(e) =>
                    set("review", { ...rules.review, minRating: Number(e.target.value) })
                  }
                  className={field}
                />
              </Row>
            </div>
          </div>
        </div>

        {/* ---- referrals ----------------------------------------------- */}
        <div className="border-line border-t pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-ink text-[0.8125rem] font-medium">{t("pts.referralTitle")}</p>
            <label className="text-ink-muted flex cursor-pointer items-center gap-2 text-[0.75rem]">
              <input
                type="checkbox"
                checked={rules.referral.enabled}
                onChange={(e) => set("referral", { ...rules.referral, enabled: e.target.checked })}
                className="accent-brand h-3.5 w-3.5"
              />
              {t("pts.enabled")}
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Row label={t("pts.referralInviter")}>
              <input
                type="number"
                min={0}
                dir="ltr"
                value={rules.referral.inviterPoints}
                onChange={(e) =>
                  set("referral", { ...rules.referral, inviterPoints: Number(e.target.value) })
                }
                className={field}
              />
            </Row>
            <Row label={t("pts.referralInvitee")}>
              <input
                type="number"
                min={0}
                dir="ltr"
                value={rules.referral.inviteePoints}
                onChange={(e) =>
                  set("referral", { ...rules.referral, inviteePoints: Number(e.target.value) })
                }
                className={field}
              />
            </Row>
          </div>

          <div
            className={cn(
              "mt-4 rounded-md border px-3 py-2.5",
              rules.referral.requiresOrder
                ? "border-line bg-paper-sunken"
                : "border-alert/40 bg-alert/5",
            )}
          >
            <p className="text-ink-muted mb-2 text-[0.6875rem] leading-relaxed">
              {t("pts.referralWarn")}
            </p>
            <label className="text-ink flex cursor-pointer items-center gap-2 text-[0.75rem]">
              <input
                type="checkbox"
                checked={rules.referral.requiresOrder}
                onChange={(e) =>
                  set("referral", { ...rules.referral, requiresOrder: e.target.checked })
                }
                className="accent-brand h-3.5 w-3.5"
              />
              {t("pts.referralRequiresOrder")}
            </label>
          </div>
        </div>

        {/* ---- wheel --------------------------------------------------- */}
        <div className="border-line border-t pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-ink text-[0.8125rem] font-medium">{t("pts.wheelTitle")}</p>
              <p className="text-mist mt-1 text-[0.6875rem]">{t("pts.wheelHint")}</p>
            </div>
            <label className="text-ink-muted flex shrink-0 cursor-pointer items-center gap-2 text-[0.75rem]">
              <input
                type="checkbox"
                checked={rules.wheel.enabled}
                onChange={(e) => set("wheel", { enabled: e.target.checked })}
                className="accent-brand h-3.5 w-3.5"
              />
              {t("pts.enabled")}
            </label>
          </div>
        </div>

        {saved && !error && (
          <p role="status" className={cn("text-mint text-[0.8125rem]", rtl && "text-end")}>
            {t("pts.saved")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-alert text-[0.8125rem]">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
