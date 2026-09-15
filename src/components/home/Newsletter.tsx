"use client";

import { useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { Button } from "@/components/ui/Button";
import { BrandWave } from "@/components/brand/BrandWave";
import type { Locale } from "@/types";

/**
 * Newsletter capture.
 *
 * States: idle → submitting → success (or error). The success state replaces
 * the form entirely rather than showing a toast above it, so there is no
 * ambiguity about whether to submit again.
 *
 * Consent is explicit and unticked by default — a pre-ticked box is not consent
 * under GDPR, and the same standard is worth applying everywhere.
 */
export function Newsletter({ locale = "en" }: { locale?: Locale }) {
  const reduced = useReducedMotion();
  const rtl = locale === "ar";

  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      setError(rtl ? "أدخل بريداً إلكترونياً صحيحاً." : "Enter a valid email address.");
      return;
    }
    if (!consent) {
      setError(rtl ? "يرجى الموافقة على استلام الرسائل." : "Please confirm you want to hear from us.");
      return;
    }

    setState("loading");
    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale }),
      });
      if (!response.ok) throw new Error("subscribe failed");
      setState("success");
    } catch {
      setState("error");
      setError(rtl ? "تعذّر الاشتراك. حاول مرة أخرى." : "Could not subscribe. Please try again.");
    }
  }

  return (
    <section className="bg-brand-veil rounded-2xl relative overflow-hidden px-7 py-14 md:px-14 md:py-20">
      <div className="pointer-events-none absolute -start-16 -bottom-20 h-80 w-80 opacity-40">
        <BrandWave rings={4} color="var(--color-brand)" speed={12} />
      </div>

      <div className="relative mx-auto max-w-xl text-center">
        <p className="text-eyebrow text-brand mb-5 uppercase">
          {rtl ? "انضم إلينا" : "The list"}
        </p>

        <h2 className="font-display text-ink text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          {rtl ? "أول من يعرف، أول من يقتني" : "First to know, first to wear"}
        </h2>

        <p className="text-ink-muted mx-auto mt-4 max-w-md text-pretty">
          {rtl
            ? "إصدارات محدودة، دعوات خاصة، ولا شيء آخر. رسالة واحدة في الأسبوع على الأكثر."
            : "Limited drops, private invitations, nothing else. One email a week at most."}
        </p>

        {state === "success" ? (
          <motion.div
            className="mt-10"
            initial={reduced ? undefined : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.45, ease: EASE.spring }}
          >
            <div className="bg-mint/12 text-mint rounded-xl inline-flex items-center gap-3 px-6 py-4">
              <CheckCircle />
              <span className="text-[0.9375rem] font-medium">
                {rtl ? "تم! تحقق من بريدك للتأكيد." : "You're in. Check your inbox to confirm."}
              </span>
            </div>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-10" noValidate>
            <div
              className={cn(
                "bg-paper-raised rounded-pill shadow-lift mx-auto flex max-w-md items-center gap-2 p-2",
                "border transition-colors duration-300",
                error ? "border-alert" : "border-line focus-within:border-brand",
              )}
            >
              <label htmlFor="newsletter-email" className="sr-only">
                {rtl ? "البريد الإلكتروني" : "Email address"}
              </label>
              <input
                id="newsletter-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={rtl ? "بريدك الإلكتروني" : "your@email.com"}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "newsletter-error" : undefined}
                className="text-ink placeholder:text-mist min-w-0 flex-1 bg-transparent px-5 text-[0.9375rem] outline-none"
              />
              <Button
                type="submit"
                variant="brand"
                size="md"
                loading={state === "loading"}
                className="shrink-0"
              >
                {rtl ? "اشترك" : "Join"}
              </Button>
            </div>

            <label className="text-smoke mx-auto mt-4 flex max-w-md cursor-pointer items-start gap-2.5 text-start text-[0.75rem]">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="accent-brand mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer"
              />
              <span>
                {rtl
                  ? "أوافق على استلام رسائل من نت سيل. يمكنني إلغاء الاشتراك في أي وقت."
                  : "I'd like to hear from net sale. I can unsubscribe at any time."}
              </span>
            </label>

            {error && (
              <motion.p
                id="newsletter-error"
                role="alert"
                className="text-alert mt-3 text-[0.8125rem]"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {error}
              </motion.p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}

function CheckCircle() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.4" />
      <motion.path
        d="m6.2 10.3 2.6 2.6 5-5.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: EASE.brand, delay: 0.15 }}
      />
    </svg>
  );
}
