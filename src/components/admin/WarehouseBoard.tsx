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

const SEASON_LABELS: Record<Season, string> = {
  winter: "Winter",
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  "all-season": "All season",
};

const STATE_STYLES: Record<StorefrontState, { label: string; tone: string }> = {
  live: { label: "Live", tone: "bg-mint/12 text-mint" },
  "out-of-stock": { label: "Sold out", tone: "bg-alert/10 text-alert" },
  hidden: { label: "In warehouse", tone: "bg-brand-mist text-brand-deep" },
  draft: { label: "Draft", tone: "bg-paper-sunken text-smoke" },
  archived: { label: "Archived", tone: "bg-paper-sunken text-mist" },
};

export function WarehouseBoard({
  products,
  categories,
  now,
}: {
  products: Product[];
  categories: Category[];
  now: number;
}) {
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
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Update failed");
      if (data.persisted === false) {
        setError("Validated, but not stored: Firebase Admin is not configured here.");
        return;
      }
      setNotice(`${describe} — ${data.count ?? selected.size} products. The storefront is updated.`);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The products could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminPageHeader
        title="Seasonal warehouse"
        description="Move stock off the shopfront and back, without changing what it is."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Live" value={counts.live.toString()} emphasis={counts.live > 0} />
        <StatTile label="In the warehouse" value={counts.hidden.toString()} />
        <StatTile label="Sold out" value={counts["out-of-stock"].toString()} />
        <StatTile label="Draft" value={counts.draft.toString()} />
      </div>

      {/* ---- Filters ------------------------------------------------- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or SKU…"
          aria-label="Search products"
          className="border-line focus:border-brand bg-paper text-ink min-w-0 flex-1 rounded-md border px-3 py-2 text-[0.8125rem] outline-none sm:max-w-xs"
        />
        <select
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value as Season | "all")}
          aria-label="Filter by season"
          className={filterClass}
        >
          <option value="all">Every season</option>
          {SEASONS.map((s) => (
            <option key={s} value={s}>
              {SEASON_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
          className={filterClass}
        >
          <option value="all">Every category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {"— ".repeat(c.depth)}
              {c.name.en}
            </option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as StorefrontState | "all")}
          aria-label="Filter by state"
          className={filterClass}
        >
          <option value="all">Any state</option>
          {(Object.keys(STATE_STYLES) as StorefrontState[]).map((s) => (
            <option key={s} value={s}>
              {STATE_STYLES[s].label}
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
          title={`${selected.size} selected`}
          description="Hiding never changes stock, status or past orders."
        >
          <div className="flex flex-wrap items-end gap-3">
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => apply({ visibility: "hidden" }, "Moved to the warehouse")}
            >
              Move to warehouse
            </Button>
            <Button
              variant="brand"
              size="sm"
              loading={busy}
              onClick={() => apply({ visibility: "visible" }, "Returned to the shopfront")}
            >
              Return to shopfront
            </Button>

            <span className="border-line mx-1 h-8 border-s" />

            {SEASONS.map((season) => (
              <button
                key={season}
                type="button"
                disabled={busy}
                onClick={() => apply({ seasons: [season] }, `Tagged ${SEASON_LABELS[season]}`)}
                className="border-line text-ink-muted hover:border-ink hover:text-ink rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors disabled:opacity-40"
                data-cursor="hover"
              >
                {SEASON_LABELS[season]}
              </button>
            ))}
          </div>

          <div className="border-line mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto]">
            <label className="block">
              <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Show at (Amman)</span>
              <input
                type="datetime-local"
                value={showAt}
                onChange={(e) => setShowAt(e.target.value)}
                className={filterClass + " w-full"}
              />
            </label>
            <label className="block">
              <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Hide at (Amman)</span>
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
                    "Scheduled",
                  )
                }
              >
                Schedule
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={busy}
                onClick={() => apply({ clearSchedule: true }, "Schedule cleared")}
              >
                Clear
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
                    aria-label="Select everything shown"
                    onChange={() =>
                      setSelected(allShown ? new Set() : new Set(rows.map((r) => r.id)))
                    }
                    className="accent-brand"
                  />
                </th>
                <th className="p-3 text-start font-medium">Product</th>
                <th className="p-3 text-start font-medium">Seasons</th>
                <th className="p-3 text-start font-medium">State</th>
                <th className="p-3 text-end font-medium">Stock</th>
                <th className="p-3 text-start font-medium">Schedule</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-mist p-8 text-center">
                    Nothing matches these filters.
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
                          schedule.showAt ? `show ${toLocalInput(schedule.showAt)}` : null,
                          schedule.hideAt ? `hide ${toLocalInput(schedule.hideAt)}` : null,
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
                              {pick(product.title, "en")}
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
                            .map((s) => SEASON_LABELS[s])
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
                          {style.label}
                        </span>
                        {product.visibilityOverride && (
                          <span
                            className="text-mist ms-1.5 text-[0.625rem]"
                            title="A manual change is overriding the schedule"
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
