"use client";

import { useState } from "react";

import { getIdToken } from "@/lib/firebase/auth";
import { useAuth } from "@/components/providers/AuthProvider";
import { Link } from "@/components/ui/Link";
import type { Locale } from "@/types";

/**
 * "Tell me when it's back."
 *
 * The one thing worth offering at the exact moment a shop disappoints
 * somebody. A sold-out size is otherwise the end of that visit, and usually of
 * that customer — they do not come back to check.
 *
 * Signing in is required, and the reason is worth stating where the customer
 * can read it: an email box alone would let anyone sign a stranger up for mail
 * from this shop, and a shop whose mail arrives unasked is one whose mail
 * stops arriving at all. The prompt says "sign in", not "register", because
 * most people here already have an account.
 *
 * What it promises is exactly what the sweep delivers: one message, and no
 * reminder after it. Saying so is what makes this a service rather than the
 * start of a series nobody agreed to.
 */
export function BackInStock({
  productId,
  colorId,
  sizeId,
  locale = "en",
}: {
  productId: string;
  colorId?: string;
  sizeId?: string;
  locale?: Locale;
}) {
  const rtl = locale === "ar";
  const { user } = useAuth();

  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function subscribe() {
    if (state === "busy") return;
    setState("busy");
    setError(null);

    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          productId,
          colorId,
          sizeId,
          kind: "back-in-stock",
          locale,
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "");
      setState("done");
    } catch (subscribeError) {
      setState("idle");
      setError(
        subscribeError instanceof Error && subscribeError.message
          ? subscribeError.message
          : rtl
            ? "تعذّر حفظ التنبيه."
            : "That alert could not be saved.",
      );
    }
  }

  if (state === "done") {
    return (
      <p className="text-mint mt-3 text-[0.8125rem]">
        {rtl
          ? "سنراسلك مرة واحدة عندما يتوفر. لن نرسل تذكيراً بعدها."
          : "We will email you once when it is back. No reminder after that."}
      </p>
    );
  }

  if (!user) {
    return (
      <p className="text-mist mt-3 text-[0.8125rem]">
        <Link href="/login" className="text-ink underline underline-offset-2">
          {rtl ? "سجّل الدخول" : "Sign in"}
        </Link>{" "}
        {rtl ? "لنخبرك عندما يعود هذا المقاس." : "and we will tell you when this size is back."}
      </p>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void subscribe()}
        disabled={state === "busy"}
        className="border-line hover:border-ink text-ink rounded-pill cursor-pointer border px-4 py-2 text-[0.8125rem] transition-colors disabled:opacity-50"
        data-cursor="hover"
      >
        {state === "busy"
          ? rtl
            ? "يُحفظ…"
            : "Saving…"
          : rtl
            ? "أخبرني عندما يتوفر"
            : "Tell me when it is back"}
      </button>

      {error && (
        <p role="alert" className="text-alert mt-2 text-[0.8125rem]">
          {error}
        </p>
      )}
    </div>
  );
}
