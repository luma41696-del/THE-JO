import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  DAILY_LIMIT,
  MONTHLY_LIMIT,
  STALE_RUNNING_MS,
  canStart,
  expiredJobs,
  isActive,
  retriable,
  wasBilled,
} from "../src/lib/fitting/quota";
import { MAX_ATTEMPTS, type TryOnJob } from "../src/lib/fitting/provider";

/**
 * The spending control on the one feature that costs money per use.
 *
 * Every other thing in this shop is free to run. A try-on is roughly USD
 * 0.04–0.10 to somebody else's account, so a retry loop is not a slow page, it
 * is an invoice — and these are the rules that stop it.
 *
 * The rule tested hardest is the one that goes the other way: a call the shop
 * refused before spending anything must not come off the customer's
 * allowance.
 *
 * Run with:
 *
 *     npm run test:fitting-quota
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 16);

function job(over: Partial<TryOnJob> = {}): TryOnJob {
  return {
    id: "j1",
    uid: "u1",
    productId: "p1",
    state: "done",
    attempts: 1,
    createdAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    expiresAt: NOW + 30 * DAY,
    ...over,
  };
}

const start = (over: Partial<Parameters<typeof canStart>[0]> = {}) =>
  canStart({ jobs: [], consented: true, providerConfigured: true, now: NOW, ...over });

/* -------------------------------------------------------------------------- */
/*  What counts as a call                                                     */
/* -------------------------------------------------------------------------- */

describe("wasBilled", () => {
  test("a finished try-on cost money", () => {
    assert.equal(wasBilled(job({ state: "done" })), true);
  });

  test("an attempt with no provider configured cost nothing", () => {
    /*
     * The one that matters in practice. With the provider off, every attempt
     * lands here — and without this rule a customer would burn a whole month's
     * allowance discovering the feature is not switched on.
     */
    assert.equal(wasBilled(job({ state: "not-configured" })), false);
  });

  test("a failure before the call went out cost nothing", () => {
    // These come from `callProvider`'s own pre-flight, which runs before the
    // OAuth exchange and before any bytes are sent.
    for (const error of [
      "No try-on provider is configured (missing VTO_PROJECT_ID).",
      "A try-on job needs the account it belongs to.",
      "That image is too large.",
      "That is not an accepted image type.",
    ]) {
      assert.equal(wasBilled(job({ state: "failed", error })), false, error);
    }
  });

  test("a failure after the call went out did cost money", () => {
    // The model was invoked and answered badly; that is still an invoice line.
    assert.equal(
      wasBilled(job({ state: "failed", error: "The model returned no image." })),
      true,
    );
  });

  test("a queued job has not cost anything yet", () => {
    assert.equal(wasBilled(job({ state: "queued" })), false);
  });
});

/* -------------------------------------------------------------------------- */
/*  One at a time                                                             */
/* -------------------------------------------------------------------------- */

describe("isActive", () => {
  test("a job in flight holds the slot", () => {
    assert.equal(isActive(job({ state: "running", updatedAt: NOW - 1000 }), NOW), true);
    assert.equal(isActive(job({ state: "queued", updatedAt: NOW - 1000 }), NOW), true);
  });

  test("a finished job does not", () => {
    assert.equal(isActive(job({ state: "done" }), NOW), false);
  });

  test("a job stuck running is presumed dead and releases the slot", () => {
    /*
     * The process that owned it is gone. Without this one crashed request
     * locks the customer out of the feature permanently, and the only fix is a
     * support ticket.
     */
    const stuck = job({ state: "running", updatedAt: NOW - STALE_RUNNING_MS - 1000 });
    assert.equal(isActive(stuck, NOW), false);
  });
});

/* -------------------------------------------------------------------------- */
/*  May I start?                                                              */
/* -------------------------------------------------------------------------- */

