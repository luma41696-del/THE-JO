"use client";

import { useMemo } from "react";

import { stockRuleProblems } from "@/lib/product-options";
import { useAdminLocale } from "./AdminLocale";
import type { StockPriceRule } from "@/types";

/**
 * Mark down the last few.
 *
 * A markdown, never a mark-up: the control offers a percentage off and nothing
 * else, because a price that climbs as stock falls is surge pricing on somebody
 * who can see the counter. The rule itself refuses to raise a price even if one
 * arrives from an import, so this is the door, not the lock.
 *
 * Lifted out of the old options editor unchanged when the variant table
 * replaced it — the rules are about the product, not about one axis, and they
 * outlived the screen they were written on.
 */
export function StockRulesEditor({
  rules,
  onChange,
}: {
  rules: StockPriceRule[];
  onChange: (next: StockPriceRule[]) => void;
}) {
  const { t } = useAdminLocale();
  const problems = useMemo(() => stockRuleProblems(rules), [rules]);

  const box =
    "border-line focus:border-brand bg-paper text-ink w-16 rounded-md border px-2 py-1 text-end text-[0.75rem] tabular-nums outline-none";

  return (
    <div>
      <h4 className="text-ink text-[0.8125rem] font-medium">{t("opt.stockRules")}</h4>
      <p className="text-mist mt-0.5 text-[0.6875rem]">{t("opt.stockRulesHint")}</p>

      <ul className="mt-3 grid gap-2">
        {rules.map((rule, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2">
            <span className="text-ink-muted text-[0.75rem]">{t("opt.whenLeft")}</span>
            <input
              value={rule.whenStockAtOrBelow}
              onChange={(event) =>
                onChange(
                  rules.map((existing, i) =>
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
              className={box}
            />
            <input
              value={rule.percentOff}
              onChange={(event) =>
                onChange(
                  rules.map((existing, i) =>
                    i === index
                      ? { ...existing, percentOff: Number(event.target.value) || 0 }
                      : existing,
                  ),
                )
              }
              inputMode="decimal"
              aria-label={t("opt.percentOff")}
              className={box}
            />
            <span className="text-ink-muted text-[0.75rem]">{t("opt.percentOff")}</span>
            <button
              type="button"
              onClick={() => onChange(rules.filter((_, i) => i !== index))}
              className="text-mist hover:text-alert cursor-pointer text-[0.75rem]"
              data-cursor="hover"
            >
              {t("common.remove")}
            </button>
          </li>
        ))}
      </ul>

      {problems.length > 0 && (
        <p role="alert" className="text-alert mt-2 text-[0.75rem]">
          {problems[0]}
        </p>
      )}

      <button
        type="button"
        onClick={() => onChange([...rules, { whenStockAtOrBelow: 3, percentOff: 10 }])}
        className="border-line hover:border-ink text-ink rounded-pill mt-3 cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors"
        data-cursor="hover"
      >
        {t("opt.addRule")}
      </button>
    </div>
  );
}
