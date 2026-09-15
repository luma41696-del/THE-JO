"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { formatPrice, t as pick } from "@/lib/format";
import { discountPercent } from "@/lib/utils";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { getIdToken } from "@/lib/firebase/auth";
import { storefrontState, type StorefrontState } from "@/lib/visibility";
import { ACTION_LABELS, type ProductAction } from "@/lib/product-state";
import {
  FIELD_LABELS,
  editProblems,
  type Edit,
  type EditField,
  type EditMode,
} from "@/lib/bulk-edit";
import type { AdminKey } from "@/lib/i18n/admin";

/** The same tones and words the warehouse uses, so one product reads the same on both screens. */
const STATE_KEYS: Record<StorefrontState, AdminKey> = {
  live: "wh.state.live",
  "sold-out": "wh.state.sold-out",
  "out-of-stock": "wh.state.out-of-stock",
  hidden: "wh.state.hidden",
  draft: "wh.state.draft",
  archived: "wh.state.archived",
};

const STATE_TONES: Record<StorefrontState, string> = {
  live: "bg-mint/12 text-mint",
  "sold-out": "bg-clay/20 text-ink-muted",
  "out-of-stock": "bg-alert/10 text-alert",
  hidden: "bg-brand-mist text-brand-deep",
  draft: "bg-paper-sunken text-smoke",
  archived: "bg-paper-sunken text-mist",
};
import { DataTable, FilterChips, type Column } from "./AdminUI";
import { ExportMenu } from "./ExportMenu";
import { Button } from "@/components/ui/Button";
import type { Category, Product } from "@/types";

/**
 * Catalogue board.
 *
 * Sorted by **stock ascending** by default, not alphabetically. The question
 * this screen answers most often is "what is about to run out", and an
 * alphabetical list buries that behind the letter A.
 */

type Filter = "all" | "low-stock" | "on-sale" | "draft" | "archived" | string;

const LOW_STOCK = 8;

/**
 * The state changes offered on a selection.
 *
 * Archive and restore are deliberately absent: retiring thirty products at
 * once is not something to do from a chip on a toolbar, and the warehouse
 * screen — where the consequences are spelled out — is the place for it.
 */
const BULK_ACTIONS: ProductAction[] = [
  "publish",
  "draft",
  "warehouse",
  "shopfront",
  "sold-out",
  "restock",
];

