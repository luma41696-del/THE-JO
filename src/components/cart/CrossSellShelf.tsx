"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";

import { Link } from "@/components/ui/Link";
import { Price } from "@/components/ui/Price";
import { EASE } from "@/lib/motion";
import { t } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCart } from "@/lib/store/cart";
import { hasOptions, resolveSelection } from "@/lib/product";
import type { Locale, Product } from "@/types";

/**
 * Cross-sell shelf — "along with this".
 *
 * Shown in the bag, never on the product page. At the product stage a
 * suggestion competes with the decision in front of the customer; once the
 * item is in the bag, that decision is made and a complement is genuinely
 * useful rather than a distraction.
 *
 * Two rules keep this from becoming a junk drawer:
 *  - It only renders what the merchant explicitly linked. No "customers also
 *    bought" filler — the whole value is that a leather balm next to a leather
 *    tote is a real recommendation.
 *  - A **simple** cross-sell adds straight to the bag from here. A variable
 *    one links to its page instead, because adding without choosing a size
 *    would either guess or silently fail, and both are worse than a link.
 */

export interface CrossSellShelfProps {
  products: Product[];
  locale?: Locale;
  /** Product ids already in the bag, so nothing suggests what is already there. */
  inBag?: string[];
  className?: string;
}

export function CrossSellShelf({
  products,
  locale = "en",
  inBag = [],
  className,
}: CrossSellShelfProps) {
  const rtl = locale === "ar";
  const add = useCart((s) => s.add);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const shown = useMemo(
    () => products.filter((p) => !inBag.includes(p.id)).slice(0, 3),
    [products, inBag],
  );

  if (shown.length === 0) return null;

  return (
    <section className={cn("border-line rounded-xl border p-5 md:p-6", className)}>
      <h2 className="font-display text-ink text-[1.0625rem] font-semibold tracking-tight">
        {rtl ? "يُكمل طلبك" : "Completes your order"}
      </h2>
      <p className="text-smoke mt-1 text-[0.8125rem]">
        {rtl
          ? "قطع صغيرة تُطيل عمر ما اخترته."
          : "Small things that make the rest last longer."}
      </p>

      <ul className="mt-5 grid gap-3">
        {shown.map((product) => {
          const simple = !hasOptions(product);
          const selection = resolveSelection(product);
          const added = justAdded === product.id;

          return (
            <li
              key={product.id}
              className="border-line flex items-center gap-3 rounded-lg border p-2.5"
            >
              <Link
                href={`/product/${product.slug}`}
                className="bg-paper-sunken rounded-md relative h-16 w-14 shrink-0 overflow-hidden"
                aria-hidden="true"
                tabIndex={-1}
              >
                {product.images[0] && (
                  <Image src={product.images[0].url} alt="" fill sizes="56px" className="object-cover" />
                )}
              </Link>

              <div className="min-w-0 flex-1">
                <Link
                  href={`/product/${product.slug}`}
                  className="text-ink ns-underline block truncate text-[0.875rem] font-medium"
                  data-cursor="hover"
                >
                  {t(product.title, locale)}
                </Link>
                <Price
                  value={product.price}
                  currency={product.currency}
                  locale={locale}
                  size="sm"
                  className="mt-0.5"
                />
              </div>

              {simple && selection.buyable ? (
                <motion.button
                  type="button"
                  onClick={() => {
                    add({ product, quantity: 1 });
                    setJustAdded(product.id);
                    window.setTimeout(() => setJustAdded(null), 1600);
                  }}
                  className={cn(
                    "shrink-0 rounded-pill px-3.5 py-2 text-[0.75rem] font-semibold whitespace-nowrap transition-colors",
                    added
                      ? "bg-mint/12 text-mint"
                      : "border-ink text-ink hover:bg-ink border hover:text-white",
                  )}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.2, ease: EASE.spring }}
                  data-cursor="hover"
                >
                  {added ? (rtl ? "أُضيف ✓" : "Added ✓") : rtl ? "أضف" : "Add"}
                </motion.button>
              ) : (
                <Link
                  href={`/product/${product.slug}`}
                  className="border-line text-ink hover:border-ink shrink-0 rounded-pill border px-3.5 py-2 text-[0.75rem] font-semibold whitespace-nowrap transition-colors"
                  data-cursor="hover"
                >
                  {rtl ? "اختر" : "Choose"}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
