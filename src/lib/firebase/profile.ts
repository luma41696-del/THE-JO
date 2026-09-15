import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import type { User } from "firebase/auth";

import { getDb } from "./db";
import { userConverter } from "./converters";
import type { Locale, UserProfile } from "@/types";

/**
 * The customer's profile document.
 *
 * Split out of `auth.ts` so that `getIdToken` — imported by nineteen client
 * components — does not drag `firebase/firestore` into their bundles. Almost
 * every consumer of the auth module wants a token and nothing else; only the
 * account panel and the provider's signed-in branch touch a document.
 *
 * Everything here runs **only when there is a user**, which is what lets the
 * callers import it dynamically and keep Firestore out of the first load for
 * a visitor who is signed out.
 */

function profileRef(uid: string) {
  return doc(getDb(), "users", uid).withConverter(userConverter);
}

/**
 * Create the profile document if this is a first sign-in. Uses `merge` so a
 * second call can never clobber addresses or a fit profile.
 */
export async function ensureProfile(user: User, locale: Locale = "en"): Promise<UserProfile> {
  const ref = profileRef(user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const existing = snap.data();
    // Keep the denormalised auth fields fresh without touching anything else.
    await updateDoc(doc(getDb(), "users", user.uid), {
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      updatedAt: serverTimestamp(),
    });
    return existing;
  }

  const fresh: UserProfile = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    locale,
    currency: (process.env.NEXT_PUBLIC_DEFAULT_CURRENCY as UserProfile["currency"]) || "JOD",
    addresses: [],
    wishlist: [],
    marketingOptIn: false,
    // Authoritative role lives in the custom claim; this mirror is read-only.
    role: "customer",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await setDoc(
    doc(getDb(), "users", user.uid),
    {
      email: fresh.email,
      displayName: fresh.displayName,
      photoURL: fresh.photoURL,
      locale: fresh.locale,
      currency: fresh.currency,
      addresses: [],
      wishlist: [],
      marketingOptIn: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return fresh;
}

export async function fetchProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(profileRef(uid));
  return snap.exists() ? snap.data() : null;
}

export async function updateProfileDoc(uid: string, patch: Partial<UserProfile>) {
  const { uid: _uid, role: _role, createdAt: _createdAt, ...safe } = patch;
  void _uid;
  void _role;
  void _createdAt;
  await updateDoc(doc(getDb(), "users", uid), { ...safe, updatedAt: serverTimestamp() });
}

