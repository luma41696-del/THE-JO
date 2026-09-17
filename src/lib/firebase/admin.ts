import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Firebase Admin SDK — server only.
 *
 * The `server-only` import above is load-bearing: if any Client Component ever
 * imports this file, the build fails instead of leaking a service-account key
 * into the browser bundle.
 *
 * Admin bypasses all Security Rules. Use it for exactly the things the client
 * must not be trusted with:
 *   - re-pricing a cart and creating the order document
 *   - decrementing stock inside a transaction
 *   - validating and redeeming discount codes
 *   - setting the `role` custom claim
 */

const ADMIN_APP = "net-sale-admin";

function credentials() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  // Vercel and most CI systems store the key with literal "\n" sequences.
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "[net sale] Firebase Admin is not configured. Set FIREBASE_ADMIN_PROJECT_ID, " +
        "FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY in .env.local " +
        "(Firebase console > Project settings > Service accounts).",
    );
  }

  return { projectId, clientEmail, privateKey };
}

export function getAdminApp(): App {
  const existing = getApps().find((a) => a.name === ADMIN_APP);
  if (existing) return existing;

  const { projectId, clientEmail, privateKey } = credentials();
  return initializeApp(
    {
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    },
    ADMIN_APP,
  );
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

/** Present so callers can probe configuration without triggering the throw. */
export function isAdminConfigured() {
  return Boolean(
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
      process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
      process.env.FIREBASE_ADMIN_PRIVATE_KEY,
  );
}

/**
 * Verify the caller's ID token from an `Authorization: Bearer <token>` header.
 * Returns `null` rather than throwing so route handlers can answer 401 cleanly.
 *
 * `checkRevoked` costs an extra lookup but means a signed-out or disabled
 * account cannot keep placing orders with a still-valid cached token.
 */
export async function verifyRequest(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  try {
    const decoded = await getAdminAuth().verifyIdToken(token, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      role: (decoded.role as "customer" | "staff" | "admin" | undefined) ?? "customer",
      /*
       * Whether we know this person can be reached.
       *
       * A phone sign-in counts. It has no email at all, and treating "no
       * verified email" as unconfirmed would lock every phone customer out of
       * the parts of the shop that ask for a confirmed identity — which is the
       * opposite of what confirming an identity is for. What matters is that
       * *some* channel was proved, not which one.
       */
      emailVerified: decoded.email_verified === true,
      phoneVerified: typeof decoded.phone_number === "string" && decoded.phone_number.length > 0,
      get verified(): boolean {
        return this.emailVerified || this.phoneVerified;
      },
    };
  } catch {
    return null;
  }
}

/**
 * A caller who has proved they can be reached, or a refusal explaining how.
 *
 * Used by the routes that publish something other people read, or that send a
 * message on the shop's behalf. Staff are exempt: their accounts are created
 * by an administrator, which is a stronger check than an email round-trip.
 */
export function requireVerified(
  caller: { verified: boolean; role: string } | null,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!caller) return { ok: false, status: 401, error: "Sign in first." };
  if (caller.role === "staff" || caller.role === "admin") return { ok: true };
  if (caller.verified) return { ok: true };
  return {
    ok: false,
    status: 403,
    error: "Confirm your email address first — check your inbox for the link.",
  };
}

/** Grant staff/admin. Call from a protected script or an admin-only route. */
export async function setUserRole(uid: string, role: "customer" | "staff" | "admin") {
  await getAdminAuth().setCustomUserClaims(uid, { role });
  // The claim only reaches the client on the next token refresh; the client
  // should call `getIdToken(true)` after an elevation.
}
