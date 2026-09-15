import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/**
 * Crawl policy.
 *
 * The shop had none, which means every crawler was free to index the admin,
 * the checkout and each customer's own order pages. None of that is a secret
 * — they are all gated — but indexed is not the same as accessible, and a
 * search result reading "Order NS-7K4M2X · net sale" is a bad thing to exist
 * whether or not the page behind it refuses to load.
 *
 * What is disallowed, and why:
 *
 *   /admin      operations tooling; nothing there is for a shopper
 *   /api        endpoints, not pages; crawling them wastes budget and can
 *               trigger side-effectful GETs on anything added carelessly later
 *   /checkout   a step in a flow, meaningless without a bag
 *   /account,
 *   /orders     per-customer, and the content differs by who is signed in —
 *               exactly what must never end up in a shared index
 *   /cart,
 *   /wishlist   personal state; an empty bag is all a crawler would ever see
 *
 * Everything else is open on purpose. The catalogue is the point.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        /*
         * Locale-prefixed paths need the wildcard: the routes are `/en/cart`
         * and `/ar/cart`, never a bare `/cart`. A rule written without it
         * would match nothing and quietly do the opposite of what it says.
         */
        disallow: [
          "/admin",
          "/api/",
          "/*/checkout",
          "/*/account",
          "/*/orders",
          "/*/cart",
          "/*/wishlist",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
