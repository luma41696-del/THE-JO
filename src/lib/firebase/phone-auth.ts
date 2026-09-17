"use client";

import {
  PhoneAuthProvider,
  RecaptchaVerifier,
  linkWithCredential,
  signInWithCredential,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";

import { getFirebaseAuth } from "./client";
import { AuthError } from "./auth";
import { formatJordanianPhone, normaliseJordanianPhone } from "@/lib/phone";
import type { Locale } from "@/types";

/**
 * Signing in with a phone number.
 *
 * ## This one costs money
 *
 * Every code sent is an SMS Firebase bills for once the free daily allowance
 * is gone, and unlike every other provider here it can be *made* to cost
 * money by a stranger with a loop. So it is switched on by an explicit
 * environment flag rather than by existing, and the shop's own rate limit sits
 * in front of it as well as Firebase's.
 *
 * ## Why the reCAPTCHA is not optional
 *
 * Firebase refuses `signInWithPhoneNumber` without one. It is what stands
 * between the shop and somebody burning its SMS budget — invisible to a real
 * customer, and a challenge to anything that looks automated. It has to be
 * rendered into a real element that stays in the DOM for the lifetime of the
 * attempt; tearing it down between the number and the code is the usual reason
 * this flow fails on the second try.
 */

export { formatJordanianPhone, normaliseJordanianPhone };

/** `true` only when the provider has been switched on deliberately. */
export function phoneSignInEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PHONE_SIGN_IN_ENABLED === "true";
}

/* -------------------------------------------------------------------------- */
/*  The flow                                                                  */
/* -------------------------------------------------------------------------- */

let verifier: RecaptchaVerifier | undefined;

/**
 * The invisible reCAPTCHA, created once and kept.
 *
 * Firebase ties a solved challenge to the verifier instance. Creating a new
 * one for the resend — the obvious thing to do — invalidates the first and the
 * second code never arrives, which looks exactly like an SMS delivery problem
 * and gets debugged as one.
 */
export function ensureRecaptcha(containerId: string): RecaptchaVerifier {
  if (verifier) return verifier;
  verifier = new RecaptchaVerifier(getFirebaseAuth(), containerId, { size: "invisible" });
  return verifier;
}

/** Drop the challenge, so a fresh attempt starts clean after a failure. */
export function clearRecaptcha() {
  try {
    verifier?.clear();
  } catch {
    // Already torn down with the element. Nothing to recover.
  }
  verifier = undefined;
}

export interface PhoneChallenge {
  confirm: (code: string) => Promise<import("firebase/auth").User>;
  /** E.164, for showing the customer where the code went. */
  sentTo: string;
}

/**
 * Text a sign-in code, and return the thing that checks it.
 *
 * The confirmation object is kept in a closure rather than handed to the
 * caller, because it is the only proof the code was requested by this browser
 * — putting it in component state invites it being serialised somewhere.
 */
export async function startPhoneSignIn(
  rawNumber: string,
  containerId: string,
  locale: Locale = "en",
): Promise<PhoneChallenge> {
  if (!phoneSignInEnabled()) {
    throw new AuthError(
      "Phone sign-in is not switched on for this shop.",
      "app/phone-disabled",
    );
  }

  const phone = normaliseJordanianPhone(rawNumber);
  if (!phone) {
    throw new AuthError(
      locale === "ar"
        ? "أدخل رقم هاتف أردني صحيح، مثل 0790000000."
        : "Enter a Jordanian mobile number, like 0790000000.",
      "auth/invalid-phone-number",
    );
  }

  const auth = getFirebaseAuth();
  // The SMS itself is written in the customer's language by Firebase.
  auth.languageCode = locale;

  let confirmation: ConfirmationResult;
  try {
    confirmation = await signInWithPhoneNumber(auth, phone, ensureRecaptcha(containerId));
  } catch (error) {
    // A failed attempt leaves a spent challenge behind; the next one needs a
    // fresh verifier or it fails for a reason that has nothing to do with it.
    clearRecaptcha();
    throw toPhoneError(error);
  }

  return {
    sentTo: phone,
    confirm: async (code: string) => {
      try {
        const credential = await confirmation.confirm(code.trim());
        const { ensureProfile } = await import("./profile");
        await ensureProfile(credential.user, locale);
        return credential.user;
      } catch (error) {
        throw toPhoneError(error);
      }
    },
  };
}

/**
 * Attach a phone number to the account already signed in.
 *
 * Separate from signing in with it: a customer who registered by email and
 * then adds their number should end up with **one** account carrying both, not
 * two accounts that each know half of their orders.
 */
export async function linkPhoneToCurrentUser(
  verificationId: string,
  code: string,
): Promise<void> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new AuthError("Sign in first.", "app/not-signed-in");

  try {
    await linkWithCredential(user, PhoneAuthProvider.credential(verificationId, code.trim()));
  } catch (error) {
    const code_ = errorCode(error);
    /*
     * The number already belongs to another account. Signing into *that* one
     * instead would silently abandon the cart, addresses and order history of
     * the account they are sitting in, so it is refused and explained.
     */
    if (code_ === "auth/credential-already-in-use") {
      throw new AuthError(
        "That number is already on another account. Sign out and sign in with it instead.",
        code_,
      );
    }
    throw toPhoneError(error);
  }
}

/** Sign in with a credential built elsewhere — used by the link-then-switch path. */
export async function signInWithPhoneCredential(verificationId: string, code: string) {
  try {
    const credential = await signInWithCredential(
      getFirebaseAuth(),
      PhoneAuthProvider.credential(verificationId, code.trim()),
    );
    const { ensureProfile } = await import("./profile");
    await ensureProfile(credential.user);
    return credential.user;
  } catch (error) {
    throw toPhoneError(error);
  }
}

/* -------------------------------------------------------------------------- */

function errorCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code: unknown }).code)
    : "auth/unknown";
}

const PHONE_MESSAGES: Record<string, string> = {
  "auth/invalid-phone-number": "That phone number does not look right.",
  "auth/invalid-verification-code": "That code is not right. Check it and try again.",
  "auth/code-expired": "That code has expired. Ask for a new one.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes, then try again.",
  "auth/quota-exceeded": "Too many codes have been sent. Try again later.",
  "auth/captcha-check-failed": "The security check failed. Reload the page and try again.",
  "auth/operation-not-allowed": "Phone sign-in is not switched on for this shop yet.",
  "auth/missing-verification-code": "Enter the code from the message.",
};

function toPhoneError(error: unknown): AuthError {
  const code = errorCode(error);
  return new AuthError(
    PHONE_MESSAGES[code] ?? "That did not work. Please try again.",
    code,
  );
}
