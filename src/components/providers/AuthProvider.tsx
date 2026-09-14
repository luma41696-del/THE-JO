"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onIdTokenChanged, type User } from "firebase/auth";

import { getFirebaseAuth, initAnalytics, initAppCheck } from "@/lib/firebase/client";
import { ensureProfile, fetchProfile } from "@/lib/firebase/auth";
import { syncAdminSession } from "@/lib/firebase/session-client";
import { useWishlist } from "@/lib/store/wishlist";
import type { UserProfile } from "@/types";

/**
 * Auth session.
 *
 * `status` is a three-state union rather than a boolean, because "we do not
 * know yet" and "signed out" must render differently — flashing a Sign in link
 * at an authenticated customer on every page load is the classic Firebase tell.
 */

type Status = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  status: Status;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  status: "loading",
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const syncWishlist = useWishlist((s) => s.syncFromServer);

  // App Check must initialise before the first Firestore read, so it runs here
  // rather than inside a page. Analytics is fire-and-forget.
  useEffect(() => {
    void initAppCheck();
    void initAnalytics();
  }, []);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(getFirebaseAuth(), async (nextUser) => {
      setUser(nextUser);
      // Refreshes renew the server cookie too. Customer auth remains available
      // if the admin endpoint is offline; explicit admin navigation waits for it.
      void syncAdminSession(nextUser).catch(() => {});

      if (!nextUser) {
        setProfile(null);
        setStatus("anonymous");
        return;
      }

      try {
        const nextProfile = await ensureProfile(nextUser);
        setProfile(nextProfile);
        // A guest who wishlisted before signing in keeps those items.
        syncWishlist(nextProfile.wishlist ?? []);
      } catch {
        // Rules rejection or offline: the session is still valid, the profile
        // simply is not available yet. The UI degrades to auth-only state.
        setProfile(null);
      } finally {
        setStatus("authenticated");
      }
    });

    return unsubscribe;
  }, [syncWishlist]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      status,
      refreshProfile: async () => {
        if (!user) return;
        setProfile(await fetchProfile(user.uid));
      },
    }),
    [user, profile, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Convenience for gating UI without repeating the status comparison. */
export function useIsSignedIn() {
  return useAuth().status === "authenticated";
}
