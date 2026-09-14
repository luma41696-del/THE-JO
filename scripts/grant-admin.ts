/**
 * Grant or revoke an admin role.
 *
 *   npm run grant-admin -- luma41696@gmail.com
 *   npm run grant-admin -- someone@example.com --role staff
 *   npm run grant-admin -- someone@example.com --revoke
 *
 * The role is written as a **Firebase custom claim**, not a Firestore field.
 * That distinction is the whole security model: a claim is signed by Firebase
 * and travels inside the ID token, so Security Rules and server routes can
 * trust it. A `role` field in a document is only as trustworthy as the rules
 * protecting that document — and if the account can edit its own profile, a
 * document-based role is self-assignable.
 *
 * Requires FIREBASE_ADMIN_* in `.env.local`. This script bypasses every rule,
 * so it belongs on a developer machine or in CI — never behind an HTTP route.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

/* --- env ----------------------------------------------------------------- */

function loadEnv() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* fall through to the explicit check below */
  }
}

loadEnv();

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    "\n  Missing Admin SDK credentials.\n\n" +
      "  Firebase console > Project settings > Service accounts > Generate new private key,\n" +
      "  then add FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL and\n" +
      "  FIREBASE_ADMIN_PRIVATE_KEY to .env.local.\n",
  );
  process.exit(1);
}

/* --- args ---------------------------------------------------------------- */

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const revoke = args.includes("--revoke");
const roleArg = args[args.indexOf("--role") + 1];
const role = revoke ? "customer" : roleArg === "staff" ? "staff" : "admin";

if (!email) {
  console.error(
    "\n  Usage: npm run grant-admin -- <email> [--role staff] [--revoke]\n",
  );
  process.exit(1);
}

/* --- run ----------------------------------------------------------------- */

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
}

const auth = getAuth();

async function main() {
  let user;
  try {
    user = await auth.getUserByEmail(email!);
  } catch {
    console.error(
      `\n  No Firebase Auth user with the email ${email}.\n\n` +
        `  Create the account first — sign up at /en/register with that address,\n` +
        `  then re-run this script.\n`,
    );
    process.exit(1);
  }

  // Merge rather than replace: other claims (a future `storeId`, say) survive.
  const existing = user.customClaims ?? {};
  await auth.setCustomUserClaims(user.uid, { ...existing, role });

  // Force every existing session to re-authenticate. Without this the old token
  // keeps its old claims until it expires — up to an hour of stale access,
  // which matters most in the case this script exists for: revoking one.
  await auth.revokeRefreshTokens(user.uid);

  console.log(
    `\n  ${revoke ? "Revoked" : "Granted"}: ${email} is now "${role}".\n` +
      `  uid ${user.uid}\n\n` +
      `  Existing sessions were revoked, so they must sign in again to pick\n` +
      `  the claim up. Then /admin is reachable.\n`,
  );
}

main().catch((error) => {
  console.error("\n  Failed:", error);
  process.exit(1);
});
