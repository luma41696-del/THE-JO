import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  ALWAYS_OPEN,
  closureCopy,
  currentState,
  isAlwaysOpen,
  retryAfterSeconds,
  sanitiseStorefront,
  type StorefrontSettings,
} from "../src/lib/storefront-state";

/**
 * Closing the shop.
 *
 * Two failures are worth more than the rest, and both are here:
 *
 *  1. **A closure that takes the admin with it.** There is no second way in.
 *     Whatever is stored, `/admin` and the routes that sign somebody into it
 *     must stay reachable.
 *  2. **A closure that never lifts.** Twenty minutes of stock-taking becomes
 *     two dark days because nobody came back. The reopening time is what
 *     prevents it, and it has to work by time passing rather than by anything
 *     running.
 *
 * Run with:
 *
 *     npm run test:storefront-state
 */

const settings = (over: Partial<StorefrontSettings> = {}): StorefrontSettings => ({
  state: "closed",
  reason: "maintenance",
  ...over,
});

const HOUR = 3_600_000;
const now = 1_700_000_000_000;

/* -------------------------------------------------------------------------- */
/*  The lockout                                                               */
/* -------------------------------------------------------------------------- */

describe("a closure can never close the admin", () => {
  test("the admin and the doors into it are always open", () => {
    for (const path of [
      "/admin",
      "/admin/settings",
      "/admin/products/123",
      "/api/admin/storefront",
      "/api/auth/session",
      "/api/auth/seen",
    ]) {
      assert.equal(isAlwaysOpen(path), true, path);
    }
  });

  test("the storefront is not", () => {
    for (const path of ["/", "/ar", "/ar/shop", "/api/checkout", "/api/reviews", "/en/product/x"]) {
      assert.equal(isAlwaysOpen(path), false, path);
    }
  });

  /*
   * Prefix matching, not `startsWith` alone: a marketing page at
   * `/administrator` or `/admin-guide` is storefront and must close with it.
   */
  test("a path that merely begins with the same letters is not the admin", () => {
    assert.equal(isAlwaysOpen("/administrator"), false);
    assert.equal(isAlwaysOpen("/admin-guide"), false);
    assert.equal(isAlwaysOpen("/api/authentic-goods"), false);
  });

  test("the exempt list is not empty, whatever else changes", () => {
    // If somebody ever trims this list to nothing, the shop becomes
    // unreopenable the next time it is closed.
    assert.ok(ALWAYS_OPEN.includes("/admin"));
    assert.ok(ALWAYS_OPEN.includes("/api/auth"));
  });
});

/* -------------------------------------------------------------------------- */
/*  Lifting by itself                                                         */
/* -------------------------------------------------------------------------- */

describe("a closure with a time on it lifts by itself", () => {
  test("before the time it is closed", () => {
    assert.equal(currentState(settings({ reopensAt: now + HOUR }), now), "closed");
  });

  /*
   * By time passing, not by a job. A job that fails leaves the shop shut with
   * nothing to notice it.
   */
  test("at and after the time it is open", () => {
    assert.equal(currentState(settings({ reopensAt: now }), now), "open");
    assert.equal(currentState(settings({ reopensAt: now - 1 }), now), "open");
    assert.equal(currentState(settings({ reopensAt: now - HOUR * 40 }), now), "open");
  });

  test("with no time on it, it stays until somebody lifts it", () => {
    assert.equal(currentState(settings(), now), "closed");
    assert.equal(currentState(settings(), now + HOUR * 1000), "closed");
  });

  test("browsing-only expires the same way", () => {
    assert.equal(currentState(settings({ state: "browse-only", reopensAt: now - 1 }), now), "open");
    assert.equal(
      currentState(settings({ state: "browse-only", reopensAt: now + HOUR }), now),
      "browse-only",
    );
  });

  test("open is open whatever else is set", () => {
    assert.equal(currentState(settings({ state: "open", reopensAt: now + HOUR }), now), "open");
  });
});

describe("what a crawler is told to do", () => {
  test("it is given the time until the shop reopens", () => {
    assert.equal(retryAfterSeconds(settings({ reopensAt: now + HOUR }), now), 3600);
  });

  test("with nothing scheduled it is an hour", () => {
    assert.equal(retryAfterSeconds(settings(), now), 3600);
  });

  /*
   * Never zero or negative. A `Retry-After: 0` invites a crawler to hammer a
   * shop that is deliberately down.
   */
  test("it is never less than a minute", () => {
    assert.equal(retryAfterSeconds(settings({ reopensAt: now + 1000 }), now), 60);
    assert.equal(retryAfterSeconds(settings({ reopensAt: now - HOUR }), now), 60);
  });
});

