import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { formatJordanianPhone, normaliseJordanianPhone } from "../src/lib/phone";

/**
 * Jordanian phone numbers.
 *
 * Customers write their number every way there is, and Firebase accepts
 * exactly one of them. Every format below is one a real person types — getting
 * any of them wrong means telling a customer their own number is invalid, and
 * the only thing they can do about that is leave.
 *
 * Run with:
 *
 *     npm run test:phone-auth
 */

describe("normalising what a customer typed", () => {
  const CANONICAL = "+962790000000";

  test("the ways people write the same number all reach it", () => {
    const written = [
      "0790000000",
      "079 000 0000",
      "079-000-0000",
      "+962790000000",
      "+962 79 000 0000",
      "+962-79-000-0000",
      "00962790000000",
      "00962 79 000 0000",
      "962790000000",
      "790000000",
      "  0790000000  ",
      "(079) 000-0000",
    ];
    for (const input of written) {
      assert.equal(normaliseJordanianPhone(input), CANONICAL, input);
    }
  });

  /*
   * An Arabic keyboard produces Arabic-Indic digits. A customer typing their
   * number on an Arabic phone gets ٠٧٩٠٠٠٠٠٠٠ — which is the same number, and
   * rejecting it is rejecting the shop's own primary market.
   */
  test("Arabic-Indic digits are the same number", () => {
    assert.equal(normaliseJordanianPhone("٠٧٩٠٠٠٠٠٠٠"), CANONICAL);
    assert.equal(normaliseJordanianPhone("+٩٦٢ ٧٩ ٠٠٠ ٠٠٠٠"), CANONICAL);
  });

  test("every Jordanian mobile prefix is accepted", () => {
    // 77, 78 and 79 are the live ones; 70 exists too.
    for (const prefix of ["70", "77", "78", "79"]) {
      assert.equal(
        normaliseJordanianPhone(`0${prefix}1234567`),
        `+962${prefix}1234567`,
        prefix,
      );
    }
  });

  /*
   * Undefined, never a guess. Sending a code to a number the customer did not
   * type costs an SMS and reaches a stranger.
   */
  test("what cannot be understood is refused rather than guessed", () => {
    for (const input of [
      "",
      "   ",
      "not a number",
      "079000000", // one digit short
      "07900000000", // one too many
      "0612345678", // a landline, not a mobile
      "+14155550100", // not Jordanian
      "+9626123456", // Jordanian landline
      "0",
      "+962",
    ]) {
      assert.equal(normaliseJordanianPhone(input), undefined, JSON.stringify(input));
    }
  });

  test("normalising twice changes nothing", () => {
    const once = normaliseJordanianPhone("0790000000")!;
    assert.equal(normaliseJordanianPhone(once), once);
  });
});

describe("showing it back", () => {
  /*
   * Shown before the code is sent, so a mistyped digit is caught while it is
   * still free to fix.
   */
  test("is grouped the way the number is read aloud", () => {
    assert.equal(formatJordanianPhone("+962790000000"), "+962 79 000 0000");
    assert.equal(formatJordanianPhone("+962771234567"), "+962 77 123 4567");
  });

  test("anything unexpected is shown unchanged rather than mangled", () => {
    assert.equal(formatJordanianPhone("+14155550100"), "+14155550100");
    assert.equal(formatJordanianPhone(""), "");
  });
});
