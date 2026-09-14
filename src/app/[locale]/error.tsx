"use client";

import { useEffect } from "react";

import { Link } from "@/components/ui/Link";
import { useI18n } from "@/components/providers/LocaleProvider";
import { BrandWave } from "@/components/brand/BrandWave";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/**
 * Route-level error boundary.
 *
 * Shows the customer something calm and actionable, and reports the digest
 * rather than the raw stack — `error.message` from a Server Component is
 * redacted in production anyway, and printing it here would only ever leak
 * internals in development.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t, locale } = useI18n();
  const ar = locale === "ar";

  useEffect(() => {
    // Replace with your error reporter (Sentry, Firebase Crashlytics, …).
    console.error("[net sale] Route error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="ns-container flex min-h-screen flex-col items-center justify-center py-24 text-center">
      <div className="h-32 w-32 opacity-70">
        <BrandWave rings={3} color="var(--color-alert)" speed={5} />
      </div>

      <h1
        className={cn(
          "text-ink mt-10 text-2xl font-semibold tracking-tight md:text-3xl",
          ar ? "font-arabic font-extrabold" : "font-display",
        )}
      >
        {t.errors.errorTitle}
      </h1>

      <p className="text-smoke mt-3 max-w-md text-pretty">{t.errors.errorBody}</p>

      {error.digest && (
        <p className="text-mist mt-4 text-[0.75rem]">
          {t.errors.reference} <span className="font-ui tracking-wide">{error.digest}</span>
        </p>
      )}

      <div className="mt-9 flex flex-wrap justify-center gap-3">
        <Button variant="primary" size="lg" magnetic onClick={reset}>
          {t.common.tryAgain}
        </Button>
        <Link href="/">
          <Button variant="ghost" size="lg">
            {t.errors.backHome}
          </Button>
        </Link>
      </div>
    </div>
  );
}
