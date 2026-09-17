/**
 * Jordanian phone numbers.
 *
 * Kept apart from the Firebase module that uses them, because these are a
 * domain rule rather than an auth concern — and because importing them should
 * not drag in the Firebase client, which refuses to load without a configured
 * project. A pure rule that cannot be tested without a service account is a
 * rule nobody tests.
 */

/**
 * A number in the form Firebase wants: `+9627XXXXXXXX`.
 *
 * Customers write their number every way there is — `0790 000 000`,
 * `00962 79 000 0000`, `+962-79-000-0000`, `79 0000000`. Firebase accepts
 * exactly one of those, and rejecting the rest as "invalid" is blaming the
 * customer for a formatting rule nobody told them about.
 *
 * Returns `undefined` rather than a guess when it cannot tell: sending a code
 * to a number the customer did not type costs an SMS and reaches a stranger.
 */
export function normaliseJordanianPhone(input: string): string | undefined {
  // Arabic-Indic digits are what an Arabic keyboard produces, and this shop's
  // primary market types on one.
  const western = input.replace(/[\u0660-\u0669]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x0660),
  );
  const digits = western.replace(/[^\d+]/g, "");

  let rest: string;
  if (digits.startsWith("+962")) rest = digits.slice(4);
  else if (digits.startsWith("00962")) rest = digits.slice(5);
  else if (digits.startsWith("962") && digits.length >= 12) rest = digits.slice(3);
  else if (digits.startsWith("0")) rest = digits.slice(1);
  else rest = digits.replace(/^\+/, "");

  // Jordanian mobiles are 7 followed by eight more digits. A landline (`6…`)
  // cannot receive an SMS, so it is refused here rather than by the carrier
  // after the shop has paid to find out.
  if (!/^7\d{8}$/.test(rest)) return undefined;
  return `+962${rest}`;
}

/** For showing back what will be texted, grouped the way people read it. */
export function formatJordanianPhone(e164: string): string {
  const match = /^\+962(7\d)(\d{3})(\d{4})$/.exec(e164);
  return match ? `+962 ${match[1]} ${match[2]} ${match[3]}` : e164;
}