export function ProductsBoard({
  products,
  categories,
}: {
  products: Product[];
  categories: Category[];
}) {
  const { t, locale } = useAdminLocale();
  const router = useLocalizedRouter();
  /*
   * One clock for the whole render. Calling `Date.now()` per row would let two
   * products either side of a scheduled boundary disagree within one table.
   */
  const now = Date.now();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [stateNotice, setStateNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  /*
   * The selection lives here rather than in the table, so it survives a
   * re-render of the rows and so the bar that acts on it, the count it shows
   * and the clearing after a write are all one piece of state.
   */
  const [selected, setSelected] = useState<string[]>([]);
  const [quickId, setQuickId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  /*
   * The product the quick-edit row belongs to, resolved against the rows
   * currently on screen. Held as an id rather than an object so a refresh
   * after a save reopens it on the *new* values instead of the stale ones.
   */
  const quickTarget = useMemo(
    () => products.find((product) => product.id === quickId) ?? null,
    [products, quickId],
  );

  /**
   * Send an edit to the bulk route — for one product or for the selection.
   *
   * Quick edit is not a different operation. It is this one with a single id,
   * which is why it goes through the same validation and produces the same
   * per-product refusals.
   */
  async function sendEdits(ids: string[], edits: Edit[]) {
    if (ids.length === 0 || edits.length === 0) return false;
    setApplying(true);
    setStateError(null);
    setStateNotice(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/products/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ids, edits }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        changed?: number;
        refused?: { reason?: string; reasonAr?: string; title?: string }[];
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? t("qe.failed"));

      const changed = data.changed ?? 0;
      const refused = data.refused ?? [];

      /*
       * Both halves are reported. "26 updated, 4 refused" with the first
       * reason is what a merchant can act on; a bare success count hides the
       * four products that did not move, and a bare failure hides the 26 that
       * did.
       */
      const parts: string[] = [];
      if (changed > 0) parts.push(t("qe.changed").replace("{n}", String(changed)));
      else parts.push(t("qe.noneChanged"));
      if (refused.length > 0) parts.push(t("qe.refused").replace("{n}", String(refused.length)));
      setStateNotice(parts.join(" "));

      if (refused.length > 0) {
        const first = refused[0]!;
        setStateError(
          [first.title, (locale === "ar" ? first.reasonAr : first.reason) ?? ""]
            .filter(Boolean)
            .join(" — "),
        );
      }

      if (changed > 0) router.refresh();
      return refused.length === 0;
    } catch (error) {
      setStateError(error instanceof Error ? error.message : t("qe.failed"));
      return false;
    } finally {
      setApplying(false);
    }
  }

  /**
   * Apply one state action to one product or to the whole selection.
   *
   * One function for both, because the route already takes a list and already
   * answers per product. A separate single-row path would be a second place
   * for the refusal handling to drift out of step.
   */
  async function runAction(ids: string[], action: ProductAction) {
    if (ids.length === 0) return;
    setBusyId(ids[0]!);
    setStateError(null);
    setStateNotice(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/products/state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ids, action }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        changed?: number;
        refused?: { reason?: string; title?: string }[];
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? t("wh.updateFailed"));

      const changed = data.changed ?? 0;
      const refused = data.refused ?? [];

      // A refusal is the useful answer, not a failure — it carries the reason.
      if (refused.length > 0) {
        const first = refused[0]!;
        setStateError([first.title, first.reason].filter(Boolean).join(" — "));
      }
      if (changed > 0) {
        setStateNotice(
          ids.length > 1
            ? `${ACTION_LABELS[action][locale]} · ${t("qe.changed").replace("{n}", String(changed))}`
            : ACTION_LABELS[action][locale],
        );
        router.refresh();
        // Cleared only on a change, so a selection that was entirely refused
        // is still there to look at and fix.
        if (refused.length === 0) setSelected([]);
      } else if (refused.length === 0) {
        setStateError(t("wh.updateFailed"));
      }
    } catch (error) {
      setStateError(error instanceof Error ? error.message : t("wh.updateError"));
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(
    () => ({
      all: products.length,
      "low-stock": products.filter((p) => p.totalStock <= LOW_STOCK).length,
      "on-sale": products.filter((p) => p.compareAtPrice && p.compareAtPrice > p.price).length,
      /*
       * Split, because "not active" also caught every archived product — so
       * the Draft filter mixed things a merchant is still writing with things
       * they deliberately retired, and the count on the chip was wrong for
       * both.
       */
      draft: products.filter((p) => p.status === "draft").length,
      archived: products.filter((p) => p.status === "archived").length,
    }),
    [products],
  );

  const rows = useMemo(() => {
    let list = products;

    if (filter === "low-stock") list = list.filter((p) => p.totalStock <= LOW_STOCK);
    else if (filter === "on-sale")
      list = list.filter((p) => p.compareAtPrice && p.compareAtPrice > p.price);
    else if (filter === "draft") list = list.filter((p) => p.status === "draft");
    else if (filter === "archived") list = list.filter((p) => p.status === "archived");
    else if (filter !== "all") list = list.filter((p) => p.categoryId === filter);

    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter((p) =>
        [pick(p.title, "en"), pick(p.title, "ar"), p.slug, p.categoryId, ...p.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }

    return list;
  }, [products, filter, search]);

  const columns: Column<Product>[] = [
    {
      key: "product",
      header: t("col.product"),
      cell: (product) => (
        <span className="flex items-center gap-3">
          {product.images[0] && (
            <span className="bg-paper-sunken relative h-12 w-9 shrink-0 overflow-hidden rounded-sm">
              <Image
                src={product.images[0].url}
                alt=""
                fill
                sizes="36px"
                className="object-cover"
              />
            </span>
          )}
          <span className="min-w-0">
            <Link
              href={`/admin/products/${product.id}`}
              className="text-ink block truncate font-medium"
            >
              {pick(product.title, locale)}
            </Link>
            <span className="text-mist block truncate text-[0.6875rem]" dir="rtl" lang="ar">
              {pick(product.title, "ar")}
            </span>
          </span>
        </span>
      ),
      sortValue: (product) => pick(product.title, locale),
    },
    {
      key: "category",
      header: t("col.category"),
      cell: (product) => <span className="text-ink-muted capitalize">{product.categoryId}</span>,
      sortValue: (product) => product.categoryId,
    },
    {
      key: "price",
      header: t("col.price"),
      align: "end",
      cell: (product) => {
        const off = discountPercent(product.price, product.compareAtPrice);
        return (
          <span className="tabular-nums">
            <span className={cn("font-medium", off > 0 ? "text-alert" : "text-ink")}>
              {formatPrice(product.price, product.currency)}
            </span>
            {off > 0 && <span className="text-mist ms-2 text-[0.6875rem]">−{off}%</span>}
          </span>
        );
      },
      sortValue: (product) => product.price,
    },
    {
      key: "stock",
      header: t("col.stock"),
      align: "end",
      cell: (product) => (
        <span
          className={cn(
            "font-medium tabular-nums",
            product.totalStock === 0
              ? "text-alert"
              : product.totalStock <= LOW_STOCK
                ? "text-brand-deep"
                : "text-ink",
          )}
        >
          {product.totalStock}
          {product.totalStock <= LOW_STOCK && product.totalStock > 0 && (
            <span className="text-mist ms-1.5 text-[0.6875rem]">low</span>
          )}
        </span>
      ),
      sortValue: (product) => product.totalStock,
    },
    {
      key: "variants",
      header: t("col.variants"),
      align: "end",
      cell: (product) => (
        <span className="text-smoke tabular-nums">
          {product.colors.length} × {product.sizes.length}
        </span>
      ),
      sortValue: (product) => product.colors.length * product.sizes.length,
    },
    {
      key: "status",
      header: t("col.status"),
      /*
       * The real state, not just `status`.
       *
       * `status` alone says "active" for a product that is in the warehouse,
       * stopped by hand, or sold out — three situations a merchant scanning
       * this list needs to tell apart at a glance, and which used to look
       * identical here.
       */
      cell: (product) => {
        const state = storefrontState(product, now);
        return (
          <span
            className={cn(
              "rounded-pill inline-flex px-2.5 py-1 text-[0.6875rem] font-medium",
              STATE_TONES[state],
            )}
          >
            {t(STATE_KEYS[state])}
          </span>
        );
      },
      sortValue: (product) => storefrontState(product, now),
    },
    {
      key: "act",
      header: "",
      /*
       * One action per row, chosen for the state the product is actually in —
       * the next thing a merchant would want to do to it. The full set lives
       * in the warehouse, where a selection can be acted on together.
       */
      cell: (product) => {
        const state = storefrontState(product, now);
        const action: ProductAction | null =
          state === "draft"
            ? "publish"
            : state === "archived"
              ? "restore"
              : state === "sold-out"
                ? "restock"
                : state === "hidden"
                  ? "shopfront"
                  : "sold-out";

        return (
          <span className="flex items-center justify-end gap-1.5">
            {/*
              Quick edit opens under this row rather than navigating.

              Changing one price used to mean opening the product, changing it,
              saving, and coming back to a list that had forgotten the filter
              and the scroll position that led there. For a repricing pass down
              a column of twenty products that is twenty round trips.
            */}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setQuickId((current) => (current === product.id ? null : product.id));
              }}
              className={cn(
                "rounded-pill cursor-pointer border px-2.5 py-1 text-[0.6875rem] whitespace-nowrap transition-colors",
                quickId === product.id
                  ? "border-ink text-ink"
                  : "border-line text-ink-muted hover:border-ink hover:text-ink",
              )}
              data-cursor="hover"
            >
              {t("qe.quickEdit")}
            </button>

            <button
              type="button"
              disabled={busyId === product.id}
              onClick={(event) => {
                event.stopPropagation();
                void runAction([product.id], action);
              }}
              className="border-line text-ink-muted hover:border-ink hover:text-ink rounded-pill cursor-pointer border px-2.5 py-1 text-[0.6875rem] whitespace-nowrap transition-colors disabled:opacity-40"
              data-cursor="hover"
            >
              {ACTION_LABELS[action][locale]}
            </button>
          </span>
        );
      },
      align: "end",
    },
  ];

  const filters = [
    { value: "all", label: t("common.all") },
    { value: "low-stock", label: t("products.lowStock") },
    { value: "on-sale", label: t("products.onSale") },
    { value: "draft", label: t("products.draft") },
    { value: "archived", label: t("pe.statusArchived") },
    ...categories.map((c) => ({ value: c.id, label: pick(c.name, locale) })),
  ];

  return (
    <>
      <AdminPageHeader
        title={t("products.title")}
        description={t("products.subtitle")}
        actions={
          <>
            <ExportMenu
              rows={rows}
              columns={[
                { header: t("col.titleEn"), value: (p) => pick(p.title, "en"), width: 30 },
                { header: t("col.titleAr"), value: (p) => pick(p.title, "ar"), width: 30 },
                { header: t("col.slug"), value: (p) => p.slug, width: 26 },
                { header: t("col.category"), value: (p) => p.categoryId },
                { header: t("col.price"), value: (p) => p.price, format: "currency" },
                { header: t("col.compareAt"), value: (p) => p.compareAtPrice ?? "", format: "currency" },
                { header: t("col.stock"), value: (p) => p.totalStock, format: "number" },
                { header: t("col.colours"), value: (p) => p.colors.map((c) => pick(c.name, locale)).join(", "), width: 28 },
                { header: t("col.sizes"), value: (p) => p.sizes.map((s) => s.label).join(", ") },
                { header: t("col.status"), value: (p) => p.status },
                // Exported from the seeded field, which is demo data. Left in
                // the export for continuity, but the storefront no longer shows
                // it — the product page reads published reviews instead.
                { header: "Seeded rating", value: (p) => p.rating?.average ?? "" },
              ]}
              filename="net-sale-catalogue"
              title={t("products.title")}
            />
            <Link href="/admin/products/new">
              <Button variant="brand" size="sm">
                {t("products.new")}
              </Button>
            </Link>
          </>
        }
      />

      {/* A refusal carries its reason — "missing title.ar" is actionable,
          "could not publish" is not. */}
      {stateError && (
        <p role="alert" className="text-alert mb-3 text-[0.8125rem]">
          {stateError}
        </p>
      )}
      {stateNotice && !stateError && (
        <p role="status" className="text-mint mb-3 text-[0.8125rem]">
          {stateNotice}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips options={filters} value={filter} onChange={setFilter} counts={counts} />

        <label className="relative">
          <span className="sr-only">{t("products.searchLabel")}</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("products.searchPlaceholder")}
            className="border-line focus:border-brand bg-paper-raised text-ink placeholder:text-mist w-56 rounded-pill border py-2 ps-4 pe-4 text-[0.8125rem] outline-none transition-colors"
          />
        </label>
      </div>

      {/*
        The bar only exists when something is selected.

        A permanently visible bulk panel invites a click before a selection,
        and "apply to nothing" is a worse answer than the control not being
        there at all.
      */}
      {selected.length > 0 && (
        <div className="border-line bg-paper-raised mb-3 rounded-lg border px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-ink text-[0.8125rem] font-medium tabular-nums">
              {t("qe.selected").replace("{n}", String(selected.length))}
            </span>
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-mist hover:text-ink cursor-pointer text-[0.75rem]"
              data-cursor="hover"
            >
              {t("qe.clear")}
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen((open) => !open)}
              className="border-line hover:border-ink text-ink rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors"
              data-cursor="hover"
            >
              {t("qe.bulkEdit")}
            </button>

            {/* The state actions the warehouse offers, on the same selection. */}
            {BULK_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                disabled={applying || busyId !== null}
                onClick={() => void runAction(selected, action)}
                className="border-line text-ink-muted hover:border-ink hover:text-ink rounded-pill cursor-pointer border px-2.5 py-1 text-[0.6875rem] transition-colors disabled:opacity-40"
                data-cursor="hover"
              >
                {ACTION_LABELS[action][locale]}
              </button>
            ))}
          </div>

          {bulkOpen && (
            <EditForm
              categories={categories}
              busy={applying}
              onApply={async (edits) => {
                const clean = await sendEdits(selected, edits);
                if (clean) {
                  setBulkOpen(false);
                  setSelected([]);
                }
              }}
            />
          )}
        </div>
      )}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(product) => product.id}
        onRowClick={(product) => router.push(`/admin/products/${product.id}`)}
        initialSort={{ key: "stock", dir: "asc" }}
        empty={search ? t("common.noMatch") : t("products.empty")}
        selection={{ selected, onChange: setSelected, label: t("qe.selectAll") }}
        expanded={
          quickTarget
            ? {
                key: quickTarget.id,
                render: () => (
                  <EditForm
                    categories={categories}
                    busy={applying}
                    product={quickTarget}
                    onApply={async (edits) => {
                      const clean = await sendEdits([quickTarget.id], edits);
                      if (clean) setQuickId(null);
                    }}
                    onCancel={() => setQuickId(null)}
                  />
                ),
              }
            : undefined
        }
      />
    </>
  );
}

