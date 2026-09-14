import type { ReactNode } from "react";

/**
 * Root layout — intentionally a passthrough.
 *
 * `<html>` needs `lang` and `dir`, and both depend on the locale, which only
 * exists once the `[locale]` segment has matched. So the real document shell
 * lives in `app/[locale]/layout.tsx` and this file exists only because Next
 * requires a root layout to be present.
 *
 * Nothing should be added here. Anything global belongs in the locale layout,
 * where it can actually be rendered in the right language and direction.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
