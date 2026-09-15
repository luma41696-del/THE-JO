import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

import { getFirebaseApp } from "./client";
import { useEmulators } from "./config";

/**
 * Firestore, in its own module.
 *
 * It lived in `client.ts`, and `AuthProvider` imports that on every page for
 * `getFirebaseAuth` — so `firebase/firestore` (~190KB) was in the first-load
 * bundle of every route, including the homepage, for visitors who are not
 * signed in and never read a document from the browser at all. The catalogue
 * is read on the server.
 *
 * A static import anywhere in `client.ts` is enough to pull the whole product
 * in, however lazily the function is called. Splitting the module is what lets
 * the bundler leave it out.
 */

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

  // `firestore` is memoised above, so this runs once by construction.
  if (useEmulators) {
    connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  }
  return firestore;
}
