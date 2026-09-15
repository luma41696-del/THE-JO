import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";

import { getFirebaseApp } from "./client";
import { useEmulators } from "./config";

/**
 * Cloud Storage, in its own module.
 *
 * It lived in `client.ts`, which `AuthProvider` imports on every page — so
 * `firebase/storage` (138KB) was downloaded by every visitor, including the
 * overwhelming majority who never upload anything. The only caller is
 * `upload.ts`, and every path to *that* is already a dynamic import.
 *
 * Splitting the module is what lets the bundler leave it out: a static import
 * anywhere in `client.ts` pulls the whole product into the first-load chunk no
 * matter how lazily the function is eventually called.
 */

let storage: FirebaseStorage | undefined;

export function getStorageClient(): FirebaseStorage {
  if (storage) return storage;

  storage = getStorage(getFirebaseApp());

  /*
   * Memoised, so the emulator is connected exactly once.
   *
   * The previous shared `emulatorsConnected` flag was only ever set by
   * `getFunctionsClient`, which nothing called — so it was permanently false
   * and this ran on every invocation. Harmless in production, where the branch
   * is dead, and a source of repeat-connection warnings under the emulator.
   */
  if (useEmulators) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }

  return storage;
}
