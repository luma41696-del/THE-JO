"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Link } from "@/components/ui/Link";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/Button";
import { BrandWave } from "@/components/brand/BrandWave";

/**
 * Admin access gate.
 *
 * Reads the **`role` custom claim off the ID token**, not a Firestore field.
 * A claim is signed by Firebase and cannot be edited by the account it belongs
 * to; a document field can be, wherever the rules let a user write their own
 * profile. Anyone building an admin on a document field has built a door with
 * the lock on the outside.
 *
 * This is still only the *UI* gate. It decides what to render, nothing more.
 * The controls that matter are:
 *   - Firestore Security Rules, which reject unauthorised writes whatever the
 *     browser thinks;
 *   - `verifyRequest()` in every admin route handler, which re-checks the claim
 *     server-side with the Admin SDK.
 * If this component were deleted entirely, no data would become writable.
 */

type Access = "checking" | "granted" | "denied" | "anonymous";

/**
 * Development-only preview.
 *
 * Opens the admin without an account so the screens can be built and reviewed
 * before Firebase Auth, a service account and a role claim all exist. Two locks,
 * and both must hold:
 *
 *  1. `NODE_ENV === "development"` — Next inlines this at build time, so in a
 *     production bundle the whole branch is dead code and is eliminated. It
 *     cannot be switched on by setting an environment variable on the server.
 *  2. An explicit opt-in flag, so it is never on by accident in a dev session.
 *
 * It changes nothing about what can be *written*: every admin route handler
 * re-verifies the caller's claim with the Admin SDK, and Security Rules reject
 * unauthorised writes regardless. With no session there is no token, so every
 * mutation from a bypassed session is refused — this grants reading the UI, not
 * authority over the data.
 */
const DEV_BYPASS =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_ADMIN_DEV_BYPASS === "true";

export function AdminGate({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const [access, setAccess] = useState<Access>("checking");
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (DEV_BYPASS) {
      setAccess("granted");
      setRole("dev-bypass");
      return;
    }

    if (status === "loading") return;

    if (status === "anonymous" || !user) {
      setAccess("anonymous");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        // `true` forces a refresh: a role granted seconds ago is otherwise
        // invisible until the cached token expires, which looks like the grant
        // silently failing.
        const token = await user.getIdTokenResult(true);
        if (cancelled) return;

        const claim = (token.claims.role as string | undefined) ?? "customer";
        setRole(claim);
        setAccess(claim === "admin" || claim === "staff" ? "granted" : "denied");
      } catch {
        if (!cancelled) setAccess("denied");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, status]);

  if (access === "checking") {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="h-20 w-20 opacity-60">
          <BrandWave rings={3} color="var(--color-brand)" speed={5} />
        </div>
        <span className="sr-only">Checking access</span>
      </div>
    );
  }

  if (access === "anonymous") {
    return (
      <Shell
        title="Sign in to continue"
        body="The admin is only reachable by a signed-in account with a staff or admin role."
        action={
          <Link href="/login?next=/admin">
            <Button variant="brand" size="lg" magnetic>
              Sign in
            </Button>
          </Link>
        }
      />
    );
  }

  if (access === "denied") {
    return (
      <Shell
        title="This account does not have admin access"
        body={
          <>
            Signed in as <strong className="text-ink">{user?.email}</strong> with the role{" "}
            <code className="bg-paper-sunken rounded-xs px-1.5 py-0.5 text-[0.8125rem]">
              {role ?? "customer"}
            </code>
            . Grant access from a trusted machine:
            <code className="bg-ink mt-4 block rounded-md px-4 py-3 text-start text-[0.8125rem] text-white">
              npm run grant-admin -- {user?.email}
            </code>
            Then sign out and back in so the new token carries the claim.
          </>
        }
        action={
          <Link href="/">
            <Button variant="secondary" size="lg">
              Back to the store
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <>
      {DEV_BYPASS && (
        <p
          role="status"
          className="bg-alert sticky top-0 z-[200] px-4 py-1.5 text-center text-[0.6875rem] font-medium text-white"
        >
          Development preview — access checks are bypassed. Writes still require a
          verified admin token and will be refused.
        </p>
      )}
      {children}
    </>
  );
}

function Shell({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto h-24 w-24 opacity-70">
          <BrandWave rings={3} color="var(--color-brand)" speed={8} />
        </div>
        <h1 className="font-display text-ink mt-6 text-xl font-semibold">{title}</h1>
        <div className="text-smoke mt-3 text-[0.9375rem] leading-relaxed">{body}</div>
        <div className="mt-7 flex justify-center">{action}</div>
      </div>
    </div>
  );
}
