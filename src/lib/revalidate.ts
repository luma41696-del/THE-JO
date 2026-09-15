import "server-only";

import { revalidatePath } from "next/cache";

import { LOCALES } from "@/lib/i18n/config";

/**
 * Push an admin change onto the live storefront immediately.
 *
 * Storefront pages carry `export const revalidate = 3600`, which is right for
 * traffic and wrong for editing: a merchant who hides a winter coat, or turns
 * off the hero banner, watches the old page for up to an hour and reasonably
 * concludes the save did not work. They then click save again, and again.
 *
 * Every admin write calls one of these instead. Revalidation is best-effort on
 * purpose — the data is already committed by the time we get here, so a
 * failure to purge a cache must never turn a successful save into an error
 * response. It is logged and swallowed.
 */

/** Revalidate one path across every locale prefix. */
function localised(path: string) {
  for (const locale of LOCALES) {
    try {
      revalidatePath(`/${locale}${path}`);
    } catch (error) {
      console.warn(`[revalidate] /${locale}${path} failed`, error);
    }
  }
}

/**
 * Pages whose content depends on the catalogue.
 *
 * The product pages are revalidated by layout rather than one by one: a
 * visibility change can affect a product's own page, every listing it appeared
 * in, and every rail that recommended it, and enumerating those is how one
 * gets missed.
 */
export function revalidateCatalogue() {
  localised("");
  localised("/shop");
  localised("/categories");
  localised("/fitting-room");
  try {
    revalidatePath("/[locale]/(store)/product/[slug]", "page");
  } catch (error) {
    console.warn("[revalidate] product pages failed", error);
  }
}

/** The homepage and anywhere else a banner can appear. */
export function revalidateMerchandising() {
  localised("");
  localised("/shop");
  localised("/categories");
}

/** Category changes move the nav, which lives in the shared layout. */
export function revalidateNavigation() {
  try {
    revalidatePath("/[locale]", "layout");
  } catch (error) {
    console.warn("[revalidate] layout failed", error);
  }
  revalidateCatalogue();
}
