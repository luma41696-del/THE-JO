import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  browserOf,
  fingerprintOf,
  redact,
  routeOf,
  toReport,
} from "@/lib/monitoring/fingerprint";

/* -------------------------------------------------------------------------- */
/*  Nothing personal reaches the log                                          */
/* -------------------------------------------------------------------------- */

test("a query string never survives", () => {
  /*
   * The reason the route pattern is stored and not the URL: a query string
   * can hold a search term, a coupon, or an email somebody mistyped into the
   * wrong field. None of it belongs in an error log.
   */
  assert.equal(routeOf("/en/shop?q=lina%40example.com"), "/:locale/shop");
  assert.equal(routeOf("/en/shop#section"), "/:locale/shop");
});

test("identifiers in the path collapse, so one bug is one row", () => {
  // Two products failing the same way is one bug, not two.
  assert.equal(routeOf("/en/product/wool-coat"), "/:locale/product/:slug");
  assert.equal(routeOf("/ar/product/silk-dress"), "/:locale/product/:slug");
  assert.equal(
    routeOf("/en/product/wool-coat"),
    routeOf("/en/product/silk-dress"),
    "same route pattern",
  );
  assert.equal(routeOf("/en/orders/NS-7K4M2X"), "/:locale/orders/:slug");
});

test("messages are stripped of anything that identifies a person", () => {
  assert.match(redact("Failed for lina.haddad@example.com"), /\[email\]/);
  assert.doesNotMatch(redact("Failed for lina.haddad@example.com"), /lina/);

  assert.match(redact("GET https://netsale.shop/api/x?token=abc failed"), /\[url\]/);
  assert.doesNotMatch(redact("GET https://netsale.shop/api/x?token=abc failed"), /token=abc/);

  assert.match(redact("uid 962790000000 not found"), /\[number\]/);
  assert.match(redact("Bad token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef"), /\[token\]/);
});

test("a redacted message is still diagnosable", () => {
  const out = redact("Cannot read properties of undefined (reading 'variants')");
  assert.match(out, /Cannot read properties of undefined/);
  assert.match(out, /variants/);
});

test("an absent message does not become 'undefined'", () => {
  assert.equal(redact(undefined), "Unknown error");
  assert.equal(redact(""), "Unknown error");
});

test("a very long message is truncated rather than stored whole", () => {
  assert.ok(redact("x".repeat(5000)).length <= 300);
});

/* -------------------------------------------------------------------------- */
/*  Grouping                                                                  */
/* -------------------------------------------------------------------------- */

test("the same fault on the same route is one fingerprint", () => {
  const a = fingerprintOf({ digest: "abc123", path: "/en/product/wool-coat" });
  const b = fingerprintOf({ digest: "abc123", path: "/ar/product/silk-dress" });
  assert.equal(a, b, "locale and slug do not split a bug in two");
});

test("different faults on the same route stay apart", () => {
  const a = fingerprintOf({ digest: "abc123", path: "/en/shop" });
  const b = fingerprintOf({ digest: "def456", path: "/en/shop" });
  assert.notEqual(a, b);
});

test("the same fault on different routes stays apart", () => {
  // Same error thrown from two places is usually two problems.
  const a = fingerprintOf({ digest: "abc123", path: "/en/shop" });
  const b = fingerprintOf({ digest: "abc123", path: "/en/cart" });
  assert.notEqual(a, b);
});

test("client errors group on the redacted message, not the raw one", () => {
  /*
   * Client errors carry no digest. Two visitors hitting the same fault with
   * different emails in the message must still group as one — which only
   * works because the fingerprint is built from the *redacted* text.
   */
  const a = fingerprintOf({ message: "Upload failed for ana@example.com" });
  const b = fingerprintOf({ message: "Upload failed for omar@example.com" });
  assert.equal(a, b);
});

test("a fingerprint is safe to use as a document id", () => {
  const id = fingerprintOf({ message: "a/b#c?d[e]", path: "/en/shop" });
  assert.doesNotMatch(id, /[/#?[\]]/, "no characters Firestore refuses in an id");
  assert.ok(id.length <= 200);
});

/* -------------------------------------------------------------------------- */
/*  Browser                                                                   */
/* -------------------------------------------------------------------------- */

test("the browser family is recorded, never the full user-agent", () => {
  const ua =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const out = browserOf(ua);
  assert.equal(out, "Safari on iOS");
  assert.ok(out.length < 30, "not a fingerprinting vector");
});

test("browsers that impersonate each other are told apart", () => {
  // Edge and Chrome both claim "Chrome"; Chrome claims "Safari". Order matters.
  assert.match(browserOf("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120"), /^Edge/);
  assert.match(browserOf("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537"), /^Chrome/);
  assert.match(browserOf("Mozilla/5.0 (Macintosh; Mac OS X) Version/17 Safari/605"), /^Safari/);
  assert.equal(browserOf(undefined), "unknown");
});

/* -------------------------------------------------------------------------- */
/*  The stored shape                                                          */
/* -------------------------------------------------------------------------- */

test("a report carries no identifier of any kind", () => {
  const report = toReport(
    {
      digest: "abc",
      message: "Something broke for lina@example.com",
      path: "/en/orders/NS-7K4M2X?email=lina@example.com",
      locale: "ar",
      boundary: "route",
      userAgent: "Mozilla/5.0 (iPhone) Safari/604",
    },
    1_000,
  );

  const serialised = JSON.stringify(report);
  assert.doesNotMatch(serialised, /lina/, "no email");
  assert.doesNotMatch(serialised, /NS-7K4M2X/, "no order reference");
  assert.doesNotMatch(serialised, /Mozilla/, "no raw user agent");
  assert.equal(report.route, "/:locale/orders/:slug");
  assert.equal(report.locale, "ar");
  assert.equal(report.firstSeenAt, 1_000);
  assert.equal(report.lastSeenAt, 1_000);
});

test("an unknown boundary or locale falls back rather than storing junk", () => {
  const report = toReport(
    { message: "x", boundary: "nonsense" as never, locale: "fr" as never },
    5,
  );
  assert.equal(report.boundary, "route");
  assert.equal(report.locale, "en");
});
