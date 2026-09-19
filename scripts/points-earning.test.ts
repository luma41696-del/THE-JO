import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  DEFAULT_EARN_RULES,
  LIMITS,
  earnKey,
  pointsForMoney,
  pointsForReview,
  pointsToMoney,
  sanitiseRules,
} from "../src/lib/loyalty-earning";
import {
  claimRefusal,
  generateReferralCode,
  normaliseReferralCode,
} from "../src/lib/referral";

/**
 * Earning points.
 *
 * Points are a currency the shop prints, so everything here is about how much
 * it prints and to whom. Two families of failure are pinned:
 *
 *  - **Paying more than intended.** A stray zero in `pointValue`, a review paid
 *    before a moderator has read it, a referral paid for making an account.
 *  - **Paying the same thing twice.** Every award is keyed, and the keys are
 *    asserted here because nothing else in the system checks them.
 *
 * Run with:
 *
 *     npm run test:points-earning
 */

const rules = (over: Partial<typeof DEFAULT_EARN_RULES> = {}) =>
  sanitiseRules({ ...DEFAULT_EARN_RULES, ...over });

/* -------------------------------------------------------------------------- */
/*  Keys                                                                      */
/* -------------------------------------------------------------------------- */

describe("every award is keyed to the thing it pays for", () => {
  test("the key is the source and the id", () => {
    assert.equal(earnKey("review", "r7"), "review-r7");
    assert.equal(earnKey("referral", "uid9"), "referral-uid9");
    assert.equal(earnKey("wheel", "play3"), "wheel-play3");
  });

  /*
   * The point of the key: the same event produces the same document id, so a
   * moderator approving a review twice, a retried request and a replayed job
   * all write to one place.
   */
  test("the same event always produces the same key", () => {
    assert.equal(earnKey("review", "r7"), earnKey("review", "r7"));
  });

  test("different sources cannot collide on one id", () => {
    assert.notEqual(earnKey("review", "x1"), earnKey("wheel", "x1"));
  });
});

/* -------------------------------------------------------------------------- */
/*  What a point is worth                                                     */
/* -------------------------------------------------------------------------- */

describe("the value of a point is bounded", () => {
  test("a stray zero is clamped, not stored", () => {
    // 0.5 instead of 0.05 turns a 1,000-point balance from 50 into 500.
    assert.equal(sanitiseRules({ pointValue: 50 }).pointValue, LIMITS.pointValue.max);
    assert.equal(sanitiseRules({ pointValue: 0 }).pointValue, LIMITS.pointValue.min);
    assert.equal(sanitiseRules({ pointValue: -3 }).pointValue, LIMITS.pointValue.min);
  });

  test("nonsense falls back to the default rather than to zero", () => {
    // A zero here would make every balance in the shop worthless silently.
    for (const bad of [undefined, null, "", "abc", NaN, Infinity, {}]) {
      assert.equal(
        sanitiseRules({ pointValue: bad }).pointValue,
        DEFAULT_EARN_RULES.pointValue,
        String(bad),
      );
    }
  });

  test("a settings document missing keys still reads as complete rules", () => {
    const partial = sanitiseRules({ review: { points: 10 } });
    assert.equal(partial.review.points, 10);
    assert.equal(partial.review.minLength, DEFAULT_EARN_RULES.review.minLength);
    assert.equal(partial.referral.inviterPoints, DEFAULT_EARN_RULES.referral.inviterPoints);
    assert.equal(partial.pointValue, DEFAULT_EARN_RULES.pointValue);
  });

  test("money converts both ways without drifting", () => {
    const r = rules();
    assert.equal(pointsToMoney(1000, r), 50);
    assert.equal(pointsToMoney(0, r), 0);
    // Up, because this is what the customer pays.
    assert.equal(pointsForMoney(1, r), 20);
    assert.equal(pointsForMoney(0.99, r), 20);
  });

  test("point counts are whole numbers", () => {
    assert.equal(sanitiseRules({ review: { points: 12.7 } }).review.points, 13);
    assert.equal(sanitiseRules({ review: { minRating: 3.4 } }).review.minRating, 3);
  });
});

/* -------------------------------------------------------------------------- */
/*  Reviews                                                                   */
/* -------------------------------------------------------------------------- */

const review = (over: Partial<Parameters<typeof pointsForReview>[1]> = {}) => ({
  rating: 5,
  body: "x".repeat(100),
  status: "published",
  ...over,
});

