"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Link } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { t } from "@/lib/format";
import type { CategoryNode, Locale } from "@/types";

/**
 * The category navigation, in two shapes.
 *
 * Desktop gets a panel that opens under the nav; a phone gets an accordion
 * inside the existing drawer. They are one component because they are one
 * piece of information architecture — building them separately is how the two
 * drift until the phone is missing a department nobody noticed.
 *
 * Empty departments are dropped by default. A category tile that promises
 * pieces and leads to an empty grid is a dead end, and after the seasonal
 * warehouse pulls a department's whole stock that is exactly what it becomes.
 */

export interface CategoryMenuProps {
  tree: CategoryNode[];
  locale?: Locale;
  /** Keep departments with no products. Off by default. */
  showEmpty?: boolean;
}

function usable(tree: CategoryNode[], showEmpty: boolean): CategoryNode[] {
  return tree
    .filter((node) => node.showInNav !== false && !node.hidden)
    .filter((node) => showEmpty || node.productCount > 0)
    .map((node) => ({
      ...node,
      children: node.children.filter(
        (child) =>
          child.showInNav !== false && !child.hidden && (showEmpty || child.productCount > 0),
      ),
    }));
}

/* -------------------------------------------------------------------------- */
/*  Desktop                                                                   */
/* -------------------------------------------------------------------------- */

export function CategoryMegaMenu({ tree, locale = "en", showEmpty = false }: CategoryMenuProps) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const rtl = locale === "ar";

  const departments = usable(tree, showEmpty);

  /*
   * Close on Escape and on focus leaving the whole group. A hover-only menu
   * is unreachable by keyboard, so it opens on focus too — and must therefore
   * know how to close when focus moves past its last link.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onFocus = (event: FocusEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open]);

  if (departments.length === 0) return null;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        className={cn(
          "font-ui ns-underline inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold transition-colors",
          rtl ? "text-[0.9375rem]" : "tracking-[0.1em] uppercase",
          open ? "text-ink" : "text-ink-muted hover:text-ink",
        )}
        data-cursor="hover"
      >
        {rtl ? "الأقسام" : "Categories"}
        <span
          aria-hidden="true"
          className={cn("transition-transform duration-300", open && "rotate-180")}
        >
          ⌄
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            className="bg-paper-raised border-line rounded-2xl shadow-float absolute start-0 top-full z-50 mt-4 w-max max-w-[min(64rem,90vw)] border p-6"
            initial={reduced ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: EASE.brand }}
          >
            <div className="flex gap-8">
              {departments.map((department) => (
                <div key={department.id} className="min-w-[10rem]">
                  <Link
                    href={`/shop?category=${department.id}`}
                    onClick={() => setOpen(false)}
                    className="font-display text-ink hover:text-brand block text-[0.9375rem] font-semibold transition-colors"
                    data-cursor="hover"
                  >
                    {t(department.name, locale)}
                  </Link>
                  <span className="text-mist mt-0.5 block text-[0.6875rem] tabular-nums">
                    {department.productCount} {rtl ? "قطعة" : "pieces"}
                  </span>

                  {department.children.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {department.children.map((child) => (
                        <li key={child.id}>
                          <Link
                            href={`/shop?category=${child.id}`}
                            onClick={() => setOpen(false)}
                            className="text-ink-muted hover:text-ink block text-[0.8125rem] transition-colors"
                            data-cursor="hover"
                          >
                            {t(child.name, locale)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              {/* The featured department's artwork, as an anchor for the eye.
                  A menu of nothing but text lists reads as a sitemap. */}
              {departments.find((d) => d.image) && (
                <Link
                  href={`/shop?category=${departments.find((d) => d.image)!.id}`}
                  onClick={() => setOpen(false)}
                  className="bg-paper-sunken rounded-lg relative hidden h-44 w-36 shrink-0 overflow-hidden xl:block"
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  <Image
                    src={departments.find((d) => d.image)!.image!.url}
                    alt=""
                    fill
                    sizes="144px"
                    className="object-cover"
                  />
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Mobile                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The same tree as a set of disclosures.
 *
 * A department with subcategories is a row plus a toggle rather than one
 * tappable block: tapping the name goes to the department, and tapping the
 * chevron expands it. Merging the two would make it impossible to reach the
 * department itself, which is the usual failure of a mobile accordion menu.
 */
export function CategoryAccordion({
  tree,
  locale = "en",
  showEmpty = false,
  onNavigate,
}: CategoryMenuProps & { onNavigate?: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const rtl = locale === "ar";
  const departments = usable(tree, showEmpty);

  if (departments.length === 0) return null;

  return (
    <div className="border-line mt-2 border-t pt-2">
      <p className="text-eyebrow font-display text-mist mb-1 py-2 uppercase">
        {rtl ? "الأقسام" : "Categories"}
      </p>

      <ul>
        {departments.map((department) => {
          const open = expanded === department.id;
          return (
            <li key={department.id} className="border-line/60 border-b last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/shop?category=${department.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "text-ink min-w-0 flex-1 py-3 text-lg font-semibold tracking-tight",
                    rtl ? "font-arabic" : "font-display",
                  )}
                >
                  {t(department.name, locale)}
                </Link>

                {department.children.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : department.id)}
                    aria-expanded={open}
                    aria-label={`${t(department.name, locale)} — ${
                      rtl ? "الأقسام الفرعية" : "subcategories"
                    }`}
                    className="text-mist grid h-11 w-11 shrink-0 place-items-center"
                  >
                    <span
                      aria-hidden="true"
                      className={cn("transition-transform duration-300", open && "rotate-180")}
                    >
                      ⌄
                    </span>
                  </button>
                )}
              </div>

              <AnimatePresence initial={false}>
                {open && department.children.length > 0 && (
                  <motion.ul
                    className="overflow-hidden ps-3"
                    initial={reduced ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduced ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: EASE.brand }}
                  >
                    {department.children.map((child) => (
                      <li key={child.id}>
                        <Link
                          href={`/shop?category=${child.id}`}
                          onClick={onNavigate}
                          className="text-ink-muted block py-2.5 text-[0.9375rem]"
                        >
                          {t(child.name, locale)}
                          <span className="text-mist ms-2 text-[0.75rem] tabular-nums">
                            {child.productCount}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
