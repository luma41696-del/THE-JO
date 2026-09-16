import type { CartTotals, Localized } from "@/types";

/**
 * Points, tiers, and turning points back into money.
 *
 * A loyalty programme is a currency the shop prints, so the arithmetic is the
 * whole thing. Three rules decide whether it costs what the merchant expects
 * or quietly drains the margin:
 *
 *  1. **Points are earned on what was actually paid.** Not on the subtotal
 *     before a discount, and never on shipping. Earning on the pre-discount
 *     figure means a 50%-off coupon still pays full points — the customer is
 *     rewarded twice for the same purchase, and a 100% code mints points out
 *     of nothing. Earning on shipping pays people to choose express.
 *
 *  2. **Every point carries its own expiry.** A single balance number cannot
 *     say which half of it expires in March, so expiry either never happens or
 *     wipes the lot. The ledger holds dated entries and the balance is
 *     computed from them.
 *
 *  3. **Redeeming is a debit and a coupon, together or not at all.** See
 *     `redemptionPlan` and the route that applies it: a retry that mints a
 *     second coupon from one balance is free money, and it is the default
 *     behaviour of any implementation that writes them separately.
 *
 * Everything here is pure so the money can be tested without a database.
 */

/* -------------------------------------------------------------------------- */
/*  The programme                                                             */
/* -------------------------------------------------------------------------- */

export type Tier = "bronze" | "silver" | "gold";

export interface TierRule {
  id: Tier;
  name: Localized;
  /** Lifetime spend, in store currency, at which this tier begins. */
  from: number;
  /** Points per whole unit of currency spent. */
  pointsPerUnit: number;
}

/**
 * The tiers, cheapest first.
 *
 * Deliberately shallow — three tiers and a modest multiplier. A programme that
 * gives 10% back in points is a 10% discount with extra steps, and one that
 * needs a spreadsheet to explain is one nobody uses.
 */
export const TIERS: TierRule[] = [
  { id: "bronze", name: { en: "Bronze", ar: "برونزي" }, from: 0, pointsPerUnit: 1 },
  { id: "silver", name: { en: "Silver", ar: "فضي" }, from: 300, pointsPerUnit: 1.25 },
  { id: "gold", name: { en: "Gold", ar: "ذهبي" }, from: 1000, pointsPerUnit: 1.5 },
];

/** What one point is worth when redeemed, in store currency. */
export const POINT_VALUE = 0.05;

/** The smallest redemption. Below this the coupon costs more to process than it saves. */
export const MIN_REDEEM_POINTS = 200;

/** Redemptions move in whole steps, so the coupon is always a round figure. */
export const REDEEM_STEP = 100;

/**
 * How long a point lives.
 *
 * Twelve months from the purchase that earned it. Long enough to be a reward
 * rather than a deadline, short enough that the shop's liability does not grow
 * without limit — unredeemed points are a debt, and a programme with no expiry
 * accumulates one nobody has budgeted for.
 */
export const POINT_LIFETIME_MONTHS = 12;

/* -------------------------------------------------------------------------- */
/*  The ledger                                                                */
/* -------------------------------------------------------------------------- */

export type LedgerKind = "earn" | "redeem" | "expire" | "adjust" | "reverse";

export interface LedgerEntry {
  id: string;
  uid: string;
  kind: LedgerKind;
  /** Positive to add, negative to take away. Never zero. */
  points: number;
  at: number;
  /** When these points lapse. Only ever set on an `earn`. */
  expiresAt?: number;
  orderId?: string;
  orderReference?: string;
  /**
   * What the order paid for goods, on an `earn`.
   *
   * Recorded here so lifetime spend — and therefore the tier — is derived from
   * the ledger rather than from a counter kept beside it. A tier that
   * disagrees with the history behind it is the kind of thing a customer
   * notices and nobody can reconstruct.
   */
  spend?: number;
  /** The coupon a `redeem` produced. */
  offerId?: string;
  offerCode?: string;
  /** Why, for an `adjust` made by a person. */
  note?: string;
  actorUid?: string;
}

export interface Balance {
  /** Points that can be spent today. */
  available: number;
  /** Earned, spent and lapsed, for the account page's own arithmetic. */
  earned: number;
  redeemed: number;
  expired: number;
  /** Lifetime spend the tier is derived from. */
  lifetimeSpend: number;
  tier: Tier;
  /** Points that lapse within the next 60 days, and when the soonest goes. */
  expiringSoon: number;
  expiringSoonAt?: number;
}

/* -------------------------------------------------------------------------- */
/*  Earning                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The part of an order that earns points.
 *
 * Subtotal minus discount: what the customer actually paid for goods. Shipping
 * and tax are excluded because neither is the shop's margin — paying points on
 * delivery is paying people to pick the expensive courier, and paying on tax is
 * paying them on money that was never the shop's.
 *
 * Clamped at zero: a discount larger than the subtotal (a full comp, an
 * apology code) earns nothing rather than a negative, which would otherwise
 * subtract from a balance the customer built honestly.
 */
