"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { getIdToken } from "@/lib/firebase/auth";
import { prizeSummary } from "@/lib/gift";
import { t } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Link } from "@/components/ui/Link";
import type { GiftCampaign, GiftPrize, Locale } from "@/types";

/**
 * The gift wheel.
 *
 * The animation is a **presentation of a decided outcome**, never the thing
 * that decides it. The server draws, writes the play and mints the coupon
 * before this component knows anything; the wheel then spins to the slice it
 * has been told about.
 *
 * That ordering is what makes every obvious cheat pointless: there is nothing
 * in this file to tamper with, refreshing replays nothing, and a browser that
 * dies mid-spin has still been awarded its prize — the customer finds it in
 * their account.
 *
 * Under `prefers-reduced-motion` the wheel does not spin at all. The result is
 * stated in words instead, which is the same information without a rotating
 * disc; a gift game is exactly the kind of decorative motion that triggers
 * vestibular symptoms.
 */

const SLICE_COLOURS = [
  "var(--color-brand)",
  "var(--color-ink)",
  "var(--color-brand-deep)",
  "var(--color-clay)",
  "var(--color-brand-bright)",
  "var(--color-smoke)",
];

export interface GiftWheelProps {
  campaign: GiftCampaign;
  locale?: Locale;
  /** Set when the customer is inside a cooldown on first render. */
  nextPlayAt?: number | null;
  signedIn: boolean;
}

type Outcome = {
  prize: Pick<GiftPrize, "id" | "label" | "reward" | "value">;
  code?: string;
  expiresAt?: number;
};

