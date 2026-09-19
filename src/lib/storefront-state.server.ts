import "server-only";

import {
  DEFAULT_STOREFRONT,
  sanitiseStorefront,
  type StorefrontSettings,
} from "@/lib/storefront-state";

/**
 * Reading whether the shop is open.
 *
 * Consulted on every request that reaches the middleware, so it is cached the
 * same way the address blocklist is and for the same reason: a Firestore read
 * per page view is a read per visitor per navigation.
 *
 * ## It fails **open**
 *
 * If the settings cannot be read, the shop is open. The alternative — treating
 * an unreachable database as "closed" — turns a brief Firestore wobble into a
 * shut shop, which is the failure that costs money. A shop that stays open for
 * thirty seconds longer than intended costs almost nothing.
 */

type Db = FirebaseFirestore.Firestore;

const TTL_MS = 20_000;
let cached: { settings: StorefrontSettings; readAt: number } | null = null;
let inFlight: Promise<StorefrontSettings> | null = null;

/** Clear the cache in the instance that just changed it. */
export function invalidateStorefront(): void {
  cached = null;
}

async function read(): Promise<StorefrontSettings> {
  const { isAdminConfigured, getAdminDb } = await import("@/lib/firebase/admin");
  if (!isAdminConfigured()) return DEFAULT_STOREFRONT;

  const snap = await (getAdminDb() as Db).collection("settings").doc("storefront").get();
  const data = snap.data();
  if (!data) return DEFAULT_STOREFRONT;

  /*
   * Sanitised on the way out as well as in. `sanitiseStorefront` drops a
   * reopening time that has passed, which is what makes an expired closure
   * expire — and a document written by an older version is missing keys.
   */
  return {
    ...sanitiseStorefront(data),
    closedBy: typeof data.closedBy === "string" ? data.closedBy : undefined,
    closedAt: typeof data.closedAt === "number" ? data.closedAt : undefined,
  };
}

export async function getStorefront(): Promise<StorefrontSettings> {
  if (cached && Date.now() - cached.readAt < TTL_MS) return cached.settings;

  // One read per instance even when a burst arrives on a cold start.
  inFlight ??= read()
    .then((settings) => {
      cached = { settings, readAt: Date.now() };
      return settings;
    })
    .catch((error) => {
      console.error("[net sale] could not read the storefront state; staying open:", error);
      return DEFAULT_STOREFRONT;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
