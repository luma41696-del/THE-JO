import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  MAX_MESSAGE,
  MAX_MESSAGES,
  MAX_OPEN_TICKETS,
  canAppend,
  canOpenTicket,
  cleanMessage,
  cleanSubject,
  millis,
  statusAfterCustomerMessage,
  subjectFrom,
  ticketReference,
  topicLabel,
} from "../src/lib/support";
import { TAX_PERCENT, TAX_RATE, taxLabel } from "../src/lib/pricing";
import { inviteWindowKey } from "../src/lib/gift";

/**
 * The parts of a support conversation, a tax label and a gift invitation that
 * can be decided without a database.
 *
 * Run with:
 *
 *     npm run test:support
 */

/* -------------------------------------------------------------------------- */
/*  Timestamps                                                                */
/* -------------------------------------------------------------------------- */

describe("millis", () => {
  test("reads a number, a Date and a Firestore Timestamp alike", () => {
    assert.equal(millis(1_700_000_000_000), 1_700_000_000_000);
    assert.equal(millis(new Date(1_700_000_000_000)), 1_700_000_000_000);

    // What the Admin SDK actually hands back.
    assert.equal(millis({ toMillis: () => 1_700_000_000_000 }), 1_700_000_000_000);
    // What a Timestamp looks like once it has been through JSON.
    assert.equal(millis({ seconds: 1_700_000_000, nanoseconds: 0 }), 1_700_000_000_000);
    assert.equal(millis({ _seconds: 1_700_000_000, _nanoseconds: 0 }), 1_700_000_000_000);
  });

  test("never returns NaN", () => {
    /*
     * The bug this exists to stop: the reply route computed
     * `Number(data.createdAt)` on a field written as a Date. That is NaN, and
     * `Math.round((now - NaN) / 60_000)` is NaN — so the first-response metric
     * the whole support screen is built around would have been written as NaN
     * and stayed that way.
     */
    for (const bad of [undefined, null, "not a date", {}, [], NaN, Infinity]) {
      const out = millis(bad);
      assert.equal(Number.isFinite(out), true, `millis(${String(bad)}) must be finite`);
      assert.equal(out, 0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Messages                                                                  */
/* -------------------------------------------------------------------------- */

describe("a customer's message", () => {
  test("is trimmed and capped, not rewritten", () => {
    assert.equal(cleanMessage("  where is my order?  "), "where is my order?");
    // Windows line endings normalise; the customer's own line breaks survive.
    assert.equal(cleanMessage("one\r\ntwo"), "one\ntwo");
    assert.equal(cleanMessage("a".repeat(MAX_MESSAGE + 500)).length, MAX_MESSAGE);
    assert.equal(cleanMessage(undefined), "");
    assert.equal(cleanMessage("   "), "");
  });

  test("a subject collapses whitespace; a message does not", () => {
    assert.equal(cleanSubject("  too    many   spaces "), "too many spaces");
    // A message is prose. Collapsing its newlines would reflow what they wrote.
    assert.equal(cleanMessage("line one\n\nline two"), "line one\n\nline two");
  });
});

describe("subjectFrom", () => {
  test("uses the first line when there is one worth using", () => {
    assert.equal(
      subjectFrom("My parcel never arrived\nIt says delivered", "delivery", "en"),
      "My parcel never arrived",
    );
  });

  test("truncates a first line that is really a paragraph", () => {
    const long = "x".repeat(200);
    const subject = subjectFrom(long, "other", "en");
    assert.equal(subject.length, 70); // 69 characters plus the ellipsis
    assert.equal(subject.endsWith("…"), true);
  });

  test("falls back to the topic, in the customer's language", () => {
    assert.equal(subjectFrom("hi", "returns", "en"), topicLabel("returns", "en"));
    assert.equal(subjectFrom("", "returns", "ar"), topicLabel("returns", "ar"));
    // Arabic must not fall through to an English label.
    assert.notEqual(topicLabel("returns", "ar"), topicLabel("returns", "en"));
  });
});

describe("conversation limits", () => {
  test("a sixth open thread is refused, bilingually", () => {
    assert.equal(canOpenTicket(0).ok, true);
    assert.equal(canOpenTicket(MAX_OPEN_TICKETS - 1).ok, true);

    const refused = canOpenTicket(MAX_OPEN_TICKETS);
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "too-many-open");
    assert.equal(refused.message.ar.length > 0, true);
    assert.notEqual(refused.message.ar, refused.message.en);
  });

  test("a thread stops accepting messages before it becomes unreadable", () => {
    assert.equal(canAppend(MAX_MESSAGES - 1).ok, true);
    assert.equal(canAppend(MAX_MESSAGES).ok, false);
  });

  test("a customer's reply always reopens the thread", () => {
    /*
     * Including from `resolved` and `closed`. Someone replying to a thread
     * support considered finished is the clearest possible evidence that it
     * was not, and making them file a second ticket to say so throws away the
     * history that explains the problem.
     */
    assert.equal(statusAfterCustomerMessage(), "open");
  });
});

describe("ticketReference", () => {
  test("is stable for a document and readable out loud", () => {
    const first = ticketReference("abc123");
    assert.equal(first, ticketReference("abc123"));
    assert.match(first, /^SUP-[A-HJ-NP-Z2-9]{5}$/);
    // I, O, 0 and 1 are excluded so a reference survives being read down a
    // phone line.
    assert.equal(/[IO01]/.test(first.slice(4)), false);
  });

  test("different documents get different references", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(ticketReference(`doc-${i}`));
    // Not a uniqueness guarantee — it is a 32^5 space and the id is the real
    // key — but a hash that collided constantly would be worthless as a
    // reference, and this would catch it.
    assert.equal(seen.size > 490, true, `only ${seen.size} distinct references from 500 ids`);
  });
});

/* -------------------------------------------------------------------------- */
/*  The tax the customer is told about                                        */
/* -------------------------------------------------------------------------- */

describe("the tax label", () => {
  test("says the rate that is actually charged", () => {
    /*
     * The bug: `TAX_RATE` was 0.16, and the cart and the checkout both printed
     * "VAT (15%)" above a figure computed at 16%. A customer checking the
     * summary by hand would have found the shop's own label disagreeing with
     * the shop's own arithmetic.
     */
    assert.equal(TAX_PERCENT, Math.round(TAX_RATE * 100));
    assert.equal(taxLabel("en").includes(String(TAX_PERCENT)), true);
    assert.equal(taxLabel("ar").includes(String(TAX_PERCENT)), true);
  });

  test("is Jordan's general sales tax, and says 16", () => {
    // Pinned deliberately: this is the number on every invoice the shop issues.
    assert.equal(TAX_RATE, 0.16);
    assert.equal(taxLabel("en"), "VAT (16%)");
    assert.equal(taxLabel("ar"), "ضريبة المبيعات (16٪)");
  });

  test("no label anywhere says 15", () => {
    assert.equal(taxLabel("en").includes("15"), false);
    assert.equal(taxLabel("ar").includes("15"), false);
  });
});

/* -------------------------------------------------------------------------- */
/*  The gift invitation                                                       */
/* -------------------------------------------------------------------------- */

describe("inviteWindowKey", () => {
  test("one key per turn, so dismissing sticks until the turn changes", () => {
    const first = inviteWindowKey("spring", 0);
    assert.equal(first, inviteWindowKey("spring", 0));

    // Playing changes the turn, so a later eligible moment can invite again.
    assert.notEqual(first, inviteWindowKey("spring", 1));
    // A new campaign is always a new turn.
    assert.notEqual(first, inviteWindowKey("summer", 0));
  });

  test("is namespaced, so it cannot collide with other stored keys", () => {
    assert.equal(inviteWindowKey("spring", 0).startsWith("ns.gift.invite:"), true);
  });
});
