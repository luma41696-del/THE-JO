import type { MetadataRoute } from "next";

import { getCategories, getAllProducts } from "@/lib/catalog";
import { visibleProducts } from "@/lib/visibility";
import { policyDocs } from "@/data/site-content";
import { LOCALES } from "@/lib/i18n/config";
import { absoluteUrl } from "@/lib/site";
import type { Locale } from "@/types";

/**
 * The sitemap.
 *
 * There wasn't one, so a search engine's only route into the catalogue was
 * whatever it could reach by following links — which for a shop means the
 * pieces on the homepage and not much else.
 *
 * Two things this gets right that a naive sitemap gets wrong:
 *
 * **It only lists pages that exist.** Products run through `visibleProducts`,
 * the same filter the storefront uses. A draft, an archived piece or a coat
 * pulled for the summer is *not* listed — telling a crawler to fetch a page
 * that 404s or redirects wastes the shop's crawl budget and teaches the
 * engine the sitemap is unreliable.
 *
 * **Every entry declares its other language.** The shop is bilingual with
 * prefix-always routing, so `/en/shop` and `/ar/shop` are the same page in two
 * languages. Without `alternates.languages` a search engine has to guess
 * whether they are translations or duplicates — and an Arabic searcher gets
 * served the English page about as often as not.
 */

/** Routes with no data behind them. */
const STATIC_PATHS = [
  { path: "", priority: 1, changeFrequency: "daily" as const },
  { path: "shop", priority: 0.9, changeFrequency: "daily" as const },
  { path: "categories", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "fitting-room", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "gift", priority: 0.5, changeFrequency: "weekly" as const },
  { path: "about", priority: 0.4, changeFrequency: "monthly" as const },
];

/**
 * The same page in every language, keyed for `alternates.languages`.
 *
 * `x-default` points at English: it is what a searcher with no matching
 * language preference should land on, and omitting it leaves that choice to
 * the engine.
 */
function languagesFor(path: string): Record<string, string> {
  const entries = Object.fromEntries(
    LOCALES.map((locale: Locale) => [locale, absoluteUrl(`${locale}/${path}`.replace(/\/$/, ""))]),
  );
  return { ...entries, "x-default": absoluteUrl(`en/${path}`.replace(/\/$/, "")) };
}

function entriesFor(
  path: string,
  lastModified: Date,
  priority: number,
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
): MetadataRoute.Sitemap {
  const languages = languagesFor(path);
  return LOCALES.map((locale: Locale) => ({
    url: absoluteUrl(`${locale}/${path}`.replace(/\/$/, "")),
    lastModified,
    changeFrequency,
    priority,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  /*
   * A failure here must not take the sitemap down to nothing — a 500 is worse
   * than a sitemap listing only the static pages, because an engine that
   * cannot fetch it may fall back on a cached copy for days.
   */
  const [products, categories] = await Promise.all([
    getAllProducts().catch(() => []),
    getCategories().catch(() => []),
  ]);

  const entries: MetadataRoute.Sitemap = [];

  for (const { path, priority, changeFrequency } of STATIC_PATHS) {
    entries.push(...entriesFor(path, now, priority, changeFrequency));
  }

  // Only what a shopper can actually reach.
  for (const product of visibleProducts(products)) {
    entries.push(
      ...entriesFor(
        `product/${product.slug}`,
        // The product's own timestamp, not today's. Claiming everything
        // changed this morning is how a sitemap stops being believed.
        new Date(product.updatedAt || product.publishedAt || Date.now()),
        0.8,
        "weekly",
      ),
    );
  }

  for (const category of categories) {
    if (category.hidden) continue;
    entries.push(...entriesFor(`categories/${category.slug}`, now, 0.6, "weekly"));
  }

  for (const doc of policyDocs) {
    // `about` is already a static entry; its children live under /about/…
    const base = doc.group === "about" ? "about" : doc.group;
    entries.push(
      ...entriesFor(`${base}/${doc.slug}`, new Date(doc.updatedAt), 0.3, "yearly"),
    );
  }

  return entries;
}
