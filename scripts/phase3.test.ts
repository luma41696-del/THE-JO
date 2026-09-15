/**
 * Reviews, gift odds and analytics hygiene.
 *
 *   npm run test:phase3
 *
 * The gift tests are the ones that matter most: a wheel whose odds are subtly
 * wrong pays out more than the merchant budgeted and nobody notices for weeks,
 * because every individual spin looks plausible.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { summarise, summariseAll, sortReviews, validateReview } from "../src/lib/reviews";
import { availablePrizes, canPlay, drawPrize, giftCode } from "../src/lib/gift";
import { funnel, exitPoints, zeroResultSearches, byDevice } from "../src/lib/analytics/report";
import type { AnalyticsEvent, GiftCampaign, GiftPrize, Review } from "../src/types";

const NOW = Date.UTC(2026, 8, 15);
const HOUR = 3_600_000;

/* -------------------------------------------------------------------------- */
/*  Reviews                                                                   */
/* -------------------------------------------------------------------------- */

const review = (o: Partial<Review> = {}): Review =>
  ({
    id: "r1",
    productId: "p1",
    uid: "u1",
    authorName: "A",
    rating: 5,
    body: "Good",
    images: [],
    verifiedPurchase: false,
    status: "published",
    helpfulCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
  }) as Review;

test("only published reviews count toward the average", () => {
  const rows = [
    review({ id: "a", rating: 5 }),
    review({ id: "b", rating: 1, status: "hidden" }),
    review({ id: "c", rating: 1, status: "pending" }),
  ];
  const s = summarise("p1", rows);
  assert.equal(s.count, 1, "the hidden and pending ones do not count");
  assert.equal(s.average, 5);
});

test("hiding a review moves the average immediately", () => {
  const rows = [review({ id: "a", rating: 5 }), review({ id: "b", rating: 1 })];
  assert.equal(summarise("p1", rows).average, 3);

  const hidden = rows.map((r) => (r.id === "b" ? { ...r, status: "hidden" as const } : r));
  assert.equal(summarise("p1", hidden).average, 5, "the one-star stops counting");
  assert.equal(summarise("p1", hidden).count, 1);
});

test("the distribution buckets by star", () => {
  const rows = [
    review({ id: "a", rating: 5 }),
    review({ id: "b", rating: 5 }),
    review({ id: "c", rating: 3 }),
  ];
  assert.deepEqual(summarise("p1", rows).distribution, [0, 0, 1, 0, 2]);
});

test("the average is rounded once, at the end", () => {
  // 4 + 5 + 5 = 14 / 3 = 4.666…, which must be 4.7 and not 4.6.
  const rows = [
    review({ id: "a", rating: 4 }),
    review({ id: "b", rating: 5 }),
    review({ id: "c", rating: 5 }),
  ];
  assert.equal(summarise("p1", rows).average, 4.7);
});

test("a product with no reviews has no rating, not a zero rating", () => {
  const s = summarise("p1", []);
  assert.equal(s.count, 0);
  assert.equal(s.average, 0, "and the caller checks count, never average");
});

test("summaries are keyed per product", () => {
  const all = summariseAll([
    review({ id: "a", productId: "p1", rating: 5 }),
    review({ id: "b", productId: "p2", rating: 1 }),
  ]);
  assert.equal(all.p1?.average, 5);
  assert.equal(all.p2?.average, 1);
});

test("helpful sort falls back to recency, so pages do not reshuffle", () => {
  const rows = [
    review({ id: "a", helpfulCount: 2, createdAt: 1 }),
    review({ id: "b", helpfulCount: 2, createdAt: 2 }),
  ];
  assert.deepEqual(sortReviews(rows, "helpful").map((r) => r.id), ["b", "a"]);
});

test("one review per person per product", () => {
  const args = { uid: "u1", rating: 5, body: "Good", imageCount: 0 };
  assert.equal(validateReview({ ...args, existing: null }).ok, true);
  const second = validateReview({ ...args, existing: review() });
  assert.equal(second.ok, false);
  assert.equal(second.ok === false && second.reason, "duplicate");
  // Editing the one they already have is allowed.
  assert.equal(validateReview({ ...args, existing: review(), isEdit: true }).ok, true);
});

