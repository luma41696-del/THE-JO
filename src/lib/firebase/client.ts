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
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";

import { appCheckSiteKey, firebaseConfig, useEmulators } from "./config";

let emulatorsConnected = false;

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

  if (useEmulators && !emulatorsConnected) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  return auth;
}

let firestore: Firestore | undefined;

export function getDb(): Firestore {
  if (firestore) return firestore;

  firestore = initializeFirestore(getFirebaseApp(), {
    // Offline cache means a returning shopper sees their last catalogue view
    // instantly, and the cart survives a dropped connection mid-checkout.
    localCache:
      typeof window !== "undefined"
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : undefined,
    // Corporate proxies and some mobile networks break gRPC streaming.
    experimentalAutoDetectLongPolling: true,
  });

  if (useEmulators && !emulatorsConnected) {
    connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  }
  return firestore;
}

export function getStorageClient(): FirebaseStorage {
  const storage = getStorage(getFirebaseApp());
  if (useEmulators && !emulatorsConnected) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }
  return storage;
}

export function getFunctionsClient(region = "europe-west1"): Functions {
  const functions = getFunctions(getFirebaseApp(), region);
  if (useEmulators && !emulatorsConnected) {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    emulatorsConnected = true;
  }
  return functions;
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

/** Analytics is lazy and guarded: it is unsupported in some browsers/webviews. */
export async function initAnalytics() {
  if (typeof window === "undefined" || !firebaseConfig.measurementId) return null;

  const { getAnalytics, isSupported } = await import("firebase/analytics");
  if (!(await isSupported())) return null;

  return getAnalytics(getFirebaseApp());
}
