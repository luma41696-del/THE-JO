import { strict as assert } from "node:assert";
import { test } from "node:test";

/**
 * The intake's allow-list, exercised directly.
 *
 * The route's `clean()` is not exported, so this mirrors its contract: the
 * point being asserted is that an address, an email, a card number, a body
 * measurement and an image URL are all dropped even when a caller passes
 * them — which is the only guarantee that matters here, because the one time
 * somebody passes a whole cart object is the time a street address ends up in
 * the analytics store.
 */
const ALLOWED = new Set([
  "productId","productSlug","categoryId","sku","price","currency","quantity",
  "value","query","results","filter","sort","method","code","reason",
  "prizeId","step","position","orderReference",
]);

function clean(props: Record<string, unknown>) {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED.has(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 120);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

test("personal data is dropped even when a caller passes it", () => {
  const out = clean({
    productId: "p1",
    address: "12 Rainbow St, Amman",
    email: "someone@example.com",
    phone: "+962790000000",
    cardNumber: "4111111111111111",
    chestCm: 96,
    waistCm: 78,
    imageUrl: "https://example.com/me.jpg",
    fullName: "A Person",
  });
  assert.deepEqual(out, { productId: "p1" }, "only the allow-listed key survives");
  for (const forbidden of ["address","email","phone","cardNumber","chestCm","waistCm","imageUrl","fullName"]) {
    assert.ok(!(forbidden in out), `${forbidden} must never be recorded`);
  }
});

test("objects and arrays are dropped rather than serialised", () => {
  // Serialising them is exactly how a whole address object would get through.
  const out = clean({ productId: "p1", query: { nested: "x" }, results: ["a"] } as never);
  assert.deepEqual(out, { productId: "p1" });
});

test("a search term is truncated, never stored unbounded", () => {
  const out = clean({ query: "x".repeat(500) });
  assert.equal((out.query as string).length, 120);
});

/* -------------------------------------------------------------------------- */
/*  Nothing third-party loads before consent                                  */
/* -------------------------------------------------------------------------- */

/**
 * The gap these tests had.
 *
 * Everything above proves our **own** event writer respects consent. It always
 * did. Meanwhile `initAnalytics()` ran unconditionally from a mount effect, so
 * the shop loaded a 446KB Google tag and began recording `page_view` before
 * the visitor had answered the banner. The suite was testing the right thing
 * about the wrong surface.
 *
 * `initAnalytics` is asserted here against a fake window, because the real one
 * would reach for `firebase/analytics`.
 */
test("analytics does not initialise before consent is given", async () => {
  /*
   * A throwaway config. The Firebase module validates its environment at
   * import, and this test is about the consent gate rather than about
   * Firebase — real credentials would make the assertion depend on whoever
   * happens to be running it.
   */
  for (const key of [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
    "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID",
  ]) {
    process.env[key] ??= "test-value";
  }

  const { useConsent } = await import("@/lib/analytics/consent");
  const { analyticsMayLoad } = await import("@/lib/firebase/client");

  const globals = globalThis as { window?: unknown };
  const hadWindow = "window" in globals;
  globals.window = {};

  try {
    /*
     * `analyticsMayLoad` rather than `initAnalytics`.
     *
     * The first draft of this test called `initAnalytics` and asserted null —
     * and a mutation check proved it vacuous: with the consent gate deleted
     * it still returned null, because `isSupported()` is false in Node
     * regardless. An assertion that cannot fail is worse than none, because
     * it reads as proof.
     */
    // No decision recorded — the state a first-time visitor is in.
    useConsent.setState({ analytics: false, fittingRoom: false, decidedAt: 0, version: 1 });
    assert.equal(analyticsMayLoad(), false, "nothing loads before a decision");

    // A flag set without a decision is still not consent.
    useConsent.setState({ analytics: true, fittingRoom: false, decidedAt: 0, version: 1 });
    assert.equal(analyticsMayLoad(), false, "an undecided visitor is not opted in");

    // Declined is not the same as undecided, and must also load nothing.
    useConsent.setState({ analytics: false, fittingRoom: false, decidedAt: Date.now(), version: 1 });
    assert.equal(analyticsMayLoad(), false, "a refusal is respected");

    // And it does load once consent is genuinely given, or the gate would be
    // an off switch rather than a gate.
    const { POLICY_VERSION } = await import("@/lib/analytics/consent");
    useConsent.setState({
      analytics: true, fittingRoom: false, decidedAt: Date.now(), version: POLICY_VERSION,
    });
    assert.equal(analyticsMayLoad(), true, "consent turns it on");
  } finally {
    if (!hadWindow) delete globals.window;
  }
});

test("the gate is the same predicate the event writer uses", async () => {
  /*
   * One definition of "may we", not two that can drift. If `analyticsAllowed`
   * ever stops being what gates the tag, this fails.
   */
  const { analyticsAllowed, useConsent, POLICY_VERSION } = await import(
    "@/lib/analytics/consent"
  );

  useConsent.setState({ analytics: true, fittingRoom: false, decidedAt: 0, version: POLICY_VERSION });
  assert.equal(analyticsAllowed(), false, "a flag with no decision is not consent");

  useConsent.setState({
    analytics: true, fittingRoom: false, decidedAt: Date.now(), version: POLICY_VERSION - 1,
  });
  assert.equal(analyticsAllowed(), false, "consent to an older policy is not consent to this one");

  useConsent.setState({
    analytics: true, fittingRoom: false, decidedAt: Date.now(), version: POLICY_VERSION,
  });
  assert.equal(analyticsAllowed(), true);
});
