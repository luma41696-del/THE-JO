"use client";

import { Link } from "@/components/ui/Link";
import { useI18n } from "@/components/providers/LocaleProvider";
import { BrandWave } from "@/components/brand/BrandWave";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/**
 * Localised 404.
 *
 * A Client Component so it can read the locale from context: `not-found.tsx`
 * receives no params, and a 404 that silently reverts to English is a worse
 * experience than the missing page itself.
 */
export default function NotFound() {
  const { t, locale } = useI18n();
  const ar = locale === "ar";

  return (
    <div className="ns-container flex min-h-screen flex-col items-center justify-center py-24 text-center">
      <div className="h-36 w-36 opacity-80">
        <BrandWave rings={4} solidCore color="var(--color-brand)" speed={7} />
      </div>

      <p className="font-display text-brand mt-10 text-6xl md:text-8xl">404</p>

      <h1
        className={cn(
          "text-ink mt-4 text-2xl font-semibold tracking-tight md:text-3xl",
          ar ? "font-arabic font-extrabold" : "font-display",
        )}
      >
        {t.errors.notFoundTitle}
      </h1>

      <p className="text-smoke mt-3 max-w-md text-pretty">{t.errors.notFoundBody}</p>

      <div className="mt-9 flex flex-wrap justify-center gap-3">
        <Link href="/">
          <Button variant="primary" size="lg" magnetic>
            {t.errors.backHome}
          </Button>
        </Link>
        <Link href="/shop">
          <Button variant="ghost" size="lg">
            {t.home.shopCollection}
          </Button>
        </Link>
      </div>
    </div>
  );
}
