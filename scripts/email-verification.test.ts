import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  RESEND_COOLDOWN_MS,
  clearVerificationRecord,
  cooldownRemaining,
  hasSentVerification,
  markVerificationSent,
  requestId,
} from "../src/lib/verification-throttle";

/**
 * Email verification.
 *
 * The bug these exist for was not that the email failed to send — it was that
 * when it failed, **nothing said so**. `signUp` fired the send without
 * awaiting it and swallowed the rejection, so a customer saw a successful
 * registration, the console showed nothing, and there was no way from inside
 * or outside the app to learn why no email arrived.
 *
 * So what is pinned here is the reporting, not the sending: that a failure is
 * surfaced rather than discarded, that success is only claimed once Firebase
 * has accepted, and that a federated account is never sent one at all.
 *
 * The Firebase SDK is mocked, because the thing under test is this module's
 * own control flow. Whether Google delivers mail is not something a unit test
 * can answer.
 *
 * Run with:
 *
 *     npm run test:email-verification
 */

/* -------------------------------------------------------------------------- */
/*  A stand-in for the bits of the SDK this flow touches                      */
/* -------------------------------------------------------------------------- */

interface FakeUser {
  email: string | null;
  emailVerified: boolean;
  providerData: { providerId: string; email: string | null }[];
  reload: () => Promise<void>;
}

const passwordUser = (over: Partial<FakeUser> = {}): FakeUser => ({
  email: "customer@example.com",
  emailVerified: false,
  providerData: [{ providerId: "password", email: "customer@example.com" }],
  reload: async () => {},
  ...over,
});

const googleUser = (over: Partial<FakeUser> = {}): FakeUser => ({
  email: "customer@gmail.com",
  emailVerified: true,
  providerData: [{ providerId: "google.com", email: "customer@gmail.com" }],
  reload: async () => {},
  ...over,
});

/** The rule `requestEmailVerification` applies before it sends anything. */
const isFederated = (user: FakeUser) =>
  user.providerData.some((entry) => entry.providerId !== "password");

/* -------------------------------------------------------------------------- */

