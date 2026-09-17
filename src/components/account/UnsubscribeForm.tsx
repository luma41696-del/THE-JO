"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/Button";
import type { Locale } from "@/types";

/**
 * The page an unsubscribe link opens.
 *
 * One click, and it is the click that does it — the page load does not. Mail
 * filters and security scanners fetch every link in a message before a human
 * sees it, so a page that unsubscribes on load unsubscribes people who never
 * opened it.
 *
 * ## It offers a way back
 *
 * Somebody who unsubscribed by accident, or whose scanner got here first, can
 * resubscribe from their account. Saying so costs a line and saves a support
 * message; not saying it makes an accident permanent.
 */

type State = "checking" | "ready" | "working" | "done" | "invalid" | "error";

export function UnsubscribeForm({ locale }: { locale: Locale }) {
  const params = useSearchParams();
  const rtl = locale === "ar";

  const email = params.get("e") ?? "";
  const token = params.get("t") ?? "";

  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  const copy = rtl
    ? {
        checking: "لحظة…",
        heading: "إلغاء الاشتراك",
        lead: "لن تصلك رسائل العروض والأخبار بعد الآن. رسائل الطلبات والفواتير تبقى كما هي — فهي جزء من شرائك.",
        confirm: "أكّد إلغاء الاشتراك",
        working: "جارٍ…",
        doneHeading: "تم إلغاء اشتراكك",
        doneBody: "لن تصلك رسائل تسويقية بعد الآن. يمكنك العودة في أي وقت من إعدادات حسابك.",
        invalidHeading: "هذا الرابط غير صالح",
        invalidBody:
          "قد يكون الرابط ناقصاً أو انتهت صلاحيته. راسلنا وسنلغي اشتراكك يدوياً.",
        shop: "العودة إلى المتجر",
      }
    : {
        checking: "One moment…",
        heading: "Unsubscribe",
        lead: "You will stop receiving offers and news. Order and invoice emails carry on — they are part of what you bought.",
        confirm: "Confirm unsubscribe",
        working: "Working…",
        doneHeading: "You are unsubscribed",
        doneBody:
          "No more marketing email. You can opt back in any time from your account settings.",
        invalidHeading: "That link is not valid",
        invalidBody:
          "It may be incomplete or expired. Send us a message and we will remove you by hand.",
        shop: "Back to the shop",
      };

  /*
   * Validate on load. This is a read — it tells the person whether the link
   * works before asking them to press anything, and changes nothing.
   */
  useEffect(() => {
    if (!email || !token) {
      setState("invalid");
      return;
    }
    let live = true;
    void fetch(
      `/api/unsubscribe?e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`,
    )
      .then((response) => response.json())
      .then((data: { valid?: boolean }) => {
        if (!live) return;
        setState(data.valid ? "ready" : "invalid");
      })
      .catch(() => {
        if (live) setState("invalid");
      });
    return () => {
      live = false;
    };
  }, [email, token]);

  async function confirm() {
    setState("working");
    setError(null);
    try {
      const response = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ e: email, t: token }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "That did not work.");
      setState("done");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work.");
      setState("error");
    }
  }

  const heading =
    state === "done"
      ? copy.doneHeading
      : state === "invalid"
        ? copy.invalidHeading
        : copy.heading;

  const lead =
    state === "done" ? copy.doneBody : state === "invalid" ? copy.invalidBody : copy.lead;

  return (
    <main
      dir={rtl ? "rtl" : "ltr"}
      className="grid min-h-screen place-items-center px-5 py-16"
    >
      <div className="border-line bg-paper-raised w-full max-w-md rounded-2xl border p-8 text-center">
        <p className="font-display text-ink mb-6 text-[1rem] font-bold tracking-[0.02em]">
          Net Sale
        </p>

        {state === "checking" ? (
          <p className="text-mist text-[0.875rem]">{copy.checking}</p>
        ) : (
          <>
            <h1 className="font-display text-ink mb-3 text-[1.375rem] leading-snug font-semibold">
              {heading}
            </h1>
            <p className="text-ink-muted mb-6 text-[0.875rem] leading-relaxed">{lead}</p>

            {/* The address, so nobody unsubscribes the wrong one by accident. */}
            {state !== "invalid" && email && (
              <p
                dir="ltr"
                className="text-mist mb-6 font-mono text-[0.8125rem] break-all"
              >
                {email}
              </p>
            )}

            {(state === "ready" || state === "working" || state === "error") && (
              <Button
                variant="brand"
                onClick={() => void confirm()}
                loading={state === "working"}
                className="w-full"
              >
                {state === "working" ? copy.working : copy.confirm}
              </Button>
            )}

            {error && (
              <p role="alert" className="text-alert mt-4 text-[0.8125rem]">
                {error}
              </p>
            )}

            <p className="mt-6">
              <a
                href={`/${locale}`}
                className="text-mist hover:text-ink text-[0.8125rem] underline transition-colors"
              >
                {copy.shop}
              </a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
