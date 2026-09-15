import { NextResponse } from "next/server";

import { isAdminConfigured, setUserRole, verifyRequest } from "@/lib/firebase/admin";
import { canChangeRole, isRole, shouldRevokeTokens, type Role } from "@/lib/team";

/**
 * Appointing and removing staff, from inside the shop.
 *
 * This is the most dangerous route in the project: it hands out the permission
 * that bypasses every other permission. So it is also the most conservative.
 *
 *  - The caller's own role is read from a **verified ID token** with the Admin
 *    SDK, never from the request body, a cookie the browser can shape, or the
 *    UI that rendered the form.
 *  - Only an admin may call it. Staff are refused, including for their own
 *    account, because a staff member who can promote can promote themselves.
 *  - The target is looked up by email against Firebase Auth. An address with no
 *    account is refused rather than silently "invited" — an invitation nobody
 *    can accept is a grant that never happened.
 *  - Removing access revokes the account's refresh tokens, so it ends now
 *    rather than whenever their current hour-long ID token expires.
 *  - Every change is written to `auditLog` with who did it and to whom. A
 *    privilege change nobody can reconstruct afterwards is how an account
 *    quietly keeps access it was never granted.
 *
 * `scripts/grant-admin.ts` stays. The first admin cannot be appointed from a
 * screen only an admin may open, so the CLI remains the bootstrap — and the
 * way back in if the last admin is ever lost.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enough for any shop this admin was built for; stated when exceeded. */
const MAX_ACCOUNTS = 1_000;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

interface Member {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  lastSignInAt: number | null;
  createdAt: number | null;
  disabled: boolean;
}

async function listTeam() {
  const { getAdminAuth } = await import("@/lib/firebase/admin");
  const auth = getAdminAuth();

  const members: Member[] = [];
  let admins = 0;
  let accounts = 0;
  let pageToken: string | undefined;
  let truncated = false;

  do {
    const page = await auth.listUsers(1_000, pageToken);
    for (const user of page.users) {
      accounts += 1;
      const role = (user.customClaims?.role as Role | undefined) ?? "customer";
      if (role === "admin") admins += 1;
      // Only people with access are listed. The customer list is a different
      // screen, built from orders, and does not belong on a permissions page.
      if (role === "staff" || role === "admin") {
        members.push({
          uid: user.uid,
          email: user.email ?? null,
          displayName: user.displayName ?? null,
          role,
          lastSignInAt: user.metadata.lastSignInTime
            ? Date.parse(user.metadata.lastSignInTime)
            : null,
          createdAt: user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : null,
          disabled: user.disabled,
        });
      }
    }
    pageToken = page.pageToken;
    if (accounts >= MAX_ACCOUNTS && pageToken) {
      truncated = true;
      break;
    }
  } while (pageToken);

  members.sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return (a.email ?? "").localeCompare(b.email ?? "");
  });

  return { members, admins, accounts, truncated };
}

/* -------------------------------------------------------------------------- */

export async function GET(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, members: [], admins: 0, persisted: false });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  // Staff may see who holds access — they cannot change it. Hiding the list
  // from them protects nothing; the rail already shows the screen exists.
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to read the team.", 403);
  }

  try {
    const { members, admins, accounts, truncated } = await listTeam();
    return NextResponse.json({
      ok: true,
      members,
      admins,
      accounts,
      truncated,
      callerUid: caller.uid,
      callerRole: caller.role,
    });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "The team could not be read.",
      500,
    );
  }
}

/* -------------------------------------------------------------------------- */

interface Body {
  email?: string;
  uid?: string;
  role?: Role;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const uid = String(body.uid ?? "").trim();
  if (!email && !uid) return bad("An email address is required.");
  if (!isRole(body.role)) return bad("That is not a role.");
  const nextRole: Role = body.role;

  if (!isAdminConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        persisted: false,
        error:
          "Firebase Admin is not configured here, so no role was changed. " +
          "Nothing was written.",
      },
      { status: 503 },
    );
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  try {
    const { getAdminAuth, getAdminDb } = await import("@/lib/firebase/admin");
    const auth = getAdminAuth();

    const target = await (uid ? auth.getUser(uid) : auth.getUserByEmail(email)).catch(() => null);
    if (!target) {
      return bad(
        "No account uses that email address yet. Ask them to sign in to the shop once, " +
          "then grant access.",
        404,
      );
    }

    const targetRole = (target.customClaims?.role as Role | undefined) ?? "customer";
    const { admins } = await listTeam();

    const verdict = canChangeRole({
      callerRole: caller.role,
      callerUid: caller.uid,
      targetUid: target.uid,
      targetRole,
      nextRole,
      adminCount: admins,
    });

    if (!verdict.ok) {
      return NextResponse.json(
        { ok: false, reason: verdict.reason, error: verdict.message.en, message: verdict.message },
        { status: verdict.reason === "not-admin" ? 403 : 409 },
      );
    }

    await setUserRole(target.uid, nextRole);

    /*
     * A demotion has to bite immediately. Without this the account keeps a
     * working admin token until it expires — up to an hour of access after the
     * screen said the access was removed.
     */
    if (shouldRevokeTokens(targetRole, nextRole)) {
      await auth.revokeRefreshTokens(target.uid);
    }

    await getAdminDb()
      .collection("auditLog")
      .add({
        action: "team.role",
        targetUid: target.uid,
        targetEmail: target.email ?? null,
        from: targetRole,
        to: nextRole,
        actorUid: caller.uid,
        actorEmail: caller.email,
        at: new Date(),
      });

    return NextResponse.json({
      ok: true,
      persisted: true,
      uid: target.uid,
      email: target.email ?? null,
      role: nextRole,
      /*
       * Said plainly, because it is the part people get wrong: a claim reaches
       * a browser on the next token refresh, not instantly. Granting without
       * saying this produces "it did not work" from someone whose access is
       * already waiting for them.
       */
      note:
        nextRole === "customer"
          ? "Access removed. Their session has been signed out."
          : "Access granted. They need to sign out and back in before the admin opens.",
    });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "The role could not be changed.",
      500,
    );
  }
}
