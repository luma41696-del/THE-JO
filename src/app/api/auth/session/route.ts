import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getAdminAuth, isAdminConfigured } from "@/lib/firebase/admin";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE,
  adminSessionCookieOptions,
  isStaffRole,
} from "@/lib/firebase/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  // All mutations come from our own fetch calls. Reject cross-site login/logout CSRF.
  return request.headers.get("origin") === new URL(request.url).origin &&
    request.headers.get("sec-fetch-site") !== "cross-site";
}

function clearedResponse(body: object, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(ADMIN_SESSION_COOKIE, "", { ...adminSessionCookieOptions, maxAge: 0 });
  return response;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 });
  if (!isAdminConfigured()) return clearedResponse({ ok: false }, 503);
  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return clearedResponse({ ok: false }, 401);

  try {
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(idToken, true);
    const user = await auth.getUser(decoded.uid);
    if (user.disabled || !isStaffRole(decoded.role) || !isStaffRole(user.customClaims?.role)) {
      return clearedResponse({ ok: true, admin: false });
    }

    // A fresh login starts a session; a matching, unrevoked cookie may be renewed.
    const recentlySignedIn = Date.now() / 1000 - decoded.auth_time < 5 * 60;
    if (!recentlySignedIn) {
      const previous = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
      const existing = previous ? await auth.verifySessionCookie(previous, true) : null;
      if (!existing || existing.uid !== decoded.uid || !isStaffRole(existing.role)) {
        return clearedResponse({ ok: false, error: "Sign in again to open the admin." }, 401);
      }
    }

    const value = await auth.createSessionCookie(idToken, { expiresIn: ADMIN_SESSION_MAX_AGE * 1000 });
    const response = NextResponse.json({ ok: true, admin: true });
    response.headers.set("Cache-Control", "private, no-store");
    response.cookies.set(ADMIN_SESSION_COOKIE, value, {
      ...adminSessionCookieOptions,
      maxAge: ADMIN_SESSION_MAX_AGE,
    });
    return response;
  } catch {
    return clearedResponse({ ok: false, error: "Sign in again to open the admin." }, 401);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 });
  return clearedResponse({ ok: true });
}