export function GiftWheel({ campaign, locale = "en", nextPlayAt = null, signedIn }: GiftWheelProps) {
  const rtl = locale === "ar";
  const reduced = useReducedMotion();

  const [spinning, setSpinning] = useState(false);
  const [angle, setAngle] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(nextPlayAt);
  const rotations = useRef(0);

  const prizes = campaign.prizes;
  const slice = 360 / Math.max(1, prizes.length);

  const locked = Boolean(cooldownUntil && cooldownUntil > Date.now());

  async function play() {
    if (spinning || locked) return;
    setMessage(null);
    setOutcome(null);
    setSpinning(true);

    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/gift/play", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: { en: string; ar: string };
        prize?: Outcome["prize"];
        code?: string;
        expiresAt?: number;
        nextPlayAt?: number;
      };

      if (!response.ok || !data.ok || !data.prize) {
        setMessage(
          data.message?.[locale] ??
            data.error ??
            (rtl ? "تعذّر تشغيل اللعبة." : "The game could not be played."),
        );
        if (data.nextPlayAt) setCooldownUntil(data.nextPlayAt);
        setSpinning(false);
        return;
      }

      const index = Math.max(
        0,
        prizes.findIndex((p) => p.id === data.prize!.id),
      );

      if (reduced) {
        // No spin: the outcome is announced directly.
        setOutcome({ prize: data.prize, code: data.code, expiresAt: data.expiresAt });
        setCooldownUntil(data.nextPlayAt ?? null);
        setSpinning(false);
        return;
      }

      /*
       * Spin to the *known* slice. Five extra turns are for the feel of it;
       * the landing angle is arithmetic, not chance — the chance already
       * happened, on the server, and is already written down.
       */
      rotations.current += 5;
      const target = rotations.current * 360 - (index * slice + slice / 2);
      setAngle(target);

      window.setTimeout(() => {
        setOutcome({ prize: data.prize!, code: data.code, expiresAt: data.expiresAt });
        setCooldownUntil(data.nextPlayAt ?? null);
        setSpinning(false);
      }, 3600);
    } catch {
      /*
       * A network failure is reported honestly. It is deliberately *not*
       * treated as a loss: the request may well have succeeded, and the prize
       * would then be sitting in the account. Saying "you lost" here would be
       * a guess, and half the time a wrong one.
       */
      setMessage(
        rtl
          ? "انقطع الاتصال. تحقّق من «هداياي» قبل المحاولة ثانية."
          : "The connection dropped. Check “My gifts” before trying again.",
      );
      setSpinning(false);
    }
  }

  return (
    <div className="mx-auto max-w-md text-center">
      <h2 className="font-display text-ink text-2xl font-semibold tracking-tight md:text-3xl">
        {t(campaign.name, locale)}
      </h2>

      {/* ---- The wheel ------------------------------------------------- */}
      <div className="relative mx-auto mt-8 aspect-square w-full max-w-[20rem]">
        {/* Pointer */}
        <span
          aria-hidden="true"
          className="border-b-ink absolute start-1/2 top-0 z-10 -ms-2 h-0 w-0 border-x-8 border-b-12 border-x-transparent"
        />

        <motion.svg
          viewBox="0 0 200 200"
          className="h-full w-full drop-shadow-lg"
          animate={{ rotate: angle }}
          transition={{ duration: 3.4, ease: [0.16, 1, 0.3, 1] }}
          role="img"
          aria-label={rtl ? "عجلة الهدايا" : "Gift wheel"}
        >
          {prizes.map((prize, index) => {
            const start = (index * slice - 90) * (Math.PI / 180);
            const end = ((index + 1) * slice - 90) * (Math.PI / 180);
            const x1 = 100 + 96 * Math.cos(start);
            const y1 = 100 + 96 * Math.sin(start);
            const x2 = 100 + 96 * Math.cos(end);
            const y2 = 100 + 96 * Math.sin(end);
            const large = slice > 180 ? 1 : 0;
            const mid = (index * slice + slice / 2 - 90) * (Math.PI / 180);

            return (
              <g key={prize.id}>
                <path
                  d={`M100 100 L${x1} ${y1} A96 96 0 ${large} 1 ${x2} ${y2} Z`}
                  fill={SLICE_COLOURS[index % SLICE_COLOURS.length]}
                  stroke="var(--color-paper)"
                  strokeWidth="1.5"
                />
                <text
                  x={100 + 62 * Math.cos(mid)}
                  y={100 + 62 * Math.sin(mid)}
                  fill="white"
                  fontSize="8"
                  fontWeight="600"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${index * slice + slice / 2} ${100 + 62 * Math.cos(mid)} ${100 + 62 * Math.sin(mid)})`}
                >
                  {prizeSummary(prize, locale)}
                </text>
              </g>
            );
          })}
          <circle cx="100" cy="100" r="16" fill="var(--color-paper)" />
        </motion.svg>
      </div>

      {/* ---- Action ---------------------------------------------------- */}
      <div className="mt-8">
        {!signedIn ? (
          <p className="text-smoke text-[0.875rem]">
            <Link href="/login" className="text-brand underline-offset-4 hover:underline">
              {rtl ? "سجّل الدخول" : "Sign in"}
            </Link>{" "}
            {rtl ? "للعب — تُحفظ هديتك في حسابك." : "to play — your gift is saved to your account."}
          </p>
        ) : locked ? (
          <p className="text-smoke text-[0.875rem]">
            {rtl ? "يمكنك اللعب مجدداً بعد " : "You can play again in "}
            {Math.ceil(((cooldownUntil ?? 0) - Date.now()) / 3_600_000)}
            {rtl ? " ساعة." : " hours."}
          </p>
        ) : (
          <Button variant="brand" size="lg" loading={spinning} magnetic onClick={play}>
            {rtl ? "أدر العجلة" : "Spin the wheel"}
          </Button>
        )}
      </div>

      {message && (
        <p role="alert" className="text-alert mt-4 text-[0.875rem]">
          {message}
        </p>
      )}

      {/* ---- Result ---------------------------------------------------- */}
      {outcome && (
        <motion.div
          className={cn(
            "rounded-lg mt-6 p-5",
            outcome.prize.reward === "none" ? "bg-paper-sunken" : "bg-mint/10",
          )}
          initial={reduced ? false : { opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: EASE.spring }}
          role="status"
        >
          <p
            className={cn(
              "font-display text-lg font-semibold",
              outcome.prize.reward === "none" ? "text-ink-muted" : "text-mint",
            )}
          >
            {t(outcome.prize.label, locale)}
          </p>

          {outcome.code ? (
            <>
              <p className="text-ink mt-2 font-mono text-xl tracking-wider tabular-nums">
                {outcome.code}
              </p>
              <p className="text-smoke mt-2 text-[0.8125rem]">
                {rtl
                  ? "حُفظت الهدية في حسابك — ستجدها في «هداياي»."
                  : "Saved to your account — you will find it under “My gifts”."}
              </p>
              {outcome.expiresAt && (
                <p className="text-mist mt-1 text-[0.75rem]">
                  {rtl ? "تنتهي في " : "Expires "}
                  {new Date(outcome.expiresAt).toLocaleDateString(
                    locale === "ar" ? "ar-JO" : "en-JO",
                  )}
                </p>
              )}
              <Link
                href="/account?tab=gifts"
                className="text-brand mt-3 inline-block text-[0.8125rem] font-semibold underline-offset-4 hover:underline"
              >
                {rtl ? "اذهب إلى هداياي" : "Go to my gifts"}
              </Link>
            </>
          ) : (
            <p className="text-smoke mt-2 text-[0.8125rem]">
              {rtl ? "حظاً أوفر في المرة القادمة." : "Better luck next time."}
            </p>
          )}
        </motion.div>
      )}

      {campaign.terms && (
        <p className="text-mist mt-6 text-[0.75rem] leading-relaxed">
          {t(campaign.terms, locale)}
        </p>
      )}
    </div>
  );
}
