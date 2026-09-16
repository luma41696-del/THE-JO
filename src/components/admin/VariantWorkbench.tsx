"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { t as pick } from "@/lib/format";
import { getIdToken } from "@/lib/firebase/auth";
import { parseDelimited } from "@/lib/import";
import {
  BULK_LABELS,
  VALUELESS,
  applyBulkTo,
  buildTable,
  combinationCountFor,
  emptyRow,
  fillSkus,
  rowMatches,
  rowProblems,
  stockMatrix,
  valueOf,
  withValue,
  type BulkAction,
} from "@/lib/variant-matrix";
import {
  applyImport,
  autoMapColumns,
  newValuesFor,
  planVariantImport,
  summarise,
  targetsFor,
  type ExistingPolicy,
  type ImportRow,
} from "@/lib/variant-import";
import { useAdminLocale } from "./AdminLocale";
import { Panel } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import type { Locale, ProductAttribute, ProductVariant } from "@/types";

/**
 * The variant table.
 *
 * This replaces a card-per-variant editor that knew about two axes. Three
 * things drove the rewrite, and they show up everywhere below:
 *
 *  - **Axes are whatever the category defines.** Colour and size are enough
 *    for clothing and nothing else, so the columns are built from the
 *    product's attributes and a kettle gets Capacity where a shirt gets Size.
 *  - **A price is the only thing a row needs.** Everything else may be blank,
 *    and a row is only refused when it has no price anywhere.
 *  - **Nothing saves on its own.** Every edit is local until the save button,
 *    so five hundred rows are one write rather than five hundred.
 *
 * The rules all live in `lib/variant-matrix` and `lib/variant-import`, which
 * are pure and tested; this file is the surface.
 */

/* -------------------------------------------------------------------------- */

const input =
  "border-line focus:border-brand bg-paper text-ink placeholder:text-mist rounded-md border px-2 py-1 text-[0.8125rem] outline-none transition-colors";
const inputBad = "border-alert focus:border-alert";

export interface VariantWorkbenchProps {
  attributes: ProductAttribute[];
  onAttributesChange: (next: ProductAttribute[]) => void;
  variants: ProductVariant[];
  onVariantsChange: (next: ProductVariant[]) => void;
  productPrice?: number;
  baseSku?: string;
}

