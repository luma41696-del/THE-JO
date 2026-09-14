import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAdminAuth, isAdminConfigured } from "./admin";

export const ADMIN_SESSION_COOKIE = "ns-admin-session";
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 24 * 5;
export const adminSessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export function isStaffRole(role: unknown): role is "staff" | "admin" {
  return role === "staff" || role === "admin";
}

/** The server verifies the cookie and current role before reading any private data. */
export const getAdminSession = cache(async () => {
  const value = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!value || !isAdminConfigured()) return null;
  try {
    const auth = getAdminAuth();
    const session = await auth.verifySessionCookie(value, true);
    if (!isStaffRole(session.role)) return null;
    // A removed role must take effect even while a previously issued cookie exists.
    const user = await auth.getUser(session.uid);
    if (user.disabled || !isStaffRole(user.customClaims?.role)) return null;
    return session;
  } catch {
    return null;
  }
});

export const requireAdminSession = cache(async () => {
  const session = await getAdminSession();
  if (session) return session;

  // Preview may read generated data only; callers must not use Admin SDK for it.
  if (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_ADMIN_DEV_BYPASS === "true"
  ) return null;

  const locale = (await cookies()).get("NEXT_LOCALE")?.value === "ar" ? "ar" : "en";
  redirect(`/${locale}/login?next=%2Fadmin`);
});
