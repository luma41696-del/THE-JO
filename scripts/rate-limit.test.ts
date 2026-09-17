import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { RULES, callerKey, rateLimit, tooManyRequests } from "../src/lib/security/rate-limit";

/**
 * Rate limiting.
 *
 * Firebase Admin is not configured in this suite, so `rateLimit` runs its
 * in-memory path — which is the code that runs in development and the logic
 * that the Firestore path mirrors. What is being tested is the *window*
 * arithmetic and the identity rules, which is where the bugs live; the
 * Firestore transaction is a counter and fails open by design.
 *
 * Run with:
 *
 *     npm run test:rate-limit
 */

const request = (headers: Record<string, string> = {}) =>
  new Request("https://netsale.shop/api/newsletter", { method: "POST", headers });

/** A fresh bucket per test, so one test cannot exhaust another's. */
let bucket = 0;
const key = () => `test-${(bucket += 1)}`;

describe("who is being limited", () => {
  test("a signed-in caller is keyed by uid, not by address", () => {
    // Otherwise a household behind one NAT shares a limit, and an abuser
    // escapes theirs by moving to a café.
    const fromHome = callerKey(request({ "x-forwarded-for": "1.1.1.1" }), "user-7");
    const fromCafe = callerKey(request({ "x-forwarded-for": "2.2.2.2" }), "user-7");
    assert.equal(fromHome, fromCafe);
    assert.equal(fromHome, "uid:user-7");
  });

  test("an anonymous caller is keyed by the leftmost forwarded address", () => {
    // The leftmost is the real peer; the rest are proxies. Taking the last
    // would key every request to the same edge node.
    assert.equal(
      callerKey(request({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" })),
      "ip:203.0.113.9",
    );
  });

  test("a missing address still produces a key rather than throwing", () => {
    assert.equal(callerKey(request()), "ip:unknown");
  });

  test("x-real-ip is the fallback when there is no forwarded header", () => {
    assert.equal(callerKey(request({ "x-real-ip": "198.51.100.4" })), "ip:198.51.100.4");
  });
});

describe("the window", () => {
  test("allows exactly the limit, then refuses", async () => {
    const rule = { limit: 3, windowSeconds: 60 };
    const k = key();
    const now = 1_700_000_000_000;

    for (let i = 1; i <= 3; i += 1) {
      const result = await rateLimit(k, rule, now);
      assert.equal(result.ok, true, `request ${i}`);
      assert.equal(result.remaining, 3 - i);
    }

    const refused = await rateLimit(k, rule, now);
    assert.equal(refused.ok, false);
    assert.equal(refused.remaining, 0);
  });

  test("a new window starts fresh", async () => {
    const rule = { limit: 2, windowSeconds: 60 };
    const k = key();
    const now = 1_700_000_000_000;

    await rateLimit(k, rule, now);
    await rateLimit(k, rule, now);
    assert.equal((await rateLimit(k, rule, now)).ok, false);

    // One window later.
    assert.equal((await rateLimit(k, rule, now + 60_000)).ok, true);
  });

  test("two different callers do not share a bucket", async () => {
    const rule = { limit: 1, windowSeconds: 60 };
    const now = 1_700_000_000_000;
    const a = key();
    const b = key();

    assert.equal((await rateLimit(a, rule, now)).ok, true);
    assert.equal((await rateLimit(a, rule, now)).ok, false);
    // b is untouched by a's flood.
    assert.equal((await rateLimit(b, rule, now)).ok, true);
  });

  /*
   * Windows are aligned to absolute time, not to the caller's first request.
   * That is what lets the window start be part of the Firestore document id —
   * a new window is a new document, so nothing has to be reset or swept up on
   * the hot path. The cost is that a caller arriving late in a window gets a
   * short one, which is the right trade for a limiter that never needs a cron.
   */
  test("the window is aligned to the clock, not to the first request", async () => {
    const rule = { limit: 1, windowSeconds: 60 };
    const k = key();
    const aligned = 1_700_000_040_000; // exactly on a 60s boundary

    assert.equal((await rateLimit(k, rule, aligned + 1_000)).ok, true);
    assert.equal((await rateLimit(k, rule, aligned + 59_000)).ok, false);
    // A tick past the boundary is a fresh window, whoever the caller is.
    assert.equal((await rateLimit(k, rule, aligned + 60_000)).ok, true);
  });

  test("retryAfter counts down within the window, and is never zero on a refusal", async () => {
    const rule = { limit: 1, windowSeconds: 60 };
    const k = key();
    const aligned = 1_700_000_040_000;

    await rateLimit(k, rule, aligned);
    const early = await rateLimit(k, rule, aligned + 1_000);
    const late = await rateLimit(k, rule, aligned + 59_000);

    assert.equal(early.retryAfter, 59);
    assert.equal(late.retryAfter, 1);
    assert.ok(early.retryAfter > late.retryAfter);
  });
});

describe("the refusal", () => {
  test("is a 429 carrying Retry-After", async () => {
    const response = tooManyRequests({ ok: false, remaining: 0, retryAfter: 42 });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "42");
    assert.equal((await response.json()).ok, false);
  });

  /*
   * A refusal must not distinguish "too many attempts for this account" from
   * "too many for this address" — the difference tells an attacker which
   * accounts exist.
   */
  test("says the same thing whatever was limited", async () => {
    const byIp = await tooManyRequests({ ok: false, remaining: 0, retryAfter: 5 }).json();
    const byUid = await tooManyRequests({ ok: false, remaining: 0, retryAfter: 9 }).json();
    assert.deepEqual(byIp, byUid);
  });

  test("Retry-After is at least a second, so a client does not hot-loop", () => {
    const response = tooManyRequests({ ok: false, remaining: 0, retryAfter: 0 });
    assert.equal(response.headers.get("Retry-After"), "1");
  });
});

describe("the rules", () => {
  /*
   * Set against what a person does, not against a round number. A customer
   * places one order, maybe two; nobody subscribes to a newsletter four times.
   */
  test("every rule is a positive limit over a positive window", () => {
    for (const [name, rule] of Object.entries(RULES)) {
      assert.ok(rule.limit > 0, name);
      assert.ok(rule.windowSeconds > 0, name);
    }
  });

  test("sending messages is tighter than reading", () => {
    // Anything that sends an email or an SMS on the shop's behalf spends money
    // and reputation; a read only spends a query.
    const perSecond = (r: { limit: number; windowSeconds: number }) => r.limit / r.windowSeconds;
    assert.ok(perSecond(RULES.messaging) < perSecond(RULES.read));
    assert.ok(perSecond(RULES.session) < perSecond(RULES.read));
  });
});