test("a review needs a signed-in author and a real rating", () => {
  assert.equal(
    validateReview({ uid: null, rating: 5, body: "x", imageCount: 0 }).ok,
    false,
  );
  assert.equal(
    validateReview({ uid: "u", rating: 0, body: "x", imageCount: 0 }).ok,
    false,
  );
  assert.equal(
    validateReview({ uid: "u", rating: 6, body: "x", imageCount: 0 }).ok,
    false,
  );
});

/* -------------------------------------------------------------------------- */
/*  Gift                                                                      */
/* -------------------------------------------------------------------------- */

const prize = (o: Partial<GiftPrize> = {}): GiftPrize => ({
  id: "p",
  label: { en: "P", ar: "ج" },
  reward: "percentage",
  value: 10,
  validForDays: 14,
  weight: 1,
  issued: 0,
  ...o,
});

const campaign = (o: Partial<GiftCampaign> = {}): GiftCampaign => ({
  id: "c1",
  name: { en: "Spin", ar: "أدر" },
  kind: "wheel",
  prizes: [prize({ id: "a", weight: 1 }), prize({ id: "b", weight: 1 })],
  startsAt: NOW - HOUR,
  endsAt: NOW + 30 * 24 * HOUR,
  cooldownHours: 24,
  status: "active",
  ...o,
});

test("a prize at its quantity is out of the pool", () => {
  const c = campaign({
    prizes: [prize({ id: "a", quantity: 2, issued: 2 }), prize({ id: "b" })],
  });
  assert.deepEqual(availablePrizes(c).map((p) => p.id), ["b"]);
});

test("a zero-weight prize can never be drawn", () => {
  const c = campaign({ prizes: [prize({ id: "a", weight: 0 }), prize({ id: "b", weight: 1 })] });
  // Including at random() === 0 exactly, which a `<= 0` comparison gets wrong.
  assert.equal(drawPrize(c, () => 0)?.id, "b");
  assert.equal(drawPrize(c, () => 0.999999)?.id, "b");
});

test("weights are relative, and need not sum to anything", () => {
  const c = campaign({
    prizes: [prize({ id: "a", weight: 30 }), prize({ id: "b", weight: 70 })],
  });
  // 30/100 boundary: just under picks a, just over picks b.
  assert.equal(drawPrize(c, () => 0.29)?.id, "a");
  assert.equal(drawPrize(c, () => 0.31)?.id, "b");
});

test("the distribution matches the weights over many draws", () => {
  const c = campaign({
    prizes: [prize({ id: "a", weight: 1 }), prize({ id: "b", weight: 3 })],
  });
  // A deterministic sweep rather than random sampling: no flaky test.
  let a = 0;
  let b = 0;
  for (let i = 0; i < 1000; i += 1) {
    const id = drawPrize(c, () => i / 1000)?.id;
    if (id === "a") a += 1;
    if (id === "b") b += 1;
  }
  assert.equal(a, 250, "a holds one quarter of the weight");
  assert.equal(b, 750);
});

test("an exhausted campaign refuses the spin rather than forcing a loss", () => {
  const c = campaign({
    prizes: [prize({ id: "a", quantity: 1, issued: 1 }), prize({ id: "b", quantity: 2, issued: 2 })],
  });
  const verdict = canPlay(c, { uid: "u1", now: NOW });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "exhausted");
});

test("the cooldown is enforced, and says when", () => {
  const c = campaign({ cooldownHours: 24 });
  const tooSoon = canPlay(c, { uid: "u1", now: NOW, lastPlayedAt: NOW - 2 * HOUR });
  assert.equal(tooSoon.ok, false);
  assert.equal(tooSoon.reason, "cooldown");
  assert.equal(tooSoon.nextPlayAt, NOW - 2 * HOUR + 24 * HOUR);

  const later = canPlay(c, { uid: "u1", now: NOW, lastPlayedAt: NOW - 25 * HOUR });
  assert.equal(later.ok, true);
});

