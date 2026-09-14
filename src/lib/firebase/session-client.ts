"use client";

import type { User } from "firebase/auth";

// Serialize cookie writes so a late token refresh cannot restore a signed-out session.
let pending: Promise<unknown> = Promise.resolve();

export function syncAdminSession(user: User | null): Promise<boolean> {
  const operation = pending.catch(() => {}).then(async () => {
    const token = user ? await user.getIdTokenResult() : null;
    const staff = token?.claims.role === "admin" || token?.claims.role === "staff";
    const response = await fetch("/api/auth/session", {
      method: staff ? "POST" : "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers: staff ? { Authorization: `Bearer ${token!.token}` } : {},
    });
    if (!response.ok) throw new Error("Could not update the admin session. Please sign in again.");
    if (!staff) return false;
    const result = await response.json() as { admin?: boolean };
    return result.admin === true;
  });
  pending = operation;
  return operation;
}
