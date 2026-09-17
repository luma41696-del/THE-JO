import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

/**
 * The signature on an unsubscribe link.
 *
 * What this protects: without it, `?e=someone@else.com` in the address bar
 * unsubscribes anybody. That is a small piece of vandalism which stays
 * invisible until a customer asks why the shop went quiet — there is no bounce,
 * no error, and nothing in a log that looks wrong.
 *
 * The module reads `CAMPAIGN_SECRET` at call time rather than at import, so
 * each test sets it and the refusal case can clear it.
 *
 * Run with:
 *
 *     npm run test:unsubscribe-token
 */

const SECRET = "test-secret-at-least-24-characters-long";

/*
 * The builder refuses a link that is not https, so a link built against the
 * `http://localhost:3000` fallback is not a sendable one. Production sets this;
 * the tests set it too, and one below clears it to pin that refusal.
 */
process.env.NEXT_PUBLIC_SITE_URL = "https://netsale.shop";

async function load(secret?: string) {
  if (secret === undefined) delete process.env.CAMPAIGN_SECRET;
  else process.env.CAMPAIGN_SECRET = secret;
  // Fresh each time: the query string busts the module cache so a changed
  // secret is actually picked up.
  return import(`../src/lib/email/unsubscribe?${Math.random()}`);
}

describe("an unsubscribe link cannot be forged", () => {
  test("a token made for one address does not work for another", async () => {
    const { unsubscribeToken, verifyUnsubscribe } = await load(SECRET);

    const mine = unsubscribeToken("lina@example.com")!;
    assert.ok(mine);
    assert.equal(verifyUnsubscribe("lina@example.com", mine), true);
    assert.equal(verifyUnsubscribe("someone@else.com", mine), false);
  });

  test("a tampered token is refused", async () => {
    const { unsubscribeToken, verifyUnsubscribe } = await load(SECRET);
    const token = unsubscribeToken("lina@example.com")!;

    for (const bad of [
      token.slice(0, -1),
      token + "x",
      token.replace(/^./, (c: string) => (c === "a" ? "b" : "a")),
      "",
      "not-a-token",
    ]) {
      assert.equal(verifyUnsubscribe("lina@example.com", bad), false, JSON.stringify(bad));
    }
  });

  test("the same address in different casing is one subscription", async () => {
    const { unsubscribeToken, verifyUnsubscribe } = await load(SECRET);

    const token = unsubscribeToken("Lina@Example.COM")!;
    assert.equal(unsubscribeToken("lina@example.com"), token);
    assert.equal(verifyUnsubscribe("  LINA@example.com  ", token), true);
  });

  test("a different secret produces a token this shop refuses", async () => {
    const mine = await load(SECRET);
    const token = mine.unsubscribeToken("lina@example.com")!;

    const other = await load("a-completely-different-secret-value-xyz");
    assert.equal(other.verifyUnsubscribe("lina@example.com", token), false);
  });
});

describe("without a usable secret, no campaign can be built", () => {
  test("nothing is minted when the variable is unset", async () => {
    const { unsubscribeToken, unsubscribeLink, unsubscribeStatus } = await load(undefined);

    assert.equal(unsubscribeToken("lina@example.com"), undefined);
    assert.equal(unsubscribeLink("lina@example.com"), undefined);
    assert.equal(unsubscribeStatus().ready, false);
    assert.deepEqual(unsubscribeStatus().missing, ["CAMPAIGN_SECRET"]);
  });

  /*
   * A deployment still on the localhost fallback cannot build a campaign,
   * because the builder refuses a link that is not https. Named up front so it
   * does not surface as every recipient failing for an unexplained reason.
   */
  test("a non-https site URL is reported as missing too", async () => {
    const previous = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    try {
      const { unsubscribeStatus } = await load(SECRET);
      assert.equal(unsubscribeStatus().ready, false);
      assert.match(unsubscribeStatus().missing.join(" "), /NEXT_PUBLIC_SITE_URL/);
    } finally {
      process.env.NEXT_PUBLIC_SITE_URL = previous;
    }
  });

  /*
   * A short secret is refused rather than accepted quietly. Somebody setting
   * this to "changeme" should find out now, not when a forged link works.
   */
  test("a short secret is treated as no secret", async () => {
    const { unsubscribeToken, unsubscribeStatus } = await load("changeme");
    assert.equal(unsubscribeToken("lina@example.com"), undefined);
    assert.equal(unsubscribeStatus().ready, false);
  });

  test("a campaign email refuses to build without one", async () => {
    await load(undefined);
    const { unsubscribeLink } = await load(undefined);
    const { buildCampaignEmail } = await import("../src/lib/email/campaign-email");

    const email = buildCampaignEmail(
      { subject: "s", heading: "h", body: "b", locale: "en" },
      { email: "lina@example.com", unsubscribeUrl: unsubscribeLink("lina@example.com") },
    );
    assert.equal(email, undefined, "no link, nothing to send");
  });
});

describe("the link itself", () => {
  test("carries the address and the token, both encoded", async () => {
    const { unsubscribeLink, unsubscribeToken } = await load(SECRET);

    const link = unsubscribeLink("lina+news@example.com", "ar")!;
    const url = new URL(link);

    assert.equal(url.protocol, "https:");
    assert.match(url.pathname, /\/ar\/unsubscribe$/);
    // `+` in an address must survive the round trip — decoded from a query
    // string it would otherwise become a space and match nobody.
    assert.equal(url.searchParams.get("e"), "lina+news@example.com");
    assert.equal(url.searchParams.get("t"), unsubscribeToken("lina+news@example.com"));
  });

  test("uses the locale it was asked for", async () => {
    const { unsubscribeLink } = await load(SECRET);
    assert.match(unsubscribeLink("a@b.com", "en")!, /\/en\/unsubscribe/);
    assert.match(unsubscribeLink("a@b.com", "ar")!, /\/ar\/unsubscribe/);
  });
});