export function earnableAmount(totals: Pick<CartTotals, "subtotal" | "discount">): number {
  return Math.max(0, (totals.subtotal ?? 0) - (totals.discount ?? 0));
}

/** The tier a lifetime spend falls in. */
export function tierFor(lifetimeSpend: number): TierRule {
  let current = TIERS[0]!;
  for (const tier of TIERS) {
    if (lifetimeSpend >= tier.from) current = tier;
  }
  return current;
}

/** The next tier up, and what it still costs to reach. Absent at the top. */
export function nextTier(lifetimeSpend: number): { tier: TierRule; remaining: number } | null {
  const upcoming = TIERS.find((tier) => tier.from > lifetimeSpend);
  if (!upcoming) return null;
  return { tier: upcoming, remaining: round2(upcoming.from - lifetimeSpend) };
}

/**
 * Points earned by one order.
 *
 * Rounded **down**. A shop that rounds up pays out more than it planned on
 * every single order, and across a year that is a real number; rounding down
 * costs the customer at most one point, which is worth 0.05.
 */
export function pointsForOrder(
  totals: Pick<CartTotals, "subtotal" | "discount">,
  lifetimeSpend: number,
): number {
  const amount = earnableAmount(totals);
  if (amount <= 0) return 0;
  return Math.floor(amount * tierFor(lifetimeSpend).pointsPerUnit);
}

/** When points earned now lapse. */
export function expiryFor(earnedAt: number): number {
  const date = new Date(earnedAt);
  date.setMonth(date.getMonth() + POINT_LIFETIME_MONTHS);
  return date.getTime();
}

/* -------------------------------------------------------------------------- */
/*  Reading the ledger                                                        */
/* -------------------------------------------------------------------------- */

const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;

/**
 * What the account holds, from its entries.
 *
 * Computed rather than stored. A running total kept beside the ledger is wrong
 * the first time anything writes one without the other — a failed transaction,
 * a hand edit, a migration — and a balance that disagrees with its own history
 * is the one number a customer will notice and nobody can explain.
 *
 * Expiry is applied here rather than by a scheduled job: an `earn` whose date
 * has passed and which has not been spent simply stops counting. A job that
 * writes `expire` entries is still wanted for the record, but the balance must
 * not depend on it having run.
 */
