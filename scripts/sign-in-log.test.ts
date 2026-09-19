import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  MAX_ADDRESSES,
  isRecentlyRecorded,
  recordSignIn,
  type SeenAddress,
} from "../src/lib/security/sign-in-log";

/**
 * The addresses an account has signed in from.
 *
 * This is personal data on a real customer, so the bounding is not a detail:
 * an unbounded list is a movement history, and the difference between the two
 * is one missing `slice`. What is pinned here is that it stays small, that it
 * drops the *oldest* rather than whichever was last in the array, and that the
 * date an address was first seen is never rewritten.
 *
 * Run with:
 *
 *     npm run test:sign-in-log
 */

const HOUR = 3_600_000;
const at = (h: number) => 1_700_000_000_000 + h * HOUR;

describe("folding one sign-in into the list", () => {
  test("a first sign-in starts the list", () => {
    const list = recordSignIn(undefined, "203.0.113.9", at(0));
    assert.deepEqual(list, [{ ip: "203.0.113.9", first: at(0), last: at(0), count: 1 }]);
  });

  test("the same address again is counted, not duplicated", () => {
    let list = recordSignIn(undefined, "203.0.113.9", at(0));
    list = recordSignIn(list, "203.0.113.9", at(5));

    assert.equal(list.length, 1);
    assert.equal(list[0]!.count, 2);
    assert.equal(list[0]!.last, at(5));
  });

  /*
   * `first` is the only field that says how long an address has been
   * associated with the account. Overwriting it on every sign-in would erase
   * exactly the thing that distinguishes a long-standing home connection from
   * one that appeared this morning.
   */
  test("the first-seen date is never moved forward", () => {
    let list = recordSignIn(undefined, "203.0.113.9", at(0));
    list = recordSignIn(list, "203.0.113.9", at(100));
    assert.equal(list[0]!.first, at(0));
  });

  test("a second address is added alongside", () => {
    let list = recordSignIn(undefined, "203.0.113.9", at(0));
    list = recordSignIn(list, "198.51.100.4", at(1));

    assert.equal(list.length, 2);
    // Newest first.
    assert.equal(list[0]!.ip, "198.51.100.4");
    assert.equal(list[1]!.ip, "203.0.113.9");
  });

  test("the list is always newest first", () => {
    let list: SeenAddress[] = [];
    for (const [i, ip] of ["a", "b", "c"].entries()) {
      list = recordSignIn(list, `203.0.113.${i + 1}`, at(i));
      void ip;
    }
    // Signing in again from the oldest brings it back to the top.
    list = recordSignIn(list, "203.0.113.1", at(50));
    assert.equal(list[0]!.ip, "203.0.113.1");
  });
});

describe("it stays small", () => {
  test(`no more than ${MAX_ADDRESSES} addresses are kept`, () => {
    let list: SeenAddress[] = [];
    for (let i = 0; i < 20; i += 1) {
      list = recordSignIn(list, `203.0.113.${i}`, at(i));
    }
    assert.equal(list.length, MAX_ADDRESSES);
  });

  /*
   * The bug this exists for: cutting before sorting keeps whichever addresses
   * happened to sit at the front of the array, which means a stale one is kept
   * forever while the address somebody actually signs in from today is thrown
   * away every time.
   */
  test("the cut drops the oldest, not an arbitrary one", () => {
    let list: SeenAddress[] = [];
    for (let i = 0; i < 8; i += 1) {
      list = recordSignIn(list, `203.0.113.${i}`, at(i));
    }

    const kept = list.map((entry) => entry.ip);
    // The last five signed in from, newest first.
    assert.deepEqual(kept, [
      "203.0.113.7",
      "203.0.113.6",
      "203.0.113.5",
      "203.0.113.4",
      "203.0.113.3",
    ]);
    assert.ok(!kept.includes("203.0.113.0"), "the oldest is gone");
  });

  test("a long-stored list is trimmed on the next write, not left as it was", () => {
    // A row written before the cap existed, or by an older version.
    const oversized: SeenAddress[] = Array.from({ length: 12 }, (_, i) => ({
      ip: `198.51.100.${i}`,
      first: at(i),
      last: at(i),
      count: 1,
    }));

    const list = recordSignIn(oversized, "203.0.113.9", at(99));
    assert.equal(list.length, MAX_ADDRESSES);
    assert.equal(list[0]!.ip, "203.0.113.9");
  });

  test("rubbish in the stored array is dropped rather than carried", () => {
    const dirty = [
      { ip: "", first: 1, last: 1, count: 1 },
      null,
      undefined,
      { first: 1, last: 1, count: 1 },
      { ip: "203.0.113.9", first: at(0), last: at(0), count: 3 },
    ] as unknown as SeenAddress[];

    const list = recordSignIn(dirty, "198.51.100.4", at(1));
    assert.deepEqual(
      list.map((entry) => entry.ip),
      ["198.51.100.4", "203.0.113.9"],
    );
  });
});

describe("writes that would change nothing are skipped", () => {
  const QUIET = 6 * HOUR;

  test("the same address within the quiet window is already recorded", () => {
    const list = recordSignIn(undefined, "203.0.113.9", at(0));
    assert.equal(isRecentlyRecorded(list, "203.0.113.9", at(1), QUIET), true);
    assert.equal(isRecentlyRecorded(list, "203.0.113.9", at(5), QUIET), true);
  });

  test("past the window it is written again", () => {
    const list = recordSignIn(undefined, "203.0.113.9", at(0));
    assert.equal(isRecentlyRecorded(list, "203.0.113.9", at(7), QUIET), false);
  });

  /*
   * A new address is the interesting event — somebody signing in from
   * somewhere they never have before — so it is never quiet.
   */
  test("an address never seen before is never quiet", () => {
    const list = recordSignIn(undefined, "203.0.113.9", at(0));
    assert.equal(isRecentlyRecorded(list, "198.51.100.4", at(1), QUIET), false);
    assert.equal(isRecentlyRecorded(undefined, "203.0.113.9", at(0), QUIET), false);
    assert.equal(isRecentlyRecorded([], "203.0.113.9", at(0), QUIET), false);
  });
});

/*
 * The input is not mutated, which is what lets the route compare before and
 * after — and, more importantly, means a transaction retry does not fold the
 * same sign-in in twice.
 */
test("the stored array is not modified in place", () => {
  const original = recordSignIn(undefined, "203.0.113.9", at(0));
  const snapshot = JSON.parse(JSON.stringify(original));

  recordSignIn(original, "203.0.113.9", at(9));
  recordSignIn(original, "198.51.100.4", at(9));

  assert.deepEqual(original, snapshot);
});
