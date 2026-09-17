"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/AuthProvider";
import { AuthError, refreshVerification, resendEmailVerification } from "@/lib/firebase/auth";
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

  useEffect(() => {
    if (!needsConfirming) return;

    const recheck = async () => {
      try {
        if (await refreshVerification()) setVerified(true);
      } catch {
        // Offline, or the token could not refresh. The banner simply stays.
      }
    };

    window.addEventListener("focus", recheck);
    // Also on mount: they may have confirmed in a previous session.
    void recheck();
    return () => window.removeEventListener("focus", recheck);
  }, [needsConfirming]);

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
      if (result.alreadyVerified) setVerified(true);
      else setSent(true);
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
      <p className="text-ink">
        {rtl
          ? "أكّد بريدك الإلكتروني لتتمكّن من كتابة التقييمات وتلقّي تنبيهات التوفّر."
          : "Confirm your email address to write reviews and get back-in-stock alerts."}
        <span className="text-mist ms-1.5">{user?.email}</span>
      </p>

      {sent ? (
        <span className="text-mint ms-auto">
          {rtl ? "أُرسل الرابط — تفقّد بريدك." : "Link sent — check your inbox."}
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
