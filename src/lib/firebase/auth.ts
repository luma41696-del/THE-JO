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
import {
  RESEND_COOLDOWN_MS,
  cooldownRemaining,
  markVerificationSent,
  requestId,
} from "@/lib/verification-throttle";
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
  /*
   * These three are the ones a verification email dies on, and each needs a
   * different action from whoever reads it — so none of them is allowed to
   * collapse into "something went wrong".
   */
  "auth/too-many-requests": {
    message: "Too many requests for this account. Wait a few minutes, then try again.",
  },
  "auth/unauthorized-domain": {
    message:
      "This site's domain is not on the Firebase authorized-domains list, so no email can be sent.",
  },
  "auth/invalid-continue-uri": {
    message: "The return link for the email is not valid.",
  },
  "auth/user-token-expired": {
    message: "Your session expired. Sign in again and retry.",
  },
};

/** The Firebase code as it came, before it is turned into a sentence. */
function rawCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code: unknown }).code)
    : "auth/unknown";
}

function toAuthError(error: unknown): AuthError {
  const code = rawCode(error);
  const known = MESSAGES[code];
  return new AuthError(
    // The code rides along in the message when there is no written one for it,
    // because "Something went wrong" in a bug report is worth nothing.
    known?.message ?? `Something went wrong (${code}). Please try again.`,
    code,
    known?.field,
  );
}

/**
 * Who is signed in and what is confirmed — development only.
 *
 * Deliberately never in production: `providerData` carries the customer's
 * email and provider ids, and a shop that prints those into a browser console
 * has put them into every screen recording and support screenshot of that
 * session. No tokens, no password, and nothing here that is not already on
 * the customer's own account page.
 */
function logAuthState(where: string) {
  if (process.env.NODE_ENV === "production") return;
  const user = getFirebaseAuth().currentUser;
  if (!user) {
    console.info(`[net sale] auth (${where}): nobody signed in.`);
    return;
  }
  console.info(`[net sale] auth (${where})`, {
    email: user.email,
    emailVerified: user.emailVerified,
    providerData: user.providerData.map((entry) => ({
      providerId: entry.providerId,
      email: entry.email,
    })),
  });
}

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Tell the server where this sign-in came from.
 *
 * Firebase authenticates entirely in the browser, so without this call a
 * sign-in touches no server of ours and the shop never learns the address —
 * which is what an account block needs in order to also be an address block.
 *
 * ## It is awaited, and it cannot fail the sign-in
 *
 * Awaited so the write is in flight before the page navigates away; wrapped so
 * that nothing it does can throw into the caller. A customer must never be
 * kept out of their account because a bookkeeping write went wrong, and the
 * address is not worth one failed login.
 *
 * The failure is logged rather than swallowed. A `.catch(() => {})` here would
 * make a broken endpoint invisible for months — which is exactly how the
 * verification email went unnoticed.
 */
export async function recordSignInAddress(user: User): Promise<void> {
  try {
    const token = await user.getIdToken();
    const response = await fetch("/api/auth/seen", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      console.warn(`[net sale] sign-in address not recorded (${response.status}).`);
    }
  } catch (error) {
    console.warn("[net sale] sign-in address not recorded:", error);
  }
}

export async function signIn(email: string, password: string) {
  try {
    const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    // Imported here rather than at the top: this is the one path that needs
    // Firestore, and it must not be in the bundle of every page that only
    // wants a token.
    const { ensureProfile } = await import("./profile");
    await ensureProfile(credential.user);
    await recordSignInAddress(credential.user);
    return credential.user;
  } catch (error) {
    throw toAuthError(error);
  }
}

/** What sign-up produced: the account, and whether the email actually went. */
export interface SignUpResult {
  user: User;
  /** `true` only once Firebase has accepted the send. */
  verificationSent: boolean;
  /** The real Firebase code when it did not, for the UI and the log. */
  verificationError?: AuthError;
}

/** How long the UI should wait before offering to send another. */
export { RESEND_COOLDOWN_MS };