export function VariantWorkbench({
  attributes,
  onAttributesChange,
  variants,
  onVariantsChange,
  productPrice,
  baseSku = "",
}: VariantWorkbenchProps) {
  /*
   * The operator's language, not the shopper's. An Arabic admin is a
   * preference stored on this machine; the product being edited may well be
   * bilingual either way.
   */
  const { locale, rtl } = useAdminLocale();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [bulk, setBulk] = useState<BulkAction | "">("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [matrixFilters, setMatrixFilters] = useState<Record<string, string>>({});

  /* ---- rows and their problems ------------------------------------------ */

  const allSkus = useMemo(() => variants.map((v) => v.sku ?? "").filter(Boolean), [variants]);

  const problemsByIndex = useMemo(
    () => variants.map((row) => rowProblems(row, { productPrice, allSkus })),
    [variants, productPrice, allSkus],
  );

  /*
   * What a blank code will be stored as.
   *
   * The merchant does not have to type one — but "blank" is not what gets
   * saved, and showing an empty box for a field that will quietly acquire a
   * value is how somebody first meets their own SKU on an invoice. The same
   * function the route uses, so the greyed-out text is the actual answer.
   */
  const derivedSkus = useMemo(
    () => fillSkus(variants, attributes, baseSku).map((row) => row.sku),
    [variants, attributes, baseSku],
  );

  /*
   * Indices, not rows. The selection survives a search because it is keyed on
   * position in the full table rather than on what happens to be on screen —
   * filtering then hiding a selected row must not silently deselect it, or a
   * bulk action does less than the count above it promised.
   */
  const visibleIndices = useMemo(
    () =>
      variants
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => rowMatches(row, attributes, query))
        .map(({ index }) => index),
    [variants, attributes, query],
  );

  const matrix = useMemo(
    () => stockMatrix(variants, attributes, matrixFilters),
    [variants, attributes, matrixFilters],
  );

  /* ---- editing ---------------------------------------------------------- */

  const patch = useCallback(
    (index: number, next: Partial<ProductVariant>) => {
      onVariantsChange(variants.map((row, i) => (i === index ? { ...row, ...next } : row)));
    },
    [variants, onVariantsChange],
  );

  const setAxis = useCallback(
    (index: number, attribute: ProductAttribute, value: string) => {
      onVariantsChange(
        variants.map((row, i) => (i === index ? withValue(row, attribute, value) : row)),
      );
    },
    [variants, onVariantsChange],
  );

  function build() {
    const result = buildTable(attributes, variants, baseSku);
    onVariantsChange(result.rows);
    setSelected(new Set());
    setNotice(
      rtl
        ? `أُضيف ${result.added} وبقي ${result.kept} كما هو.`
        : `${result.added} added, ${result.kept} kept as they were.`,
    );
  }

  function addRow() {
    onVariantsChange([...variants, emptyRow()]);
  }

  function removeSelected() {
    onVariantsChange(variants.filter((_, index) => !selected.has(index)));
    setSelected(new Set());
    setDeleteOpen(false);
  }

  function runBulk(value: number) {
    if (!bulk) return;
    onVariantsChange(applyBulkTo(variants, selected, bulk, value, productPrice ?? 0));
    setBulkOpen(false);
    setNotice(
      rtl
        ? `طُبِّق على ${selected.size} خيارًا.`
        : `Applied to ${selected.size} variant${selected.size === 1 ? "" : "s"}.`,
    );
  }

  /* ---- selection -------------------------------------------------------- */

  const allVisibleSelected =
    visibleIndices.length > 0 && visibleIndices.every((index) => selected.has(index));

  function toggleRow(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="grid gap-5">
      {/* ---- axes --------------------------------------------------------- */}
      <AttributeEditor
        attributes={attributes}
        onChange={onAttributesChange}
        locale={locale}
        rtl={rtl}
      />

      {/* ---- toolbar ------------------------------------------------------ */}
      <div className="border-line bg-paper-sunken/40 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Secondary, not brand. The page already has one red button — Save —
            and a second one beside it turns "the thing you press when you are
            finished" into a colour that means nothing in particular.
          */}
          <Button variant="secondary" size="sm" onClick={build} disabled={attributes.length === 0}>
            {rtl ? "بناء الجدول" : "Build table"}
            {combinationCountFor(attributes) > 0 && (
              <span className="ms-1.5 opacity-70 tabular-nums">
                ({combinationCountFor(attributes)})
              </span>
            )}
          </Button>

          <Tool onClick={addRow}>{rtl ? "+ إضافة خيار" : "+ Add variant"}</Tool>
          <Tool onClick={() => setSelected(new Set(variants.map((_, i) => i)))}>
            {rtl ? "تحديد الكل" : "Select all"}
          </Tool>
          <Tool onClick={() => setSelected(new Set(visibleIndices))}>
            {rtl ? "تحديد الظاهر" : "Select visible"}
          </Tool>
          <Tool onClick={() => setSelected(new Set())}>{rtl ? "إلغاء التحديد" : "Clear"}</Tool>

          <span className="border-line mx-1 h-5 w-px bg-current opacity-10" aria-hidden="true" />

          <select
            value={bulk}
            onChange={(event) => setBulk(event.target.value as BulkAction | "")}
            aria-label={rtl ? "إجراء جماعي" : "Bulk action"}
            className={cn(input, "min-w-[12rem]")}
          >
            <option value="">{rtl ? "إجراء جماعي…" : "Bulk action…"}</option>
            {(Object.keys(BULK_LABELS) as BulkAction[]).map((action) => (
              <option key={action} value={action}>
                {pick(BULK_LABELS[action], locale)}
              </option>
            ))}
          </select>

          <Button
            size="sm"
            variant="ghost"
            /*
             * Disabled with nothing selected rather than applying to
             * everything. A bulk action that silently means "all" is how a
             * merchant reprices five hundred rows meaning to reprice three.
             */
            disabled={!bulk || selected.size === 0}
            onClick={() => setBulkOpen(true)}
          >
            {rtl ? "طبّق" : "Apply"}
          </Button>

          <Tool
            danger
            disabled={selected.size === 0}
            onClick={() => setDeleteOpen(true)}
          >
            {rtl ? "حذف المحدد" : "Delete selected"}
          </Tool>

          <span className="ms-auto flex items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={rtl ? "ابحث…" : "Search…"}
              aria-label={rtl ? "ابحث في الخيارات" : "Search variants"}
              className={cn(input, "w-40")}
            />
          </span>
        </div>

        <p className="text-mist mt-2 text-[0.75rem] tabular-nums">
          {rtl
            ? `محدد ${selected.size} من ${variants.length}`
            : `Selected ${selected.size} of ${variants.length} variants`}
          {query && visibleIndices.length !== variants.length && (
            <span className="ms-2">
              · {rtl ? `${visibleIndices.length} ظاهر` : `${visibleIndices.length} shown`}
            </span>
          )}
        </p>

        {notice && (
          <p role="status" className="text-mint mt-2 text-[0.75rem]">
            {notice}
          </p>
        )}
      </div>

      {/* ---- import ------------------------------------------------------- */}
      <ImportPanel
        attributes={attributes}
        variants={variants}
        productPrice={productPrice}
        locale={locale}
        rtl={rtl}
        onApply={(rows, nextAttributes) => {
          if (nextAttributes) onAttributesChange(nextAttributes);
          onVariantsChange(rows);
          setSelected(new Set());
        }}
      />

      {/* ---- the table ---------------------------------------------------- */}
      {variants.length === 0 ? (
        <p className="border-line text-mist rounded-lg border border-dashed py-10 text-center text-[0.8125rem]">
          {rtl
            ? "لا خيارات بعد. اختر السمات وقيمها ثم اضغط «بناء الجدول»."
            : "No variants yet. Choose the attributes and their values, then press Build table."}
        </p>
      ) : (
        <div className="border-line max-h-[32rem] overflow-auto rounded-lg border">
          <table className="w-full text-[0.8125rem]">
            {/* Sticky, because a table this long loses its headings on the
                first scroll and every column becomes a guess. */}
            <thead className="bg-paper-sunken sticky top-0 z-10">
              <tr className="text-mist text-[0.625rem] tracking-[0.08em] uppercase">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={rtl ? "تحديد الظاهر" : "Select visible"}
                    checked={allVisibleSelected}
                    ref={(node) => {
                      if (!node) return;
                      const on = visibleIndices.filter((index) => selected.has(index)).length;
                      node.indeterminate = on > 0 && on < visibleIndices.length;
                    }}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        for (const index of visibleIndices) {
                          if (event.target.checked) next.add(index);
                          else next.delete(index);
                        }
                        return next;
                      })
                    }
                    className="accent-brand h-3.5 w-3.5 cursor-pointer"
                  />
                </th>
                {attributes.map((attribute) => (
                  <th key={attribute.id} className="px-3 py-2 text-start font-medium">
                    {pick(attribute.name, locale)}
                  </th>
                ))}
                <th className="px-3 py-2 text-start font-medium">{rtl ? "الرمز" : "SKU"}</th>
                <th className="px-3 py-2 text-end font-medium">{rtl ? "السعر" : "Price"}</th>
                <th className="px-3 py-2 text-end font-medium">{rtl ? "التخفيض" : "Sale"}</th>
                <th className="px-3 py-2 text-end font-medium">{rtl ? "المخزون" : "Stock"}</th>
                <th className="px-3 py-2 text-start font-medium">{rtl ? "الباركود" : "Barcode"}</th>
                <th className="px-3 py-2 text-center font-medium">{rtl ? "يُباع" : "Active"}</th>
              </tr>
            </thead>

            <tbody className="divide-line divide-y">
              {visibleIndices.map((index) => {
                const row = variants[index]!;
                const problems = problemsByIndex[index] ?? [];
                const problemFor = (field: string) => problems.find((p) => p.field === field);

                return (
                  <tr
                    key={index}
                    className={cn(
                      "transition-colors",
                      selected.has(index) && "bg-brand-mist/30",
                      problems.length > 0 && "bg-alert/[0.04]",
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`${rtl ? "تحديد الصف" : "Select row"} ${index + 1}`}
                        checked={selected.has(index)}
                        onChange={() => toggleRow(index)}
                        className="accent-brand h-3.5 w-3.5 cursor-pointer"
                      />
                    </td>

                    {attributes.map((attribute) => (
                      <td key={attribute.id} className="px-3 py-1.5">
                        <select
                          value={valueOf(row, attribute)}
                          onChange={(event) => setAxis(index, attribute, event.target.value)}
                          aria-label={`${pick(attribute.name, locale)} ${index + 1}`}
                          className={cn(input, "min-w-[6rem]")}
                        >
                          <option value="">—</option>
                          {attribute.values.map((value) => (
                            <option key={value.id} value={value.id}>
                              {pick(value.label, locale)}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}

                    <td className="px-3 py-1.5">
                      <input
                        value={row.sku ?? ""}
                        onChange={(event) => patch(index, { sku: event.target.value })}
                        placeholder={derivedSkus[index] || "—"}
                        aria-label={`SKU ${index + 1}`}
                        className={cn(input, "w-36 font-mono text-[0.75rem]", problemFor("sku") && inputBad)}
                      />
                    </td>

                    <td className="px-3 py-1.5 text-end">
                      <input
                        value={row.priceOverride ?? ""}
                        onChange={(event) => {
                          const raw = event.target.value.trim();
                          patch(index, {
                            priceOverride: raw === "" ? undefined : Number(raw),
                          });
                        }}
                        inputMode="decimal"
                        placeholder={productPrice !== undefined ? String(productPrice) : "—"}
                        aria-label={`${rtl ? "السعر" : "Price"} ${index + 1}`}
                        className={cn(input, "w-20 text-end tabular-nums", problemFor("price") && inputBad)}
                      />
                    </td>

                    <td className="px-3 py-1.5 text-end">
                      <input
                        value={row.salePrice ?? ""}
                        onChange={(event) => {
                          const raw = event.target.value.trim();
                          patch(index, { salePrice: raw === "" ? undefined : Number(raw) });
                        }}
                        inputMode="decimal"
                        placeholder="—"
                        aria-label={`${rtl ? "التخفيض" : "Sale"} ${index + 1}`}
                        className={cn(
                          input,
                          "w-20 text-end tabular-nums",
                          problemFor("salePrice") && inputBad,
                        )}
                      />
                    </td>

                    <td className="px-3 py-1.5 text-end">
                      <input
                        value={row.stock ?? ""}
                        onChange={(event) => {
                          const raw = event.target.value.trim();
                          patch(index, { stock: raw === "" ? 0 : Math.floor(Number(raw)) });
                        }}
                        inputMode="numeric"
                        aria-label={`${rtl ? "المخزون" : "Stock"} ${index + 1}`}
                        className={cn(input, "w-16 text-end tabular-nums", problemFor("stock") && inputBad)}
                      />
                    </td>

                    <td className="px-3 py-1.5">
                      <input
                        value={row.gtin ?? ""}
                        onChange={(event) =>
                          patch(index, { gtin: event.target.value.trim() || undefined })
                        }
                        placeholder="—"
                        aria-label={`${rtl ? "الباركود" : "Barcode"} ${index + 1}`}
                        className={cn(input, "w-32 font-mono text-[0.75rem]")}
                      />
                    </td>

                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={row.available !== false}
                        onChange={(event) =>
                          patch(index, { available: event.target.checked ? undefined : false })
                        }
                        aria-label={`${rtl ? "يُباع" : "Active"} ${index + 1}`}
                        className="accent-brand h-3.5 w-3.5 cursor-pointer"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/*
        The reason for a row, in the row's own language, under the table.

        A single alert saying "some rows are invalid" leaves the merchant
        hunting; the input is already outlined in red, and this names which.
      */}
      {problemsByIndex.some((problems) => problems.length > 0) && (
        <ul className="text-alert grid gap-1 text-[0.75rem]">
          {problemsByIndex.flatMap((problems, index) =>
            problems.map((problem, i) => (
              <li key={`${index}-${i}`}>
                {rtl ? `الصف ${index + 1}` : `Row ${index + 1}`}: {pick(problem.message, locale)}
              </li>
            )),
          )}
        </ul>
      )}

      {/* ---- stock check --------------------------------------------------- */}
      {variants.length > 0 && attributes.length > 0 && (
        <Panel
          title={rtl ? "مراجعة المخزون" : "Stock check"}
          description={
            rtl
              ? "يتحدّث مباشرة مع تعديل المخزون في الجدول أعلاه."
              : "Follows the table above as you type."
          }
        >
          {attributes.length > 2 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {attributes.slice(2).map((attribute) => (
                <label key={attribute.id} className="flex items-center gap-1.5">
                  <span className="text-ink-muted text-[0.75rem]">
                    {pick(attribute.name, locale)}
                  </span>
                  <select
                    value={matrixFilters[attribute.id] ?? ""}
                    onChange={(event) =>
                      setMatrixFilters((current) => ({
                        ...current,
                        [attribute.id]: event.target.value,
                      }))
                    }
                    className={cn(input, "text-[0.75rem]")}
                  >
                    <option value="">{rtl ? "الكل" : "All"}</option>
                    {attribute.values.map((value) => (
                      <option key={value.id} value={value.id}>
                        {pick(value.label, locale)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="text-mist text-[0.625rem] tracking-[0.08em] uppercase">
                  <th className="px-3 py-2 text-start font-medium">
                    {matrix.rowAttribute ? pick(matrix.rowAttribute.name, locale) : ""}
                  </th>
                  {matrix.columns.map((column) => (
                    <th key={column.id} className="px-3 py-2 text-end font-medium">
                      {pick(column.label, locale)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-end font-medium">{rtl ? "المجموع" : "Total"}</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {matrix.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="text-ink px-3 py-2">{pick(row.label, locale)}</td>
                    {matrix.columns.map((column) => {
                      const units = row.cells[column.id] ?? 0;
                      return (
                        <td
                          key={column.id}
                          className={cn(
                            "px-3 py-2 text-end tabular-nums",
                            // Zero is the number a merchant is scanning for.
                            units === 0 ? "text-alert" : "text-ink-muted",
                          )}
                        >
                          {units}
                        </td>
                      );
                    })}
                    <td className="text-ink px-3 py-2 text-end font-medium tabular-nums">
                      {row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-line border-t">
                  <td className="text-mist px-3 py-2 text-[0.75rem]">
                    {rtl ? "المجموع" : "Total"}
                  </td>
                  {matrix.columns.map((column) => (
                    <td key={column.id} className="text-ink-muted px-3 py-2 text-end tabular-nums">
                      {matrix.columnTotals[column.id] ?? 0}
                    </td>
                  ))}
                  <td className="text-ink px-3 py-2 text-end font-semibold tabular-nums">
                    {matrix.grandTotal}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>
      )}

      {/* ---- modals -------------------------------------------------------- */}
      {bulkOpen && bulk && (
        <BulkModal
          action={bulk}
          count={selected.size}
          locale={locale}
          rtl={rtl}
          onCancel={() => setBulkOpen(false)}
          onApply={runBulk}
        />
      )}

      {deleteOpen && (
        <ConfirmModal
          title={rtl ? "حذف الخيارات المحددة" : "Delete selected variants"}
          body={
            rtl
              ? `سيُحذف ${selected.size} خيارًا من الجدول. لا يُكتب شيء حتى تحفظ المنتج.`
              : `${selected.size} variant${selected.size === 1 ? "" : "s"} will be removed from the table. Nothing is written until you save the product.`
          }
          confirmLabel={rtl ? "احذف" : "Delete"}
          cancelLabel={rtl ? "إلغاء" : "Cancel"}
          danger
          onCancel={() => setDeleteOpen(false)}
          onConfirm={removeSelected}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Toolbar button                                                            */
/* -------------------------------------------------------------------------- */

function Tool({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-pill border px-3 py-1.5 text-[0.75rem] transition-colors disabled:opacity-40",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        danger
          ? "border-alert/40 text-alert hover:border-alert"
          : "border-line text-ink-muted hover:border-ink hover:text-ink",
      )}
      data-cursor={disabled ? undefined : "hover"}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Modals — never window.prompt                                              */
/* -------------------------------------------------------------------------- */

/**
 * A value, asked for in the admin's own furniture.
 *
 * `window.prompt` cannot say which action it is asking about, cannot be
 * cancelled without losing what was typed, and gives a merchant writing an
 * Arabic value a box with no text direction.
 */
function BulkModal({
  action,
  count,
  locale,
  rtl,
  onCancel,
  onApply,
}: {
  action: BulkAction;
  count: number;
  locale: Locale;
  rtl: boolean;
  onCancel: () => void;
  onApply: (value: number) => void;
}) {
  const needsValue = !VALUELESS.includes(action);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const parsed = Number(value);
  const usable = !needsValue || (value.trim() !== "" && Number.isFinite(parsed));

  return (
    <Shell onCancel={onCancel} label={pick(BULK_LABELS[action], locale)}>
      <h3 className="font-display text-ink text-[0.9375rem] font-semibold">
        {pick(BULK_LABELS[action], locale)}
      </h3>
      {/* Named before it runs, because a bulk action is hard to see and
          harder to undo. */}
      <p className="text-mist mt-1 text-[0.75rem]">
        {rtl ? `سيُطبَّق على ${count} خيارًا.` : `Applying to ${count} variant${count === 1 ? "" : "s"}.`}
      </p>

      {needsValue && (
        <label className="mt-4 block">
          <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
            {rtl ? "القيمة" : "Value"}
          </span>
          <input
            ref={ref}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && usable) onApply(parsed);
            }}
            inputMode="decimal"
            className={cn(input, "w-full")}
          />
        </label>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {rtl ? "إلغاء" : "Cancel"}
        </Button>
        <Button variant="brand" size="sm" disabled={!usable} onClick={() => onApply(parsed)}>
          {rtl ? "طبّق" : "Apply"}
        </Button>
      </div>
    </Shell>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Shell onCancel={onCancel} label={title}>
      <h3 className="font-display text-ink text-[0.9375rem] font-semibold">{title}</h3>
      <p className="text-ink-muted mt-2 text-[0.8125rem]">{body}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <button
          type="button"
          onClick={onConfirm}
          className={cn(
            "rounded-pill cursor-pointer px-4 py-2 text-[0.8125rem] font-medium text-white",
            danger ? "bg-alert" : "bg-ink",
          )}
          data-cursor="hover"
        >
          {confirmLabel}
        </button>
      </div>
    </Shell>
  );
}

function Shell({
  children,
  onCancel,
  label,
}: {
  children: React.ReactNode;
  onCancel: () => void;
  label: string;
}) {
  return (
    <div className="fixed inset-0 z-[200] grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className="bg-ink/40 absolute inset-0 cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="bg-paper-raised border-line rounded-xl shadow-float relative w-full max-w-sm border p-5"
      >
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Attribute editor                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The axes, and their values.
 *
 * Values are typed as a comma-separated line rather than added one modal at a
 * time: a merchant setting up sizes types "S, M, L, XL, XXL" in one breath,
 * and five dialogs to do it is the friction that makes people give up on the
 * screen.
 */
function AttributeEditor({
  attributes,
  onChange,
  locale,
  rtl,
}: {
  attributes: ProductAttribute[];
  onChange: (next: ProductAttribute[]) => void;
  locale: Locale;
  rtl: boolean;
}) {
  const [name, setName] = useState("");

  function addAttribute() {
    const label = name.trim();
    if (!label) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
      `attr-${attributes.length + 1}`;
    if (attributes.some((attribute) => attribute.id === id)) return;

    onChange([
      ...attributes,
      { id, name: { en: label, ar: label }, kind: "custom", values: [], position: attributes.length },
    ]);
    setName("");
  }

  return (
    <Panel
      title={rtl ? "السمات" : "Attributes"}
      description={
        rtl
          ? "المحاور التي يختلف عليها المنتج. أضف ما تحتاجه — ليست اللون والمقاس فقط."
          : "The axes this product varies along. Add whatever it needs — not only colour and size."
      }
    >
      <ul className="grid gap-3">
        {attributes.map((attribute, index) => {
          /*
           * Artwork is owned by the Designs panel, which holds the thumbnails.
           * Editing its values or removing the axis here would either strip
           * those images or drop a column the rows are keyed on — so this axis
           * is shown and used, not edited. A control that silently undoes
           * itself on reload is worse than one that is plainly not offered.
           */
          const locked = attribute.kind === "design";
          const named = attribute.kind === "custom";

          return (
          <li key={attribute.id} className="border-line rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={pick(attribute.name, locale)}
                readOnly={!named}
                onChange={(event) =>
                  onChange(
                    attributes.map((candidate, i) =>
                      i === index
                        ? {
                            ...candidate,
                            name: { ...candidate.name, [locale]: event.target.value },
                          }
                        : candidate,
                    ),
                  )
                }
                aria-label={rtl ? "اسم السمة" : "Attribute name"}
                className={cn(input, "w-40 font-medium", !named && "text-ink-muted")}
              />
              {locked && (
                <span className="text-mist text-[0.6875rem]">
                  {rtl ? "يُدار من لوحة التصاميم" : "Managed in the Designs panel"}
                </span>
              )}
              {!locked && (
                <button
                  type="button"
                  onClick={() => onChange(attributes.filter((_, i) => i !== index))}
                  className="text-mist hover:text-alert ms-auto cursor-pointer text-[0.75rem]"
                  data-cursor="hover"
                >
                  {rtl ? "إزالة" : "Remove"}
                </button>
              )}
            </div>

            <input
              value={attribute.values.map((value) => pick(value.label, locale)).join(", ")}
              readOnly={locked}
              onChange={(event) => {
                const values = event.target.value
                  .split(/[,،]/)
                  .map((part) => part.trim())
                  .filter(Boolean)
                  .map((label) => {
                    /*
                     * An existing value keeps its id. Regenerating ids as the
                     * merchant types would detach every row from the value it
                     * is keyed on, and the table would empty itself letter by
                     * letter.
                     */
                    const existing = attribute.values.find(
                      (candidate) =>
                        pick(candidate.label, locale).toLowerCase() === label.toLowerCase(),
                    );
                    if (existing) return existing;
                    return {
                      id:
                        label.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-|-$/g, "") ||
                        label,
                      label: { en: label, ar: label },
                    };
                  });

                onChange(
                  attributes.map((candidate, i) =>
                    i === index ? { ...candidate, values } : candidate,
                  ),
                );
              }}
              placeholder={rtl ? "القيم، مفصولة بفواصل" : "Values, comma separated"}
              aria-label={rtl ? "قيم السمة" : "Attribute values"}
              className={cn(input, "mt-2 w-full", locked && "text-ink-muted")}
            />

            {/*
              A colour axis needs its fills here, because this is now the only
              place they can be set — and a colour without one renders as an
              invisible swatch on the product page.
            */}
            {attribute.kind === "color" && attribute.values.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {attribute.values.map((value, valueIndex) => (
                  <label
                    key={value.id}
                    className="border-line flex items-center gap-1.5 rounded-md border px-2 py-1"
                  >
                    <input
                      type="color"
                      value={value.hex ?? "#c9c9c9"}
                      onChange={(event) =>
                        onChange(
                          attributes.map((candidate, i) =>
                            i === index
                              ? {
                                  ...candidate,
                                  values: candidate.values.map((existing, j) =>
                                    j === valueIndex
                                      ? { ...existing, hex: event.target.value }
                                      : existing,
                                  ),
                                }
                              : candidate,
                          ),
                        )
                      }
                      aria-label={`${pick(value.label, locale)} — ${rtl ? "اللون" : "swatch"}`}
                      className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <span className="text-ink-muted text-[0.75rem]">
                      {pick(value.label, locale)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addAttribute();
            }
          }}
          placeholder={rtl ? "سمة جديدة — السعة، العرض…" : "New attribute — Capacity, Width…"}
          className={cn(input, "w-56")}
        />
        <Button variant="ghost" size="sm" onClick={addAttribute} disabled={!name.trim()}>
          {rtl ? "أضف سمة" : "Add attribute"}
        </Button>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/*  Import                                                                    */
/* -------------------------------------------------------------------------- */

type Step = "idle" | "map" | "preview";

/**
 * Excel, CSV and Google Sheets, through one wizard.
 *
 * The order is the feature: read, map, preview, then write. An importer that
 * goes from "choose file" to "done" is one nobody can trust with five hundred
 * rows, because the first time they find out it read the price column as stock
 * is after it has.
 */
function ImportPanel({
  attributes,
  variants,
  productPrice,
  locale,
  rtl,
  onApply,
}: {
  attributes: ProductAttribute[];
  variants: ProductVariant[];
  productPrice?: number;
  locale: Locale;
  rtl: boolean;
  onApply: (rows: ProductVariant[], nextAttributes?: ProductAttribute[]) => void;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [headers, setHeaders] = useState<string[]>([]);
  const [cells, setCells] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [policy, setPolicy] = useState<ExistingPolicy>("update");
  const [createMissing, setCreateMissing] = useState(true);
  const [sheetUrl, setSheetUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const targets = useMemo(() => targetsFor(attributes), [attributes]);

  const plan = useMemo(() => {
    if (step !== "preview") return null;
    return planVariantImport(cells, mapping, {
      attributes,
      existing: variants,
      productPrice,
      existingPolicy: policy,
      createMissingValues: createMissing,
    });
  }, [step, cells, mapping, attributes, variants, productPrice, policy, createMissing]);

  function load(rows: string[][]) {
    if (rows.length < 2) {
      setError(rtl ? "لا صفوف تحت العناوين." : "There are no rows under the header.");
      return;
    }
    const head = rows[0]!.map((cell) => cell.trim());
    setHeaders(head);
    setCells(rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== "")));
    setMapping(autoMapColumns(head, attributes));
    setStep("map");
    setError(null);
  }

  async function readFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        /*
         * ExcelJS is about a megabyte and is already a dependency for exports.
         * Imported at the moment a spreadsheet is actually chosen, so it never
         * reaches anybody who only edits prices by hand.
         */
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error(rtl ? "الملف فارغ." : "That file is empty.");

        const rows: string[][] = [];
        sheet.eachRow((row) => {
          const values: string[] = [];
          // Width from the sheet, not from the row: a trailing empty cell is
          // simply absent, and the columns would shift left without this.
          for (let col = 1; col <= sheet.columnCount; col += 1) {
            values.push(cellText(row.getCell(col).value));
          }
          rows.push(values);
        });
        load(rows);
      } else {
        load(parseDelimited(await file.text()));
      }
    } catch (readError) {
      setError(
        readError instanceof Error && readError.message
          ? readError.message
          : rtl
            ? "تعذّرت قراءة الملف."
            : "That file could not be read.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function readSheet() {
    if (!sheetUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/sheets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url: sheetUrl.trim() }),
      });
      const body = (await response.json()) as { ok?: boolean; csv?: string; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "");
      load(parseDelimited(body.csv ?? ""));
    } catch (sheetError) {
      setError(
        sheetError instanceof Error && sheetError.message
          ? sheetError.message
          : rtl
            ? "تعذّرت قراءة الجدول."
            : "That sheet could not be read.",
      );
    } finally {
      setBusy(false);
    }
  }

  /** A template whose columns are this product's own axes. */
  function downloadTemplate() {
    const columns = [
      ...attributes.map((attribute) => pick(attribute.name, locale)),
      "SKU",
      "Regular Price",
      "Sale Price",
      "Stock",
      "GTIN",
      "Active",
    ];
    // One example row, so the shape is obvious without reading a manual.
    const example = [
      ...attributes.map((attribute) =>
        attribute.values[0] ? pick(attribute.values[0].label, locale) : "",
      ),
      "",
      String(productPrice ?? 0),
      "",
      "0",
      "",
      "1",
    ];

    const csv = [columns, example]
      .map((row) => row.map((cell) => (/[",\n;]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
      .join("\r\n");

    // The BOM is what makes Excel open UTF-8 correctly on Windows; without it
    // every Arabic heading arrives as mojibake.
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "variants-template.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }

  function confirmImport() {
    if (!plan) return;
    const nextRows = applyImport(variants, plan.rows);
    const nextAttributes = createMissing ? newValuesFor(attributes, plan.newValues) : undefined;
    onApply(nextRows, nextAttributes);
    setStep("idle");
    setHeaders([]);
    setCells([]);
  }

  const totals = plan ? summarise(plan.rows) : null;

  return (
    <Panel
      title={rtl ? "استيراد" : "Import"}
      description={
        rtl
          ? "ملف Excel أو CSV أو رابط Google Sheets. لا يُكتب شيء قبل المعاينة."
          : "Excel, CSV, or a Google Sheets link. Nothing is written before the preview."
      }
      actions={
        <button
          type="button"
          onClick={downloadTemplate}
          className="border-line hover:border-ink text-ink rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors"
          data-cursor="hover"
        >
          {rtl ? "نزّل قالبًا" : "Download template"}
        </button>
      }
    >
      {step === "idle" && (
        <div className="grid gap-3">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              if (!dragging) setDragging(true);
            }}
            onDragLeave={(event) => {
              const next = event.relatedTarget as Node | null;
              if (!next || !event.currentTarget.contains(next)) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void readFile(file);
            }}
            className={cn(
              "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
              dragging ? "border-brand bg-brand-mist/40" : "border-line",
            )}
          >
            <label className="cursor-pointer">
              <span className="text-ink text-[0.8125rem] underline underline-offset-2">
                {rtl ? "اختر ملفًا" : "Choose a file"}
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.txt"
                className="sr-only"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                  event.target.value = "";
                }}
              />
            </label>
            <p className="text-mist mt-1 text-[0.75rem]">
              {rtl ? "أو أفلته هنا · xlsx، xls، csv" : "or drop it here · xlsx, xls, csv"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={sheetUrl}
              onChange={(event) => setSheetUrl(event.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              aria-label={rtl ? "رابط Google Sheets" : "Google Sheets link"}
              className={cn(input, "min-w-0 flex-1")}
            />
            <Button variant="ghost" size="sm" loading={busy} onClick={() => void readSheet()}>
              {rtl ? "اقرأ الجدول" : "Read sheet"}
            </Button>
          </div>
        </div>
      )}

      {step === "map" && (
        <div className="grid gap-3">
          <p className="text-ink-muted text-[0.8125rem]">
            {rtl ? "طابق الأعمدة" : "Match the columns"}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8125rem]">
              <tbody className="divide-line divide-y">
                {headers.map((header, index) => (
                  <tr key={`${header}-${index}`}>
                    <td className="text-ink px-2 py-2 font-medium">{header || "—"}</td>
                    <td className="text-mist max-w-[12rem] truncate px-2 py-2">
                      {cells[0]?.[index] || "—"}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={mapping[index] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value || null;
                          setMapping((current) =>
                            current.map((existing, i) =>
                              // One column per target: two columns claiming the
                              // price would make one of them silently lose.
                              i === index ? value : existing === value && value ? null : existing,
                            ),
                          );
                        }}
                        aria-label={`${rtl ? "يذهب إلى" : "Goes to"} ${header}`}
                        className={cn(input, "min-w-[10rem]")}
                      >
                        <option value="">{rtl ? "تجاهل" : "Ignore"}</option>
                        {targets.map((target) => (
                          <option key={target.key} value={target.key}>
                            {pick(target.label, locale)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[0.8125rem]">
              <span className="text-ink-muted">{rtl ? "الموجود مسبقًا" : "Existing rows"}</span>
              <select
                value={policy}
                onChange={(event) => setPolicy(event.target.value as ExistingPolicy)}
                className={cn(input)}
              >
                <option value="update">{rtl ? "حدّثه" : "Update"}</option>
                <option value="skip">{rtl ? "تخطّه" : "Skip"}</option>
                <option value="error">{rtl ? "اعتبره خطأ" : "Show as error"}</option>
              </select>
            </label>

            <label className="text-ink-muted flex items-center gap-2 text-[0.8125rem]">
              <input
                type="checkbox"
                checked={createMissing}
                onChange={(event) => setCreateMissing(event.target.checked)}
                className="accent-brand h-3.5 w-3.5 cursor-pointer"
              />
              {rtl ? "أنشئ القيم الجديدة" : "Create new attribute values"}
            </label>

            <span className="ms-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("idle")}>
                {rtl ? "رجوع" : "Back"}
              </Button>
              <Button variant="brand" size="sm" onClick={() => setStep("preview")}>
                {rtl ? "معاينة" : "Preview"}
              </Button>
            </span>
          </div>
        </div>
      )}

      {step === "preview" && plan && totals && (
        <div className="grid gap-3">
          <p className="text-ink text-[0.875rem] tabular-nums">
            {rtl
              ? `${totals.total} صفًا · ${totals.create} جديد · ${totals.update} تحديث · ${totals.skip} متخطّى · ${totals.error} بها مشكلة`
              : `${totals.total} rows · ${totals.create} new · ${totals.update} updated · ${totals.skip} skipped · ${totals.error} with errors`}
          </p>

          {plan.newValues.size > 0 && (
            <p className="text-mist text-[0.75rem]">
              {rtl ? "قيم جديدة: " : "New values: "}
              {[...plan.newValues.entries()]
                .map(([id, values]) => `${id} — ${[...values].join(", ")}`)
                .join(" · ")}
            </p>
          )}

          <div className="border-line max-h-56 overflow-auto rounded-md border">
            <table className="w-full text-[0.75rem]">
              <tbody className="divide-line divide-y">
                {plan.rows.map((row) => (
                  <tr key={row.line}>
                    <td className="text-mist w-12 px-2 py-1.5 tabular-nums">{row.line}</td>
                    <td className="px-2 py-1.5">
                      <StatusPill row={row} rtl={rtl} />
                    </td>
                    <td className="text-ink-muted px-2 py-1.5">
                      {row.problems.map((problem) => pick(problem, locale)).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep("map")}>
              {rtl ? "رجوع" : "Back"}
            </Button>
            <Button
              variant="brand"
              size="sm"
              disabled={totals.create + totals.update === 0}
              onClick={confirmImport}
            >
              {rtl
                ? `استورد ${totals.create + totals.update} صفًا`
                : `Import ${totals.create + totals.update} rows`}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-alert mt-3 text-[0.8125rem]">
          {error}
        </p>
      )}
    </Panel>
  );
}

function StatusPill({ row, rtl }: { row: ImportRow; rtl: boolean }) {
  const [label, tone] =
    row.status === "create"
      ? [rtl ? "جديد" : "New", "bg-mint/12 text-mint"]
      : row.status === "update"
        ? [rtl ? "تحديث" : "Update", "bg-brand-mist text-brand-deep"]
        : row.status === "skip"
          ? [rtl ? "متخطّى" : "Skipped", "bg-paper-sunken text-mist"]
          : [rtl ? "مشكلة" : "Error", "bg-alert/10 text-alert"];

  return (
    <span className={cn("rounded-pill inline-flex px-2 py-0.5 text-[0.6875rem]", tone)}>
      {label}
    </span>
  );
}

/** An ExcelJS cell rendered the way a CSV would have written it. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const rich = value as { text?: string; result?: unknown; richText?: { text: string }[] };
    // A formula carries its computed result, rich text its parts. `String()`
    // on either yields "[object Object]" in the middle of the merchant's data.
    if (Array.isArray(rich.richText)) return rich.richText.map((part) => part.text).join("");
    if (rich.result !== undefined) return String(rich.result);
    if (rich.text !== undefined) return rich.text;
    return "";
  }
  return String(value);
}