describe("a review earns only when it has been published", () => {
  /*
   * The one that matters. Paying on submission pays for whatever somebody
   * typed, which is a moderation queue full of nonsense within a day.
   */
  test("a pending review earns nothing", () => {
    assert.equal(pointsForReview(rules(), review({ status: "pending" })), 0);
    assert.equal(pointsForReview(rules(), review({ status: "hidden" })), 0);
  });

  test("a published review earns", () => {
    assert.equal(pointsForReview(rules(), review()), DEFAULT_EARN_RULES.review.points);
  });

  test("a review too short to say anything earns nothing", () => {
    assert.equal(pointsForReview(rules(), review({ body: "Good" })), 0);
    // Whitespace is not substance.
    assert.equal(pointsForReview(rules(), review({ body: " ".repeat(200) })), 0);
  });

  test("a photo adds the bonus, once", () => {
    const r = rules();
    assert.equal(
      pointsForReview(r, review({ imageCount: 1 })),
      r.review.points + r.review.photoBonus,
    );
    // Three photos is not three bonuses.
    assert.equal(
      pointsForReview(r, review({ imageCount: 3 })),
      r.review.points + r.review.photoBonus,
    );
  });

  /*
   * The default pays any rating. Rewarding five stars specifically is review
   * manipulation; the setting exists, and the default is the safe one.
   */
  test("by default a one-star review earns exactly as much as a five-star one", () => {
    const r = rules();
    assert.equal(r.review.minRating, 1);
    assert.equal(
      pointsForReview(r, review({ rating: 1 })),
      pointsForReview(r, review({ rating: 5 })),
    );
  });

  test("a merchant who raises the threshold gets what they asked for", () => {
    const r = rules({ review: { ...DEFAULT_EARN_RULES.review, minRating: 5 } });
    assert.equal(pointsForReview(r, review({ rating: 4 })), 0);
    assert.ok(pointsForReview(r, review({ rating: 5 })) > 0);
  });

  test("turning reviews off stops them earning", () => {
    const r = rules({ review: { ...DEFAULT_EARN_RULES.review, enabled: false } });
    assert.equal(pointsForReview(r, review()), 0);
  });
});

/* -------------------------------------------------------------------------- */
/*  Referrals                                                                 */
/* -------------------------------------------------------------------------- */

const claim = (over: Partial<Parameters<typeof claimRefusal>[0]> = {}) => ({
  inviterUid: "inviter",
  uid: "newbie",
  existingReferredBy: null,
  ordersPlaced: 0,
  inviterIps: ["203.0.113.9"],
  claimantIps: ["198.51.100.4"],
  enabled: true,
  ...over,
});

describe("a referral cannot be farmed", () => {
  test("a clean claim goes through", () => {
    assert.equal(claimRefusal(claim()), null);
  });

  test("nobody refers themselves", () => {
    assert.equal(claimRefusal(claim({ inviterUid: "same", uid: "same" })), "self");
  });

  test("a code nobody owns is refused", () => {
    assert.equal(claimRefusal(claim({ inviterUid: null })), "unknown-code");
  });

  test("an invitation is claimed once", () => {
    assert.equal(claimRefusal(claim({ existingReferredBy: "someone" })), "already-claimed");
  });

  test("an existing customer is not a referral", () => {
    assert.equal(claimRefusal(claim({ ordersPlaced: 1 })), "not-new");
  });

  /*
   * The realistic farm: one person, several accounts, one phone. Caught
   * because the shop records the addresses an account signs in from.
   */
  test("the same connection on both sides is refused", () => {
    assert.equal(
      claimRefusal(claim({ inviterIps: ["203.0.113.9"], claimantIps: ["203.0.113.9"] })),
      "same-connection",
    );
    // Any overlap, not only the latest address.
    assert.equal(
      claimRefusal(
        claim({
          inviterIps: ["198.51.100.1", "203.0.113.9"],
          claimantIps: ["203.0.113.9", "192.0.2.7"],
        }),
      ),
      "same-connection",
    );
  });

  test("no recorded addresses does not block an honest claim", () => {
    assert.equal(claimRefusal(claim({ inviterIps: [], claimantIps: [] })), null);
    assert.equal(claimRefusal(claim({ inviterIps: undefined, claimantIps: undefined })), null);
  });

  test("a switched-off programme refuses before anything else", () => {
    assert.equal(claimRefusal(claim({ enabled: false, inviterUid: null })), "disabled");
  });
});

describe("referral codes", () => {
  test("a code avoids the characters people misread", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateReferralCode();
      assert.equal(code.length, 8);
      assert.doesNotMatch(code, /[O01IL]/, code);
    }
  });

  test("what somebody types is tidied into a code", () => {
    assert.equal(normaliseReferralCode("np4k-7t2x"), "NP4K7T2X");
    assert.equal(normaliseReferralCode("  NP4K 7T2X  "), "NP4K7T2X");
  });

  test("the wrong length is not a code", () => {
    assert.equal(normaliseReferralCode("NP4K"), "");
    assert.equal(normaliseReferralCode(""), "");
    assert.equal(normaliseReferralCode("NP4K7T2XY"), "");
  });
});
