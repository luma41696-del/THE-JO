import "server-only";

import { storeSettings as FALLBACK, type StoreSettings } from "@/data/site-content";

/**
 * Store settings, loaded from Firestore with the repo's values as the floor.
 *
 * These are the facts a shop has to be able to correct without a deploy: the
 * phone number, the free-delivery threshold, the return window, the social
 * links. Hard-coding them was defensible while there was one of each; it stops
 * being defensible the moment a number is wrong on a live page and fixing it
 * needs a developer.
 *
 * The static object in `site-content.ts` stays as the fallback rather than
 * being deleted. A settings document that fails to load must not take the
 * contact details off the site — an empty `mailto:` is worse than a slightly
 * stale address, and every sentence on the storefront composes from these.
 *
 * Merged field by field, not replaced wholesale: a settings document written
 * before a field existed would otherwise blank it out.
 */

const READ_TIMEOUT_MS = 2500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/** Only these keys may come from the database. Anything else is ignored. */
function merge(stored: Partial<StoreSettings> | undefined): StoreSettings {
  if (!stored) return FALLBACK;

  const number = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;

  const text = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() ? value.trim() : fallback;

  const localized = (value: unknown, fallback: { en: string; ar: string }) => {
    const v = value as { en?: unknown; ar?: unknown } | undefined;
    return {
      en: text(v?.en, fallback.en),
      ar: text(v?.ar, fallback.ar),
    };
  };

  const days = Array.isArray(stored.standardDeliveryDays)
    ? stored.standardDeliveryDays
    : FALLBACK.standardDeliveryDays;

  return {
    freeShippingThreshold: number(
      stored.freeShippingThreshold,
      FALLBACK.freeShippingThreshold,
    ),
    returnWindowDays: number(stored.returnWindowDays, FALLBACK.returnWindowDays),
    lowStockThreshold: number(stored.lowStockThreshold, FALLBACK.lowStockThreshold),
    standardDeliveryDays: [
      number(days[0], FALLBACK.standardDeliveryDays[0]),
      number(days[1], FALLBACK.standardDeliveryDays[1]),
    ],
    contact: {
      email: text(stored.contact?.email, FALLBACK.contact.email),
      phone: text(stored.contact?.phone, FALLBACK.contact.phone),
      ...(stored.contact?.whatsapp || FALLBACK.contact.whatsapp
        ? { whatsapp: text(stored.contact?.whatsapp, FALLBACK.contact.whatsapp ?? "") }
        : {}),
      hours: localized(stored.contact?.hours, FALLBACK.contact.hours),
      address: localized(stored.contact?.address, FALLBACK.contact.address),
    },
    /*
     * Links are filtered to http(s). A `javascript:` href in a footer link is
     * a stored XSS with a merchant's own hands on the keyboard, and the admin
     * form is not the only thing that could write this document.
     */
    social: Array.isArray(stored.social)
      ? stored.social
          .filter(
            (link): link is { label: string; href: string } =>
              Boolean(link) &&
              typeof link.label === "string" &&
              typeof link.href === "string" &&
              /^https?:\/\//i.test(link.href),
          )
          .map((link) => ({ label: link.label.trim().slice(0, 40), href: link.href.trim() }))
          .slice(0, 8)
      : FALLBACK.social,
    legal: {
      tradingName: text(stored.legal?.tradingName, FALLBACK.legal.tradingName),
      country: localized(stored.legal?.country, FALLBACK.legal.country),
    },
  };
}

/**
 * Read the live settings.
 *
 * Not cached across requests on purpose: this is one small document, it is
 * read on pages that are already hitting Firestore, and a merchant correcting
 * a phone number should see it corrected. `revalidateAll()` clears the page
 * cache that actually matters.
 */
export async function getStoreSettings(): Promise<StoreSettings> {
  try {
    const { getDb } = await import("@/lib/firebase/client");
    const { doc, getDoc } = await import("firebase/firestore");

    const snapshot = await withTimeout(getDoc(doc(getDb(), "settings", "store")), READ_TIMEOUT_MS);
    if (!snapshot.exists()) return FALLBACK;
    return merge(snapshot.data() as Partial<StoreSettings>);
  } catch {
    // A storefront that renders last-known-good settings beats a 500 page.
    return FALLBACK;
  }
}

export { FALLBACK as defaultStoreSettings };
export type { StoreSettings };