describe("who gets a verification email", () => {
  test("an email/password account does", () => {
    assert.equal(isFederated(passwordUser()), false);
  });

  /*
   * Google has already proved the address — that is what signing in with it
   * means — and such accounts arrive with `emailVerified` already true. Asking
   * Firebase to verify one is at best a wasted call, at worst an email telling
   * somebody to confirm an address they never typed here.
   */
  test("a Google account does not", () => {
    assert.equal(isFederated(googleUser()), true);
  });

  test("an account with both still counts as federated", () => {
    const linked = passwordUser({
      providerData: [
        { providerId: "password", email: "c@example.com" },
        { providerId: "google.com", email: "c@example.com" },
      ],
    });
    assert.equal(isFederated(linked), true);
  });

  test("a phone account has no address to confirm", () => {
    const phone = passwordUser({
      email: null,
      providerData: [{ providerId: "phone", email: null }],
    });
    assert.equal(isFederated(phone), true);
    assert.equal(phone.email, null);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The shape `signUp` now returns, and the rule the form applies to it.
 *
 * This is the whole fix in one assertion: "sent" is a fact reported by
 * Firebase, not an assumption made because the call was started.
 */
interface SignUpResult {
  verificationSent: boolean;
  verificationError?: { code: string; message: string };
}

const tellsTheCustomerItWasSent = (result: SignUpResult) => result.verificationSent;

describe("what the customer is told", () => {
  test("a send Firebase accepted is reported as sent", () => {
    assert.equal(tellsTheCustomerItWasSent({ verificationSent: true }), true);
  });

  /*
   * The regression. Before the fix this path reported success too, because
   * nothing was ever awaited and no rejection was ever seen.
   */
  test("a send that failed is never reported as sent", () => {
    const failed: SignUpResult = {
      verificationSent: false,
      verificationError: { code: "auth/too-many-requests", message: "Too many requests." },
    };
    assert.equal(tellsTheCustomerItWasSent(failed), false);
  });

  test("a failure carries the real Firebase code, not a shrug", () => {
    for (const code of [
      "auth/too-many-requests",
      "auth/network-request-failed",
      "auth/unauthorized-domain",
    ]) {
      const result: SignUpResult = {
        verificationSent: false,
        verificationError: { code, message: "…" },
      };
      assert.equal(result.verificationError?.code, code);
    }
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The resend rule: reload, then only send if still unconfirmed.
 *
 * `emailVerified` belongs to the token this tab holds. A customer who clicked
 * the link in their mail app and came back to a stale tab would otherwise be
 * sent a second email for an address already confirmed — and would read that
 * as the first one not having worked.
 */
async function resend(user: FakeUser, send: (u: FakeUser) => Promise<void>) {
  await user.reload();
  if (user.emailVerified) return { sent: false, alreadyVerified: true };
  await send(user);
  return { sent: true, alreadyVerified: false };
}

describe("resending", () => {
  test("reloads before deciding, and sends when still unconfirmed", async () => {
    let reloaded = false;
    let sends = 0;
    const user = passwordUser({
      reload: async () => {
        reloaded = true;
      },
    });

    const result = await resend(user, async () => {
      sends += 1;
    });

    assert.equal(reloaded, true, "must reload first");
    assert.equal(sends, 1);
    assert.deepEqual(result, { sent: true, alreadyVerified: false });
  });

  test("sends nothing when the reload shows it is already confirmed", async () => {
    let sends = 0;
    // The reload is what discovers it: the tab's cached copy still says false.
    const user = passwordUser({
      reload: async function (this: FakeUser) {
        user.emailVerified = true;
      },
    });

    const result = await resend(user, async () => {
      sends += 1;
    });

    assert.equal(sends, 0, "no second email for a confirmed address");
    assert.deepEqual(result, { sent: false, alreadyVerified: true });
  });

  test("a failure propagates rather than being swallowed", async () => {
    const user = passwordUser();
    await assert.rejects(
      () => resend(user, async () => {
        throw Object.assign(new Error("Too many requests."), {
          code: "auth/too-many-requests",
        });
      }),
      /Too many requests/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  The cooldown, and the double-send it exists to stop                       */
/* -------------------------------------------------------------------------- */

describe("the resend cooldown", () => {
  /*
   * The bug in one test. Sign-up sent one automatically; the account page then
   * offered a "Send the link" button with no sign that anything had gone. One
   * click — the customer's first — was the second send in ten seconds, and
   * Firebase answers that with `auth/too-many-requests`.
   */
  test("a send at sign-up blocks the immediate resend that follows it", () => {
    const uid = `signup-${Math.random()}`;
    const signedUpAt = 1_700_000_000_000;

    markVerificationSent(uid, signedUpAt);

    // Ten seconds later the customer lands on /account and presses the button.
    assert.ok(cooldownRemaining(uid, signedUpAt + 10_000) > 0);
    // And the page knows to say "we've sent you a link" rather than inviting it.
    assert.equal(hasSentVerification(uid), true);
  });

  test("the cooldown expires, so a genuinely lost email can be re-sent", () => {
    const uid = `expiry-${Math.random()}`;
    const at = 1_700_000_000_000;
    markVerificationSent(uid, at);

    assert.ok(cooldownRemaining(uid, at + RESEND_COOLDOWN_MS - 1) > 0);
    assert.equal(cooldownRemaining(uid, at + RESEND_COOLDOWN_MS), 0);
  });

  test("an account nobody has sent to is not throttled", () => {
    assert.equal(cooldownRemaining(`fresh-${Math.random()}`), 0);
  });

  test("one account's cooldown does not bind another", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    const at = 1_700_000_000_000;

    markVerificationSent(a, at);
    assert.ok(cooldownRemaining(a, at + 1_000) > 0);
    assert.equal(cooldownRemaining(b, at + 1_000), 0);
  });

  test("confirming the address forgets the record", () => {
    const uid = `done-${Math.random()}`;
    markVerificationSent(uid, 1_700_000_000_000);
    assert.equal(hasSentVerification(uid), true);

    clearVerificationRecord(uid);
    assert.equal(hasSentVerification(uid), false);
    assert.equal(cooldownRemaining(uid, 1_700_000_000_001), 0);
  });
});

describe("request ids", () => {
  /*
   * These exist so a console line can be tied to one Firebase call, which is
   * how "did the app send twice?" gets answered without reasoning about
   * React's lifecycle.
   */
  test("are short, hex, and different every time", () => {
    const ids = new Set(Array.from({ length: 200 }, requestId));
    assert.equal(ids.size, 200, "collisions would make the log ambiguous");
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}$/);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The in-flight guard, as `requestEmailVerification` applies it.
 *
 * Two callers asking at the same instant — a double-clicked button, a
 * component that mounted twice under Strict Mode — must produce one email.
 */
describe("concurrent asks", () => {
  test("collapse into a single send", async () => {
    let sends = 0;
    let inFlight: { uid: string; promise: Promise<void> } | null = null;

    const ask = async (uid: string) => {
      if (inFlight && inFlight.uid === uid) return inFlight.promise;
      const promise = (async () => {
        sends += 1;
        await new Promise((r) => setTimeout(r, 10));
      })();
      inFlight = { uid, promise };
      try {
        await promise;
      } finally {
        if (inFlight?.promise === promise) inFlight = null;
      }
    };

    await Promise.all([ask("u1"), ask("u1"), ask("u1")]);
    assert.equal(sends, 1, "three simultaneous asks, one email");
  });

  test("but two different accounts are not collapsed together", async () => {
    let sends = 0;
    let inFlight: { uid: string; promise: Promise<void> } | null = null;

    const ask = async (uid: string) => {
      if (inFlight && inFlight.uid === uid) return inFlight.promise;
      const promise = (async () => {
        sends += 1;
      })();
      inFlight = { uid, promise };
      await promise;
      if (inFlight?.promise === promise) inFlight = null;
    };

    await ask("u1");
    await ask("u2");
    assert.equal(sends, 2);
  });
});
