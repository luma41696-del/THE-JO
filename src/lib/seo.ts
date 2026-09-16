import { absoluteUrl } from "@/lib/site";
import { t as pick } from "@/lib/format";
import type { Category, Locale, Product } from "@/types";

/**
 * Structured data, built in one place.
 *
 * Schema.org markup is easy to write and easy to write *wrongly*, and the
 * wrong kinds are worse than none: a rating nobody left, a breadcrumb whose
 * URLs are relative, a listing that claims products the page does not show.
 * Google's response to markup that disagrees with the page is to stop trusting
 * the site's rich results altogether, so each builder here is deliberately
 * conservative — it omits a property rather than guessing at it.
 *
 * Two rules run through all of it:
 *
 *  - **Every URL is absolute.** A relative URL in JSON-LD validates as present
 *    and is useless; it is the classic silent failure.
 *  - **Nothing is claimed that the page does not show.** The item list carries
 *    the products actually rendered, in the order they are rendered.
 */

/* -------------------------------------------------------------------------- */
/*  Breadcrumbs                                                               */
/* -------------------------------------------------------------------------- */

export interface Crumb {
  name: string;
  /** Path without the locale prefix, or absent for the current page. */
  path?: string;
}

/**
 * A breadcrumb trail, as Google reads it.
 *
 * This is what replaces the bare URL under a result with "Home › Outerwear ›
 * Coats", which is both more clickable and more honest about where the page
 * sits. The last item deliberately carries no `item` URL: it is the page you
 * are on, and pointing it at itself is the most common way these get written
 * wrongly.
 */
export function breadcrumbList(crumbs: Crumb[], locale: Locale) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      ...(crumb.path !== undefined
        ? { item: absoluteUrl(`${locale}/${crumb.path}`.replace(/\/+$/, "")) }
        : {}),
    })),
  };
}

/** The trail for a product page: home, its departments, then the product. */
export function productCrumbs(
  product: Product,
  trail: Category[],
  locale: Locale,
  homeLabel: string,
): Crumb[] {
  return [
    { name: homeLabel, path: "" },
    ...trail.map((category) => ({
      name: pick(category.name, locale),
      path: `shop?category=${category.slug}`,
    })),
    { name: pick(product.title, locale) },
  ];
}

/**
 * An image URL a crawler can actually fetch.
 *
 * Uploaded imagery is already absolute, but anything shipped with the shop is
 * a site-relative path such as "/demo/coat.svg". Left as it is in JSON-LD that
 * is the same silent failure as a relative breadcrumb: it validates, and the
 * image never loads for whoever reads the markup.
 */
function absoluteImage(url: string): string {
  return /^https?:\/\//.test(url) ? url : absoluteUrl(url);
}

/* -------------------------------------------------------------------------- */
/*  Listings                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The products a listing page shows, in the order it shows them.
 *
 * Built from the rendered list rather than from the catalogue, because that is
 * the claim being made: markup that lists forty products on a page showing
 * twelve is the kind of mismatch that costs a site its rich results.
 *
 * Each entry carries the price and availability, so a listing can produce the
 * same price chips a product page does without the crawler fetching forty
 * pages to find them.
 */
export function itemListJsonLd(products: Product[], locale: Locale, name: string) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: products.length,
    itemListElement: products.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        name: pick(product.title, locale),
        url: absoluteUrl(`${locale}/product/${product.slug}`),
        ...(product.images[0] ? { image: absoluteImage(product.images[0].url) } : {}),
        ...(product.sku ? { sku: product.sku } : {}),
        offers: {
          "@type": "Offer",
          price: product.price,
          priceCurrency: product.currency,
          availability: product.inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        },
      },
    })),
  };
}

/**
 * A collection page: what this listing *is*, beside what it contains.
 *
 * `CollectionPage` is what tells a crawler that a category page is a curated
 * set rather than a search result it should ignore — the difference between a
 * category ranking for its own name and never appearing at all.
 */
export function collectionPageJsonLd({
  name,
  description,
  path,
  locale,
}: {
  name: string;
  description: string;
  path: string;
  locale: Locale;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    ...(description ? { description } : {}),
    url: absoluteUrl(`${locale}/${path}`.replace(/\/+$/, "")),
    inLanguage: locale === "ar" ? "ar-JO" : "en",
  };
}

/* -------------------------------------------------------------------------- */
/*  The site itself                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The shop, and how to search it.
 *
 * `SearchAction` is what can give the site a search box directly inside
 * Google's result — worth having, and only honest if the URL template actually
 * works, which is why it points at the real `/shop?q=` the site serves rather
 * than an invented endpoint.
 */
export function websiteJsonLd(locale: Locale, siteName: string) {
  const home = absoluteUrl(locale);
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    url: home,
    inLanguage: locale === "ar" ? "ar-JO" : "en",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${home}/shop?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Titles                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The title for a listing, given whatever the shopper filtered by.
 *
 * Every filtered listing used to share one title — "Shop" — so a category, a
 * colour and a search result were indistinguishable in a browser's history, in
 * a shared link, and to a crawler, which treats a hundred URLs under one title
 * as duplicates and indexes none of them.
 *
 * Built from what is actually selected, in the order a person would say it:
 * "Cobalt coats", not "Shop (category=outerwear-coats, color=cobalt)".
 */
export function listingTitle({
  categoryName,
  searchTerm,
  colorNames = [],
  onSale,
  fallback,
  locale,
}: {
  categoryName?: string;
  searchTerm?: string;
  colorNames?: string[];
  onSale?: boolean;
  fallback: string;
  locale: Locale;
}): string {
  if (searchTerm?.trim()) {
    return locale === "ar" ? `نتائج البحث عن «${searchTerm.trim()}»` : `Search: ${searchTerm.trim()}`;
  }

  const parts: string[] = [];
  // One colour reads naturally in front of the noun; several do not, and
  // "Cobalt and bone and sand coats" is worse than just "Coats".
  if (colorNames.length === 1) parts.push(colorNames[0]!);
  parts.push(categoryName ?? fallback);

  const base = locale === "ar" ? parts.reverse().join(" ") : parts.join(" ");
  if (!onSale) return base;
  return locale === "ar" ? `${base} — تخفيضات` : `${base} on sale`;
}

/** A description for a listing, falling back to the category's own words. */
export function listingDescription({
  categoryDescription,
  count,
  categoryName,
  fallback,
  locale,
}: {
  categoryDescription?: string;
  count: number;
  categoryName?: string;
  fallback: string;
  locale: Locale;
}): string {
  if (categoryDescription?.trim()) return categoryDescription.trim();
  if (!categoryName) return fallback;

  /*
   * Generated from the real count rather than a fixed sentence. A description
   * that says "browse our wide selection" on a category holding two products
   * is the kind of copy that reads as automated, because it is.
   */
  return locale === "ar"
    ? `${count} ${count === 1 ? "قطعة" : "قطعة"} في ${categoryName} — شحن داخل الأردن.`
    : `${count} ${count === 1 ? "piece" : "pieces"} in ${categoryName}, delivered across Jordan.`;
}