describe("canStart", () => {
  test("a fresh account may", () => {
    const verdict = start();
    assert.equal(verdict.ok, true);
    assert.equal(verdict.remainingToday, DAILY_LIMIT);
  });

  test("consent is checked before anything else", () => {
    /*
     * No amount of remaining quota makes it acceptable to send a picture of
     * somebody's body to an external model they did not agree to.
     */
    const verdict = start({ consented: false });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "no-consent");
    assert.equal(verdict.message.ar.length > 0, true);
  });

  test("consent is checked even when the provider is off", () => {
    const verdict = canStart({
      jobs: [],
      consented: false,
      providerConfigured: false,
      now: NOW,
    });
    assert.equal(verdict.reason, "no-consent");
  });

  test("an unconfigured provider is said before the photo, not after", () => {
    // Letting somebody upload a photograph of themselves to find out the
    // feature is off is the worst possible order to do it in.
    const verdict = start({ providerConfigured: false });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "not-configured");
  });

  test("one try-on at a time", () => {
    // A double-tapped button, or a page left open polling, must not become two
    // paid calls for one intention.
    const verdict = start({ jobs: [job({ state: "running", updatedAt: NOW - 1000 })] });
    assert.equal(verdict.reason, "already-running");
  });

  test("the daily allowance runs out", () => {
    const used = Array.from({ length: DAILY_LIMIT }, (_, i) =>
      job({ id: `d${i}`, state: "done", createdAt: NOW - 1000 }),
    );
    const verdict = start({ jobs: used });
    assert.equal(verdict.reason, "daily-limit");
    assert.equal(verdict.remainingToday, 0);
  });

  test("and comes back the next day", () => {
    const yesterday = Array.from({ length: DAILY_LIMIT }, (_, i) =>
      job({ id: `d${i}`, state: "done", createdAt: NOW - DAY - 1000 }),
    );
    const verdict = start({ jobs: yesterday });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.remainingToday, DAILY_LIMIT);
  });

  test("the monthly allowance holds even when today's does not", () => {
    // Spread across the month so no single day trips the daily limit.
    const spread = Array.from({ length: MONTHLY_LIMIT }, (_, i) =>
      job({ id: `m${i}`, state: "done", createdAt: NOW - (i + 1) * (DAY / 2) - 1000 }),
    );
    const verdict = start({ jobs: spread });
    assert.equal(verdict.ok, false);
    assert.equal(["daily-limit", "monthly-limit"].includes(verdict.reason!), true);
  });

  test("attempts that cost nothing do not come off the allowance", () => {
    /*
     * The fairness rule. Fifty refused attempts against an unconfigured
     * provider leave the customer's allowance untouched, because the shop
     * spent nothing on any of them.
     */
    const refused = Array.from({ length: 50 }, (_, i) =>
      job({ id: `n${i}`, state: "not-configured", createdAt: NOW - 1000 }),
    );
    const verdict = start({ jobs: refused });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.remainingToday, DAILY_LIMIT);
  });

  test("the remaining count is reported even on a refusal", () => {
    // The panel shows it before the button is pressed, so the limit is never
    // a surprise at submit time.
    const verdict = start({ consented: false });
    assert.equal(typeof verdict.remainingToday, "number");
    assert.equal(typeof verdict.remainingMonth, "number");
  });

  test("every refusal is bilingual", () => {
    const cases = [
      start({ consented: false }),
      start({ providerConfigured: false }),
      start({ jobs: [job({ state: "running", updatedAt: NOW })] }),
      start({ jobs: Array.from({ length: DAILY_LIMIT }, (_, i) => job({ id: `x${i}`, createdAt: NOW })) }),
    ];
    for (const verdict of cases) {
      assert.equal(verdict.ok, false);
      assert.equal(verdict.message.en.length > 0, true);
      assert.equal(verdict.message.ar.length > 0, true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Keeping the promise about deletion                                        */
/* -------------------------------------------------------------------------- */

describe("expiredJobs", () => {
  test("finds results past their retention date", () => {
    // The consent text promises the image is not kept indefinitely, so
    // something has to actually remove it.
    const old = job({ id: "old", expiresAt: NOW - DAY });
    const fresh = job({ id: "fresh", expiresAt: NOW + DAY });
    assert.deepEqual(expiredJobs([old, fresh], NOW).map((j) => j.id), ["old"]);
  });

  test("a job with no expiry is never swept by accident", () => {
    assert.deepEqual(expiredJobs([job({ expiresAt: 0 })], NOW), []);
  });
});

describe("retriable", () => {
  test("a failure under the cap may be tried again", () => {
    assert.equal(retriable({ state: "failed", attempts: 1 }), true);
  });

  test("the cap is final", () => {
    assert.equal(retriable({ state: "failed", attempts: MAX_ATTEMPTS }), false);
  });

  test("nothing but a failure is retried", () => {
    assert.equal(retriable({ state: "done", attempts: 1 }), false);
    assert.equal(retriable({ state: "not-configured", attempts: 1 }), false);
  });
});
