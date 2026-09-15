/**
 * Firebase Web SDK — single shared instance.
 *
 * Next.js hot-reloads modules in development and renders on the server, so
 * every getter here is idempotent: `getApps()` is checked before initialising,
 * and browser-only products (Analytics, App Check) return `null` on the server
 * instead of throwing.
 *
 * Import the *getters*, not the instances, so nothing connects to Firebase
 * during a server render that does not need it.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  type Auth,
} from "firebase/auth";

import { appCheckSiteKey, firebaseConfig, useEmulators } from "./config";
import { analyticsAllowed } from "@/lib/analytics/consent";

let authEmulatorConnected = false;

export function getFirebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth {
  const auth = getAuth(getFirebaseApp());

  if (typeof window !== "undefined") {
    // Keep the session across tabs and restarts. Fire-and-forget: a failure
    // here (private mode, blocked storage) degrades to in-memory persistence
    // rather than breaking sign-in.
    void setPersistence(auth, browserLocalPersistence).catch(() => {});
  }

  /*
   * Connected once. The guard used to be a shared `emulatorsConnected` flag
   * that only `getFunctionsClient` ever set — and nothing called that, so the
   * flag was permanently false and this re-ran on every call.
   */
  if (useEmulators && !authEmulatorConnected) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    authEmulatorConnected = true;
  }
  return auth;
}


/* -------------------------------------------------------------------------- */
/*  Browser-only products                                                     */
/* -------------------------------------------------------------------------- */

/**
 * App Check attests that requests come from your real app. Call once, early,
 * from a client component. Without it, anyone holding the public config can
 * hammer your Firestore read quota straight from a script.
 */
export async function initAppCheck() {
  if (typeof window === "undefined" || !appCheckSiteKey) return null;

  const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(
    "firebase/app-check"
  );

  if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN) {
    // Documented escape hatch for localhost; only ever set in development.
    (
      globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }
    ).FIREBASE_APPCHECK_DEBUG_TOKEN = process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN;
  }

  try {
    return initializeAppCheck(getFirebaseApp(), {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // Already initialised (fast refresh) — not an error worth surfacing.
    return null;
  }
}

/**
 * Google Analytics, and the consent it waits for.
 *
 * This used to run unconditionally from `AuthProvider`'s mount effect, which
 * meant the shop loaded a 446KB Google tag and began recording `page_view`
 * **before the visitor had answered the consent banner** — on a site whose
 * own `track()` has been carefully gated on that same consent since the
 * analytics work went in.
 *
 * The tests did not catch it because they tested the right thing about the
 * wrong surface: they proved our first-party events respect consent, while a
 * third-party tag ran alongside them, setting cookies, ungated.
 *
 * So the guard lives here, at the one place that can load it. `analyticsAllowed`
 * is the same predicate `track()` uses — one definition of "may we", not two
 * that can drift.
 *
 * **Loading is one-way.** Once the Google tag is on the page it cannot be
 * removed, so withdrawing consent later stops our own events but cannot
 * unload what is already running; a reload starts clean because this refuses
 * to initialise again. That asymmetry is exactly why it must not load early:
 * "ask first" is the only version of this that works.
 */
export function analyticsMayLoad(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(firebaseConfig.measurementId) &&
    analyticsAllowed()
  );
}

export async function initAnalytics() {
  /*
   * The decision is a separate, pure function on purpose.
   *
   * It was inline, and the test asserting "nothing loads without consent"
   * turned out to be vacuous: with the gate deleted the call still returned
   * null, because `isSupported()` is false in a test environment anyway. The
   * assertion could not fail, which is worse than no test — it reads as
   * proof. `analyticsMayLoad` can be asserted directly, and deleting the
   * consent term from it makes that assertion go red.
   */
  if (!analyticsMayLoad()) return null;

  const { getAnalytics, isSupported } = await import("firebase/analytics");
  if (!(await isSupported())) return null;

  return getAnalytics(getFirebaseApp());
}
