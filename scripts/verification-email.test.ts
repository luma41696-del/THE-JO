import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { buildVerificationEmail, escapeHtml } from "../src/lib/email/verification-email";

/**
 * The branded verification email.
 *
 * The template is pure, so it can be asserted on rather than inspected by
 * sending one to yourself — which is how email bugs normally get found, three
 * weeks after the customer stopped being able to sign up.
 *
 * Run with:
 *
 *     npm run test:verification-email
 */

const LINK =
  "https://the-jo-shop.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=ABC123&apiKey=K";

describe("escaping", () => {
  /*
   * A display name is attacker-controlled: anybody can register as
   * `<img src=x onerror=…>`, and it lands in HTML that other software renders.
   */
  test("closes every hole a name could open", () => {
    assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
    assert.equal(escapeHtml('" onmouseover="x'), "&quot; onmouseover=&quot;x");
    assert.equal(escapeHtml("it's"), "it&#39;s");
    assert.equal(escapeHtml("a & b"), "a &amp; b");
  });

  test("escapes the ampersand first, so nothing is double-encoded wrongly", () => {
    // `&lt;` must come out as `&amp;lt;`, not `&lt;`.
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  });

  test("a hostile display name cannot inject markup or an attribute", () => {
    const email = buildVerificationEmail({
      name: '<img src=x onerror="alert(1)">',
      link: LINK,
    })!;
    assert.ok(!email.html.includes("<img src=x"), "no raw tag");
    assert.ok(!email.html.includes('onerror="alert(1)"'), "no live attribute");
    assert.ok(email.html.includes("&lt;img"), "escaped instead");
  });
});

describe("the link", () => {
  test("the CTA points at the Firebase-generated URL", () => {
    const email = buildVerificationEmail({ name: "Lina", link: LINK })!;
    // Escaped in the href, because the URL carries `&` between parameters.
    assert.ok(email.html.includes("mode=verifyEmail"), "the action link is the href");
    assert.ok(email.html.includes("&amp;oobCode=ABC123"), "ampersands escaped in the attribute");
  });

  test("it appears again as copyable text, for clients that eat buttons", () => {
    const email = buildVerificationEmail({ name: "Lina", link: LINK })!;
    const occurrences = email.html.split("oobCode=ABC123").length - 1;
    assert.equal(occurrences, 2, "once as the href, once visible");
  });

  /*
   * Refused rather than rendered. A button whose href is `javascript:` or a
   * plain-http link is worse than no email: it is the shop's own message
   * taking a customer somewhere the shop did not choose.
   */
  test("anything that is not https is refused outright", () => {
    for (const bad of [
      "javascript:alert(1)",
      "http://netsale.shop/verify",
      "data:text/html,<script>",
      "not a url",
      "",
    ]) {
      assert.equal(buildVerificationEmail({ name: "Lina", link: bad }), undefined, bad);
    }
  });
});

describe("what the customer reads", () => {
  test("Arabic by default, and right-to-left", () => {
    const email = buildVerificationEmail({ name: "لينا", link: LINK })!;
    assert.match(email.html, /<html lang="ar" dir="rtl"/);
    assert.ok(email.html.includes("فعّل حسابك"));
    assert.ok(email.html.includes("تأكيد البريد الإلكتروني"));
    assert.ok(email.html.includes("مرحباً لينا،"));
    assert.ok(email.html.includes("شكراً لإنشاء حسابك في Net Sale"));
  });

  test("the security note and the footer are both there", () => {
    const email = buildVerificationEmail({ name: "لينا", link: LINK })!;
    assert.ok(email.html.includes("سينتهي رابط التحقق لأسباب أمنية"));
    assert.ok(email.html.includes("Net Sale"));
    assert.ok(email.html.includes("netsale.shop"));
  });

  test("English is available and flips the direction", () => {
    const email = buildVerificationEmail({ name: "Lina", link: LINK, locale: "en" })!;
    assert.match(email.html, /<html lang="en" dir="ltr"/);
    assert.ok(email.html.includes("Confirm your account"));
  });

  /*
   * A customer may have no display name at all. "مرحباً ،" with a dangling
   * comma is worse than a plain hello.
   */
  test("a missing name does not leave a dangling comma", () => {
    const email = buildVerificationEmail({ name: "   ", link: LINK })!;
    assert.ok(email.html.includes("مرحباً،"));
    assert.ok(!email.html.includes("مرحباً ،"));
  });
});

describe("the shape an email client needs", () => {
  test("carries a plain-text alternative with the link in it", () => {
    const email = buildVerificationEmail({ name: "Lina", link: LINK })!;
    assert.ok(email.text.length > 0);
    assert.ok(email.text.includes(LINK), "the link must be reachable without HTML");
    assert.ok(!email.text.includes("<"), "no markup in the text part");
  });

  /*
   * Gmail drops `<head><style>` on any message it clips, and Outlook renders
   * through Word. Inline styles and tables are the only layout that survives
   * both.
   */
  test("styles are inline, not in a stylesheet", () => {
    const email = buildVerificationEmail({ name: "Lina", link: LINK })!;
    assert.ok(!/<style[\s>]/i.test(email.html), "no <style> block to be stripped");
    assert.ok(email.html.includes('style="'), "inline instead");
    assert.ok(email.html.includes("<table"), "table layout");
  });

  test("declares a viewport, so a phone does not render it at desktop width", () => {
    const email = buildVerificationEmail({ name: "Lina", link: LINK })!;
    assert.ok(email.html.includes('name="viewport"'));
    assert.ok(email.html.includes("max-width:520px"));
  });

  test("uses the brand's colours", () => {
    const email = buildVerificationEmail({ name: "Lina", link: LINK })!;
    assert.ok(email.html.includes("#f5f1e6"), "warm cream ground");
    assert.ok(email.html.includes("#d21f26"), "Net Sale red on the button");
  });

  test("the subject says what it is", () => {
    assert.equal(
      buildVerificationEmail({ name: "Lina", link: LINK })!.subject,
      "فعّل حسابك في نت سيل",
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  The redirect a confirmed customer lands on                                */
/* -------------------------------------------------------------------------- */

/**
 * The continue URL the route hands to `generateEmailVerificationLink`.
 *
 * Mirrored here rather than imported, because the route pulls in `server-only`
 * and the Admin SDK. What matters is the shape: absolute, on the shop's own
 * domain, carrying the flag the account page reads.
 */
const continueUrl = (locale: string, site = "https://netsale.shop") =>
  `${site}/${locale}/account?verified=1`;

describe("the redirect after confirming", () => {
  test("lands on the Arabic account page with the flag set", () => {
    assert.equal(continueUrl("ar"), "https://netsale.shop/ar/account?verified=1");
  });

  test("follows the customer's language", () => {
    assert.equal(continueUrl("en"), "https://netsale.shop/en/account?verified=1");
  });

  /*
   * Absolute, and on the shop's domain. Firebase requires the continue URL to
   * be on the project's authorized-domains list, and a relative path is not a
   * URL it accepts at all.
   */
  test("is absolute and https", () => {
    const parsed = new URL(continueUrl("ar"));
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.host, "netsale.shop");
    assert.equal(parsed.searchParams.get("verified"), "1");
  });
});
