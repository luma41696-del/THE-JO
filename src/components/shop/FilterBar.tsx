"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";
import { t } from "@/lib/format";
import { Chip } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { Category, Locale, Product, SortOption } from "@/types";

/**
 * Product listing filters.
 *
 * State lives in the URL, not in React. That single decision buys shareable
 * filtered links, working browser back/forward, and server-rendered results —
 * and it means the filter UI holds no state that can drift from what is shown.
 *
 * Updates are wrapped in `useTransition`, so the current results stay on screen
 * and dim slightly while the server re-renders instead of collapsing to a
 * spinner.
 */

const SORTS: SortOption[] = [
  { id: "featured", label: { en: "Featured", ar: "المميزة" } },
  { id: "newest", label: { en: "Newest", ar: "الأحدث" } },
  { id: "price-asc", label: { en: "Price: low to high", ar: "السعر: من الأقل" } },
  { id: "price-desc", label: { en: "Price: high to low", ar: "السعر: من الأعلى" } },
  { id: "rating", label: { en: "Top rated", ar: "الأعلى تقييماً" } },
];

export interface FilterBarProps {
  categories: Category[];
  /** The full catalogue, used to derive the available colour and size facets. */
  products: Product[];
  resultCount: number;
  locale?: Locale;
}

export function FilterBar({ categories, products, resultCount, locale = "en" }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const rtl = locale === "ar";

  const active = {
    category: params.get("category"),
    color: params.getAll("color"),
    size: params.getAll("size"),
    sort: params.get("sort") ?? "featured",
    onSale: params.get("onSale") === "true",
    inStock: params.get("inStock") === "true",
  };

  // Facets are derived from the catalogue rather than hard-coded, so a new
  // colourway appears in the filters the moment it appears in a product.
  const facets = useMemo(() => {
    const colors = new Map<string, { id: string; name: string; hex: string }>();
    const sizes = new Map<string, { id: string; label: string; order: number }>();

    products.forEach((product) => {
      product.colors.forEach((color) => {
        if (!colors.has(color.id)) {
          colors.set(color.id, { id: color.id, name: t(color.name, locale), hex: color.hex });
        }
      });
      product.sizes.forEach((size, index) => {
        if (!sizes.has(size.id)) {
          sizes.set(size.id, { id: size.id, label: size.label, order: index });
        }
      });
    });

    return {
      colors: [...colors.values()],
      sizes: [...sizes.values()].sort((a, b) => a.order - b.order),
    };
  }, [products, locale]);

  const push = useCallback(
    (next: URLSearchParams) => {
      startTransition(() => {
        const query = next.toString();
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [pathname, router],
  );

  const toggleMulti = useCallback(
    (key: "color" | "size", value: string) => {
      const next = new URLSearchParams(params.toString());
      const current = next.getAll(key);
      next.delete(key);
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      updated.forEach((v) => next.append(key, v));
      push(next);
    },
    [params, push],
  );

  const setSingle = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);
      push(next);
    },
    [params, push],
  );

  const activeCount =
    active.color.length +
    active.size.length +
    (active.category ? 1 : 0) +
    (active.onSale ? 1 : 0) +
    (active.inStock ? 1 : 0);

  return (
    <div
      className={cn(
        "ns-container transition-opacity duration-300",
        isPending && "pointer-events-none opacity-60",
      )}
    >
      {/* Category rail — always visible; it is the primary navigation. */}
      <div className="ns-no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-4 md:mx-0 md:flex-wrap md:px-0">
        <Chip active={!active.category} onClick={() => setSingle("category", null)}>
          {rtl ? "الكل" : "All"}
        </Chip>
        {categories.map((category) => (
          <Chip
            key={category.id}
            active={active.category === category.slug}
            onClick={() =>
              setSingle("category", active.category === category.slug ? null : category.slug)
            }
          >
            {t(category.name, locale)}
          </Chip>
        ))}
      </div>

      {/* Toolbar */}
      <div className="border-line flex flex-wrap items-center justify-between gap-3 border-y py-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={cn(
              "rounded-pill inline-flex cursor-pointer items-center gap-2 border px-4 py-2 text-[0.8125rem] transition-colors",
              activeCount > 0
                ? "border-ink bg-ink text-white"
                : "border-line text-ink hover:border-ink/40",
            )}
            data-cursor="hover"
          >
            <FilterIcon />
            {rtl ? "تصفية" : "Filters"}
            {activeCount > 0 && (
              <span className="bg-brand grid h-4.5 min-w-4.5 place-items-center rounded-full px-1 text-[0.625rem] tabular-nums">
                {activeCount}
              </span>
            )}
          </button>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => push(new URLSearchParams(active.sort !== "featured" ? { sort: active.sort } : {}))}
              className="text-smoke hover:text-ink cursor-pointer text-[0.8125rem] underline-offset-4 transition-colors hover:underline"
              data-cursor="hover"
            >
              {rtl ? "مسح الكل" : "Clear all"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span className="text-smoke text-[0.8125rem] tabular-nums" aria-live="polite">
            {resultCount} {rtl ? "قطعة" : resultCount === 1 ? "piece" : "pieces"}
          </span>

          <label className="flex items-center gap-2">
            <span className="sr-only">{rtl ? "ترتيب" : "Sort by"}</span>
            <select
              value={active.sort}
              onChange={(event) => setSingle("sort", event.target.value)}
              className="border-line text-ink rounded-pill cursor-pointer border bg-transparent py-2 ps-4 pe-8 text-[0.8125rem] outline-none"
              data-cursor="hover"
            >
              {SORTS.map((sort) => (
                <option key={sort.id} value={sort.id}>
                  {t(sort.label, locale)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Expanded facets */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition.base}
            className="overflow-hidden"
          >
            <div className="border-line grid gap-8 border-b py-7 sm:grid-cols-2 lg:grid-cols-4">
              <Facet title={rtl ? "اللون" : "Colour"}>
                <div className="flex flex-wrap gap-2">
                  {facets.colors.map((color) => {
                    const on = active.color.includes(color.id);
                    return (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => toggleMulti("color", color.id)}
                        aria-pressed={on}
                        title={color.name}
                        className={cn(
                          "rounded-pill flex cursor-pointer items-center gap-2 border px-3 py-1.5 text-[0.75rem] transition-all",
                          on ? "border-ink bg-ink text-white" : "border-line text-ink-muted hover:border-ink/40",
                        )}
                        data-cursor="hover"
                      >
                        <span
                          className="ring-ink/10 h-3 w-3 rounded-full ring-1"
                          style={{ background: color.hex }}
                        />
                        {color.name}
                      </button>
                    );
                  })}
                </div>
              </Facet>

              <Facet title={rtl ? "المقاس" : "Size"}>
                <div className="flex flex-wrap gap-1.5">
                  {facets.sizes.map((size) => (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => toggleMulti("size", size.id)}
                      aria-pressed={active.size.includes(size.id)}
                      className={cn(
                        "rounded-xs min-w-10 cursor-pointer border px-2.5 py-1.5 text-[0.75rem] transition-all",
                        active.size.includes(size.id)
                          ? "border-ink bg-ink text-white"
                          : "border-line text-ink-muted hover:border-ink/40",
                      )}
                      data-cursor="hover"
                    >
                      {size.label}
                    </button>
                  ))}
                </div>
              </Facet>

              <Facet title={rtl ? "التوفر" : "Availability"}>
                <div className="flex flex-col gap-2.5">
                  <Toggle
                    label={rtl ? "متوفر فقط" : "In stock only"}
                    checked={active.inStock}
                    onChange={(v) => setSingle("inStock", v ? "true" : null)}
                  />
                  <Toggle
                    label={rtl ? "المخفّضة فقط" : "On sale only"}
                    checked={active.onSale}
                    onChange={(v) => setSingle("onSale", v ? "true" : null)}
                  />
                </div>
              </Facet>

              <Facet title={rtl ? "السعر" : "Price"}>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: rtl ? "أقل من ٥٠٠" : "Under 500", max: "500" },
                    { label: "500 – 1000", min: "500", max: "1000" },
                    { label: rtl ? "أكثر من ١٠٠٠" : "Over 1000", min: "1000" },
                  ].map((band) => {
                    const on = params.get("minPrice") === (band.min ?? null) &&
                      params.get("maxPrice") === (band.max ?? null);
                    return (
                      <Chip
                        key={band.label}
                        active={on}
                        onClick={() => {
                          const next = new URLSearchParams(params.toString());
                          next.delete("minPrice");
                          next.delete("maxPrice");
                          if (!on) {
                            if (band.min) next.set("minPrice", band.min);
                            if (band.max) next.set("maxPrice", band.max);
                          }
                          push(next);
                        }}
                      >
                        {band.label}
                      </Chip>
                    );
                  })}
                </div>
              </Facet>
            </div>

            <div className="flex justify-end py-4">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {rtl ? "إغلاق" : "Done"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Facet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-eyebrow text-mist mb-3 uppercase">{title}</h3>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="text-ink-muted flex cursor-pointer items-center gap-2.5 text-[0.8125rem]">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-300",
          checked ? "bg-brand" : "bg-line-strong",
        )}
        data-cursor="hover"
      >
        {/* `insetInlineStart`, not `left`: in RTL the knob has to travel from
            the right edge, and a physical `left` would slide it backwards. */}
        <motion.span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm"
          initial={false}
          animate={{ insetInlineStart: checked ? 18 : 2 }}
          transition={{ duration: 0.24, ease: EASE.spring }}
        />
      </button>
      {label}
    </label>
  );
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M1.5 3.5h11M3.5 7h7M5.5 10.5h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
