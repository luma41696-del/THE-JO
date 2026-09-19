"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";

import { getIdToken } from "@/lib/firebase/auth";
import { useAdminLocale } from "./AdminLocale";
import { currentState, type StorefrontSettings } from "@/lib/storefront-state";

/**
 * A reminder, on every admin screen, that the shop is shut.
 *
 * This is the actual safety feature. The switch is easy to find and easy to
 * use; what goes wrong is nobody remembering it was thrown — closed for twenty
 * minutes of stock-taking, called away, dark until a customer writes in on
 * Monday. So the banner is on every page, cannot be dismissed, and says who
 * closed it and when it lifts.
 *
 * It re-checks on an interval rather than once, so an administrator who
 * reopens in another tab is not looking at a banner for a shop that is
 * already open — and so a *scheduled* reopening clears the banner by itself.
 */

const POLL_MS = 60_000;

export function ShopClosedBanner() {
  const { t, rtl } = useAdminLocale();
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/storefront", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) return;
      const data = (await response.json()) as { ok?: boolean; settings?: StorefrontSettings };
      if (data.ok && data.settings) setSettings(data.settings);
    } catch {
      // Silent. A banner that cannot read the state says nothing rather than
      // claiming the shop is shut — a false alarm here sends somebody looking
      // for a problem that does not exist.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!settings) return null;
  const state = currentState(settings);
  if (state === "open") return null;

  const until = settings.reopensAt
    ? t("shop.bannerUntil").replace(
        "{n}",
        new Date(settings.reopensAt).toLocaleString(rtl ? "ar-JO" : "en-GB", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
      )
    : "";

  const by = settings.closedBy ? t("shop.bannerBy").replace("{n}", settings.closedBy) : "";

  return (
    <div
      role="status"
      className="bg-alert flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-[0.75rem] text-white"
      dir={rtl ? "rtl" : "ltr"}
    >
      <span className="font-medium">
        {state === "closed" ? t("shop.bannerClosed") : t("shop.bannerBrowse")}
      </span>
      {until && <span className="opacity-80">{until}</span>}
      {by && <span className="opacity-70">{by}</span>}
      <Link
        href="/admin/settings"
        className="underline underline-offset-2 opacity-90 transition-opacity hover:opacity-100"
      >
        {t("shop.reopen")}
      </Link>
    </div>
  );
}
