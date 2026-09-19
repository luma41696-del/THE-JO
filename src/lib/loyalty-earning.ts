import type { Localized } from "@/types";

/**
 * Where points come from, and what the shop pays for them.
 *
 * The existing programme earns on purchases only. This adds the other three
 * ways a customer can be paid — writing a review, bringing a friend, and
 * winning the wheel — and moves the numbers out of the source and into the
 * admin, because what a point is worth is a pricing decision and not a
 * constant.
 *
 * Everything here is pure. Points are a currency the shop prints, and the
 * arithmetic that decides how much it prints is worth being able to assert on
 * without a database.
 *
 * ## Every award is keyed, and that is the whole anti-abuse story
 *
 * Each source produces a deterministic ledger id — `review-<reviewId>`,
 * `referral-<uid>`, `wheel-<playId>`. Writing to the same id twice is one
 * document, so a retried request, a double-clicked button, a moderator
 * approving a review they already approved, and a replayed webhook all credit
 * the customer exactly once. Nothing else in this file matters as much.
 *
 * ## On paying for five-star reviews
 *
 * `minReviewRating` exists and **defaults to 1**, meaning any published
 * review earns. Setting it to 5 pays people to give five stars, and that is
 * worth naming plainly:
 *
 *  - It is illegal in a lot of places the shop will sell to. Incentivising
 *    positive reviews specifically — rather than reviews in general — is
 *    review manipulation under EU and US consumer rules, and Jordan's own
 *    consumer-protection law takes the same line on misleading commercial
 *    practice.
 *  - It devalues every review on the site, including the honest ones. A
 *    catalogue of nothing but five stars is one customers stop reading.
 *  - It buys the shop nothing it cannot get honestly: rewarding *any*
 *    substantive review drives the same volume of content.
 *
 * The setting is the merchant's to change and the admin screen says all of
 * this next to it. The default is the safe one.
 */

/* -------------------------------------------------------------------------- */
/*  Sources                                                                   */
/* -------------------------------------------------------------------------- */

export type EarnSource = "order" | "review" | "referral" | "wheel" | "adjust";

export const SOURCE_LABELS: Record<EarnSource, Localized> = {
  order: { en: "Purchase", ar: "شراء" },
  review: { en: "Review", ar: "تقييم" },
  referral: { en: "Invited a friend", ar: "دعوة صديق" },
  wheel: { en: "Lucky wheel", ar: "عجلة الحظ" },
  adjust: { en: "Adjustment", ar: "تعديل" },
};

/**
 * The ledger id for one award.
 *
 * Deterministic, so the same event can never be paid twice however many times
 * the code that pays it runs.
 */
export function earnKey(source: EarnSource, id: string): string {
  return `${source}-${id}`;
}

/* -------------------------------------------------------------------------- */
/*  The rules                                                                 */
/* -------------------------------------------------------------------------- */

export interface EarnRules {
  /** What one point is worth when redeemed, in store currency. */
  pointValue: number;

  review: {
    enabled: boolean;
    points: number;
    /**
     * Characters a review needs before it earns.
     *
     * The honest way to ask for "a good comment": length is a proxy for
     * substance and has nothing to do with whether the customer liked the
     * product. "Nice" earns nothing; a paragraph does, at one star or five.
     */
    minLength: number;
    /** See the note at the top of this file. 1 means any rating. */
    minRating: number;
    /** Points for a review that carries a photograph. Added to `points`. */
    photoBonus: number;
  };

  referral: {
    enabled: boolean;
    /** To the person who invited. */
    inviterPoints: number;
    /** To the person who joined, on their first order. */
    inviteePoints: number;
    /**
     * Pay only once the invited person has actually bought something.
     *
     * On by default, and it is the difference between a referral programme and
     * a way to print points by making accounts. Paying on sign-up costs
     * nothing to farm; paying on a paid order costs the price of the order.
     */
    requiresOrder: boolean;
  };

  wheel: {
    enabled: boolean;
  };
}

export const DEFAULT_EARN_RULES: EarnRules = {
  pointValue: 0.05,
  review: { enabled: true, points: 50, minLength: 60, minRating: 1, photoBonus: 25 },
  referral: { enabled: true, inviterPoints: 200, inviteePoints: 100, requiresOrder: true },
  wheel: { enabled: true },
};

/* -------------------------------------------------------------------------- */
/*  Bounds                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What the admin screen is allowed to set.
 *
 * Bounded because this is money and the field is a text box. The realistic
 * accident is not malice, it is a stray zero: `pointValue` at 5 instead of
 * 0.05 turns a thousand-point balance from fifty dinars into five thousand,
 * and nothing downstream would question it.
 */
