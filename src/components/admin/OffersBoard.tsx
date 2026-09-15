"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { countdownParts, formatDate, formatPrice, t as pick } from "@/lib/format";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { DataTable, Panel, StatTile, type Column } from "./AdminUI";
import { ExportMenu } from "./ExportMenu";
import { Button } from "@/components/ui/Button";
import { OfferEditor } from "./OfferEditor";
import { BannerEditor } from "./BannerEditor";
import { offerStatus } from "@/lib/offers";
import { getIdToken } from "@/lib/firebase/auth";
import type { Banner, Category, Offer, OfferStatus, Product } from "@/types";

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
  categories = [],
  products = [],
  now,
}: {
  offers: Offer[];
  banners: Banner[];
  /** For the coupon editor's scope pickers. */
  categories?: Category[];
  products?: Product[];
  now: number;
}) {
  const { t, locale } = useAdminLocale();
  const router = useRouter();
  const [tab, setTab] = useState<"codes" | "campaigns">("codes");

  const [editing, setEditing] = useState<Offer | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<OfferStatus | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [bannerEditorOpen, setBannerEditorOpen] = useState(false);
  const [bannerBusyId, setBannerBusyId] = useState<string | null>(null);

  function openNewBanner() {
    setEditingBanner(null);
    setBannerEditorOpen(true);
  }

  /**
   * Pause, resume and reorder a banner without opening the editor.
   *
   * Taking a campaign down is the urgent action — stock ran out, the price was
   * wrong — and it should be one click from the list, not a form submission
   * away.
   */
  async function patchBanner(banner: Banner, patch: { status?: string; priority?: number }) {
    setBannerBusyId(banner.id);
    setActionError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/banners", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: banner.id, ...patch }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; persisted?: boolean };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Update failed");
      if (data.persisted === false) {
        setActionError("Validated, but not stored: Firebase Admin is not configured here.");
        return;
      }
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The banner could not be updated.");
    } finally {
      setBannerBusyId(null);
    }
  }

  const live = offers.filter((o) => offerStatus(o) === "active" && o.startsAt <= now && o.endsAt > now);
  const redemptions = offers.reduce((sum, o) => sum + o.usageCount, 0);

  /*
   * Archived coupons are hidden unless asked for. They are kept forever so an
   * old order can still explain its discount, which means the list only grows
   * — and a board where last year's campaigns outnumber this month's is a
   * board nobody scans.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return offers.filter((offer) => {
      const status = offerStatus(offer);
      if (statusFilter === "all" ? status === "archived" : status !== statusFilter) return false;
      if (!needle) return true;
      return (
        offer.code.toLowerCase().includes(needle) ||
        offer.title.en.toLowerCase().includes(needle) ||
        offer.title.ar.includes(query.trim())
      );
    });
  }, [offers, query, statusFilter]);

  function openNew() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(offer: Offer) {
    setEditing(offer);
    setEditorOpen(true);
  }

  /**
   * Duplicate rather than "edit a running campaign".
   *
   * Changing the terms of a coupon customers already hold is how a store ends
   * up honouring two different deals under one code. Copying into a new draft
   * keeps the original's history intact and makes the new terms a new code.
   */
  function duplicate(offer: Offer) {
    setEditing({
      ...offer,
      id: "",
      code: `${offer.code}-COPY`,
      usageCount: 0,
      status: "draft",
      active: false,
    } as Offer);
    setEditorOpen(true);
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setActionError("Could not copy — your browser blocked clipboard access.");
    }
  }

  async function setStatus(offer: Offer, status: OfferStatus) {
    setBusyId(offer.id);
    setActionError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/offers", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: offer.id, status }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; persisted?: boolean };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Update failed");
      if (data.persisted === false) {
        setActionError("Validated, but not stored: Firebase Admin is not configured here.");
        return;
      }
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The coupon could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  const offerColumns: Column<Offer>[] = [
    {
      key: "code",
      header: t("off.code"),
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
      header: t("off.discount"),
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
      header: t("off.minimum"),
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
      header: t("off.redeemed"),
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
                  className={cn("block h-full rounded-full", share > 0.9 ? "bg-alert" : "bg-brand")}
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
      header: t("off.window"),
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
                parts.expired ? "text-mist" : running ? "text-mint" : "text-brand-deep",
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
    {
      key: "status",
      header: t("col.status"),
      cell: (offer) => {
        const status = offerStatus(offer);
        const tone =
          status === "active"
            ? "bg-mint/12 text-mint"
            : status === "paused"
              ? "bg-brand-mist text-brand-deep"
              : status === "draft"
                ? "bg-paper-sunken text-smoke"
                : "bg-paper-sunken text-mist";
        return (
          <span className={cn("rounded-pill px-2.5 py-1 text-[0.6875rem] font-semibold", tone)}>
            {status}
          </span>
        );
      },
      sortValue: (offer) => offerStatus(offer),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      cell: (offer) => {
        const status = offerStatus(offer);
        const busy = busyId === offer.id;
        return (
          <span className="inline-flex items-center justify-end gap-1">
            <IconAction label={t("off.copyCode")} onClick={() => copyCode(offer.code)}>
              {copied === offer.code ? "✓" : "⧉"}
            </IconAction>
            <IconAction label={t("common.edit")} onClick={() => openEdit(offer)}>
              ✎
            </IconAction>
            <IconAction label={t("off.duplicate")} onClick={() => duplicate(offer)}>
              +
            </IconAction>

            {/* Pause and resume are one button: the opposite of the current
                state is the only thing a merchant wants to click. */}
            {status === "active" ? (
              <IconAction label={t("off.pause")} busy={busy} onClick={() => setStatus(offer, "paused")}>
                ❙❙
              </IconAction>
            ) : status !== "archived" ? (
              <IconAction label={t("off.activate")} busy={busy} onClick={() => setStatus(offer, "active")}>
                ▶
              </IconAction>
            ) : (
              <IconAction label={t("off.restore")} busy={busy} onClick={() => setStatus(offer, "paused")}>
                ↩
              </IconAction>
            )}

            {status !== "archived" && (
              <IconAction
                label={t("off.archive")}
                busy={busy}
                danger
                onClick={() => setStatus(offer, "archived")}
              >
                ⌫
              </IconAction>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <AdminPageHeader
        title={t("off.title")}
        description={t("off.subtitle")}
        actions={
          <>
            <ExportMenu
              rows={offers}
              columns={[
                { header: t("off.code"), value: (o) => o.code, width: 16 },
                { header: t("col.titleEn"), value: (o) => pick(o.title, locale), width: 30 },
                { header: t("off.type"), value: (o) => o.type },
                { header: t("off.value"), value: (o) => o.value, format: "number" },
                { header: t("off.minimum"), value: (o) => o.minSubtotal ?? 0, format: "currency" },
                { header: t("off.redeemed"), value: (o) => o.usageCount, format: "number" },
                { header: t("off.limit"), value: (o) => o.usageLimit ?? "", format: "number" },
                { header: t("off.starts"), value: (o) => new Date(o.startsAt), format: "date", width: 18 },
                { header: t("off.ends"), value: (o) => new Date(o.endsAt), format: "date", width: 18 },
                { header: t("off.activeCol"), value: (o) => (o.active ? t("off.yes") : t("off.no")) },
              ]}
              filename="net-sale-offers"
              title={t("off.title")}
            />
            <Button variant="brand" size="sm">
              {tab === "codes" ? t("off.newOffer") : t("off.newCampaign")}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t("off.liveOffers")} value={live.length.toString()} emphasis={live.length > 0} />
        <StatTile label={t("off.redemptions")} value={redemptions.toLocaleString("en-GB")} />
        <StatTile label={t("off.campaigns")} value={banners.length.toString()} />
        <StatTile
          label={t("off.liveCampaigns")}
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
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("off.searchPlaceholder")}
              aria-label={t("off.searchLabel")}
              className="border-line focus:border-brand bg-paper text-ink min-w-0 flex-1 rounded-md border px-3 py-2 text-[0.8125rem] outline-none sm:max-w-xs"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as OfferStatus | "all")}
              aria-label={t("off.filterStatus")}
              className="border-line focus:border-brand bg-paper text-ink rounded-md border px-3 py-2 text-[0.8125rem] outline-none"
            >
              <option value="all">{t("off.allExceptArchived")}</option>
              <option value="active">{t("off.active")}</option>
              <option value="paused">{t("off.paused")}</option>
              <option value="draft">{t("off.draft")}</option>
              <option value="archived">{t("off.archived")}</option>
            </select>
            <Button variant="brand" size="sm" onClick={openNew}>
              {t("off.newCoupon")}
            </Button>
          </div>

          {actionError && (
            <p role="alert" className="text-alert mb-3 text-[0.8125rem]">
              {actionError}
            </p>
          )}

          <DataTable
            rows={visible}
            columns={offerColumns}
            rowKey={(offer) => offer.id}
            initialSort={{ key: "window", dir: "desc" }}
            empty={
              query || statusFilter !== "all"
                ? t("off.noMatch")
                : t("off.empty")
            }
          />
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-mist text-[0.75rem]">
              {/* The hero is the one placement where "off" has to be obvious,
                  because an empty first screen looks like a broken deploy. */}
              {t("off.heroHint")}
            </p>
            <Button variant="brand" size="sm" onClick={openNewBanner}>
              {t("off.newBanner")}
            </Button>
          </div>

          {actionError && (
            <p role="alert" className="text-alert mb-3 text-[0.8125rem]">
              {actionError}
            </p>
          )}

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
                      <dt>{t("off.slot")}</dt>
                      <dd className="text-ink-muted">{banner.slot}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>{t("off.tone")}</dt>
                      <dd className="text-ink-muted">{banner.tone}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>{t("off.priority")}</dt>
                      <dd className="text-ink-muted tabular-nums">{banner.priority}</dd>
                    </div>
                    {banner.endsAt && (
                      <div className="flex justify-between">
                        <dt>{t("off.ends")}</dt>
                        <dd className="text-ink-muted">{formatDate(banner.endsAt)}</dd>
                      </div>
                    )}
                  </dl>

                  {/* Controls, inside the card: a separate actions column
                      would put the button that takes a campaign down a long
                      way from the artwork that identifies it. */}
                  <div className="border-line mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
                    <SmallAction onClick={() => { setEditingBanner(banner); setBannerEditorOpen(true); }}>
                      {t("off.edit")}
                    </SmallAction>

                    {(banner.status ?? (banner.active ? "active" : "paused")) === "active" ? (
                      <SmallAction
                        busy={bannerBusyId === banner.id}
                        onClick={() => patchBanner(banner, { status: "paused" })}
                      >
                        {t("off.pause")}
                      </SmallAction>
                    ) : (
                      <SmallAction
                        busy={bannerBusyId === banner.id}
                        onClick={() => patchBanner(banner, { status: "active" })}
                      >
                        {t("off.makeLive")}
                      </SmallAction>
                    )}

                    <SmallAction
                      busy={bannerBusyId === banner.id}
                      onClick={() => patchBanner(banner, { priority: (banner.priority ?? 0) + 10 })}
                      label={t("off.raisePriority")}
                    >
                      ↑
                    </SmallAction>
                    <SmallAction
                      busy={bannerBusyId === banner.id}
                      onClick={() =>
                        patchBanner(banner, { priority: Math.max(0, (banner.priority ?? 0) - 10) })
                      }
                      label={t("off.lowerPriority")}
                    >
                      ↓
                    </SmallAction>

                    <span className="text-mist ms-auto text-[0.6875rem] tabular-nums">
                      {banner.slot} · p{banner.priority ?? 0}
                    </span>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
        </>
      )}

      <p className="text-mist mt-4 max-w-2xl text-[0.75rem] leading-relaxed">
        A discount is only ever applied server-side. `/api/checkout` re-validates
        the code inside the same transaction that creates the order — against its
        window, its total limit, this customer&rsquo;s own limit and the cart
        minimum — and increments the count atomically, so two orders arriving at
        once cannot both take the last redemption. The cart is a preview, never
        the authority.
      </p>

      <BannerEditor
        banner={editingBanner}
        defaultSlot="hero"
        open={bannerEditorOpen}
        onClose={() => setBannerEditorOpen(false)}
        onSaved={() => router.refresh()}
      />

      <OfferEditor
        offer={editing}
        categories={categories}
        products={products}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={() => router.refresh()}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A square icon button.
 *
 * Every row action carries a real `aria-label`: a table of bare glyphs is
 * unusable with a screen reader, and "⌫" is not a word in any language.
 */
/** A text or glyph action sized for a card footer. */
function SmallAction({
  children,
  onClick,
  busy = false,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className={cn(
        "border-line text-ink-muted hover:border-ink hover:text-ink rounded-pill cursor-pointer border px-2.5 py-1 text-[0.6875rem] transition-colors",
        "disabled:opacity-40",
      )}
      data-cursor="hover"
    >
      {busy ? "…" : children}
    </button>
  );
}

function IconAction({
  label,
  onClick,
  children,
  busy = false,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 cursor-pointer place-items-center rounded-md text-[0.8125rem] transition-colors",
        "hover:bg-paper-sunken disabled:opacity-40",
        danger ? "text-alert" : "text-ink-muted hover:text-ink",
      )}
      data-cursor="hover"
    >
      {busy ? "…" : children}
    </button>
  );
}
