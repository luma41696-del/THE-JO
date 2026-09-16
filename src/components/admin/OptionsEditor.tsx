"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { useAdminLocale } from "./AdminLocale";
import {
  COLOR_PALETTE,
  MAX_VARIANTS,
  SIZE_PRESETS,
  combinationCount,
  duplicateSkus,
  generateVariants,
  isHex,
  normaliseSku,
  stockRuleProblems,
  optionId,
} from "@/lib/product-options";
import type {
  ProductColor,
  ProductDesign,
  ProductSize,
  ProductVariant,
  StockPriceRule,
} from "@/types";

/**
 * Colours, sizes, and the table of sellable units they produce.
 *
 * Until now a product's colours and sizes could not be edited at all — the
 * editor only *read* them to draw a stock grid, and the save route dropped
 * them on the floor. So a product created in the admin had no options, no
 * variants that resolved, and no way to get any. This is that half.
 *
 * The shape of the screen follows the shape of the decision: choose the axes
 * first, then generate the units, then price and count them. A merchant who
 * has not chosen an axis has nothing to price, and showing them an empty
 * matrix first is how that gets confusing.
 */

export interface OptionsEditorProps {
  baseSku: string;
  colors: ProductColor[];
  sizes: ProductSize[];
  designs: ProductDesign[];
  variants: ProductVariant[];
  onColorsChange: (next: ProductColor[]) => void;
  onSizesChange: (next: ProductSize[]) => void;
  onVariantsChange: (next: ProductVariant[]) => void;
  stockRules?: StockPriceRule[];
  onStockRulesChange?: (next: StockPriceRule[]) => void;
}