export const LIMITS = {
  pointValue: { min: 0.001, max: 1 },
  points: { min: 0, max: 10_000 },
  minLength: { min: 0, max: 1000 },
  minRating: { min: 1, max: 5 },
} as const;

function clamp(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  /*
   * `Number(null)`, `Number("")` and `Number([])` are all **0**, which is
   * finite — so coercing anything and testing the result sends a missing value
   * to the bottom of the range instead of to the default. For `pointValue`
   * that is the difference between every balance in the shop being worth what
   * it should and being worth a fiftieth of it, with no error anywhere.
   *
   * So only a real number, or a string with something in it, is a value.
   */
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(n)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, n));
}

function whole(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  return Math.round(clamp(value, fallback, bounds));
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Read whatever is stored, or whatever was typed, into usable rules.
 *
 * Every field falls back to the default rather than to zero. A settings
 * document written by an older version is missing keys, and a missing
 * `pointValue` read as 0 would make every balance worthless without a single
 * error anywhere.
 */
export function sanitiseRules(input: unknown): EarnRules {
  const raw = (input ?? {}) as Partial<{
    pointValue: unknown;
    review: Partial<Record<keyof EarnRules["review"], unknown>>;
    referral: Partial<Record<keyof EarnRules["referral"], unknown>>;
    wheel: Partial<Record<keyof EarnRules["wheel"], unknown>>;
  }>;

  const d = DEFAULT_EARN_RULES;
  const review = raw.review ?? {};
  const referral = raw.referral ?? {};
  const wheel = raw.wheel ?? {};

  return {
    // Rounded to four places: a point worth 0.05 is exact, and a value with
    // fifteen decimals is a float artefact that would show up in a total.
    pointValue: Math.round(clamp(raw.pointValue, d.pointValue, LIMITS.pointValue) * 10_000) / 10_000,
    review: {
      enabled: flag(review.enabled, d.review.enabled),
      points: whole(review.points, d.review.points, LIMITS.points),
      minLength: whole(review.minLength, d.review.minLength, LIMITS.minLength),
      minRating: whole(review.minRating, d.review.minRating, LIMITS.minRating),
      photoBonus: whole(review.photoBonus, d.review.photoBonus, LIMITS.points),
    },
    referral: {
      enabled: flag(referral.enabled, d.referral.enabled),
      inviterPoints: whole(referral.inviterPoints, d.referral.inviterPoints, LIMITS.points),
      inviteePoints: whole(referral.inviteePoints, d.referral.inviteePoints, LIMITS.points),
      requiresOrder: flag(referral.requiresOrder, d.referral.requiresOrder),
    },
    wheel: { enabled: flag(wheel.enabled, d.wheel.enabled) },
  };
}

/* -------------------------------------------------------------------------- */
/*  What each action earns                                                    */
/* -------------------------------------------------------------------------- */

export interface ReviewForPoints {
  rating: number;
  body: string;
  /** Only a published review earns — see `pointsForReview`. */
  status: string;
  imageCount?: number;
}

/**
 * Points for one review, or zero.
 *
 * **Only a published review earns.** A review waiting on moderation has not
 * been read by anybody yet, and paying on submission is paying for whatever
 * somebody typed — which is a queue full of nonsense within a day.
 *
 * The body is measured after trimming, so a hundred spaces is not a paragraph.
 */
export function pointsForReview(rules: EarnRules, review: ReviewForPoints): number {
  if (!rules.review.enabled) return 0;
  if (review.status !== "published") return 0;
  if (review.rating < rules.review.minRating) return 0;
  if (review.body.trim().length < rules.review.minLength) return 0;

  const photos = (review.imageCount ?? 0) > 0 ? rules.review.photoBonus : 0;
  return rules.review.points + photos;
}

/** What a point is worth, and what a balance is worth, in store currency. */
export function pointsToMoney(points: number, rules: EarnRules): number {
  return Math.round(points * rules.pointValue * 1000) / 1000;
}

/**
 * How many points buy a given amount — rounded **up**.
 *
 * Up, because this answers "what does this cost the customer", and rounding
 * down there would hand out a fraction of a dinar on every redemption.
 */
export function pointsForMoney(amount: number, rules: EarnRules): number {
  if (rules.pointValue <= 0) return 0;
  return Math.ceil(amount / rules.pointValue);
}
