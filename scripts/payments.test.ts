import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  DEFAULT_PAYMENT_METHOD,
  blockedPaymentMethods,
  enabledPaymentMethods,
  isPaymentMethodEnabled,
  paymentLabel,
} from "@/lib/payments";

test("only methods with an integration behind them are offered", () => {
  const enabled = enabledPaymentMethods().map((o) => o.id);
  assert.deepEqual(enabled, ["cod"]);

  // Rendering a card option that cannot charge a card is not a preview of a
  // feature; it is a checkout that fails at the last step.
  assert.equal(isPaymentMethodEnabled("card"), false);
  assert.equal(isPaymentMethodEnabled("cliq"), false);
  assert.equal(isPaymentMethodEnabled("apple-pay"), false);
  assert.equal(isPaymentMethodEnabled("cod"), true);
});

test("the guard rejects anything that is not an enabled method", () => {
  // The server calls this on whatever the request carries.
  for (const value of [undefined, null, "", "bitcoin", 42, {}, "COD"]) {
    assert.equal(isPaymentMethodEnabled(value), false, `${String(value)} is refused`);
  }
});

test("the default is a method that actually works", () => {
  assert.equal(isPaymentMethodEnabled(DEFAULT_PAYMENT_METHOD), true);
});

test("every blocked method says why, so nothing is merely missing", () => {
  const blocked = blockedPaymentMethods();
  assert.ok(blocked.length > 0);
  for (const option of blocked) {
    assert.ok(option.blockedBy, `${option.id} states its reason`);
  }
});

test("offered and accepted cannot drift apart", () => {
  /*
   * The property the module exists for. These were two lists — a NODE_ENV
   * filter in the checkout and a NODE_ENV check on the server — and the rule
   * that decides whether money can be taken was written twice.
   */
  for (const option of enabledPaymentMethods()) {
    assert.equal(isPaymentMethodEnabled(option.id), true, `${option.id} is accepted`);
  }
  for (const option of blockedPaymentMethods()) {
    assert.equal(isPaymentMethodEnabled(option.id), false, `${option.id} is refused`);
  }
});

test("every method is named in both languages, including blocked ones", () => {
  // A past order paid by a method since withdrawn still has to render.
  for (const option of [...enabledPaymentMethods(), ...blockedPaymentMethods()]) {
    assert.ok(option.name.en.trim(), `${option.id} has English`);
    assert.ok(option.name.ar.trim(), `${option.id} has Arabic`);
    assert.equal(paymentLabel(option.id, "ar"), option.name.ar);
  }
});