export function balanceOf(entries: LedgerEntry[], now = Date.now()): Balance {
  let earned = 0;
  let redeemed = 0;
  let expired = 0;
  let lifetimeSpend = 0;

  /*
   * Points are spent oldest-first, so a redemption consumes the entries
   * closest to lapsing. The alternative — newest first — lets a customer who
   * redeems regularly still watch old points expire, which reads as the shop
   * taking them back.
   */
  const earns = entries
    .filter((entry) => entry.kind === "earn" && entry.points > 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => ({ ...entry, remaining: entry.points }));

  let toSpend = 0;
  for (const entry of entries) {
    if (entry.kind === "earn") {
      earned += entry.points;
    } else if (entry.kind === "redeem" || entry.kind === "reverse") {
      // Both take points away and are stored negative.
      const taken = Math.abs(entry.points);
      toSpend += taken;
      if (entry.kind === "redeem") redeemed += taken;
      else earned -= taken;
    } else if (entry.kind === "expire") {
      expired += Math.abs(entry.points);
    } else if (entry.kind === "adjust") {
      if (entry.points > 0) earned += entry.points;
      else toSpend += Math.abs(entry.points);
    }
  }

  // Draw what has been spent off the oldest earns.
  for (const earn of earns) {
    if (toSpend <= 0) break;
    const taken = Math.min(earn.remaining, toSpend);
    earn.remaining -= taken;
    toSpend -= taken;
  }

  let available = 0;
  let expiringSoon = 0;
  let expiringSoonAt: number | undefined;
  let lapsed = 0;

  for (const earn of earns) {
    if (earn.remaining <= 0) continue;
    if (earn.expiresAt !== undefined && earn.expiresAt <= now) {
      lapsed += earn.remaining;
      continue;
    }
    available += earn.remaining;
    if (earn.expiresAt !== undefined && earn.expiresAt - now <= SIXTY_DAYS) {
      expiringSoon += earn.remaining;
      if (expiringSoonAt === undefined || earn.expiresAt < expiringSoonAt) {
        expiringSoonAt = earn.expiresAt;
      }
    }
  }

  /*
   * A positive adjustment made by staff is spendable even though it is not an
   * `earn`, so it is added after the earn walk. It never expires — a goodwill
   * gesture with a deadline is not much of a gesture.
   */
  for (const entry of entries) {
    if (entry.kind === "adjust" && entry.points > 0) available += entry.points;
  }
  available = Math.max(0, available);

  for (const entry of entries) {
    if (entry.kind === "earn" && typeof entry.orderId === "string") {
      lifetimeSpend += entry.spend ?? 0;
    }
  }

  return {
    available,
    earned: Math.max(0, earned),
    redeemed,
    expired: expired + lapsed,
    lifetimeSpend: round2(lifetimeSpend),
    tier: tierFor(lifetimeSpend).id,
    expiringSoon,
    ...(expiringSoonAt !== undefined ? { expiringSoonAt } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/*  Redeeming                                                                 */
/* -------------------------------------------------------------------------- */

export type RedeemRefusal = "below-minimum" | "not-a-step" | "insufficient" | "not-positive";

export interface RedemptionPlan {
  ok: boolean;
  reason?: RedeemRefusal;
  message: Localized;
  /** Points to debit, and the coupon value they buy. */
  points?: number;
  value?: number;
}

/**
 * May this many points become a coupon, and what is it worth?
 *
 * Every refusal is a rule the customer can see before they press the button:
 * a minimum, a step, and their own balance. Nothing here is a surprise at
 * submit time, which is the point — a loyalty programme that refuses after the
 * fact feels like a trick.
 */
export function redemptionPlan(points: number, available: number): RedemptionPlan {
  if (!Number.isFinite(points) || points <= 0) {
    return {
      ok: false,
      reason: "not-positive",
      message: { en: "Choose how many points to use.", ar: "اختر عدد النقاط التي تريد استخدامها." },
    };
  }

  if (points < MIN_REDEEM_POINTS) {
    return {
      ok: false,
      reason: "below-minimum",
      message: {
        en: `The smallest redemption is ${MIN_REDEEM_POINTS} points.`,
        ar: `أقل استبدال هو ${MIN_REDEEM_POINTS} نقطة.`,
      },
    };
  }

  if (points % REDEEM_STEP !== 0) {
    return {
      ok: false,
      reason: "not-a-step",
      message: {
        en: `Points are redeemed in steps of ${REDEEM_STEP}.`,
        ar: `تُستبدل النقاط بمضاعفات ${REDEEM_STEP}.`,
      },
    };
  }

  if (points > available) {
    return {
      ok: false,
      reason: "insufficient",
      message: {
        en: `You have ${available} points.`,
        ar: `لديك ${available} نقطة.`,
      },
    };
  }

  return {
    ok: true,
    points,
    value: round2(points * POINT_VALUE),
    message: { en: "Ready to redeem.", ar: "جاهز للاستبدال." },
  };
}

/** The largest redemption a balance allows, as a whole step. */
export function maxRedeemable(available: number): number {
  const steps = Math.floor(available / REDEEM_STEP) * REDEEM_STEP;
  return steps >= MIN_REDEEM_POINTS ? steps : 0;
}

/**
 * The coupon a redemption produces.
 *
 * Bound to the account and usable once. Both matter: points are not a bearer
 * instrument, and a code that survives its first use turns one person's
 * balance into a discount the whole internet can share within a day.
 *
 * It is a `fixed` amount, never a percentage — the customer is spending a
 * known number of points for a known number of dinars, and a percentage would
 * make what they get depend on what they buy next.
 */
export function couponFor(uid: string, points: number, now = Date.now()) {
  const value = round2(points * POINT_VALUE);
  return {
    code: `PTS-${points}-${now.toString(36).toUpperCase().slice(-5)}`,
    type: "fixed" as const,
    value,
    title: {
      en: `${value} off, from ${points} points`,
      ar: `خصم ${value} مقابل ${points} نقطة`,
    },
    assignedUid: uid,
    usageLimit: 1,
    perUserLimit: 1,
    firstOrderOnly: false,
    appliesToCategoryIds: [],
    appliesToProductIds: [],
    excludesCategoryIds: [],
    excludesProductIds: [],
    startsAt: now,
    /*
     * Ninety days. A redeemed coupon is points already taken off the balance,
     * so an unused one is money the customer has paid for and not spent —
     * long enough to be fair, short enough that the liability closes.
     */
    endsAt: now + 90 * 24 * 60 * 60 * 1000,
    usageCount: 0,
    status: "active" as const,
  };
}

/* -------------------------------------------------------------------------- */
/*  Earning, written inside the checkout transaction                          */
/* -------------------------------------------------------------------------- */

/**
 * The ledger write for one order — a description, not a write.
 *
 * Returned for the caller to perform *inside* the checkout transaction,
 * because the points and the order have to land together. An order that
 * commits without its points is a customer who paid and was not credited, and
 * points written before an order that then fails are points for a purchase
 * that never happened.
 *
 * The document id is derived from the order, so the write is idempotent: a
 * checkout retried after a lost response credits once, not twice.
 */
export function earnEntryFor({
  uid,
  orderId,
  orderReference,
  points,
  spend,
  now = Date.now(),
}: {
  uid: string;
  orderId: string;
  orderReference: string;
  points: number;
  spend: number;
  now?: number;
}): { docId: string; data: Omit<LedgerEntry, "id"> } {
  return {
    docId: `order-${orderId}`,
    data: {
      uid,
      kind: "earn",
      points,
      spend,
      at: now,
      expiresAt: expiryFor(now),
      orderId,
      orderReference,
    },
  };
}

/* -------------------------------------------------------------------------- */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
