"use client";

import Image from "next/image";
import { Link } from "@/components/ui/Link";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { t } from "@/lib/format";
import type { CategoryNode, Locale } from "@/types";

/**
 * Category tiles.
 *
 * A mosaic rather than a uniform grid: the first tile is double-height, which
 * gives the eye an entry point and stops six equal rectangles from reading as a
 * file browser. Each tile crops its image on hover instead of scaling the whole
 * card, so the layout never shifts.
 *
 * Subcategories are listed *inside* the department tile as direct links rather
 * than hidden behind it. A shopper who already knows they want blazers should
 * not have to land on Outerwear first and filter — that is one wasted page
 * view per visit, and it is the page view where people leave.
 */
export function CategoryGrid({
  categories,
  locale = "en",
}: {
  /** Departments, each carrying its children. */
  categories: CategoryNode[];
  locale?: Locale;
}) {
  const reduced = useReducedMotion();

  return (
    <div className="grid auto-rows-[13rem] grid-cols-2 gap-3 md:auto-rows-[15rem] md:grid-cols-3 md:gap-5 lg:grid-cols-4">
      {categories.map((category, index) => {
        const feature = index === 0;

        return (
          <motion.div
            key={category.id}
            className={cn("relative", feature && "col-span-2 row-span-2")}
            initial={reduced ? undefined : { opacity: 0, y: 24 }}
            whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-8%" }}
            transition={{ duration: 0.55, ease: EASE.brand, delay: index * 0.06 }}
          >
            <Link
              href={`/shop?category=${category.slug}`}
              className="rounded-lg group relative block h-full overflow-hidden"
              data-cursor="view"
              data-cursor-label={locale === "ar" ? "تصفّح" : "Browse"}
            >
              {category.image && (
                <Image
                  src={category.image.url}
                  alt=""
                  fill
                  sizes={feature ? "(max-width: 768px) 100vw, 50vw" : "(max-width: 768px) 50vw, 25vw"}
                  className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.07]"
                />
              )}

              <div className="from-ink/75 via-ink/15 absolute inset-0 bg-gradient-to-t to-transparent" />

              <div className="absolute inset-x-0 bottom-0 p-5 md:p-6">
                <h3
                  className={cn(
                    "font-display font-semibold tracking-tight text-white",
                    feature ? "text-2xl md:text-4xl" : "text-lg md:text-xl",
                  )}
                >
                  {t(category.name, locale)}
                </h3>

                {feature && category.description && (
                  <p className="mt-2 max-w-sm text-[0.875rem] text-white/70">
                    {t(category.description, locale)}
                  </p>
                )}

                <span className="mt-3 flex items-center gap-2 text-[0.6875rem] tracking-[0.16em] text-white/60 uppercase">
                  {category.productCount} {locale === "ar" ? "قطعة" : "pieces"}
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-300 group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1"
                  >
                    →
                  </span>
                </span>
              </div>
            </Link>

            {/* Subcategory shortcuts, layered over the tile's own link.
                Absolutely positioned so they sit inside the card without
                nesting an anchor in an anchor, which is invalid and makes the
                whole tile unclickable in some browsers. */}
            {category.children.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-0 p-4 md:p-5">
                <ul className="pointer-events-auto flex flex-wrap gap-1.5">
                  {category.children.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={`/shop?category=${child.id}`}
                        className="rounded-pill bg-white/15 px-2.5 py-1 text-[0.6875rem] font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
                        data-cursor="hover"
                      >
                        {t(child.name, locale)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
