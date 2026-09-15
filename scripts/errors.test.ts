import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ApiError, errorMessage, isNetworkError, readJson } from "@/lib/errors";

const FALLBACK = { en: "Your review could not be saved.", ar: "تعذّر حفظ تقييمك." };

/* -------------------------------------------------------------------------- */

test("a message the server wrote is shown verbatim", () => {
  // These are written for customers and carry real information.
  const error = new ApiError("Only 2 of that remain.");
  assert.equal(errorMessage(error, "en", FALLBACK), "Only 2 of that remain.");
  assert.equal(errorMessage(error, "ar", FALLBACK), "Only 2 of that remain.");
});

test("a dropped connection never shows the browser's own words", () => {
  /*
   * The bug this module exists for. `fetch` rejects with a TypeError whose
   * message is "Failed to fetch" — so the most likely failure produced the
   * least useful sentence, in English, whatever the customer was reading.
   */
  const dropped = new TypeError("Failed to fetch");

  const en = errorMessage(dropped, "en", FALLBACK);
  const ar = errorMessage(dropped, "ar", FALLBACK);

  assert.doesNotMatch(en, /Failed to fetch/);
  assert.doesNotMatch(ar, /Failed to fetch/);
  assert.match(ar, /[\u0600-\u06FF]/, "an Arabic reader gets Arabic");
  assert.match(en, /connection/i, "and it says what to do");
});

test("an unexplained failure falls back in the customer's language", () => {
  const vague = new ApiError("");
  assert.equal(errorMessage(vague, "ar", FALLBACK), FALLBACK.ar);
  assert.equal(errorMessage(vague, "en", FALLBACK), FALLBACK.en);

  // Anything at all may be thrown.
  assert.equal(errorMessage("a string", "ar", FALLBACK), FALLBACK.ar);
  assert.equal(errorMessage(undefined, "ar", FALLBACK), FALLBACK.ar);
  assert.equal(errorMessage(new Error("internal detail"), "ar", FALLBACK), FALLBACK.ar);
});

test("a plain Error is not treated as a server message", () => {
  // Only `ApiError` is trusted. An internal Error carries implementation
  // detail that is no use to a shopper and may leak internals.
  assert.equal(errorMessage(new Error("Cannot read properties of null"), "en", FALLBACK), FALLBACK.en);
});

test("network errors are told apart from refusals", () => {
  assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
  assert.equal(isNetworkError(new ApiError("That coupon has expired.")), false);
  assert.equal(isNetworkError(new Error("boom")), false);
});

/* -------------------------------------------------------------------------- */

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("readJson returns the body on success", async () => {
  const data = await readJson<{ ok?: boolean; id?: string }>(jsonResponse({ ok: true, id: "x" }));
  assert.equal(data.id, "x");
});

test("a 200 carrying ok:false is a failure, not a success", async () => {
  /*
   * The half everyone forgets. Checking only `response.ok` treats a 200 with
   * `{ok:false}` as success — which is precisely the fake success this shop
   * is careful about everywhere else.
   */
  await assert.rejects(
    () => readJson(jsonResponse({ ok: false, error: "That coupon has expired." })),
    (error: unknown) =>
      error instanceof ApiError && error.message === "That coupon has expired.",
  );
});

test("an HTTP error carries the server's message when it sent one", async () => {
  await assert.rejects(
    () => readJson(jsonResponse({ ok: false, error: "Sign in to save." }, 401)),
    (error: unknown) => error instanceof ApiError && error.message === "Sign in to save.",
  );
});

test("a non-JSON body becomes the caller's fallback, not a parse error", async () => {
  // A proxy error page or a gateway timeout is not a message to show.
  const html = new Response("<html>502 Bad Gateway</html>", { status: 502 });
  await assert.rejects(
    () => readJson(html),
    (error: unknown) => error instanceof ApiError && error.message === "",
  );

  const thrown = await readJson(html).catch((e: unknown) => e);
  assert.equal(errorMessage(thrown, "ar", FALLBACK), FALLBACK.ar);
});
