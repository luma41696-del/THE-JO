"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { t as pick } from "@/lib/format";
import {
  byDevice,
  bySource,
  couponOutcomes,
  dailySessions,
  exitPoints,
  funnel,
  inPeriod,
  topProducts,
  topSearches,
  zeroResultSearches,
  type Period,
} from "@/lib/analytics/report";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { Panel, StatTile } from "./AdminUI";
import { Link } from "@/components/ui/Link";
import type { AnalyticsEvent, Product } from "@/types";

/**
 * The behaviour report.
 *
 * Deliberately not a second revenue dashboard. Orders already answer "how much
 * did we sell"; this answers "what happened to everyone who did not buy",
 * which is the larger and more useful group.
 *
 * The zero-result search list is the most valuable panel on the page and is
 * placed accordingly: every line is a customer stating, in their own words,
 * something the shop did not have or could not find.
 */

export function BehaviourBoard({
  events,
  products,
  truncated,
  live,
  uid,
}: {
  events: AnalyticsEvent[];
  products: Product[];
  /** True when the window hit its page ceiling and the totals are partial. */
  truncated: boolean;
  /** False when reading fell back to demo data. */
  live: boolean;
  /** Narrow the whole board to one signed-in customer. */
  uid?: string;
}) {
  const { t, rtl } = useAdminLocale();
  const [period, setPeriod] = useState<Period>("30d");

  /*
   * One customer, when the customers board sent us here.
   *
   * Only signed-in activity carries a uid, and only with analytics consent —
   * so this shows what is known, not everything that happened. A board that
   * quietly reported "no activity" for a customer who simply declined
   * analytics would be an accusation dressed as a fact, which is why the
   * banner below says which it is.
   */
  const forCustomer = useMemo(
    () => (uid ? events.filter((event) => event.uid === uid) : events),
    [events, uid],
  );

  const scoped = useMemo(() => inPeriod(forCustomer, period), [forCustomer, period]);

  const customerBanner = uid ? (
    <div className="border-line bg-paper-raised mb-5 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-[0.8125rem]">
      <span className="text-ink">
        {rtl ? "نشاط حساب واحد" : "One account's activity"}
        <span className="text-mist ms-2 font-mono text-[0.75rem]">{uid}</span>
      </span>
      <span className="text-mist">
        {forCustomer.length === 0
          ? rtl
            ? "لا نشاط مسجّل — قد يكون الزبون رفض التتبّع."
            : "Nothing recorded — this customer may have declined analytics."
          : rtl
            ? `${forCustomer.length} حدثاً`
            : `${forCustomer.length} events`}
      </span>
      <Link href="/admin/customers" className="text-mist hover:text-ink ms-auto transition-colors">
        ← {rtl ? "كل الزبائن" : "All customers"}
      </Link>
    </div>
  ) : null;

  const steps = useMemo(() => funnel(scoped), [scoped]);
  const exits = useMemo(() => exitPoints(scoped), [scoped]);
  const zero = useMemo(() => zeroResultSearches(scoped), [scoped]);
  const searches = useMemo(() => topSearches(scoped), [scoped]);
  const devices = useMemo(() => byDevice(scoped), [scoped]);
  const sources = useMemo(() => bySource(scoped), [scoped]);
  const viewed = useMemo(() => topProducts(scoped), [scoped]);
  const coupons = useMemo(() => couponOutcomes(scoped), [scoped]);
  const series = useMemo(() => dailySessions(scoped, period), [scoped, period]);

  const sessions = useMemo(
    () => new Set(scoped.map((e) => e.sessionId)).size,
    [scoped],
  );

  const titleOf = (productId: string) =>
    products.find((p) => p.id === productId)?.title.en ?? productId;

  const purchases = steps.at(-1)?.count ?? 0;
  const rate = sessions > 0 ? purchases / sessions : 0;

  return (
    <>
      <AdminPageHeader
        title={t("beh.title")}
        description={t("beh.subtitle")}
      />

      {customerBanner}

      {/* Honesty about the data before any number is read. */}
      {!live && (
        <p className="bg-paper-sunken text-smoke rounded-md mb-4 px-3.5 py-2.5 text-[0.8125rem]">
          No analytics have been recorded yet, or the store&rsquo;s backend is not
          configured here. Events are only collected from visitors who accept
          the privacy banner.
        </p>
      )}
      {truncated && (
        <p role="alert" className="text-alert bg-alert/10 rounded-md mb-4 px-3.5 py-2.5 text-[0.8125rem]">
          This window has more events than one read can return, so these totals
          are partial. Narrow the period for exact figures.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["7d", "30d", "90d"] as Period[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
            className={cn(
              "rounded-pill cursor-pointer px-4 py-2 text-[0.8125rem] transition-colors",
              period === p ? "bg-ink text-white" : "text-ink-muted hover:bg-paper-sunken",
            )}
            data-cursor="hover"
          >
            {p === "7d" ? "7 days" : p === "30d" ? "30 days" : "90 days"}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t("beh.sessions")} value={sessions.toLocaleString("en-GB")} emphasis={sessions > 0} />
        <StatTile label={t("col.orders")} value={purchases.toLocaleString("en-GB")} />
        <StatTile label={t("beh.conversion")} value={`${(rate * 100).toFixed(1)}%`} />
        <StatTile
          label={t("beh.noResults")}
          value={zero.reduce((sum, s) => sum + s.count, 0).toLocaleString("en-GB")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr] [&>*]:min-w-0">
        {/* ---- Funnel ------------------------------------------------- */}
        <Panel title={t("beh.funnel")} description={t("beh.funnelHint")}>
          <ul className="space-y-3">
            {steps.map((step, index) => {
              const first = steps[0]?.count ?? 0;
              const width = first > 0 ? (step.count / first) * 100 : 0;
              return (
                <li key={step.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="text-ink text-[0.8125rem]">{pick(step.label, "en")}</span>
                    <span className="text-ink text-[0.8125rem] tabular-nums">
                      {step.count.toLocaleString("en-GB")}
                      {index > 0 && (
                        <span
                          className={cn(
                            "ms-2 text-[0.6875rem]",
                            step.conversion < 0.3 ? "text-alert" : "text-mist",
                          )}
                        >
                          {(step.conversion * 100).toFixed(0)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <span className="bg-paper-sunken block h-2 overflow-hidden rounded-full">
                    <span
                      className="bg-brand block h-full rounded-full"
                      style={{ width: `${Math.max(1, width)}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>

        {/* ---- Zero-result searches ----------------------------------- */}
        <Panel
          title={t("beh.searchedNotFound")}
          description={t("beh.searchedNotFoundHint")}
        >
          {zero.length === 0 ? (
            <p className="text-mist py-6 text-center text-[0.875rem]">
              {t("beh.nothingMissing")}
            </p>
          ) : (
            <ul className="divide-line divide-y">
              {zero.map((row) => (
                <li key={row.query} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink min-w-0 truncate text-[0.8125rem]">{row.query}</span>
                  <span className="text-alert shrink-0 text-[0.8125rem] font-medium tabular-nums">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ---- Exit points -------------------------------------------- */}
        <Panel title={t("beh.exits")} description={t("beh.exitsHint")}>
          {exits.length === 0 ? (
            <p className="text-mist py-6 text-center text-[0.875rem]">{t("beh.notEnough")}</p>
          ) : (
            <ul className="divide-line divide-y">
              {exits.map((row) => (
                <li key={row.path} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink-muted min-w-0 truncate font-mono text-[0.75rem]">
                    {row.path}
                  </span>
                  <span className="text-ink shrink-0 text-[0.8125rem] tabular-nums">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ---- Most viewed -------------------------------------------- */}
        <Panel title={t("beh.mostViewed")} description={t("beh.mostViewedHint")}>
          {viewed.length === 0 ? (
            <p className="text-mist py-6 text-center text-[0.875rem]">{t("beh.notEnough")}</p>
          ) : (
            <ul className="divide-line divide-y">
              {viewed.map((row) => (
                <li key={row.productId} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink min-w-0 truncate text-[0.8125rem]">
                    {titleOf(row.productId)}
                  </span>
                  <span className="text-ink shrink-0 text-[0.8125rem] tabular-nums">
                    {row.views}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ---- Devices and sources ------------------------------------ */}
        <Panel title={t("beh.devices")} description={t("beh.devicesHint")}>
          <ul className="space-y-2">
            {(["mobile", "tablet", "desktop"] as const).map((key) => {
              const total = devices.mobile + devices.tablet + devices.desktop;
              const share = total > 0 ? devices[key] / total : 0;
              return (
                <li key={key}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-ink text-[0.8125rem] capitalize">{key}</span>
                    <span className="text-mist text-[0.75rem] tabular-nums">
                      {devices[key]} · {(share * 100).toFixed(0)}%
                    </span>
                  </div>
                  <span className="bg-paper-sunken block h-1.5 overflow-hidden rounded-full">
                    <span
                      className="bg-ink block h-full rounded-full"
                      style={{ width: `${share * 100}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title={t("beh.sources")} description={t("beh.sourcesHint")}>
          {sources.length === 0 ? (
            <p className="text-mist py-6 text-center text-[0.875rem]">{t("beh.notEnough")}</p>
          ) : (
            <ul className="divide-line divide-y">
              {sources.map((row) => (
                <li key={row.source} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink text-[0.8125rem]">{row.source}</span>
                  <span className="text-ink text-[0.8125rem] tabular-nums">{row.sessions}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ---- Coupons ------------------------------------------------ */}
        <Panel title={t("beh.coupons")} description={t("beh.couponsHint")}>
          <p className="text-ink text-[0.875rem]">
            <strong className="tabular-nums">{coupons.applied}</strong> applied
          </p>
          {coupons.rejected.length > 0 ? (
            <ul className="divide-line mt-2 divide-y">
              {coupons.rejected.map((row) => (
                <li key={row.reason} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink-muted text-[0.8125rem]">
                    {/* The reason is the useful half: a spike in "expired"
                        means a closed campaign is still being shared. */}
                    {row.reason.replace(/-/g, " ")}
                  </span>
                  <span className="text-ink text-[0.8125rem] tabular-nums">{row.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-mist mt-2 text-[0.8125rem]">{t("beh.noRefusals")}</p>
          )}
        </Panel>

        {/* ---- Top searches ------------------------------------------- */}
        <Panel title={t("beh.topSearches")} description={t("beh.topSearchesHint")}>
          {searches.length === 0 ? (
            <p className="text-mist py-6 text-center text-[0.875rem]">{t("beh.notEnough")}</p>
          ) : (
            <ul className="divide-line divide-y">
              {searches.map((row) => (
                <li key={row.query} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink min-w-0 truncate text-[0.8125rem]">{row.query}</span>
                  <span className="text-ink shrink-0 text-[0.8125rem] tabular-nums">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title={t("beh.overTime")}>
          <div className="flex h-24 items-end gap-0.5">
            {series.map((point) => {
              const max = Math.max(...series.map((s) => s.sessions), 1);
              return (
                <span
                  key={point.day}
                  title={`${point.day}: ${point.sessions}`}
                  className="bg-brand/70 hover:bg-brand min-w-0 flex-1 rounded-t-sm transition-colors"
                  style={{ height: `${Math.max(2, (point.sessions / max) * 100)}%` }}
                />
              );
            })}
          </div>
        </Panel>
      </div>

      <p className="text-mist mt-4 max-w-2xl text-[0.75rem] leading-relaxed">
        Collected only from visitors who accepted the privacy banner, and only
        ever with a random per-browser id — never a hashed email, which stays
        re-identifiable. Addresses, payment details, body measurements and
        images are never recorded; admin sessions are excluded.
      </p>
    </>
  );
}
