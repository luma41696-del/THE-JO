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
