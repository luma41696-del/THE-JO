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
   * Which department the panel is showing.
   *
   * Held rather than derived from hover alone, so the panel still has
   * contents when the menu is opened by keyboard and nothing has been
   * pointed at yet — an empty panel on first open reads as broken.
   */
  const [activeId, setActiveId] = useState<string | null>(null);
  const active =
    departments.find((department) => department.id === activeId) ?? departments[0];

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
            className="bg-paper-raised border-line rounded-2xl shadow-float absolute start-0 top-full z-50 mt-4 flex max-h-[min(34rem,70vh)] w-max max-w-[min(72rem,94vw)] overflow-hidden border"
            initial={reduced ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: EASE.brand }}
          >
            {/*
              A rail of departments, and a panel for the one being pointed at.
              The alternative — every department's contents side by side — is
              what this replaced, and it forces each column narrow enough that
              only a text list fits. A rail buys the width to show what things
              actually look like, which is the whole reason a clothing shop has
              a picture menu at all.
            */}
            <ul
              className="border-line bg-paper-sunken/40 w-52 shrink-0 overflow-y-auto border-e py-2"
              role="tablist"
              aria-orientation="vertical"
            >
              {departments.map((department) => {
                const active = department.id === activeId;
                return (
                  <li key={department.id}>
                    <Link
                      href={`/shop?category=${department.slug}`}
                      role="tab"
                      aria-selected={active}
                      /*
                       * Pointing at a department shows it; clicking goes to it.
                       * Requiring a click to preview would make browsing the
                       * menu cost a page load each time, and a rail that only
                       * previews would strand anybody who wants the department
                       * itself.
                       */
                      onMouseEnter={() => setActiveId(department.id)}
                      onFocus={() => setActiveId(department.id)}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center justify-between gap-2 px-4 py-2.5 text-[0.875rem] transition-colors",
                        active
                          ? "bg-paper-raised text-ink font-medium"
                          : "text-ink-muted hover:text-ink",
                      )}
                      data-cursor="hover"
                    >
                      <span className="truncate">{t(department.name, locale)}</span>
                      <span aria-hidden="true" className="text-mist shrink-0 text-[0.75rem]">
                        {rtl ? "‹" : "›"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="min-w-0 flex-1 overflow-y-auto p-6">
              {groupsFor(active, locale, rtl).map((group) => (
                <section key={group.id} className="mb-7 last:mb-0">
                  <h3 className="font-display text-ink mb-4 text-[0.8125rem] font-semibold tracking-[0.08em] uppercase">
                    {group.title}
                  </h3>

                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-x-3 gap-y-5">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={`/shop?category=${item.slug}`}
                          onClick={() => setOpen(false)}
                          className="group/tile flex flex-col items-center gap-2 text-center"
                          data-cursor="hover"
                        >
                          <span
                            className={cn(
                              "bg-paper-sunken relative grid h-[4.5rem] w-[4.5rem] shrink-0 place-items-center overflow-hidden rounded-full transition-transform duration-200 group-hover/tile:scale-105",
                              item.viewAll && "border-line border",
                            )}
                          >
                            {item.image ? (
                              <Image
                                src={item.image.url}
                                /*
                                 * Decorative: the name is the link text
                                 * directly beneath, so describing the picture
                                 * as well makes a screen reader read every
                                 * tile twice.
                                 */
                                alt=""
                                fill
                                sizes="72px"
                                className="object-cover"
                              />
                            ) : (
                              <GridGlyph />
                            )}
                          </span>
                          <span className="text-ink-muted group-hover/tile:text-ink text-[0.75rem] leading-tight transition-colors">
                            {item.label}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The four-square mark used where a category has no photograph of its own. */
function GridGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="text-mist h-6 w-6" aria-hidden="true" fill="currentColor">
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

interface Tile {
  id: string;
  slug: string;
  label: string;
  image?: { url: string };
  viewAll?: boolean;
}

/**
 * The panel's contents for one department.
 *
 * Handles both shapes the catalogue can be in, because a shop does not
 * reorganise its tree to suit a menu:
 *
 *  - **Three levels** — each child becomes a heading and its own children
 *    become the circles beneath it, which is the layout this is modelled on.
 *  - **Two levels** — the department's children are the circles, under one
 *    heading naming the department. A shop that has never needed a third level
 *    should not have to invent one to get a picture menu.
 *
 * Every group opens with a "View all" tile. Without it the only way to reach a
 * whole department from its own panel is the rail entry that is already
 * selected, which reads as a dead end.
 */
function groupsFor(
  department: CategoryNode | undefined,
  locale: Locale,
  rtl: boolean,
): { id: string; title: string; items: Tile[] }[] {
  if (!department) return [];

  const viewAll = (node: CategoryNode): Tile => ({
    id: `${node.id}-all`,
    slug: node.slug,
    label: rtl ? "الكل" : "View All",
    viewAll: true,
  });

  const tile = (node: CategoryNode): Tile => ({
    id: node.id,
    slug: node.slug,
    label: t(node.name, locale),
    ...(node.image ? { image: node.image } : {}),
  });

  const withGrandchildren = department.children.filter((child) => child.children.length > 0);

  if (withGrandchildren.length > 0) {
    const groups = withGrandchildren.map((child) => ({
      id: child.id,
      title: t(child.name, locale),
      items: [viewAll(child), ...child.children.map(tile)],
    }));

    /*
     * Children with no children of their own would otherwise vanish from the
     * panel entirely — they are not a group and they were not collected as
     * anybody's circle. They go into a group of their own rather than being
     * dropped, because a category invisible in the menu is a category nobody
     * finds.
     */
    const loose = department.children.filter((child) => child.children.length === 0);
    if (loose.length > 0) {
      groups.push({
        id: `${department.id}-loose`,
        title: t(department.name, locale),
        items: [viewAll(department), ...loose.map(tile)],
      });
    }

    return groups;
  }

  return [
    {
      id: department.id,
      title: t(department.name, locale),
      items: [viewAll(department), ...department.children.map(tile)],
    },
  ];
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
      <p className="text-eyebrow text-mist mb-1 py-2 uppercase">
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
                    "font-display",
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
