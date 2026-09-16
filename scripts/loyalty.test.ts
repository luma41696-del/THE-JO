import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  MIN_REDEEM_POINTS,
  POINT_VALUE,
  REDEEM_STEP,
  TIERS,
  balanceOf,
  couponFor,
  earnableAmount,
  expiryFor,
  maxRedeemable,
  nextTier,
  pointsForOrder,
  redemptionPlan,
  tierFor,
  type LedgerEntry,
} from "../src/lib/loyalty";

/**
 * Points, and the ways a loyalty programme leaks money.
 *
 * A points balance is a currency the shop prints and a debt it carries, so
 * almost everything here is about *not* paying out: not on shipping, not on
 * the half of an order a coupon already discounted, not twice for one
 * redemption, and not at all on points that have lapsed.
 *
 * Run with:
 *
 *     npm run test:loyalty
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 1);

function earn(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "e1",
    uid: "u1",
    kind: "earn",
    points: 100,
    at: NOW - 30 * DAY,
    expiresAt: NOW + 300 * DAY,
    orderId: "o1",
    spend: 100,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/*  What earns                                                                */
/* -------------------------------------------------------------------------- */

describe("earnableAmount", () => {
  test("is what was paid for goods, after the discount", () => {
    /*
     * Earning on the pre-discount subtotal rewards the customer twice for one
     * purchase: the coupon takes half off, and the points are paid as though
     * it had not. A 100% code would mint points out of nothing.
     */
    assert.equal(earnableAmount({ subtotal: 100, discount: 40 }), 60);
  });

  test("excludes shipping and tax", () => {
    // Paying points on delivery pays people to choose the expensive courier;
    // paying on tax pays them on money that was never the shop's.
    assert.equal(earnableAmount({ subtotal: 100, discount: 0 }), 100);
  });

  test("a discount larger than the subtotal earns nothing, not a negative", () => {
    // Which would otherwise subtract from a balance built honestly.
    assert.equal(earnableAmount({ subtotal: 50, discount: 80 }), 0);
  });

  test("missing figures are treated as zero rather than NaN", () => {
    assert.equal(earnableAmount({} as never), 0);
  });
});

describe("pointsForOrder", () => {
  test("pays the tier's rate", () => {
    assert.equal(pointsForOrder({ subtotal: 100, discount: 0 }, 0), 100);
    assert.equal(pointsForOrder({ subtotal: 100, discount: 0 }, 500), 125);
    assert.equal(pointsForOrder({ subtotal: 100, discount: 0 }, 2000), 150);
  });

  test("rounds down", () => {
    /*
     * Rounding up pays out more than planned on every order. Rounding down
     * costs the customer at most one point, which is worth five piastres.
     */
    assert.equal(pointsForOrder({ subtotal: 99.9, discount: 0 }, 500), 124);
  });

  test("an order that paid nothing earns nothing", () => {
    assert.equal(pointsForOrder({ subtotal: 40, discount: 40 }, 500), 0);
  });
});

/* -------------------------------------------------------------------------- */
/*  Tiers                                                                     */
/* -------------------------------------------------------------------------- */