export async function signUp(
  name: string,
  email: string,
  password: string,
  locale: Locale = "en",
): Promise<SignUpResult> {
  if (name.trim().length < 2) {
    throw new AuthError("Please enter your name.", "app/invalid-name", "name");
  }

  let credential;
  try {
    credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
    await updateProfile(credential.user, { displayName: name.trim() });
  } catch (error) {
    // Only a failure to create the account itself is a failed sign-up.
    throw toAuthError(error);
  }

  /*
   * The profile document is a follow-up, not a precondition.
   *
   * It used to be awaited in the same try as account creation, above the
   * verification send — so a Firestore hiccup, an App Check blip or a rules
   * change meant the customer got an account, no verification email, and
   * "Something went wrong". The account is real by this point and `ensureProfile`
   * is idempotent and runs again on every sign-in, so a failure here heals
   * itself. A missing verification email does not.
   */
  try {
    const { ensureProfile } = await import("./profile");
    await ensureProfile(credential.user, locale);
  } catch (error) {
    console.error(
      "[net sale] Profile document was not written at sign-up; it will be retried on next sign-in.",
      rawCode(error),
    );
  }

  /*
   * Awaited, and its outcome returned.
   *
   * This used to be `void requestEmailVerification(...).catch(() => {})`, on
   * the reasoning that a failed send must not turn a successful registration
   * into an error. The first half of that is right and the second half was
   * the bug: discarding the rejection meant that when the send failed, the
   * customer was told nothing, the console showed nothing, and there was no
   * way — from the outside or the inside — to find out why no email arrived.
   *
   * The account still stands whatever happens here. What changes is that the
   * caller now knows, and can say so.
   */
  let verificationSent = false;
  let verificationError: AuthError | undefined;
  try {
    await requestEmailVerification(credential.user, locale);
    verificationSent = true;
  } catch (error) {
    verificationError = error instanceof AuthError ? error : toAuthError(error);
    console.error(
      "[net sale] Verification email was not sent.",
      verificationError.code,
      verificationError.message,
    );
  }

  logAuthState("after sign-up");
  return { user: credential.user, verificationSent, verificationError };
}

export async function signInWithGoogle(locale: Locale = "en") {
  const provider = new GoogleAuthProvider();
  // Always show the chooser: shared devices are common in this market.
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const credential = await signInWithPopup(getFirebaseAuth(), provider);
    const { ensureProfile } = await import("./profile");
    await ensureProfile(credential.user, locale);
    await recordSignInAddress(credential.user);
    return credential.user;
  } catch (error) {
    throw toAuthError(error);
  }
}

/** Did this account come from Google (or any other federated provider)? */
export function isFederatedUser(user: User): boolean {
  return user.providerData.some((entry) => entry.providerId !== "password");
}

/**
 * Send (or re-send) the address confirmation.
 *
 * ## Never for a Google account
 *
 * Google has already proved the address — that is the whole point of signing
 * in with it — and such accounts arrive with `emailVerified` already true.
 * Asking Firebase to verify them is at best a wasted call and at worst an
 * email telling a customer to confirm something they never typed.
 *
 * ## Why the continue URL has a fallback
 *
 * `ActionCodeSettings.url` must be on the project's authorized-domains list,
 * and if it is not, Firebase rejects the whole call and **sends nothing**.
 * That failure mode is invisible from the code and costs a customer their
 * sign-up, so a rejected URL falls back to a bare send: the plain Firebase
 * landing page is a far better outcome than no email. `netsale.shop` is on the
 * list today; this is here so that a new domain, or a project restored from a
 * backup, degrades instead of breaking.
 */
/**
 * The one send in flight, if any.
 *
 * Two callers asking at the same moment — a double-clicked button, a component
 * that mounted twice — get the *same* promise rather than two emails. Firebase
 * counts the second one, and the customer who clicked once is the one told
 * they have tried too many times.
 */
let inFlight: { uid: string; promise: Promise<void> } | null = null;

