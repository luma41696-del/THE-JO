"use client";

import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { forwardRef, useCallback, type ComponentPropsWithoutRef } from "react";

import { localeFromPath, localePath } from "@/lib/i18n/config";

/**
 * Locale-aware `Link`.
 *
 * A drop-in replacement for `next/link` that prefixes internal hrefs with the
 * active locale, so components can keep writing `href="/shop"` and still land
 * on `/ar/shop` for an Arabic shopper. Every route in the app is locale-scoped,
 * and one forgotten prefix drops someone out of their language mid-journey —
 * which is exactly the kind of bug that survives review, so it is removed at
 * the component level rather than left to discipline.
 *
 * The locale is read from the pathname rather than from context so this works
 * in any tree, including ones rendered above `LocaleProvider`.
 *
 * External URLs, hashes, `mailto:` and `tel:` pass through untouched.
 */

type LinkProps = ComponentPropsWithoutRef<typeof NextLink>;

function isInternal(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, ...props },
  ref,
) {
  const pathname = usePathname();

  if (typeof href !== "string" || !isInternal(href)) {
    return <NextLink ref={ref} href={href} {...props} />;
  }

  // Preserve query and hash while prefixing only the path.
  const [path = "/", suffix] = href.split(/(?=[?#])/);
  const locale = localeFromPath(pathname);

  return <NextLink ref={ref} href={`${localePath(path, locale)}${suffix ?? ""}`} {...props} />;
});

/**
 * Locale-aware `router.push`. Same reasoning as `Link`, for the handful of
 * places that navigate imperatively (checkout, auth redirects, the cart CTA).
 */
export function useLocalizedRouter() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = localeFromPath(pathname);

  const push = useCallback(
    (path: string) => {
      if (!isInternal(path)) {
        router.push(path);
        return;
      }
      const [base = "/", suffix] = path.split(/(?=[?#])/);
      router.push(`${localePath(base, locale)}${suffix ?? ""}`);
    },
    [router, locale],
  );

  const replace = useCallback(
    (path: string) => {
      const [base = "/", suffix] = path.split(/(?=[?#])/);
      router.replace(`${localePath(base, locale)}${suffix ?? ""}`);
    },
    [router, locale],
  );

  return { push, replace, refresh: router.refresh, prefetch: router.prefetch, locale };
}