describe("tiers", () => {
  test("a new account starts at the bottom", () => {
    assert.equal(tierFor(0).id, "bronze");
  });

  test("the boundary belongs to the higher tier", () => {
    assert.equal(tierFor(299).id, "bronze");
    assert.equal(tierFor(300).id, "silver");
    assert.equal(tierFor(1000).id, "gold");
  });

  test("beyond the top tier there is nothing left to reach", () => {
    assert.equal(nextTier(5000), null);
  });

  test("the next tier says what it still costs", () => {
    const next = nextTier(250);
    assert.equal(next!.tier.id, "silver");
    assert.equal(next!.remaining, 50);
  });

  test("the tiers are ordered and each pays more than the last", () => {
    // A table where a higher tier pays less is a bug nobody reads carefully
    // enough to spot in a config object.
    for (let i = 1; i < TIERS.length; i += 1) {
      assert.equal(TIERS[i]!.from > TIERS[i - 1]!.from, true);
      assert.equal(TIERS[i]!.pointsPerUnit > TIERS[i - 1]!.pointsPerUnit, true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  The balance                                                               */
/* -------------------------------------------------------------------------- */

describe("balanceOf", () => {
  test("adds up what is there", () => {
    const balance = balanceOf([earn({ points: 100 }), earn({ id: "e2", points: 50 })], NOW);
    assert.equal(balance.available, 150);
    assert.equal(balance.earned, 150);
  });

  test("a redemption comes off the balance", () => {
    const balance = balanceOf(
      [earn({ points: 500 }), { ...earn({ id: "r1" }), kind: "redeem", points: -200 }],
      NOW,
    );
    assert.equal(balance.available, 300);
    assert.equal(balance.redeemed, 200);
  });

  test("points past their date stop counting, with no job having run", () => {
    /*
     * Expiry is computed, not swept. A balance that depends on a scheduled job
     * having run is a balance that is wrong every time the job fails — and it
     * fails silently, in the customer's favour, until somebody notices.
     */
    const balance = balanceOf([earn({ points: 100, expiresAt: NOW - DAY })], NOW);
    assert.equal(balance.available, 0);
    assert.equal(balance.expired, 100);
  });

  test("points are spent oldest first, so the ones nearest lapsing go", () => {
    /*
     * Spending the newest first lets somebody who redeems regularly still
     * watch old points expire, which reads as the shop taking them back.
     */
    const old = earn({ id: "old", points: 200, at: NOW - 300 * DAY, expiresAt: NOW + 10 * DAY });
    const fresh = earn({ id: "new", points: 200, at: NOW - DAY, expiresAt: NOW + 350 * DAY });
    const spend: LedgerEntry = { ...earn({ id: "r" }), kind: "redeem", points: -200 };

    const balance = balanceOf([old, fresh, spend], NOW);
    assert.equal(balance.available, 200);
    // The remaining 200 are the fresh ones, so nothing is about to lapse.
    assert.equal(balance.expiringSoon, 0);
  });

  test("warns about points lapsing within sixty days", () => {
    const balance = balanceOf([earn({ points: 100, expiresAt: NOW + 10 * DAY })], NOW);
    assert.equal(balance.expiringSoon, 100);
    assert.equal(balance.expiringSoonAt, NOW + 10 * DAY);
  });

  test("a reversal takes back what an order earned", () => {
    // A refunded order must not leave its points behind, or a buy-and-return
    // loop is a points printer.
    const balance = balanceOf(
      [earn({ points: 100 }), { ...earn({ id: "rev" }), kind: "reverse", points: -100 }],
      NOW,
    );
    assert.equal(balance.available, 0);
    assert.equal(balance.earned, 0);
  });

  test("a goodwill adjustment is spendable and does not lapse", () => {
    // A gesture with a deadline is not much of a gesture.
    const balance = balanceOf(
      [{ ...earn({ id: "a" }), kind: "adjust", points: 250, expiresAt: undefined, orderId: undefined }],
      NOW,
    );
    assert.equal(balance.available, 250);
  });

  test("a negative adjustment takes points away", () => {
    const balance = balanceOf(
      [
        earn({ points: 500 }),
        { ...earn({ id: "a" }), kind: "adjust", points: -100, expiresAt: undefined, orderId: undefined },
      ],
      NOW,
    );
    assert.equal(balance.available, 400);
  });

  test("the balance never goes below zero", () => {
    const balance = balanceOf(
      [earn({ points: 50 }), { ...earn({ id: "r" }), kind: "redeem", points: -500 }],
      NOW,
    );
    assert.equal(balance.available, 0);
  });

  test("lifetime spend and the tier come from the ledger itself", () => {
    /*
     * Not from a counter kept beside it. A tier that disagrees with the
     * history behind it is the one number a customer notices and nobody can
     * reconstruct.
     */
    const balance = balanceOf(
      [earn({ id: "a", spend: 200, orderId: "o1" }), earn({ id: "b", spend: 150, orderId: "o2" })],
      NOW,
    );
    assert.equal(balance.lifetimeSpend, 350);
    assert.equal(balance.tier, "silver");
  });

  test("an empty ledger is an empty account, not a crash", () => {
    const balance = balanceOf([], NOW);
    assert.equal(balance.available, 0);
    assert.equal(balance.tier, "bronze");
  });
});

/* -------------------------------------------------------------------------- */
/*  Redeeming                                                                 */
/* -------------------------------------------------------------------------- */

describe("redemptionPlan", () => {
  test("a clean redemption says what it is worth", () => {
    const plan = redemptionPlan(400, 1000);
    assert.equal(plan.ok, true);
    assert.equal(plan.points, 400);
    assert.equal(plan.value, 20);
  });

  test("below the minimum is refused, and says the minimum", () => {
    const plan = redemptionPlan(100, 1000);
    assert.equal(plan.ok, false);
    assert.equal(plan.reason, "below-minimum");
    assert.equal(plan.message.en.includes(String(MIN_REDEEM_POINTS)), true);
    assert.equal(plan.message.ar.length > 0, true);
  });

  test("an amount off the step is refused", () => {
    assert.equal(redemptionPlan(250, 1000).reason, "not-a-step");
    assert.equal(redemptionPlan(300, 1000).ok, true);
  });

  test("more than the balance is refused, and says the balance", () => {
    const plan = redemptionPlan(1000, 300);
    assert.equal(plan.reason, "insufficient");
    assert.equal(plan.message.en.includes("300"), true);
  });

  test("zero and nonsense are refused before anything else", () => {
    assert.equal(redemptionPlan(0, 1000).reason, "not-positive");
    assert.equal(redemptionPlan(-500, 1000).reason, "not-positive");
    assert.equal(redemptionPlan(Number.NaN, 1000).reason, "not-positive");
  });

  test("every refusal is bilingual", () => {
    for (const points of [0, 100, 250, 99999]) {
      const plan = redemptionPlan(points, 300);
      assert.equal(plan.ok, false);
      assert.equal(plan.message.en.length > 0, true);
      assert.equal(plan.message.ar.length > 0, true);
    }
  });
});

describe("maxRedeemable", () => {
  test("rounds down to a whole step", () => {
    assert.equal(maxRedeemable(1250), 1200);
    assert.equal(maxRedeemable(REDEEM_STEP * 3), REDEEM_STEP * 3);
  });

  test("a balance under the minimum can redeem nothing", () => {
    assert.equal(maxRedeemable(150), 0);
    assert.equal(maxRedeemable(0), 0);
  });
});

/* -------------------------------------------------------------------------- */
/*  The coupon                                                                */
/* -------------------------------------------------------------------------- */

describe("couponFor", () => {
  const coupon = couponFor("u1", 400, NOW);

  test("is worth what the points were worth", () => {
    assert.equal(coupon.value, 400 * POINT_VALUE);
    assert.equal(coupon.type, "fixed");
  });

  test("is a fixed amount, never a percentage", () => {
    /*
     * The customer spent a known number of points for a known number of
     * dinars. A percentage would make what they get depend on what they buy
     * next, which is not what they agreed to.
     */
    assert.equal(coupon.type, "fixed");
  });

  test("is bound to the account that paid for it", () => {
    // Points are not a bearer instrument.
    assert.equal(coupon.assignedUid, "u1");
  });

  test("works once", () => {
    // A code that survives its first use turns one balance into a discount the
    // whole internet shares within a day.
    assert.equal(coupon.usageLimit, 1);
    assert.equal(coupon.perUserLimit, 1);
  });

  test("starts now and ends", () => {
    assert.equal(coupon.startsAt, NOW);
    assert.equal(coupon.endsAt > NOW, true);
  });

  test("applies to everything, and excludes nothing", () => {
    assert.deepEqual(coupon.appliesToCategoryIds, []);
    assert.deepEqual(coupon.excludesProductIds, []);
  });

  test("two redemptions in the same millisecond still differ by their points", () => {
    // The code carries both the amount and a stamp, so a collision would need
    // the same points in the same millisecond — and the route writes it into a
    // transaction that would reject a duplicate anyway.
    assert.notEqual(couponFor("u1", 400, NOW).code, couponFor("u1", 300, NOW).code);
  });
});

describe("expiryFor", () => {
  test("is a year out", () => {
    const expiry = expiryFor(Date.UTC(2026, 0, 15));
    assert.equal(new Date(expiry).getUTCFullYear(), 2027);
    assert.equal(new Date(expiry).getUTCMonth(), 0);
  });
});

/* -------------------------------------------------------------------------- */
/*  A worked account                                                          */
/* -------------------------------------------------------------------------- */

describe("an account over a year", () => {
  test("earns, tiers up, redeems, and loses what it did not spend", () => {
    const entries: LedgerEntry[] = [
      // Two orders while bronze.
      earn({ id: "1", points: 200, spend: 200, at: NOW - 400 * DAY, expiresAt: NOW - 35 * DAY }),
      earn({ id: "2", points: 150, spend: 150, at: NOW - 200 * DAY, expiresAt: NOW + 165 * DAY }),
      // Now silver: 350 lifetime.
      earn({ id: "3", points: 250, spend: 200, at: NOW - 100 * DAY, expiresAt: NOW + 265 * DAY }),
      // Redeemed 200 — taken off the oldest first, which were about to lapse.
      { ...earn({ id: "4" }), kind: "redeem", points: -200, at: NOW - 90 * DAY },
    ];

    const balance = balanceOf(entries, NOW);

    assert.equal(balance.lifetimeSpend, 550);
    assert.equal(balance.tier, "silver");
    assert.equal(balance.redeemed, 200);
    // 600 earned, 200 redeemed off the oldest entry; the rest of that entry
    // has since lapsed, leaving the two newer ones.
    assert.equal(balance.expired, 0);
    assert.equal(balance.available, 400);
  });
});
