"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { GiftWheel } from "./GiftWheel";
import { Link } from "@/components/ui/Link";
import { useAuth } from "@/components/providers/AuthProvider";
import { getIdToken } from "@/lib/firebase/auth";
import { inviteWindowKey, prizeSummary } from "@/lib/gift";
import { transition } from "@/lib/motion";
import { t } from "@/lib/format";
import type { GiftCampaign, Locale } from "@/types";

/**
 * The gift game, brought to the customer instead of waiting for them.
 *
 * `/gift` was a page you had to know about. Almost nobody did, which made a
 * built, tested, server-authoritative game worth roughly nothing. This asks
 * the shop's own question at the only moment it can be answered — once the
 * customer is signed in, because a prize is saved to an account and a game
 * offered to a guest is a sign-in wall wearing a party hat.
 *
 * What it is careful about is **not being a nuisance**:
 *
 *  - It appears once per eligible turn (`inviteWindowKey`), so dismissing it
 *    is permanent for that turn, and the cooldown keeps the next one a day
 *    away.
 *  - It never appears on `/gift` — the wheel is already the page — and never
 *    during checkout, because the storefront layout it mounts in does not wrap
 *    the checkout routes.
 *  - It waits for the page to settle before interrupting.
 *  - Escape and the backdrop both close it, and closing counts as dismissing.
 *
 * The wheel inside is the same component the page uses, so the draw stays
 * exactly where it was: on the server, inside a transaction, before any pixel
 * moves. Nothing here can award a prize.
 */

/** Long enough that the page has painted and the customer is oriented. */
const SETTLE_MS = 1_400;

interface InviteResponse {
  ok?: boolean;
  eligible?: boolean;
  attempts?: number;
  campaign?: GiftCampaign;
}

export function GiftInvite({ locale = "en" }: { locale?: Locale }) {
  const { status } = useAuth();
  const pathname = usePathname();
  const rtl = locale === "ar";

  const [campaign, setCampaign] = useState<GiftCampaign | null>(null);
  const [windowKey, setWindowKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const onGiftPage = pathname?.includes("/gift") ?? false;

  useEffect(() => {
    if (status !== "authenticated" || onGiftPage || open) return;

    let cancelled = false;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const token = await getIdToken().catch(() => null);
          if (!token) return;

          const response = await fetch("/api/gift/invite", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!response.ok) return;

          const data = (await response.json()) as InviteResponse;
          if (cancelled || !data.ok || !data.eligible || !data.campaign) return;

          const key = inviteWindowKey(data.campaign.id, data.attempts ?? 0);

          /*
           * A browser with storage blocked throws here rather than returning
           * null. Treating that as "not yet dismissed" is the kind reading:
           * the invitation still works, it simply cannot remember being waved
           * away, and the cooldown caps how often that can happen.
           */
          let dismissed = false;
          try {
            dismissed = window.localStorage.getItem(key) !== null;
          } catch {
            dismissed = false;
          }
          if (dismissed) return;

          setCampaign(data.campaign);
          setWindowKey(key);
          setOpen(true);
        } catch {
          // Offline, or the backend is unreachable. A game that failed to
          // offer itself is not something to trouble anyone with.
        }
      })();
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, onGiftPage, open]);

  /** Closing *is* dismissing — there is no third state worth explaining. */
  function dismiss() {
    setOpen(false);
    if (!windowKey) return;
    try {
      window.localStorage.setItem(windowKey, String(Date.now()));
    } catch {
      /* Storage refused. The cooldown is the backstop. */
    }
  }

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, windowKey]);

  /*
   * Navigating closes it, and closing counts as an answer. Without this the
   * modal rides along on top of the next page — including the page its own
   * "my gifts" link goes to, where the customer would land behind a backdrop
   * they did not ask for.
   */
  useEffect(() => {
    if (open) dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <AnimatePresence>
      {open && campaign && (
        <div
          className="fixed inset-0 z-[170] grid place-items-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={rtl ? "هدية في انتظارك" : "A gift is waiting"}
        >
          <motion.button
            type="button"
            className="bg-ink/40 absolute inset-0 backdrop-blur-[3px]"
            onClick={dismiss}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
            aria-label={rtl ? "ليس الآن" : "Not now"}
          />

          <motion.div
            className="bg-paper rounded-2xl shadow-hover relative max-h-[92vh] w-full max-w-lg overflow-y-auto p-6 sm:p-8"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={transition.base}
          >
            <button
              type="button"
              onClick={dismiss}
              className="text-mist hover:text-ink absolute end-4 top-4 cursor-pointer text-[0.75rem] transition-colors"
              data-cursor="hover"
            >
              {rtl ? "ليس الآن" : "Not now"}
            </button>

            <p className="text-eyebrow text-brand uppercase">
              {rtl ? "هدية في انتظارك" : "A gift is waiting"}
            </p>
            <h2 className="font-display text-ink mt-1.5 text-xl font-semibold tracking-tight text-balance">
              {t(campaign.name, locale)}
            </h2>
            <p className="text-smoke mt-2 text-[0.875rem] leading-relaxed">
              {rtl
                ? "دورة واحدة، والجائزة تُحفظ في حسابك فوراً."
                : "One spin, and whatever you win is saved to your account straight away."}
            </p>

            <div className="mt-6">
              <GiftWheel campaign={campaign} locale={locale} signedIn />
            </div>

            {/*
              The prize list in words, under a wheel that says it in colour. A
              customer using a screen reader — or one who simply wants to know
              what is on offer before spinning — should not have to read a disc.
            */}
            <ul className="text-mist mt-5 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.6875rem]">
              {campaign.prizes.map((prize) => (
                <li key={prize.id}>{prizeSummary(prize, locale)}</li>
              ))}
            </ul>

            <p className="text-mist mt-5 text-center text-[0.6875rem]">
              <Link href="/gift" className="hover:text-ink underline transition-colors">
                {rtl ? "هداياي وكوبوناتي" : "My gifts and coupons"}
              </Link>
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