/**
 * One instruction: what to change, how, and to what.
 *
 * The same form for quick edit and for bulk edit, because they send the same
 * request. What differs is how many ids go with it — and the list of modes,
 * since a percentage change against a single product is a roundabout way of
 * typing a number.
 *
 * `product` is passed for quick edit so the inputs start at the values that
 * are actually stored. A blank form beside a product's row invites somebody to
 * fill one box, press apply, and then wonder why the others were cleared.
 */
function EditForm({
  categories,
  onApply,
  onCancel,
  busy,
  product,
}: {
  categories: Category[];
  onApply: (edits: Edit[]) => void | Promise<void>;
  onCancel?: () => void;
  busy: boolean;
  product?: Product;
}) {
  const { t, locale } = useAdminLocale();
  const single = Boolean(product);

  const [field, setField] = useState<EditField>("price");
  const [mode, setMode] = useState<EditMode>("set");
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const modes = useMemo<EditMode[]>(() => {
    if (field === "price") return single ? ["set"] : ["set", "increase", "decrease"];
    if (field === "compareAtPrice") {
      return single ? ["set", "clear"] : ["set", "increase", "decrease", "clear"];
    }
    if (field === "tags") return ["add", "remove", "set"];
    return ["set"];
  }, [field, single]);

  /*
   * Starting values, re-read whenever the chosen field changes.
   *
   * Quick edit is "change this to that", and showing what it currently is makes
   * it an edit rather than a form somebody has to remember the answer to.
   */
  useEffect(() => {
    if (!product) {
      setValue("");
      return;
    }
    const current: Record<EditField, string> = {
      price: String(product.price),
      compareAtPrice: product.compareAtPrice ? String(product.compareAtPrice) : "",
      totalStock: String(product.totalStock),
      categoryId: product.categoryId,
      shippingClassId: product.shippingClassId ?? "",
      tags: (product.tags ?? []).join(", "),
      slug: product.slug,
    };
    setValue(current[field] ?? "");
  }, [product, field]);

  // A mode that does not apply to the newly chosen field would otherwise be
  // sent and refused for something the form could have prevented.
  useEffect(() => {
    setMode((current) => (modes.includes(current) ? current : modes[0]!));
  }, [modes]);

  const fields: EditField[] = single
    ? ["price", "compareAtPrice", "totalStock", "categoryId", "tags", "slug"]
    : ["price", "compareAtPrice", "totalStock", "categoryId", "tags"];

  function modeLabel(name: EditMode): string {
    if (name === "set") return t("qe.mode.set");
    if (name === "increase") return t("qe.mode.increase");
    if (name === "decrease") return t("qe.mode.decrease");
    if (name === "clear") return t("qe.mode.clear");
    if (name === "add") return t("qe.tagsAdd");
    return t("qe.tagsRemove");
  }

  function submit() {
    const edit: Edit = { field, mode, ...(mode === "clear" ? {} : { value }) };
    // Checked here too, so an obvious mistake never becomes a round trip. The
    // server checks again — this is convenience, not the guard.
    const problems = editProblems(edit, single ? 1 : 2);
    if (problems.length > 0) {
      setProblem(problems[0]![locale]);
      return;
    }
    setProblem(null);
    void onApply([edit]);
  }

  const selectClass =
    "border-line focus:border-brand bg-paper text-ink rounded-md border px-2.5 py-1.5 text-[0.75rem] outline-none transition-colors";

  return (
    <div className="mt-3 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={field}
          onChange={(event) => setField(event.target.value as EditField)}
          aria-label={t("qe.field")}
          className={selectClass}
        >
          {fields.map((name) => (
            <option key={name} value={name}>
              {FIELD_LABELS[name][locale]}
            </option>
          ))}
        </select>

        {modes.length > 1 && (
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as EditMode)}
            aria-label={t("qe.mode.set")}
            className={selectClass}
          >
            {modes.map((name) => (
              <option key={name} value={name}>
                {modeLabel(name)}
              </option>
            ))}
          </select>
        )}

        {mode !== "clear" &&
          (field === "categoryId" ? (
            <select
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-label={t("qe.value")}
              className={selectClass}
            >
              <option value="">—</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {pick(category.name, locale)}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              inputMode={
                field === "price" || field === "compareAtPrice" || field === "totalStock"
                  ? "decimal"
                  : "text"
              }
              placeholder={field === "tags" ? t("qe.tagsHint") : t("qe.value")}
              aria-label={t("qe.value")}
              className="border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-40 rounded-md border px-2.5 py-1.5 text-[0.75rem] outline-none transition-colors"
            />
          ))}

        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="bg-ink rounded-pill cursor-pointer px-3 py-1.5 text-[0.75rem] font-medium text-white transition-opacity disabled:opacity-40"
          data-cursor="hover"
        >
          {busy ? t("qe.applying") : t("qe.apply")}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-mist hover:text-ink cursor-pointer text-[0.75rem]"
            data-cursor="hover"
          >
            {t("common.cancel")}
          </button>
        )}
      </div>

      {problem && (
        <p role="alert" className="text-alert text-[0.75rem]">
          {problem}
        </p>
      )}
    </div>
  );
}
