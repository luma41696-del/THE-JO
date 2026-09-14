/**
 * Firebase client configuration, read from `NEXT_PUBLIC_*` env vars.
 *
 * These values are public by design — they ship in the JS bundle and identify
 * the project to Google's servers. They are *not* credentials. What actually
 * protects your data is:
 *   1. Firestore + Storage Security Rules (see `firestore.rules`)
 *   2. Firebase App Check, which rejects traffic that is not from your app
 *   3. Server-only logic for anything involving money (see `src/lib/firebase/admin.ts`)
 *
 * They live in env anyway so one codebase can target dev / staging / prod.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    // Fail loudly at module load rather than with an opaque Firebase error
    // three screens into the checkout flow.
    throw new Error(
      `[THE JO] Missing environment variable ${name}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const firebaseConfig = {
  apiKey: required("NEXT_PUBLIC_FIREBASE_API_KEY", process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  authDomain: required(
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  ),
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: required(
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  ),
  storageBucket: required(
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  ),
  messagingSenderId: required(
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  ),
  appId: required("NEXT_PUBLIC_FIREBASE_APP_ID", process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
} as const;

export const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;

/** Emulators are opt-in so a stray env var can never point production at them. */
export const useEmulators =
  process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === "true" &&
  process.env.NODE_ENV !== "production";
