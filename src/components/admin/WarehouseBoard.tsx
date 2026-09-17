"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { t as pick } from "@/lib/format";
import {
  SEASONS,
  effectiveVisibility,
  seasonsOf,
  storefrontState,
  type StorefrontState,
} from "@/lib/visibility";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { BulkDeleteProducts } from "./BulkDeleteProducts";
import { ACTION_LABELS, type ProductAction } from "@/lib/product-state";
import type { AdminKey } from "@/lib/i18n/admin";
import { Panel, StatTile } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import type { Category, Product, Season } from "@/types";

/**
 * The seasonal warehouse.
 *
 * Moves products on and off the shopfront without changing what they are. The
 * whole screen is built around one distinction the old admin could not make:
 *
 *   hidden       — active, in stock, deliberately not shown
 *   out of stock — shown, nothing left to sell
 *   draft        — never published
 *   archived     — gone for good
 *
 * Conflating the first two is the expensive mistake. A merchant who "hides" a
 * coat by zeroing its stock loses a real count that has to be right in
 * October, and every sell-through report is wrong until someone notices.
 */

const STORE_TZ = "Asia/Amman";

function toLocalInput(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const guess = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(guess)) return null;
  const drift = new Date(`${toLocalInput(guess)}:00Z`).getTime() - guess;
  return guess - drift;
}

const SEASON_KEYS: Record<Season, AdminKey> = {
  winter: "wh.season.winter",
  spring: "wh.season.spring",
  summer: "wh.season.summer",
  autumn: "wh.season.autumn",
  "all-season": "wh.season.all-season",
};

const STATE_STYLES: Record<StorefrontState, { label: AdminKey; tone: string }> = {
  live: { label: "wh.state.live", tone: "bg-mint/12 text-mint" },
  "sold-out": { label: "wh.state.sold-out", tone: "bg-clay/20 text-ink-muted" },
  "out-of-stock": { label: "wh.state.out-of-stock", tone: "bg-alert/10 text-alert" },
  hidden: { label: "wh.state.hidden", tone: "bg-brand-mist text-brand-deep" },
  draft: { label: "wh.state.draft", tone: "bg-paper-sunken text-smoke" },
  archived: { label: "wh.state.archived", tone: "bg-paper-sunken text-mist" },
};