export function OptionsEditor({
  baseSku,
  colors,
  sizes,
  designs,
  variants,
  onColorsChange,
  onSizesChange,
  onVariantsChange,
  stockRules = [],
  onStockRulesChange,
}: OptionsEditorProps) {
  const { t, locale } = useAdminLocale();

  const [customName, setCustomName] = useState("");
  const [customHex, setCustomHex] = useState("#1F44B8");
  const [sizeLabel, setSizeLabel] = useState("");
  const [bulkPrice, setBulkPrice] = useState<string>("");
  const [bulkStock, setBulkStock] = useState<string>("");

  const pending = combinationCount(colors, sizes, designs);
  const dupes = useMemo(() => duplicateSkus(variants), [variants]);
  // Checked as they type, so a bad rule is named before the save refuses it.
  const ruleProblems = useMemo(() => stockRuleProblems(stockRules), [stockRules]);

  /* ---- colours --------------------------------------------------------- */

  function toggleColor(colour: ProductColor) {
    const present = colors.some((c) => c.id === colour.id);
    onColorsChange(present ? colors.filter((c) => c.id !== colour.id) : [...colors, colour]);
  }

  function addCustomColor() {
    const name = customName.trim();
    if (!name || !isHex(customHex)) return;
    const id = optionId(name);
    if (colors.some((c) => c.id === id)) return;
    onColorsChange([...colors, { id, name: { en: name, ar: name }, hex: customHex }]);
    setCustomName("");
  }

  /* ---- sizes ----------------------------------------------------------- */

  function applyPreset(key: string) {
    const preset = SIZE_PRESETS[key];
    if (!preset) return;
    // Merged, not replaced: a merchant adding the shoe run to a product that
    // already has one-size should not silently lose the one they had.
    const existing = new Set(sizes.map((s) => s.id));
    onSizesChange([...sizes, ...preset.sizes.filter((s) => !existing.has(s.id))]);
  }

  function addSize() {
    const label = sizeLabel.trim();
    if (!label) return;
    const id = optionId(label);
    if (sizes.some((s) => s.id === id)) return;
    onSizesChange([...sizes, { id, label, system: "alpha" }]);
    setSizeLabel("");
  }

  /* ---- the table ------------------------------------------------------- */

  function regenerate() {
    if (pending > MAX_VARIANTS) return;
    onVariantsChange(
      generateVariants({ baseSku, colors, sizes, designs, existing: variants }),
    );
  }

  function patchVariant(sku: string, patch: Partial<ProductVariant>) {
    onVariantsChange(variants.map((v) => (v.sku === sku ? { ...v, ...patch } : v)));
  }

  function fillPrices() {
    const value = Number(bulkPrice);
    if (!Number.isFinite(value) || value < 0) return;
    onVariantsChange(variants.map((v) => ({ ...v, priceOverride: value })));
    setBulkPrice("");
  }

  function fillStock() {
    const value = Number(bulkStock);
    if (!Number.isFinite(value) || value < 0) return;
    onVariantsChange(variants.map((v) => ({ ...v, stock: Math.floor(value) })));
    setBulkStock("");
  }

  const nameOf = (colour: ProductColor) => (locale === "ar" ? colour.name.ar : colour.name.en);

  return (
    <div className="space-y-6">
      {/* ---- Colours ----------------------------------------------------- */}
      <section>
        <p className="text-ink-muted mb-2 text-[0.75rem]">{t("opt.colours")}</p>
        <div className="flex flex-wrap gap-2">
          {COLOR_PALETTE.map((colour) => {
            const on = colors.some((c) => c.id === colour.id);
            return (
              <button
                key={colour.id}
                type="button"
                onClick={() => toggleColor(colour)}
                aria-pressed={on}
                className={cn(
                  "rounded-pill flex cursor-pointer items-center gap-2 border px-2.5 py-1.5 text-[0.75rem] transition-colors",
                  on ? "border-ink bg-ink text-white" : "border-line text-ink-muted hover:border-ink",
                )}
                data-cursor="hover"
              >
                <span
                  className="border-line/60 h-3.5 w-3.5 shrink-0 rounded-full border"
                  style={{ backgroundColor: colour.hex }}
                  aria-hidden="true"
                />
                {nameOf(colour)}
              </button>
            );
          })}
        </div>

        {/* A colour the palette does not carry. Still gets a stable id. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={t("opt.customColour")}
            className="border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-44 rounded-md border px-3 py-1.5 text-[0.8125rem] outline-none"
          />
          <input
            type="color"
            value={customHex}
            onChange={(e) => setCustomHex(e.target.value)}
            aria-label={t("opt.swatch")}
            className="border-line h-8 w-12 cursor-pointer rounded-md border"
          />
          <Button variant="secondary" size="sm" onClick={addCustomColor} disabled={!customName.trim()}>
            {t("common.add")}
          </Button>
        </div>

        {colors.length > 0 && (
          <p className="text-mist mt-2 text-[0.6875rem]">
            {colors.map(nameOf).join(" · ")}
          </p>
        )}
      </section>

      {/* ---- Sizes ------------------------------------------------------- */}
      <section>
        <p className="text-ink-muted mb-2 text-[0.75rem]">{t("opt.sizes")}</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(SIZE_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className="border-line text-ink-muted hover:border-ink rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors"
              data-cursor="hover"
            >
              + {preset.label[locale]}
            </button>
          ))}
        </div>

        {sizes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {sizes.map((size) => (
              <span
                key={size.id}
                className="border-line rounded-pill flex items-center gap-2 border px-2.5 py-1 text-[0.75rem]"
              >
                {size.label}
                <button
                  type="button"
                  onClick={() => onSizesChange(sizes.filter((s) => s.id !== size.id))}
                  aria-label={`${t("common.remove")} ${size.label}`}
                  className="text-mist hover:text-alert cursor-pointer"
                  data-cursor="hover"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={sizeLabel}
            onChange={(e) => setSizeLabel(e.target.value)}
            placeholder={t("opt.customSize")}
            className="border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-32 rounded-md border px-3 py-1.5 text-[0.8125rem] outline-none"
          />
          <Button variant="secondary" size="sm" onClick={addSize} disabled={!sizeLabel.trim()}>
            {t("common.add")}
          </Button>
        </div>
      </section>

      {/* ---- The table --------------------------------------------------- */}
      <section className="border-line border-t pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-ink text-[0.875rem] font-medium">{t("opt.units")}</p>
            {/*
              The count before the click. A merchant who has mis-set an axis
              is about to make a table nobody can edit, and the number is the
              cheapest possible warning.
            */}
            <p className="text-mist text-[0.6875rem]">
              {pending} {t("opt.combinations")}
              {variants.length > 0 && ` · ${variants.length} ${t("opt.existing")}`}
            </p>
          </div>
          <Button
            variant="brand"
            size="sm"
            onClick={regenerate}
            disabled={pending > MAX_VARIANTS || (colors.length === 0 && sizes.length === 0)}
          >
            {t("opt.generate")}
          </Button>
        </div>

        {pending > MAX_VARIANTS && (
          <p role="alert" className="text-alert mb-3 text-[0.8125rem]">
            {t("opt.tooMany")} ({pending} &gt; {MAX_VARIANTS})
          </p>
        )}

        {dupes.length > 0 && (
          <p role="alert" className="text-alert mb-3 text-[0.8125rem]">
            {t("opt.duplicateSku")}: {dupes.join(", ")}
          </p>
        )}

        {variants.length > 0 && (
          <>
            {/* Bulk fills: typing one price into forty rows is the job. */}
            <div className="border-line mb-3 flex flex-wrap items-center gap-2 rounded-md border p-2.5">
              <input
                value={bulkPrice}
                onChange={(e) => setBulkPrice(e.target.value)}
                inputMode="decimal"
                placeholder={t("opt.priceAll")}
                className="border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-28 rounded-md border px-2.5 py-1.5 text-[0.8125rem] tabular-nums outline-none"
              />
              <Button variant="ghost" size="sm" onClick={fillPrices} disabled={!bulkPrice.trim()}>
                {t("opt.applyAll")}
              </Button>
              <span className="border-line mx-1 h-6 border-s" />
              <input
                value={bulkStock}
                onChange={(e) => setBulkStock(e.target.value)}
                inputMode="numeric"
                placeholder={t("opt.stockAll")}
                className="border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-28 rounded-md border px-2.5 py-1.5 text-[0.8125rem] tabular-nums outline-none"
              />
              <Button variant="ghost" size="sm" onClick={fillStock} disabled={!bulkStock.trim()}>
                {t("opt.applyAll")}
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="text-mist text-[0.625rem] tracking-[0.12em] uppercase">
                    <th className="pb-2 text-start font-medium">{t("opt.unit")}</th>
                    <th className="pb-2 text-start font-medium">{t("off.code")}</th>
                    <th className="pb-2 text-end font-medium">{t("col.price")}</th>
                    <th className="pb-2 text-end font-medium">{t("col.stock")}</th>
                    <th className="pb-2 text-start font-medium">{t("pe.gtin")}</th>
                    <th className="pb-2 text-center font-medium">{t("opt.sold")}</th>
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {variants.map((variant) => {
                    const colour = colors.find((c) => c.id === variant.colorId);
                    const size = sizes.find((s) => s.id === variant.sizeId);
                    const design = designs.find((d) => d.id === variant.designId);

                    return (
                      <tr key={variant.sku}>
                        <td className="py-2 pe-3">
                          <span className="flex items-center gap-2">
                            {colour && (
                              <span
                                className="border-line/60 h-3 w-3 shrink-0 rounded-full border"
                                style={{ backgroundColor: colour.hex }}
                                aria-hidden="true"
                              />
                            )}
                            <span className="text-ink-muted whitespace-nowrap">
                              {[
                                colour ? nameOf(colour) : null,
                                size?.label,
                                design ? (locale === "ar" ? design.name.ar : design.name.en) : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </span>
                          </span>
                        </td>
                        <td className="py-2 pe-3">
                          <input
                            value={variant.sku}
                            onChange={(e) =>
                              patchVariant(variant.sku, { sku: normaliseSku(e.target.value) })
                            }
                            className="border-line focus:border-brand bg-paper text-ink w-40 rounded-md border px-2 py-1 font-mono text-[0.75rem] outline-none"
                          />
                        </td>
                        <td className="py-2 pe-3 text-end">
                          <input
                            value={variant.priceOverride ?? ""}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              patchVariant(variant.sku, {
                                priceOverride: raw === "" ? undefined : Number(raw),
                              });
                            }}
                            inputMode="decimal"
                            placeholder="—"
                            className="border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-20 rounded-md border px-2 py-1 text-end tabular-nums outline-none"
                          />
                        </td>
                        <td className="py-2 pe-3 text-end">
                          <input
                            value={variant.stock}
                            onChange={(e) =>
                              patchVariant(variant.sku, {
                                stock: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                              })
                            }
                            inputMode="numeric"
                            className="border-line focus:border-brand bg-paper text-ink w-16 rounded-md border px-2 py-1 text-end tabular-nums outline-none"
                          />
                        </td>
                        <td className="py-2 pe-3">
                          <input
                            value={variant.gtin ?? ""}
                            onChange={(e) =>
                              patchVariant(variant.sku, { gtin: e.target.value.trim() || undefined })
                            }
                            placeholder="—"
                            className="border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-32 rounded-md border px-2 py-1 font-mono text-[0.75rem] outline-none"
                          />
                        </td>
                        <td className="py-2 text-center">
                          {/*
                            Switching a combination off, which is not the same
                            as setting its stock to zero.

                            Zero says "we have run out" — it invites the
                            customer to wait and to ask to be told when it
                            returns. This says "we do not make this one", which
                            is the truth for a permutation that was never cut,
                            and it keeps the count intact for the day it is.
                          */}
                          <input
                            type="checkbox"
                            checked={variant.available !== false}
                            onChange={(e) =>
                              patchVariant(variant.sku, {
                                // Written only when false, so a product that
                                // never disables anything carries no new field.
                                available: e.target.checked ? undefined : false,
                              })
                            }
                            aria-label={`${t("opt.sold")} ${variant.sku}`}
                            className="accent-brand h-3.5 w-3.5 cursor-pointer"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-mist mt-3 text-[0.6875rem]">{t("opt.priceHint")}</p>

            {/*
              Clearing the tail of a run.

              A markdown, never a mark-up: the control offers a percentage off
              and nothing else, because a price that climbs as stock falls is
              surge pricing on somebody who can see the counter. The rule
              itself refuses to raise a price even if one arrives from an
              import, so this is the door, not the lock.
            */}
            {onStockRulesChange && (
              <div className="border-line mt-5 border-t pt-4">
                <h4 className="text-ink text-[0.8125rem] font-medium">{t("opt.stockRules")}</h4>
                <p className="text-mist mt-0.5 text-[0.6875rem]">{t("opt.stockRulesHint")}</p>

                <ul className="mt-3 grid gap-2">
                  {stockRules.map((rule, index) => (
                    <li key={index} className="flex flex-wrap items-center gap-2">
                      <span className="text-ink-muted text-[0.75rem]">{t("opt.whenLeft")}</span>
                      <input
                        value={rule.whenStockAtOrBelow}
                        onChange={(event) =>
                          onStockRulesChange(
                            stockRules.map((existing, i) =>
                              i === index
                                ? {
                                    ...existing,
                                    whenStockAtOrBelow: Math.max(
                                      0,
                                      Math.floor(Number(event.target.value) || 0),
                                    ),
                                  }
                                : existing,
                            ),
                          )
                        }
                        inputMode="numeric"
                        aria-label={t("opt.whenLeft")}
                        className="border-line focus:border-brand bg-paper text-ink w-16 rounded-md border px-2 py-1 text-end text-[0.75rem] tabular-nums outline-none"
                      />
                      <input
                        value={rule.percentOff}
                        onChange={(event) =>
                          onStockRulesChange(
                            stockRules.map((existing, i) =>
                              i === index
                                ? { ...existing, percentOff: Number(event.target.value) || 0 }
                                : existing,
                            ),
                          )
                        }
                        inputMode="decimal"
                        aria-label={t("opt.percentOff")}
                        className="border-line focus:border-brand bg-paper text-ink w-16 rounded-md border px-2 py-1 text-end text-[0.75rem] tabular-nums outline-none"
                      />
                      <span className="text-ink-muted text-[0.75rem]">{t("opt.percentOff")}</span>
                      <button
                        type="button"
                        onClick={() =>
                          onStockRulesChange(stockRules.filter((_, i) => i !== index))
                        }
                        className="text-mist hover:text-alert cursor-pointer text-[0.75rem]"
                        data-cursor="hover"
                      >
                        {t("common.remove")}
                      </button>
                    </li>
                  ))}
                </ul>

                {ruleProblems.length > 0 && (
                  <p role="alert" className="text-alert mt-2 text-[0.75rem]">
                    {ruleProblems[0]}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() =>
                    onStockRulesChange([
                      ...stockRules,
                      { whenStockAtOrBelow: 3, percentOff: 10 },
                    ])
                  }
                  className="border-line hover:border-ink text-ink rounded-pill mt-3 cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors"
                  data-cursor="hover"
                >
                  {t("opt.addRule")}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
