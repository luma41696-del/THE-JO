"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { LOCALE_META, localePath, otherLocale } from "@/lib/i18n/config";
import { useI18n } from "@/components/providers/LocaleProvider";

/**
 * Language toggle.
 *
 * A direct switch, not a dropdown: with two languages a menu adds a click and a
 * decision to something that should be instant.
 *
 * Three details that matter more than they look:
 *
 *  - It keeps the current path **and its query string**. Someone who has
 *    filtered the shop to black coats in size M and switches language expects
 *    the same list in Arabic, not to be dumped back on the homepage.
 *  - The query is read from `window.location` at click time rather than through
 *    `useSearchParams()`. This component sits in the navbar, so it renders on
 *    every page — and `useSearchParams` would opt every one of them out of
 *    static rendering, which is a very high price for a string only needed after
 *    a click.
 *  - Each language is labelled in *itself* — "العربية", not "Arabic". Someone
 *    who cannot read the current language still has to be able to find their
 *    own, which they can only do if it is written the way they would recognise.
 */

/** Remember the choice so a later unprefixed URL resolves to the same language. */
function rememberLocale(locale: string) {
  document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
}

function targetHref(pathname: string, target: string) {
  const search = typeof window === "undefined" ? "" : window.location.search;
  return `${localePath(pathname, target as never)}${search}`;
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const target = otherLocale(locale);

  function switchTo() {
    rememberLocale(target);
    startTransition(() => {
      router.push(targetHref(pathname, target));
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={switchTo}
      lang={LOCALE_META[target].tag}
      aria-label={t.nav.switchLanguageLabel}
      title={LOCALE_META[target].label}
      disabled={isPending}
      className={cn(
        "relative grid h-10 min-w-10 cursor-pointer place-items-center rounded-full px-2",
        "text-ink hover:bg-ink/6 transition-colors duration-300",
        isPending && "opacity-50",
        className,
      )}
      data-cursor="hover"
    >
      <motion.span
        key={target}
        // The label names the *destination* language, so it should read as
        // arriving rather than as a static toggle state.
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE.jo }}
        className={cn(
          "text-[0.8125rem] font-semibold",
          target === "ar" ? "font-arabic text-[1rem]" : "font-ui tracking-[0.08em]",
        )}
      >
        {LOCALE_META[target].short}
      </motion.span>
    </button>
  );
}

/** Full-width variant for the mobile menu, where there is room for the endonym. */
export function LanguageSwitcherWide({ onSwitch }: { onSwitch?: () => void }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  const target = otherLocale(locale);

  function switchTo() {
    rememberLocale(target);
    onSwitch?.();
    router.push(targetHref(pathname, target));
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={switchTo}
      lang={LOCALE_META[target].tag}
      className="border-line text-ink flex w-full cursor-pointer items-center justify-between rounded-pill border px-5 py-3 text-[0.9375rem]"
      data-cursor="hover"
    >
      <span className={target === "ar" ? "font-arabic" : "font-ui"}>
        {LOCALE_META[target].label}
      </span>
      <span className="text-mist text-[0.75rem]">{t.nav.switchLanguageLabel}</span>
    </button>
  );
}
