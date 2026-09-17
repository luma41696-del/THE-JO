"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/AuthProvider";
import { AuthError, refreshVerification, resendEmailVerification } from "@/lib/firebase/auth";
import {
  clearVerificationRecord,
  cooldownRemaining,
  hasSentVerification,
} from "@/lib/verification-throttle";
import type { Locale } from "@/types";

/**
 * "Confirm your email address."
 *
 * Shown to a signed-in customer whose address is still unconfirmed, and to
 * nobody else. Two details matter more than they look:
 *
 *  - **A phone customer never sees it.** They have no email, and asking them
 *    to confirm one would be asking them to do something impossible.
 *  - **It re-checks on focus.** `emailVerified` lives in this tab's cached
 *    token, so clicking the link in the email — which opens another tab —
 *    leaves this one insisting the address is unconfirmed. A customer who did
 *    exactly what they were told, and is told again to do it, concludes the
 *    shop is broken. Coming back to the tab silently re-reads the user.
 */
export function VerifyEmailBanner({ locale }: { locale: Locale }) {
  const { user, status } = useAuth();
  const rtl = locale === "ar";

  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [waitSeconds, setWaitSeconds] = useState(0);

  /*
   * Whether sign-up already sent one.
   *
   * This is the whole reason the shop was hitting `auth/too-many-requests` on
   * a single click: sign-up sent an email, then dropped the customer here in
   * front of a "Send the link" button that said nothing about it. Pressing it
   * was the obvious thing to do — and it was the second send in ten seconds,
   * which Firebase refuses.
   */
  const alreadySent = Boolean(user && hasSentVerification(user.uid));

  const signedIn = status === "authenticated" && user;

  /*
   * A phone account has no address to confirm, an already-confirmed one has
   * nothing to do — and a Google account is confirmed by Google, so offering
   * to send it a confirmation would be offering something that cannot work.
   */
  const federated = Boolean(user?.providerData.some((entry) => entry.providerId !== "password"));
  const needsConfirming = Boolean(
    signedIn && user?.email && !user.emailVerified && !verified && !federated,
  );

  /*
   * Re-reads whether the address has been confirmed. Reads only — this effect
   * has never sent an email and must not start: mounting the account page is
   * not a request for one.
   */
  useEffect(() => {
    if (!needsConfirming) return;
    let live = true;

    const recheck = async () => {
      try {
        if ((await refreshVerification()) && live) {
          setVerified(true);
          if (user) clearVerificationRecord(user.uid);
        }
      } catch {
        // Offline, or the token could not refresh. The banner simply stays.
      }
    };

    window.addEventListener("focus", recheck);
    void recheck();
    return () => {
      live = false;
      window.removeEventListener("focus", recheck);
    };
  }, [needsConfirming, user]);

  /* The countdown that replaces a button which would only fail. */
  useEffect(() => {
    if (!user || !needsConfirming) return;

    const tick = () => setWaitSeconds(Math.ceil(cooldownRemaining(user.uid) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [user, needsConfirming, sent]);

  if (!needsConfirming) return null;

  async function resend() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * Re-reads the account first. If the customer clicked the link in their
       * mail app and came back to this tab, the banner is stale and a second
       * email would be sent for an address that is already confirmed — which
       * reads as the first one not having worked.
       */
      const result = await resendEmailVerification(locale);
      if (result.alreadyVerified) {
        setVerified(true);
        if (user) clearVerificationRecord(user.uid);
      } else {
        setSent(true);
      }
    } catch (sendError) {
      // The real Firebase code, both on screen and in the log. A resend that
      // fails silently is what hid this problem in the first place.
      const message =
        sendError instanceof AuthError
          ? `${sendError.message} (${sendError.code})`
          : sendError instanceof Error
            ? sendError.message
            : rtl
              ? "تعذّر الإرسال. حاول بعد قليل."
              : "That could not be sent. Try again shortly.";
      console.error("[net sale] Resending the verification email failed.", sendError);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className={cn(
        "border-line bg-brand-veil rounded-md flex flex-wrap items-center gap-x-4 gap-y-2 border px-4 py-3",
        "text-[0.8125rem]",
      )}
    >
      {/*
        The wording turns on whether one has already gone.
        
        Telling somebody to "confirm your email" next to a Send button, when a
        link is already sitting in their inbox, is an instruction to send a
        second — which Firebase refuses and blames them for.
      */}
      <p className="text-ink">
        {sent || alreadySent
          ? rtl
            ? "أرسلنا رابط التأكيد. افتحه من بريدك لتتمكّن من كتابة التقييمات وتلقّي تنبيهات التوفّر."
            : "We've sent you a confirmation link. Open it to write reviews and get back-in-stock alerts."
          : rtl
            ? "أكّد بريدك الإلكتروني لتتمكّن من كتابة التقييمات وتلقّي تنبيهات التوفّر."
            : "Confirm your email address to write reviews and get back-in-stock alerts."}
        <span className="text-mist ms-1.5">{user?.email}</span>
      </p>

      {waitSeconds > 0 ? (
        /* A countdown rather than a button that Firebase is going to refuse. */
        <span className="text-mist ms-auto tabular-nums">
          {rtl ? `يمكنك الإرسال مجدداً بعد ${waitSeconds}ث` : `Send again in ${waitSeconds}s`}
        </span>
      ) : (
        <button
          type="button"
          onClick={resend}
          disabled={busy}
          className="border-ink/25 hover:border-ink text-ink rounded-pill ms-auto cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors disabled:opacity-50"
          data-cursor="hover"
        >
          {busy
            ? rtl
              ? "يُرسل…"
              : "Sending…"
            : alreadySent
              ? rtl
                ? "أرسله مجدداً"
                : "Send it again"
              : rtl
                ? "أرسل الرابط"
                : "Send the link"}
        </button>
      )}

      {error && (
        <p role="alert" className="text-alert w-full">
          {error}
        </p>
      )}
    </div>
  );
}