/* -------------------------------------------------------------------------- */
/*  What is stored                                                            */
/* -------------------------------------------------------------------------- */

describe("what gets stored is bounded", () => {
  test("an unknown state or reason falls back rather than breaking", () => {
    // A nonsense state must not become a closure nobody asked for.
    assert.equal(sanitiseStorefront({ state: "banana" }).state, "open");
    assert.equal(sanitiseStorefront({}).state, "open");
    assert.equal(sanitiseStorefront(null).state, "open");
    assert.equal(sanitiseStorefront({ state: "closed", reason: "nope" }).reason, "maintenance");
  });

  test("every real state and reason survives", () => {
    for (const state of ["open", "browse-only", "closed"] as const) {
      assert.equal(sanitiseStorefront({ state }).state, state);
    }
    for (const reason of ["maintenance", "restocking", "holiday", "busy", "stocktake", "custom"] as const) {
      assert.equal(sanitiseStorefront({ state: "closed", reason }).reason, reason);
    }
  });

  /*
   * Writing drops a time already in the past: storing it would leave the
   * document saying closed while the shop resolved to open.
   */
  test("writing drops a reopening time already in the past", () => {
    const past = sanitiseStorefront(
      { state: "closed", reopensAt: Date.now() - 1000 },
      { dropExpired: true },
    );
    assert.equal(past.reopensAt, undefined);
    assert.ok(
      sanitiseStorefront({ state: "closed", reopensAt: Date.now() + HOUR }, { dropExpired: true })
        .reopensAt,
    );
  });

  /*
   * Reading must keep it, and this is the one that was actually broken.
   *
   * The read path sanitised first, which dropped the expired time — so
   * `currentState` never saw the thing it exists to act on and the closure
   * stayed up forever. A closure set to lift a minute ago was still serving
   * 503 to every visitor.
   */
  test("reading keeps an expired time, so the closure can lift", () => {
    const stored = { state: "closed" as const, reason: "maintenance" as const, reopensAt: Date.now() - 60_000 };

    const read = sanitiseStorefront(stored);
    assert.equal(read.reopensAt, stored.reopensAt, "the time survives the read");
    assert.equal(currentState(read), "open", "and the shop is therefore open");

    // Had it been dropped, the state would be stuck.
    const dropped = sanitiseStorefront(stored, { dropExpired: true });
    assert.equal(currentState(dropped), "closed");
  });

  test("a message is trimmed and capped", () => {
    const long = sanitiseStorefront({
      state: "closed",
      message: { en: "x".repeat(900), ar: "  spaced  " },
    });
    assert.equal(long.message?.en.length, 400);
    assert.equal(long.message?.ar, "spaced");
  });

  test("an empty message is not stored at all", () => {
    assert.equal(sanitiseStorefront({ state: "closed", message: { en: "  ", ar: "" } }).message, undefined);
  });
});

describe("what the visitor reads", () => {
  test("each reason has its own wording in both languages", () => {
    for (const reason of ["maintenance", "restocking", "holiday", "busy", "stocktake"] as const) {
      const ar = closureCopy(settings({ reason }), "ar");
      const en = closureCopy(settings({ reason }), "en");
      assert.ok(ar.heading.length > 0 && ar.body.length > 0, reason);
      assert.match(ar.heading, /[؀-ۿ]/, `${reason} is in Arabic`);
      assert.doesNotMatch(en.heading, /[؀-ۿ]/, `${reason} is in English`);
      assert.notEqual(ar.body, en.body);
    }
  });

  test("custom wording replaces the body and leaves the heading", () => {
    const custom = closureCopy(
      settings({ reason: "holiday", message: { en: "Back on Sunday.", ar: "نعود الأحد." } }),
      "en",
    );
    assert.equal(custom.body, "Back on Sunday.");
    // The heading keeps its shape — a custom heading too would let the whole
    // page become one undifferentiated paragraph.
    assert.equal(custom.heading, closureCopy(settings({ reason: "holiday" }), "en").heading);
  });

  test("an empty custom message falls back to the standard wording", () => {
    const preset = closureCopy(settings({ reason: "busy" }), "ar");
    const blank = closureCopy(settings({ reason: "busy", message: { en: "", ar: "   " } }), "ar");
    assert.equal(blank.body, preset.body);
  });
});