export async function requestEmailVerification(user: User, locale: Locale = "en") {
  if (isFederatedUser(user)) {
    throw new AuthError(
      "This account signs in with Google, so its address is already confirmed.",
      "app/federated-account",
    );
  }

  // Collapse concurrent asks for the same account into the one already going.
  if (inFlight && inFlight.uid === user.uid) {
    console.info("[net sale] verification: joining the send already in flight.");
    return inFlight.promise;
  }

  /*
   * Refuse inside the cooldown rather than letting Firebase refuse.
   *
   * Firebase's answer to a too-soon second send is `auth/too-many-requests`,
   * which reads to the customer as an accusation. Ours names the wait.
   */
  const waitMs = cooldownRemaining(user.uid);
  if (waitMs > 0) {
    throw new AuthError(
      `A link was just sent. Check your inbox, or ask again in ${Math.ceil(waitMs / 1000)}s.`,
      "app/verification-cooldown",
    );
  }

  const promise = send(user, locale);
  inFlight = { uid: user.uid, promise };
  try {
    await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

/**
 * Ask the server to send the branded email.
 *
 * Returns `false` when the server says it cannot — no mail provider, no Admin
 * credentials, a provider outage — which is the signal to fall back to
 * Firebase's own plain email rather than leave the customer with nothing. That
 * fallback is the whole reason the branded flow can be rolled out without a
 * window where sign-up sends no email at all.
 *
 * Throws only for a refusal the customer needs to hear about, like being
 * rate-limited.
 */
async function sendBranded(locale: Locale): Promise<boolean> {
  let response: Response;
  try {
    const token = await getIdToken();
    if (!token) return false;
    response = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ locale }),
    });
  } catch {
    // The shop's own endpoint is unreachable. Firebase may still be.
    return false;
  }

  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    sent?: boolean;
    fallback?: boolean;
    error?: string;
  };

  if (response.ok && data.ok) return data.sent !== false;

  // Too many requests is the customer's answer, not something to route around
  // by asking Firebase for the same email.
  if (response.status === 429) {
    throw new AuthError(
      "A link was just sent. Check your inbox, then try again shortly.",
      "app/verification-cooldown",
    );
  }

  if (data.fallback) {
    console.warn("[net sale] branded verification unavailable, using Firebase:", data.error);
    return false;
  }

  throw new AuthError(data.error ?? "That could not be sent.", "app/verification-failed");
}

/** The actual call, with one log line per attempt. */
async function send(user: User, locale: Locale) {
  const id = requestId();
  const at = new Date().toISOString();
  const settings = {
    url: `${window.location.origin}/${locale}/account?verified=1`,
    handleCodeInApp: false,
  };

  /*
   * Every call is logged with an id and a timestamp, in production too.
   *
   * This is the line that answers "did the app send twice?" without anybody
   * having to reason about React's lifecycle. It carries no address, no token
   * and no personal data — just which account, when, and which attempt.
   */
  console.info(`[net sale] verification send ${id} at ${at} for ${user.uid}`);

  /*
   * The branded email first, Firebase's plain one only if it cannot go.
   *
   * Both end at the same place — a Firebase `oobCode` link — so a customer who
   * gets one and a customer who gets the other end up equally verified. The
   * difference is which one looks like the shop.
   */
  // A cooldown or an outright refusal throws and is the customer's answer;
  // only "cannot send" returns false and falls through to Firebase.
  if (await sendBranded(locale)) {
    markVerificationSent(user.uid);
    console.info(`[net sale] verification send ${id}: sent by the shop's own mail provider.`);
    return;
  }

  try {
    await sendEmailVerification(user, settings);
    markVerificationSent(user.uid);
    console.info(`[net sale] verification send ${id}: accepted by Firebase.`);
  } catch (error) {
    const code = rawCode(error);

    /*
     * The fallback fires only for a rejected continue URL — a case where
     * Firebase refuses the request outright and sends nothing, so a second
     * attempt cannot duplicate an email. Any other failure is reported, never
     * retried: a retry after a timeout is exactly how one click becomes two
     * emails and then `auth/too-many-requests`.
     */
    if (code === "auth/unauthorized-domain" || code === "auth/invalid-continue-uri") {
      console.warn(
        `[net sale] verification send ${id}: ${settings.url} is not authorized — retrying without a return link.`,
      );
      await sendEmailVerification(user);
      markVerificationSent(user.uid);
      console.info(`[net sale] verification send ${id}: accepted without a return link.`);
      return;
    }

    console.error(`[net sale] verification send ${id} failed:`, code);
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
/**
 * Re-send, unless the address turns out to be confirmed already.
 *
 * The reload is not politeness. `emailVerified` is a property of the token
 * this tab is holding, so a customer who clicked the link in their mail app
 * and came back to a stale tab would otherwise be sent a second email for an
 * address that is already confirmed — and would reasonably read that as the
 * first one not having worked.
 */
export async function resendEmailVerification(
  locale: Locale = "en",
): Promise<{ sent: boolean; alreadyVerified: boolean }> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new AuthError("Sign in first.", "app/not-signed-in");

  await user.reload();
  const current = auth.currentUser;
  if (!current) throw new AuthError("Sign in first.", "app/not-signed-in");

  logAuthState("before resend");

  if (current.emailVerified) return { sent: false, alreadyVerified: true };

  await requestEmailVerification(current, locale);
  return { sent: true, alreadyVerified: false };
}

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
