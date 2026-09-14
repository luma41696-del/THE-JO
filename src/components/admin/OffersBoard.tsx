"use client";

import { useState } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";
import { countdownParts, formatDate, formatPrice, t as pick } from "@/lib/format";
import { AdminPageHeader } from "./AdminShell";
import { DataTable, Panel, StatTile, type Column } from "./AdminUI";
import { ExportMenu } from "./ExportMenu";
import { Button } from "@/components/ui/Button";
import type { Banner, Offer } from "@/types";

/**
 * Offers and campaigns.
 *
 * Two different things on one screen because they are managed together: a
 * **discount code** is the money, a **campaign banner** is the shopfront that
 * sells it. Running one without the other is the most common merchandising
 * mistake, and putting them side by side makes the omission visible.
 *
 * A banner's `slot` is what decides where it appears — hero, promo rail,
 * spotlight, announcement — so a campaign can be moved between placements
 * without a deploy and without a designer.
 */
export function OffersBoard({
  offers,
  banners,
  now,
}: {
  offers: Offer[];
  banners: Banner[];
  now: number;
}) {
  const [tab, setTab] = useState<"codes" | "campaigns">("codes");

  const live = offers.filter((o) => o.active && o.startsAt <= now && o.endsAt > now);
  const redemptions = offers.reduce((sum, o) => sum + o.usageCount, 0);

  const offerColumns: Column<Offer>[] = [
    {
      key: "code",
      header: "Code",
      cell: (offer) => (
        <span>
          <span className="text-ink block font-mono font-medium">{offer.code}</span>
          <span className="text-mist block text-[0.6875rem]">{pick(offer.title, "en")}</span>
        </span>
      ),
      sortValue: (offer) => offer.code,
    },
    {
      key: "value",
      header: "Discount",
      cell: (offer) => (
        <span className="text-ink font-medium tabular-nums">
          {offer.type === "percentage"
            ? `${offer.value}%`
            : offer.type === "fixed"
              ? formatPrice(offer.value, "JOD")
              : offer.type === "free-shipping"
                ? "Free delivery"
                : "Bundle"}
        </span>
      ),
      sortValue: (offer) => offer.value,
    },
    {
      key: "minimum",
      header: "Minimum",
      align: "end",
      cell: (offer) => (
        <span className="text-smoke tabular-nums">
          {offer.minSubtotal ? formatPrice(offer.minSubtotal, "JOD") : "—"}
        </span>
      ),
      sortValue: (offer) => offer.minSubtotal ?? 0,
    },
    {
      key: "usage",
      header: "Redeemed",
      align: "end",
      cell: (offer) => {
        const share = offer.usageLimit ? offer.usageCount / offer.usageLimit : 0;
        return (
          <span className="inline-flex flex-col items-end gap-1">
            <span className="text-ink tabular-nums">
              {offer.usageCount.toLocaleString("en-GB")}
              {offer.usageLimit && (
                <span className="text-mist"> / {offer.usageLimit.toLocaleString("en-GB")}</span>
              )}
            </span>
            {offer.usageLimit && (
              <span className="bg-paper-sunken h-1 w-20 overflow-hidden rounded-full">
                <span
                  className={cn("block h-full rounded-full", share > 0.9 ? "bg-coral" : "bg-violet")}
                  style={{ width: `${Math.min(100, share * 100)}%` }}
                />
              </span>
            )}
          </span>
        );
      },
      sortValue: (offer) => offer.usageCount,
    },
    {
      key: "window",
      header: "Window",
      cell: (offer) => {
        const parts = countdownParts(offer.endsAt, now);
        const running = offer.startsAt <= now && !parts.expired;
        return (
          <span>
            <span className="text-ink-muted block text-[0.75rem]">
              {formatDate(offer.startsAt)} → {formatDate(offer.endsAt)}
            </span>
            <span
              className={cn(
                "block text-[0.6875rem]",
                parts.expired ? "text-mist" : running ? "text-mint" : "text-violet-deep",
              )}
            >
              {parts.expired
                ? "Ended"
                : running
                  ? `${parts.days}d ${parts.hours}h left`
                  : "Scheduled"}
            </span>
          </span>
        );
      },
      sortValue: (offer) => offer.endsAt,
    },
  ];

  return (
    <>
      <AdminPageHeader
        title="Offers & campaigns"
        description="The discount and the shopfront that sells it, managed together."
        actions={
          <>
            <ExportMenu
              rows={offers}
              columns={[
                { header: "Code", value: (o) => o.code, width: 16 },
                { header: "Title", value: (o) => pick(o.title, "en"), width: 30 },
                { header: "Type", value: (o) => o.type },
                { header: "Value", value: (o) => o.value, format: "number" },
                { header: "Minimum", value: (o) => o.minSubtotal ?? 0, format: "currency" },
                { header: "Redeemed", value: (o) => o.usageCount, format: "number" },
                { header: "Limit", value: (o) => o.usageLimit ?? "", format: "number" },
                { header: "Starts", value: (o) => new Date(o.startsAt), format: "date", width: 18 },
                { header: "Ends", value: (o) => new Date(o.endsAt), format: "date", width: 18 },
                { header: "Active", value: (o) => (o.active ? "yes" : "no") },
              ]}
              filename="the-jo-offers"
              title="THE JO — offers"
            />
            <Button variant="violet" size="sm">
              New {tab === "codes" ? "offer" : "campaign"}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Live offers" value={live.length.toString()} emphasis={live.length > 0} />
        <StatTile label="Total redemptions" value={redemptions.toLocaleString("en-GB")} />
        <StatTile label="Campaigns" value={banners.length.toString()} />
        <StatTile
          label="Live campaigns"
          value={banners
            .filter((b) => b.active && (!b.endsAt || b.endsAt > now))
            .length.toString()}
        />
      </div>

      <div className="border-line mb-4 inline-flex overflow-hidden rounded-pill border">
        {(["codes", "campaigns"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "cursor-pointer px-5 py-2 text-[0.8125rem] capitalize transition-colors",
              tab === key ? "bg-ink text-white" : "text-ink-muted hover:bg-paper-sunken",
            )}
            data-cursor="hover"
          >
            {key === "codes" ? "Discount codes" : "Campaign banners"}
          </button>
        ))}
      </div>

      {tab === "codes" ? (
        <DataTable
          rows={offers}
          columns={offerColumns}
          rowKey={(offer) => offer.id}
          initialSort={{ key: "window", dir: "desc" }}
          empty="No discount codes yet."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {banners.map((banner) => {
            const expired = banner.endsAt ? banner.endsAt <= now : false;
            return (
              <Panel key={banner.id} padded={false}>
                {banner.media && (
                  <div className="bg-paper-sunken relative aspect-[16/9] overflow-hidden rounded-t-lg">
                    <Image
                      src={banner.media.url}
                      alt=""
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className={cn("object-cover", expired && "opacity-40 grayscale")}
                    />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-ink text-[0.875rem] font-medium">
                      {pick(banner.title, "en").replace(/\n/g, " ")}
                    </p>
                    <span
                      className={cn(
                        "rounded-xs shrink-0 px-2 py-0.5 text-[0.625rem] tabular-nums",
                        banner.active && !expired
                          ? "bg-mint/12 text-mint"
                          : "bg-paper-sunken text-mist",
                      )}
                    >
                      {expired ? "ended" : banner.active ? "live" : "off"}
                    </span>
                  </div>

                  <p className="text-mist mt-1 truncate text-[0.6875rem]" dir="rtl" lang="ar">
                    {pick(banner.title, "ar").replace(/\n/g, " ")}
                  </p>

                  <dl className="text-mist mt-3 space-y-1 text-[0.6875rem]">
                    <div className="flex justify-between">
                      <dt>Slot</dt>
                      <dd className="text-ink-muted">{banner.slot}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Tone</dt>
                      <dd className="text-ink-muted">{banner.tone}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Priority</dt>
                      <dd className="text-ink-muted tabular-nums">{banner.priority}</dd>
                    </div>
                    {banner.endsAt && (
                      <div className="flex justify-between">
                        <dt>Ends</dt>
                        <dd className="text-ink-muted">{formatDate(banner.endsAt)}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <p className="text-mist mt-4 max-w-2xl text-[0.75rem] leading-relaxed">
        A discount is only ever applied server-side. `/api/checkout` re-validates
        the code against its window, its usage limit and the cart minimum before
        an order is created — the cart drawer showing a discount is a preview,
        never the authority.
      </p>
    </>
  );
}
