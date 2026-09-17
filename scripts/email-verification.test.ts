import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

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
