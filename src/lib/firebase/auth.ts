"use client";

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from "firebase/auth";

import { getFirebaseAuth } from "./client";
import { syncAdminSession } from "./session-client";
import type { Locale } from "@/types";

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
  "auth/operation-not-allowed": {
    message: "That sign-in method is not switched on for this shop yet.",
  },
  "auth/invalid-phone-number": {
    message: "That phone number does not look right.",
  },
  "auth/invalid-verification-code": {
    message: "That code is not right. Check it and try again.",
  },
  "auth/code-expired": { message: "That code has expired. Ask for a new one." },
  "auth/missing-phone-number": { message: "Enter your phone number." },
  "auth/quota-exceeded": {
    message: "Too many codes requested. Try again later.",
  },
  "auth/credential-already-in-use": {
    message: "That is already linked to another account.",
  },
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
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

export async function signIn(email: string, password: string) {
  try {
    const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    // Imported here rather than at the top: this is the one path that needs
    // Firestore, and it must not be in the bundle of every page that only
    // wants a token.
    const { ensureProfile } = await import("./profile");
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
    const { ensureProfile } = await import("./profile");
    await ensureProfile(credential.user, locale);

    /*
     * Sent at sign-up, and deliberately not awaited into the failure path.
     *
     * A verification email that will not send — a quota, a bounce, a provider
     * having a bad minute — must not turn a successful registration into an
     * error that leaves the customer with an account they were told was not
     * created. They can ask for another from the banner in their account.
     */
    void requestEmailVerification(credential.user, locale).catch(() => {});

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
    const { ensureProfile } = await import("./profile");
    await ensureProfile(credential.user, locale);
    return credential.user;
  } catch (error) {
    throw toAuthError(error);
  }
}

/**
 * Send (or re-send) the address confirmation.
 *
 * `continueUrl` brings them back to their account rather than to Firebase's
 * own bare "email verified" page, which carries none of the shop's branding
 * and leaves the customer on a dead end wondering whether it worked.
 */
export async function requestEmailVerification(user: User, locale: Locale = "en") {
  try {
    await sendEmailVerification(user, {
      url: `${window.location.origin}/${locale}/account?verified=1`,
      handleCodeInApp: false,
    });
  } catch (error) {
    throw toAuthError(error);
  }
}

/**
 * Re-read the user from Firebase, so a just-clicked link is reflected here.
 *
 * `user.emailVerified` is a property of the *cached* token. Clicking the link
 * in another tab does not change this one, so a page that never reloads shows
 * the "please confirm" banner to somebody who already has — which reads as the
 * confirmation not having worked, and gets it clicked again.
 */
export async function refreshVerification(): Promise<boolean> {
  const user = getFirebaseAuth().currentUser;
  if (!user) return false;
  await user.reload();
  // The claim rides in the token, so a forced refresh is what lets the server
  // see it too.
  await user.getIdToken(true);
  return getFirebaseAuth().currentUser?.emailVerified ?? false;
}

export async function requestPasswordReset(email: string) {
  try {
    await sendPasswordResetEmail(getFirebaseAuth(), email);
  } catch (error) {
    throw toAuthError(error);
  }
}

export async function signOut() {
  // Clear the HttpOnly cookie before changing client identity or navigating.
  await syncAdminSession(null);
  await fbSignOut(getFirebaseAuth());
}

/** Fresh ID token for calling our own route handlers. */
export async function getIdToken(forceRefresh = false) {
  const user = getFirebaseAuth().currentUser;
  return user ? user.getIdToken(forceRefresh) : null;
}