export function WarehouseBoard({
  products,
  categories,
  now,
  canDelete = false,
}: {
  products: Product[];
  categories: Category[];
  now: number;
  /** Deleting is an administrator's; archiving, above, is everyone's. */
  canDelete?: boolean;
}) {
  const { t, locale } = useAdminLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [seasonFilter, setSeasonFilter] = useState<Season | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<StorefrontState | "all">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showAt, setShowAt] = useState("");
  const [hideAt, setHideAt] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      if (stateFilter !== "all" && storefrontState(product, now) !== stateFilter) return false;
      if (seasonFilter !== "all" && !seasonsOf(product).includes(seasonFilter)) return false;
      if (categoryFilter !== "all" && !product.categoryPath.includes(categoryFilter)) return false;
      if (!needle) return true;
      return (
        product.title.en.toLowerCase().includes(needle) ||
        product.title.ar.includes(query.trim()) ||
        product.sku.toLowerCase().includes(needle)
      );
    });
  }, [products, query, seasonFilter, categoryFilter, stateFilter, now]);

  const counts = useMemo(() => {
    const out: Record<StorefrontState, number> = {
      live: 0,
      "sold-out": 0,
      "out-of-stock": 0,
      hidden: 0,
      draft: 0,
      archived: 0,
    };
    for (const product of products) out[storefrontState(product, now)] += 1;
    return out;
  }, [products, now]);

  const allShown = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Publication and sale state, for the whole selection.
   *
   * A separate route from `apply` because it answers differently: the
   * warehouse endpoint moves display and seasons and either works or does not,
   * while a state change is decided per product — a bulk Publish over thirty
   * products will usually refuse a few for a missing Arabic title, and the
   * useful answer names them rather than failing the other twenty-six.
   */
  async function applyState(action: ProductAction) {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/products/state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ids: [...selected], action }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        changed?: number;
        requested?: number;
        refused?: { title?: string; reason?: string }[];
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? t("wh.updateFailed"));

      const changed = data.changed ?? 0;
      const refused = data.refused ?? [];

      /*
       * Both halves are reported. "26 changed" alone hides the four that did
       * not, and a merchant who is not told will find out from a customer.
       */
      let message = `${ACTION_LABELS[action][locale]} — ${changed}/${data.requested ?? selected.size}.`;
      if (refused.length > 0) {
        const shown = refused
          .slice(0, 3)
          .map((r) => `${r.title ?? "?"}: ${r.reason ?? ""}`)
          .join(" · ");
        message += ` ${t("wh.refused")}: ${shown}`;
        if (refused.length > 3) message += ` (+${refused.length - 3})`;
      }
      setNotice(message);

      if (changed > 0) setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wh.updateError"));
    } finally {
      setBusy(false);
    }
  }

  async function apply(payload: Record<string, unknown>, describe: string) {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/warehouse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ids: [...selected], ...payload }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        persisted?: boolean;
        count?: number;
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? t("wh.updateFailed"));
      if (data.persisted === false) {
        setError(t("wh.notStored"));
        return;
      }
      setNotice(`${describe} — ${data.count ?? selected.size} products. The storefront is updated.`);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wh.updateError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminPageHeader
        title={t("wh.title")}
        description={t("wh.subtitle")}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t("wh.state.live")} value={counts.live.toString()} emphasis={counts.live > 0} />
        <StatTile label={t("wh.inWarehouse")} value={counts.hidden.toString()} />
        <StatTile label={t("wh.state.out-of-stock")} value={counts["out-of-stock"].toString()} />
        <StatTile label={t("wh.state.draft")} value={counts.draft.toString()} />
      </div>

      {/* ---- Filters ------------------------------------------------- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("wh.searchPlaceholder")}
          aria-label={t("products.searchLabel")}
          className="border-line focus:border-brand bg-paper text-ink min-w-0 flex-1 rounded-md border px-3 py-2 text-[0.8125rem] outline-none sm:max-w-xs"
        />
        <select
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value as Season | "all")}
          aria-label={t("wh.filterSeason")}
          className={filterClass}
        >
          <option value="all">{t("wh.everySeason")}</option>
          {SEASONS.map((s) => (
            <option key={s} value={s}>
              {t(SEASON_KEYS[s])}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label={t("wh.filterCategory")}
          className={filterClass}
        >
          <option value="all">{t("wh.everyCategory")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {"— ".repeat(c.depth)}
              {locale === "ar" ? c.name.ar : c.name.en}
            </option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as StorefrontState | "all")}
          aria-label={t("wh.filterState")}
          className={filterClass}
        >
          <option value="all">{t("wh.anyState")}</option>
          {(Object.keys(STATE_STYLES) as StorefrontState[]).map((s) => (
            <option key={s} value={s}>
              {t(STATE_STYLES[s].label)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="text-alert mb-3 text-[0.8125rem]">
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="text-mint mb-3 text-[0.8125rem]">
          {notice}
        </p>
      )}

      {/* ---- Bulk actions --------------------------------------------- */}
      {selected.size > 0 && (
        <Panel
          title={t("qe.selected").replace("{n}", String(selected.size))}
          description={t("wh.publicationHint")}
        >
          {/*
            Publication and sale first, display below. They are different
            axes — a draft is not a hidden product, and a stopped sale is not
            an empty shelf — and grouping them by axis is what stops an
            operator reaching for the wrong one.
          */}
          <div className="border-line mb-4 flex flex-wrap items-center gap-2 border-b pb-4">
            <span className="text-mist me-1 text-[0.6875rem] tracking-[0.1em] uppercase">
              {t("wh.publication")}
            </span>
            {(["publish", "draft", "sold-out", "restock", "archive", "restore"] as const).map(
              (action) => (
                <Button
                  key={action}
                  variant={action === "publish" ? "brand" : "secondary"}
                  size="sm"
                  loading={busy}
                  onClick={() => void applyState(action)}
                >
                  {ACTION_LABELS[action][locale]}
                </Button>
              ),
            )}

            {/*
              Deliberately at the end of the publication row and nowhere near
              "archive", which is the control most people reaching for this one
              actually want. Everything else on this row can be undone.
            */}
            {canDelete && (
              <>
                <span className="border-line mx-1 h-8 border-s" />
                <BulkDeleteProducts
                  ids={[...selected]}
                  onDeleted={(gone) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      for (const id of gone) next.delete(id);
                      return next;
                    })
                  }
                />
              </>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => apply({ visibility: "hidden" }, t("wh.movedToWarehouse"))}
            >
              {t("wh.moveToWarehouse")}
            </Button>
            <Button
              variant="brand"
              size="sm"
              loading={busy}
              onClick={() => apply({ visibility: "visible" }, t("wh.returnedToShopfront"))}
            >
              {t("wh.returnToShopfront")}
            </Button>

            <span className="border-line mx-1 h-8 border-s" />

            {SEASONS.map((season) => (
              <button
                key={season}
                type="button"
                disabled={busy}
                onClick={() => apply({ seasons: [season] }, `${t("wh.tagged")} ${t(SEASON_KEYS[season])}`)}
                className="border-line text-ink-muted hover:border-ink hover:text-ink rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors disabled:opacity-40"
                data-cursor="hover"
              >
                {t(SEASON_KEYS[season])}
              </button>
            ))}
          </div>

          <div className="border-line mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto]">
            <label className="block">
              <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{t("wh.showAt")}</span>
              <input
                type="datetime-local"
                value={showAt}
                onChange={(e) => setShowAt(e.target.value)}
                className={filterClass + " w-full"}
              />
            </label>
            <label className="block">
              <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{t("wh.hideAt")}</span>
              <input
                type="datetime-local"
                value={hideAt}
                onChange={(e) => setHideAt(e.target.value)}
                className={filterClass + " w-full"}
              />
            </label>
            <div className="flex items-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                onClick={() =>
                  apply(
                    {
                      showAt: fromLocalInput(showAt),
                      hideAt: fromLocalInput(hideAt),
                      override: false,
                    },
                    t("wh.scheduled"),
                  )
                }
              >
                {t("wh.schedule")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={busy}
                onClick={() => apply({ clearSchedule: true }, t("wh.scheduleCleared"))}
              >
                {t("wh.clear")}
              </Button>
            </div>
          </div>

          <p className="text-mist mt-2 text-[0.6875rem]">
            {/* The override rule is surprising unless stated. */}
            A manual show or hide overrides any schedule until you clear it —
            so &ldquo;show this now&rdquo; is not undone an hour later by a rule
            set last season.
          </p>
        </Panel>
      )}

      {/* ---- The list -------------------------------------------------- */}
      <Panel padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr className="text-mist border-line border-b text-[0.625rem] tracking-[0.12em] uppercase">
                <th className="w-10 p-3">
                  <input
                    type="checkbox"
                    checked={allShown}
                    aria-label={t("wh.selectAll")}
                    onChange={() =>
                      setSelected(allShown ? new Set() : new Set(rows.map((r) => r.id)))
                    }
                    className="accent-brand"
                  />
                </th>
                <th className="p-3 text-start font-medium">{t("col.product")}</th>
                <th className="p-3 text-start font-medium">{t("wh.seasons")}</th>
                <th className="p-3 text-start font-medium">{t("wh.state")}</th>
                <th className="p-3 text-end font-medium">{t("col.stock")}</th>
                <th className="p-3 text-start font-medium">{t("wh.schedule")}</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-mist p-8 text-center">
                    {t("wh.noMatch")}
                  </td>
                </tr>
              ) : (
                rows.map((product) => {
                  const state = storefrontState(product, now);
                  const style = STATE_STYLES[state];
                  const schedule = product.visibilitySchedule;
                  const scheduled =
                    schedule?.showAt || schedule?.hideAt
                      ? [
                          schedule.showAt
                            ? `${t("wh.showsAt")} ${toLocalInput(schedule.showAt)}`
                            : null,
                          schedule.hideAt
                            ? `${t("wh.hidesAt")} ${toLocalInput(schedule.hideAt)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : null;

                  return (
                    <tr key={product.id} className="hover:bg-paper-sunken/50 transition-colors">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selected.has(product.id)}
                          onChange={() => toggle(product.id)}
                          aria-label={`Select ${product.title.en}`}
                          className="accent-brand"
                        />
                      </td>
                      <td className="p-3">
                        <span className="flex items-center gap-2.5">
                          {product.images[0] && (
                            <span className="bg-paper-sunken rounded-sm relative h-10 w-8 shrink-0 overflow-hidden">
                              <Image
                                src={product.images[0].url}
                                alt=""
                                fill
                                sizes="32px"
                                className="object-cover"
                              />
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="text-ink block truncate font-medium">
                              {pick(product.title, locale)}
                            </span>
                            <span className="text-mist block font-mono text-[0.6875rem]">
                              {product.sku}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-ink-muted text-[0.75rem]">
                          {seasonsOf(product)
                            .map((s) => t(SEASON_KEYS[s]))
                            .join(", ")}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={cn(
                            "rounded-pill px-2.5 py-1 text-[0.6875rem] font-semibold",
                            style.tone,
                          )}
                        >
                          {t(style.label)}
                        </span>
                        {product.visibilityOverride && (
                          <span
                            className="text-mist ms-1.5 text-[0.625rem]"
                            title={t("wh.overriding")}
                          >
                            manual
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-end">
                        {/* Stock is shown even for hidden products: it is the
                            number that proves hiding did not destroy it. */}
                        <span className="text-ink tabular-nums">{product.totalStock}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-mist text-[0.6875rem] tabular-nums">
                          {scheduled ??
                            (effectiveVisibility(product, now) === "hidden" ? "—" : "—")}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="text-mist mt-4 max-w-2xl text-[0.75rem] leading-relaxed">
        A hidden product keeps its stock, its price and its place in every past
        order. It disappears from the homepage, search, categories,
        recommendations and the fitting room, and <strong>cannot be bought</strong>{" "}
        — the checkout refuses it even from a bookmarked link or a cart saved
        months ago.
      </p>
    </>
  );
}

const filterClass =
  "border-line focus:border-brand bg-paper text-ink rounded-md border px-3 py-2 text-[0.8125rem] outline-none";
