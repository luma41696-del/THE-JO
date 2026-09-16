"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, transition } from "@/lib/motion";
import { formatPrice, t } from "@/lib/format";
import { useUI } from "@/lib/store/ui";
import { track } from "@/lib/analytics/track";
import { BrandWave } from "@/components/brand/BrandWave";
import type { CurrencyCode, Locale, Localized, ProductImage } from "@/types";

/**
 * Search overlay.
 *
 * Opens on the search icon and on ⌘K / Ctrl-K. Results are fetched from
 * `/api/search` after a 220ms debounce, and every in-flight request is aborted
 * when the query changes — without that, a slow early request can land after a
 * fast later one and overwrite good results with stale ones.
 *
 * Keyboard: ↑ ↓ to move, Enter to open, Escape to close. The listbox/option
 * roles and `aria-activedescendant` make that navigation legible to a screen
 * reader rather than silent.
 */

interface SearchHit {
  id: string;
  slug: string;
  title: Localized;
  subtitle: Localized | null;
  price: number;
  compareAtPrice: number | null;
  currency: CurrencyCode;
  image: ProductImage | null;
  categoryId: string;
}

const SUGGESTIONS = [
  { label: { en: "Cashmere", ar: "كشمير" }, href: "/shop?color=&size=&sort=featured" },
  { label: { en: "New in", ar: "وصل حديثاً" }, href: "/shop?sort=newest" },
  { label: { en: "Outerwear", ar: "معاطف" }, href: "/shop?category=outerwear" },
  { label: { en: "On sale", ar: "التخفيضات" }, href: "/shop?onSale=true" },
];

