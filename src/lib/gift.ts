/**
 * Gift campaign mechanics.
 *
 * The draw is pure and lives here so it can be tested exhaustively, but it is
 * only ever *called* from the server. That is the whole security model of the
 * feature: the browser is told what it won, never asked.
 *
 * A client-side draw would be trivially defeated — change the outcome in the
 * console, refresh until a better prize appears, replay the request. Every one
 * of those is prevented by the same thing: the prize is chosen and written
 * inside one transaction before the wheel is allowed to start spinning.
 */

import type { GiftCampaign, GiftPrize } from "@/types";

/* -------------------------------------------------------------------------- */
/*  Eligibility                                                               */
/* -------------------------------------------------------------------------- */

export type GiftRejection =
  | "not-signed-in"
  | "no-campaign"
  | "not-started"
  | "ended"
  | "cooldown"
  | "max-attempts"
  | "exhausted";

export interface GiftEligibility {
  ok: boolean;
  reason?: GiftRejection;
  message: { en: string; ar: string };
  /** When the customer may play again, if they are in a cooldown. */
  nextPlayAt?: number;
}

function deny(
  reason: GiftRejection,
  en: string,
  ar: string,
  nextPlayAt?: number,
): GiftEligibility {
  return { ok: false, reason, message: { en, ar }, ...(nextPlayAt ? { nextPlayAt } : {}) };
}

/** Prizes with stock left. A campaign whose every prize is gone cannot run. */
export function availablePrizes(campaign: GiftCampaign): GiftPrize[] {
  return campaign.prizes.filter(
    (p) => p.weight > 0 && (p.quantity === undefined || p.issued < p.quantity),
  );
}

/**
 * May this account play right now?
 *
 * `lastPlayedAt` and `attempts` come from the caller's own play history, read
 * inside the same transaction that will write the result — checking them from
 * a separate query would let two simultaneous requests both see "no plays yet".
 */
export function canPlay(
  campaign: GiftCampaign | null,
  opts: {
    uid: string | null;
    now?: number;
    lastPlayedAt?: number | null;
    attempts?: number;
  },
): GiftEligibility {
  const now = opts.now ?? Date.now();

  if (!opts.uid) {
    return deny(
      "not-signed-in",
      "Sign in to play — your gift is saved to your account.",
      "سجّل الدخول للعب — تُحفظ هديتك في حسابك.",
    );
  }
  if (!campaign || campaign.status !== "active") {
    return deny("no-campaign", "No game is running right now.", "لا توجد لعبة جارية حالياً.");
  }
  if (campaign.startsAt > now) {
    return deny("not-started", "This game has not started yet.", "لم تبدأ هذه اللعبة بعد.");
  }
  if (campaign.endsAt <= now) {
    return deny("ended", "This game has finished.", "انتهت هذه اللعبة.");
  }

  if (campaign.maxAttempts !== undefined && (opts.attempts ?? 0) >= campaign.maxAttempts) {
    return deny(
      "max-attempts",
      "You have used all your turns.",
      "استخدمت كل محاولاتك.",
    );
  }

  if (opts.lastPlayedAt && campaign.cooldownHours > 0) {
    const nextPlayAt = opts.lastPlayedAt + campaign.cooldownHours * 3_600_000;
    if (now < nextPlayAt) {
      const hours = Math.ceil((nextPlayAt - now) / 3_600_000);
      return deny(
        "cooldown",
        `You can play again in ${hours} hour${hours === 1 ? "" : "s"}.`,
        `يمكنك اللعب مجدداً بعد ${hours} ساعة.`,
        nextPlayAt,
      );
    }
  }

  /*
   * A campaign with nothing left is *not* silently turned into a losing spin.
   * Spinning a wheel whose prizes are all gone, and landing on "better luck
   * next time" by force, is a rigged game dressed as a fair one.
   */
  if (availablePrizes(campaign).length === 0) {
    return deny(
      "exhausted",
      "Every prize has been claimed. Thank you for playing.",
      "نفدت كل الجوائز. شكراً لمشاركتك.",
    );
  }

  return { ok: true, message: { en: "", ar: "" } };
}

/* -------------------------------------------------------------------------- */
/*  The draw                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Pick a prize by weight.
 *
 * Weights are relative and normalised here, so a merchant editing one prize
 * of five does not have to keep a set of percentages summing to 100 — a
 * constraint nobody maintains, and one that silently breaks the odds when it
 * is violated.
 *
 * `random` is injectable purely so the tests can assert the distribution;
 * production always passes `Math.random`.
 */
export function drawPrize(
  campaign: GiftCampaign,
  random: () => number = Math.random,
): GiftPrize | null {
  const pool = availablePrizes(campaign);
  if (pool.length === 0) return null;

  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  if (total <= 0) return null;

  let ticket = random() * total;
  for (const prize of pool) {
    ticket -= prize.weight;
    // `< 0` rather than `<= 0`: with `random()` returning exactly 0, `<=`
    // would award a zero-weight prize that was filtered out of the pool.
    if (ticket < 0) return prize;
  }
  // Floating-point drift can leave a sliver; the last eligible prize takes it.
  return pool[pool.length - 1] ?? null;
}

/** A short, unambiguous code. Excludes I, O, 0 and 1 so it can be read aloud. */
export function giftCode(seed: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let n = Math.abs(hash);
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length);
  }
  return `GIFT-${out}`;
}

/** Human summary of a prize, for the wheel face and the win screen. */
export function prizeSummary(prize: GiftPrize, locale: "en" | "ar"): string {
  switch (prize.reward) {
    case "percentage":
      return locale === "ar" ? `خصم ${prize.value}٪` : `${prize.value}% off`;
    case "fixed":
      return locale === "ar" ? `خصم ${prize.value} دينار` : `${prize.value} JOD off`;
    case "free-shipping":
      return locale === "ar" ? "توصيل مجاني" : "Free delivery";
    case "none":
    default:
      return locale === "ar" ? "حظاً أوفر" : "No prize";
  }
}