test("a lifetime attempt cap is enforced", () => {
  const c = campaign({ maxAttempts: 3, cooldownHours: 0 });
  assert.equal(canPlay(c, { uid: "u1", now: NOW, attempts: 2 }).ok, true);
  assert.equal(canPlay(c, { uid: "u1", now: NOW, attempts: 3 }).reason, "max-attempts");
});

test("a signed-out visitor cannot play", () => {
  assert.equal(canPlay(campaign(), { uid: null, now: NOW }).reason, "not-signed-in");
});

test("a paused or out-of-window campaign refuses", () => {
  assert.equal(canPlay(campaign({ status: "paused" }), { uid: "u", now: NOW }).reason, "no-campaign");
  assert.equal(
    canPlay(campaign({ startsAt: NOW + HOUR }), { uid: "u", now: NOW }).reason,
    "not-started",
  );
  assert.equal(canPlay(campaign({ endsAt: NOW - HOUR }), { uid: "u", now: NOW }).reason, "ended");
});

test("gift codes are deterministic per play and avoid ambiguous characters", () => {
  const a = giftCode("play-1:user-1");
  assert.equal(a, giftCode("play-1:user-1"), "same input, same code");
  assert.notEqual(a, giftCode("play-2:user-1"));
  assert.match(a, /^GIFT-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.ok(!/[IO01]/.test(a.replace("GIFT-", "")), "nothing that can be misread aloud");
});

/* -------------------------------------------------------------------------- */
/*  Analytics                                                                 */
/* -------------------------------------------------------------------------- */

const event = (o: Partial<AnalyticsEvent> = {}): AnalyticsEvent =>
  ({
    id: "e",
    name: "page_view",
    anonymousId: "a1",
    sessionId: "s1",
    at: NOW,
    path: "/",
    device: "desktop",
    ...o,
  }) as AnalyticsEvent;

test("the funnel counts sessions, not events", () => {
  // One session that added to the bag six times is one session.
  const events = [
    event({ sessionId: "s1", name: "page_view" }),
    ...Array.from({ length: 6 }, (_, i) =>
      event({ sessionId: "s1", name: "cart_add", id: `c${i}` }),
    ),
    event({ sessionId: "s2", name: "page_view" }),
  ];
  const steps = funnel(events);
  assert.equal(steps.find((s) => s.name === "cart_add")?.count, 1);
  assert.equal(steps[0]?.count, 2, "two sessions visited");
});

test("a converted session is not counted as an exit", () => {
  const events = [
    event({ sessionId: "s1", path: "/cart", name: "page_view" }),
    event({ sessionId: "s1", name: "purchase", at: NOW + 1 }),
    event({ sessionId: "s2", path: "/cart", name: "page_view" }),
  ];
  const exits = exitPoints(events);
  assert.equal(exits.length, 1);
  assert.equal(exits[0]?.count, 1, "only the session that left without buying");
});

test("zero-result searches are counted and ranked", () => {
  const events = [
    event({ name: "search_no_results", props: { query: "Linen Shirt" } }),
    event({ name: "search_no_results", props: { query: "linen shirt" } }),
    event({ name: "search_no_results", props: { query: "socks" } }),
    event({ name: "search", props: { query: "coat" } }),
  ];
  const rows = zeroResultSearches(events);
  assert.equal(rows[0]?.query, "linen shirt", "case-folded and counted together");
  assert.equal(rows[0]?.count, 2);
  assert.ok(!rows.some((r) => r.query === "coat"), "a successful search is not in this list");
});

test("devices are counted once per session", () => {
  const events = [
    event({ sessionId: "s1", device: "mobile" }),
    event({ sessionId: "s1", device: "mobile", id: "e2" }),
    event({ sessionId: "s2", device: "desktop" }),
  ];
  assert.deepEqual(byDevice(events), { mobile: 1, tablet: 0, desktop: 1 });
});

test("a funnel step with no traffic before it does not divide by zero", () => {
  const steps = funnel([]);
  for (const step of steps) {
    assert.ok(Number.isFinite(step.conversion), `${step.name} conversion is finite`);
  }
});