export function SearchOverlay({ locale = "en" }: { locale?: Locale }) {
  const open = useUI((s) => s.searchOpen);
  const setOpen = useUI((s) => s.setSearchOpen);
  const router = useLocalizedRouter();
  const rtl = locale === "ar";

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* --- searching by a picture -------------------------------------------- */

  const [palette, setPalette] = useState<{ hex: string; weight: number }[]>([]);
  const [reading, setReading] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);

  /**
   * Read the picture's colours here, send only those.
   *
   * The typed term is cleared when a picture is used: they are two different
   * questions, and running both would silently intersect them — a customer who
   * had typed "coat" and then uploads a green photograph gets an empty page
   * and no way to tell which half emptied it.
   */
  async function searchByPicture(file: File) {
    setReading(true);
    setPictureError(null);
    setTerm("");

    try {
      const { paletteFromFile, PaletteError } = await import("@/lib/read-palette");
      let read: { hex: string; weight: number }[];
      try {
        read = await paletteFromFile(file);
      } catch (error) {
        throw error instanceof PaletteError
          ? error
          : new Error(rtl ? "تعذّرت قراءة الصورة." : "That picture could not be read.");
      }

      setPalette(read);

      const response = await fetch("/api/search/visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ palette: read }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; results?: SearchHit[] };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "");

      setResults(body.results ?? []);
      setCursor(0);
    } catch (error) {
      setPalette([]);
      setResults([]);
      setPictureError(
        error instanceof Error && error.message
          ? error.message
          : rtl
            ? "تعذّر البحث بهذه الصورة."
            : "That picture could not be searched with.",
      );
    } finally {
      setReading(false);
    }
  }

  /* --- open/close --------------------------------------------------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (!open) {
      setTerm("");
      setResults([]);
      setCursor(0);
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus after the entrance animation starts, or iOS Safari scrolls the
    // page to the input mid-transition.
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => {
      document.body.style.overflow = previous;
      clearTimeout(timer);
    };
  }, [open]);

  /* --- querying ----------------------------------------------------------- */

  const run = useCallback(async (query: string) => {
    abortRef.current?.abort();

    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      const data = (await response.json()) as { results: SearchHit[] };
      const hits = data.results ?? [];
      setResults(hits);
      setCursor(0);

      /*
       * Recorded once the results are in, so the event carries the count —
       * and a search that found nothing is its own event.
       *
       * A zero-result search is the single most actionable thing in this
       * whole system: it is a customer telling the shop, in their own words,
       * what they came for and did not find. Counting it separately is what
       * makes that list readable rather than buried among successful queries.
       */
      const trimmed = query.trim();
      if (trimmed.length >= 2) {
        track(hits.length === 0 ? "search_no_results" : "search", {
          query: trimmed,
          results: hits.length,
        });
      }
    } catch (error) {
      // An abort is the expected path when typing quickly, not a failure.
      if ((error as Error)?.name !== "AbortError") setResults([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void run(term), 220);
    return () => clearTimeout(timer);
  }, [term, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* --- keyboard ----------------------------------------------------------- */

  /** The full results page for whatever is typed. */
  function goToResults() {
    if (!term.trim()) return;
    setOpen(false);
    router.push(`/shop?q=${encodeURIComponent(term.trim())}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    /*
     * Enter always does something.
     *
     * It used to return early whenever the dropdown was empty, so a shopper
     * who typed a word the preview did not match and pressed Enter — the most
     * ordinary thing to do — got nothing at all, with no indication that the
     * key had been read. With no results, or none highlighted, it now opens
     * the full results page, which can also say "close matches were these".
     */
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = results[cursor];
      if (hit && results.length > 0) {
        setOpen(false);
        router.push(`/product/${hit.slug}`);
      } else {
        goToResults();
      }
      return;
    }

    if (results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => (c + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => (c - 1 + results.length) % results.length);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[160]" role="dialog" aria-modal="true" aria-label="Search">
          <motion.button
            type="button"
            className="bg-ink/35 absolute inset-0 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            aria-label={rtl ? "إغلاق البحث" : "Close search"}
          />

          <motion.div
            className="bg-paper absolute inset-x-0 top-0 rounded-b-2xl shadow-hover"
            initial={{ y: "-100%" }}
            animate={{ y: 0 }}
            exit={{ y: "-100%" }}
            transition={transition.drawer}
          >
            <div className="ns-container py-6 md:py-8">
              {/* Input */}
              <div className="border-line focus-within:border-brand flex items-center gap-4 border-b pb-4 transition-colors">
                <SearchIcon />
                <input
                  ref={inputRef}
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={rtl ? "ابحث عن قطعة، لون، أو قسم…" : "Search a piece, colour or category…"}
                  className="text-ink placeholder:text-mist font-display min-w-0 flex-1 bg-transparent text-lg outline-none md:text-2xl"
                  role="combobox"
                  aria-expanded={results.length > 0}
                  aria-controls="search-results"
                  aria-activedescendant={results[cursor] ? `search-hit-${results[cursor].id}` : undefined}
                  aria-autocomplete="list"
                />
                {/*
                  Search by a picture.

                  The file never leaves the device: its colours are read here
                  with a canvas and only the hex values are sent. A photograph
                  somebody searches with is a photograph of their room or their
                  wardrobe, and a shop that receives one has taken on storing
                  it, securing it and deleting it.
                */}
                <label
                  className={cn(
                    "text-mist hover:text-ink shrink-0 transition-colors",
                    reading ? "cursor-wait opacity-60" : "cursor-pointer",
                  )}
                  title={rtl ? "ابحث بصورة" : "Search with a picture"}
                >
                  <span className="sr-only">{rtl ? "ابحث بصورة" : "Search with a picture"}</span>
                  <CameraIcon />
                  <input
                    type="file"
                    accept="image/*"
                    disabled={reading}
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void searchByPicture(file);
                      // Cleared so choosing the same picture again still fires.
                      event.target.value = "";
                    }}
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-mist hover:text-ink cursor-pointer text-[0.75rem] tracking-wider uppercase transition-colors"
                  data-cursor="hover"
                >
                  Esc
                </button>
              </div>

              {/*
                What the picture was read as, and what that means.

                The swatches are shown because a result that is the right
                shade and the wrong shape is only confusing if the customer
                does not know it matched on colour. Shown the swatches, the
                same result reads as the shop answering the question it was
                actually asked.
              */}
              {palette.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    {palette.map((entry) => (
                      <span
                        key={entry.hex}
                        className="border-line/60 h-5 w-5 rounded-full border"
                        style={{ backgroundColor: entry.hex }}
                        title={entry.hex}
                      />
                    ))}
                  </span>
                  <span className="text-smoke text-[0.8125rem]">
                    {rtl ? "مطابقة بالألوان في صورتك" : "Matched on the colours in your picture"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPalette([]);
                      setResults([]);
                    }}
                    className="text-mist hover:text-ink cursor-pointer text-[0.75rem]"
                    data-cursor="hover"
                  >
                    {rtl ? "مسح" : "Clear"}
                  </button>
                </div>
              )}

              {pictureError && (
                <p role="alert" className="text-alert mt-3 text-[0.8125rem]">
                  {pictureError}
                </p>
              )}

              {/* Body */}
              <div className="max-h-[60vh] overflow-y-auto pt-5">
                {/*
                  Two ways in, one results area.

                  This used to ask only whether enough had been *typed*, so a
                  picture search set its results and the panel went on showing
                  the suggestion chips — the request ran, the answer arrived,
                  and the customer saw nothing change. A picture is a query
                  too, and the condition now says so.
                */}
                {term.trim().length < 2 && palette.length === 0 ? (
                  <div>
                    <p className="text-eyebrow text-mist mb-3 uppercase">
                      {rtl ? "اقتراحات" : "Try"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {SUGGESTIONS.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="border-line text-ink-muted hover:border-ink/40 hover:text-ink rounded-pill border px-4 py-2 text-[0.8125rem] transition-colors"
                          data-cursor="hover"
                        >
                          {item.label[locale]}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : loading && results.length === 0 ? (
                  <div className="flex items-center gap-3 py-10">
                    <div className="h-10 w-10 opacity-70">
                      <BrandWave rings={2} color="var(--color-brand)" speed={4} />
                    </div>
                    <span className="text-smoke text-[0.875rem]">
                      {rtl ? "جارٍ البحث…" : "Searching…"}
                    </span>
                  </div>
                ) : results.length === 0 ? (
                  <div className="py-10">
                    <p className="text-smoke text-[0.9375rem]">
                      {/*
                        A picture search has no typed term to quote back, and
                        quoting an empty one produces `Nothing matches ""`.
                      */}
                      {palette.length > 0
                        ? rtl
                          ? "لا قطع بألوان قريبة من هذه الصورة."
                          : "Nothing in the shop is close to these colours."
                        : rtl
                          ? `لا نتائج لـ "${term}". جرّب اسم قطعة أو لوناً.`
                          : `Nothing matches "${term}". Try a piece name, a colour, or a category.`}
                    </p>
                    {/* The preview is capped at eight and matches on fewer
                        fields than the results page; sending them there is a
                        real second chance, not a consolation link. */}
                    <button
                      type="button"
                      onClick={goToResults}
                      className="border-line hover:border-ink text-ink rounded-pill mt-4 cursor-pointer border px-4 py-2 text-[0.875rem] transition-colors"
                      data-cursor="hover"
                    >
                      {rtl ? "ابحث في المتجر كله" : "Search the whole shop"}
                    </button>
                  </div>
                ) : (
                  <ul id="search-results" role="listbox" className="space-y-1">
                    {results.map((hit, index) => (
                      <li key={hit.id} id={`search-hit-${hit.id}`} role="option" aria-selected={index === cursor}>
                        <Link
                          href={`/product/${hit.slug}`}
                          onClick={() => setOpen(false)}
                          onMouseEnter={() => setCursor(index)}
                          className={cn(
                            "rounded-md flex items-center gap-4 p-3 transition-colors",
                            index === cursor ? "bg-paper-sunken" : "hover:bg-paper-sunken/60",
                          )}
                          data-cursor="hover"
                        >
                          {hit.image && (
                            <span className="bg-paper-sunken rounded-sm relative h-16 w-12 shrink-0 overflow-hidden">
                              <Image
                                src={hit.image.url}
                                alt=""
                                fill
                                sizes="48px"
                                className="object-cover"
                              />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="text-ink block truncate text-[0.9375rem] font-medium">
                              {t(hit.title, locale)}
                            </span>
                            {hit.subtitle && (
                              <span className="text-smoke block truncate text-[0.8125rem]">
                                {t(hit.subtitle, locale)}
                              </span>
                            )}
                          </span>
                          <span className="text-ink shrink-0 text-[0.875rem] tabular-nums">
                            {formatPrice(hit.price, hit.currency, locale)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {results.length > 0 && (
                <motion.div
                  className="border-line text-mist mt-4 flex items-center gap-4 border-t pt-4 text-[0.6875rem]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, ease: EASE.silk }}
                >
                  <span>↑ ↓ {rtl ? "للتنقّل" : "to navigate"}</span>
                  <span>↵ {rtl ? "للفتح" : "to open"}</span>
                  <span>esc {rtl ? "للإغلاق" : "to close"}</span>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function SearchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="text-mist shrink-0">
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** A camera, for searching with a picture. */
function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
    >
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1-2h8.6l1 2h2.2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}
