"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { track } from "@/lib/analytics/track";
import { useAuth } from "@/components/providers/AuthProvider";

/**
 * Page views, in an App Router app.
 *
 * There is no full page load between routes, so a plain "on mount" tracker
 * fires once and then never again. This watches the pathname instead.
 *
 * The `useRef` guard matters more than it looks: React's development
 * StrictMode mounts effects twice, which would double every page view in
 * development and quietly train everyone to distrust the numbers. Comparing
 * against the last recorded path makes the effect idempotent.
 *
 * Search params are deliberately not watched. They change on every filter tap,
 * and a page view per checkbox would drown the funnel — filters emit their own
 * `filter_apply` event instead.
 */
export function PageTracker() {
  const pathname = usePathname();
  const uid = useAuth().user?.uid ?? null;
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    track("page_view", {}, { uid });
  }, [pathname, uid]);

  return null;
}
