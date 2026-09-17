"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  clearRecaptcha,
  formatJordanianPhone,
  normaliseJordanianPhone,
  phoneSignInEnabled,
  startPhoneSignIn,
  type PhoneChallenge,
} from "@/lib/firebase/phone-auth";
import type { Locale } from "@/types";

/**
 * Signing in with a phone number.
 *
 * Two steps, and the second one is where these flows usually go wrong. The
 * confirmation object Firebase hands back is the only thing that can check the
 * code, so it lives in a ref for the life of the attempt — not in state that a
 * re-render could replace, and never anywhere it could be serialised.
 *
 * Renders nothing at all when the provider is switched off. A sign-in button
 * that cannot sign anybody in is worse than no button: the customer blames
 * themselves, tries again, and then leaves.
 */
export function PhoneSignIn({
  locale,
  onSignedIn,
}: {
  locale: Locale;
  onSignedIn: () => void;
}) {
  const rtl = locale === "ar";
  const [step, setStep] = useState<"number" | "code">("number");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);

  const challenge = useRef<PhoneChallenge | null>(null);

  /*
   * The reCAPTCHA element has to outlive the request that uses it, so it is
   * torn down only when this component goes away. Clearing it between the
   * number and the code invalidates the challenge, and the code that arrives
   * is then rejected for a reason that has nothing to do with the code.
   */
  useEffect(() => clearRecaptcha, []);

  // A resend countdown, so the button cannot be leaned on. Every press is an
  // SMS the shop pays for.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  if (!phoneSignInEnabled()) return null;

  const normalised = normaliseJordanianPhone(phone);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      challenge.current = await startPhoneSignIn(phone, "ns-recaptcha", locale);
      setSentTo(challenge.current.sentTo);
      setStep("code");
      setSecondsLeft(45);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!challenge.current) return;
    setBusy(true);
    setError(null);
    try {
      await challenge.current.confirm(code);
      onSignedIn();
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "That code is not right.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "border-line focus:border-brand bg-paper-raised text-ink rounded-pill w-full border px-5 py-3.5 text-[0.9375rem] outline-none transition-colors";

  return (
    <div className="grid gap-3">
      {step === "number" ? (
        <>
          <label className="block">
            <span className="text-mist mb-1.5 block text-[0.75rem]">
              {rtl ? "رقم الهاتف" : "Phone number"}
            </span>
            <input
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && normalised && !busy) void send();
              }}
              // `tel` gets the numeric keypad; `dir="ltr"` keeps a number
              // readable when the page around it is Arabic.
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0790000000"
              aria-label={rtl ? "رقم الهاتف" : "Phone number"}
              className={cn(field, rtl && "text-end")}
            />
          </label>

          {/* What will actually be texted, so a mistyped number is caught
              before it costs an SMS. */}
          {normalised && (
            <p className="text-mist text-[0.75rem]" dir="ltr">
              {formatJordanianPhone(normalised)}
            </p>
          )}

          <button
            type="button"
            onClick={() => void send()}
            disabled={!normalised || busy}
            className="bg-ink hover:bg-ink-soft rounded-pill cursor-pointer px-6 py-3.5 text-[0.9375rem] font-medium text-white transition-colors disabled:opacity-40"
            data-cursor="hover"
          >
            {busy ? (rtl ? "يُرسل…" : "Sending…") : rtl ? "أرسل الرمز" : "Send the code"}
          </button>
        </>
      ) : (
        <>
          <p className="text-smoke text-[0.8125rem]">
            {rtl ? "أرسلنا رمزاً إلى " : "We sent a code to "}
            <span dir="ltr" className="text-ink">
              {formatJordanianPhone(sentTo)}
            </span>
          </p>

          <input
            value={code}
            onChange={(event) => {
              // Six digits, nothing else — people paste the whole message.
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && code.length === 6 && !busy) void check();
            }}
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            aria-label={rtl ? "رمز التحقق" : "Verification code"}
            className={cn(field, "text-center tracking-[0.4em]")}
          />

          <button
            type="button"
            onClick={() => void check()}
            disabled={code.length !== 6 || busy}
            className="bg-ink hover:bg-ink-soft rounded-pill cursor-pointer px-6 py-3.5 text-[0.9375rem] font-medium text-white transition-colors disabled:opacity-40"
            data-cursor="hover"
          >
            {busy ? (rtl ? "يتحقّق…" : "Checking…") : rtl ? "تأكيد" : "Confirm"}
          </button>

          <div className="flex items-center justify-between text-[0.75rem]">
            <button
              type="button"
              onClick={() => {
                setStep("number");
                setCode("");
                setError(null);
              }}
              className="text-smoke hover:text-ink cursor-pointer underline-offset-4 hover:underline"
              data-cursor="hover"
            >
              {rtl ? "غيّر الرقم" : "Change the number"}
            </button>

            <button
              type="button"
              onClick={() => void send()}
              disabled={secondsLeft > 0 || busy}
              className="text-smoke hover:text-ink cursor-pointer underline-offset-4 hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-50"
              data-cursor="hover"
            >
              {secondsLeft > 0
                ? rtl
                  ? `إعادة الإرسال بعد ${secondsLeft}ث`
                  : `Resend in ${secondsLeft}s`
                : rtl
                  ? "أعد الإرسال"
                  : "Resend"}
            </button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-alert text-[0.8125rem]">
          {error}
        </p>
      )}

      {/*
        The invisible reCAPTCHA renders here. It must stay mounted for the
        whole attempt — Firebase ties the solved challenge to this element, and
        unmounting it between the number and the code is the usual reason the
        second step fails.
      */}
      <div id="ns-recaptcha" />
    </div>
  );
}
