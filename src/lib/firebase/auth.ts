"use client";

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

import { getDb, getFirebaseAuth } from "./client";
import { userConverter } from "./converters";
import type { Locale, UserProfile } from "@/types";

/**
 * Auth actions.
 *
 * Every function returns a narrow, already-translated error rather than a raw
 * Firebase code, because `auth/invalid-credential` in a form field is not a
 * message — it is a support ticket.
 */

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field?: "email" | "password" | "name",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const MESSAGES: Record<string, { message: string; field?: "email" | "password" | "name" }> = {
  "auth/invalid-email": { message: "That email address does not look right.", field: "email" },
  "auth/email-already-in-use": {
    message: "An account already exists with this email. Try signing in.",
    field: "email",
  },
  "auth/weak-password": {
    message: "Use at least 8 characters, with a number or symbol.",
    field: "password",
  },
  "auth/invalid-credential": {
    message: "That email and password do not match an account.",
    field: "password",
  },
  "auth/wrong-password": { message: "Incorrect password.", field: "password" },
  "auth/user-not-found": { message: "No account found for that email.", field: "email" },
  "auth/too-many-requests": {
    message: "Too many attempts. Wait a minute, then try again.",
  },
  "auth/popup-closed-by-user": { message: "Sign-in window was closed before finishing." },
  "auth/network-request-failed": { message: "Network problem. Check your connection." },
};

function toAuthError(error: unknown): AuthError {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code: unknown }).code)
      : "auth/unknown";
  const known = MESSAGES[code];
  return new AuthError(
    known?.message ?? "Something went wrong. Please try again.",
    code,
    known?.field,
  );
}

/* -------------------------------------------------------------------------- */
/*  Profile                                                                   */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

export async function signIn(email: string, password: string) {
  try {
    const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    await ensureProfile(credential.user);
    return credential.user;
  } catch (error) {
    throw toAuthError(error);
  }
}

export async function signUp(name: string, email: string, password: string, locale: Locale = "en") {
  if (name.trim().length < 2) {
    throw new AuthError("Please enter your name.", "app/invalid-name", "name");
  }
  try {
    const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
    await updateProfile(credential.user, { displayName: name.trim() });
    await ensureProfile(credential.user, locale);
    return credential.user;
  } catch (error) {
    throw toAuthError(error);
  }
}

export async function signInWithGoogle(locale: Locale = "en") {
  const provider = new GoogleAuthProvider();
  // Always show the chooser: shared devices are common in this market.
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const credential = await signInWithPopup(getFirebaseAuth(), provider);
    await ensureProfile(credential.user, locale);
    return credential.user;
  } catch (error) {
    throw toAuthError(error);
  }
}

export async function requestPasswordReset(email: string) {
  try {
    await sendPasswordResetEmail(getFirebaseAuth(), email);
  } catch (error) {
    throw toAuthError(error);
  }
}

export async function signOut() {
  await fbSignOut(getFirebaseAuth());
}

/** Fresh ID token for calling our own route handlers. */
export async function getIdToken(forceRefresh = false) {
  const user = getFirebaseAuth().currentUser;
  return user ? user.getIdToken(forceRefresh) : null;
}
