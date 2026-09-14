"use client";

import { useEffect, type ReactNode } from "react";
import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/Button";
import { JoWave } from "@/components/brand/JoWave";
import type { Locale } from "@/types";

/**
 * Client-side auth gate for account pages.
 *
 * Three states, and the distinction matters: `loading` must not render the
 * signed-out view, or every refresh flashes "Sign in" at a signed-in customer
 * before the Firebase session resolves.
 *
 * This is a *convenience* gate, not a security boundary. Nothing here protects
 * data — Firestore Security Rules do that, and they are what stops someone
 * reading another customer's orders regardless of what this component renders.
 */
export function RequireAuth({
  children,
  locale = "en",
}: {
  children: ReactNode;
  locale?: Locale;
}) {
  const { status } = useAuth();
  const router = useLocalizedRouter();
  const pathname = usePathname();
  const rtl = locale === "ar";

  useEffect(() => {
    if (status === "anonymous") {
      router.prefetch(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  if (status === "loading") {
    return (
      <div className="jo-container flex min-h-[50vh] items-center justify-center pb-24">
        <div className="h-20 w-20 opacity-60">
          <JoWave rings={3} color="var(--color-violet)" speed={5} />
        </div>
        <span className="sr-only">{rtl ? "جارٍ التحميل" : "Loading"}</span>
      </div>
    );
  }

  if (status === "anonymous") {
    return (
      <div className="jo-container pb-24">
        <div className="border-line rounded-xl mx-auto flex max-w-md flex-col items-center border border-dashed py-16 text-center">
          <div className="h-24 w-24 opacity-70">
            <JoWave rings={3} color="var(--color-violet)" speed={8} />
          </div>
          <h2 className="font-display text-ink mt-6 text-xl font-semibold">
            {rtl ? "سجّل الدخول للمتابعة" : "Sign in to continue"}
          </h2>
          <p className="text-smoke mt-2 max-w-xs text-[0.9375rem]">
            {rtl
              ? "حسابك يحفظ مقاساتك وطلباتك ومفضلتك في مكان واحد."
              : "Your account keeps your measurements, orders and saved pieces in one place."}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href={`/login?next=${encodeURIComponent(pathname)}`}>
              <Button variant="violet" size="lg" magnetic>
                {rtl ? "تسجيل الدخول" : "Sign in"}
              </Button>
            </Link>
            <Link href={`/register?next=${encodeURIComponent(pathname)}`}>
              <Button variant="secondary" size="lg">
                {rtl ? "إنشاء حساب" : "Create account"}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
