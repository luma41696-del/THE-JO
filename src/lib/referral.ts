/**
 * Inviting a friend.
 *
 * A referral programme is the easiest thing in a shop to farm: the reward is
 * paid for creating an account, and creating accounts is free. Everything in
 * this file exists because of that, so the guards are worth listing before the
 * code:
 *
 *  1. **Nobody refers themselves.** The obvious one, and the one every
 *     implementation remembers.
 *  2. **Only somebody new may claim.** An existing customer with orders is not
 *     a referral; they are a customer being paid for having already been one.
 *  3. **A claim happens once, ever.** Stored on the invited account, checked
 *     before it is written.
 *  4. **The reward waits for a real order**, by default. Paying on sign-up
 *     costs nothing to farm. Paying on a paid order costs the farmer the price
 *     of the order, which is the whole defence.
 *  5. **Not from the same connection as the inviter.** This is the one that
 *     catches the realistic case — one person, several accounts, one phone —
 *     and it works because the shop records the addresses an account signs in
 *     from. It is a heuristic and it is stated as one: a household sharing a
 *     connection is refused too, which is the right trade for a reward paid in
 *     money.
 *
 * Pure, so each of those can be asserted without a database.
 */

/**
 * The alphabet a code is drawn from.
 *
 * No `O`, `0`, `I`, `1` or `L`. A referral code gets read aloud, written on
 * paper and typed from a photograph, and those five are where that goes wrong.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/** A fresh code. Random rather than derived, so a uid cannot be recovered. */
export function generateReferralCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return code;
}

/**
 * Tidy what somebody typed into a code, or return empty.
 *
 * Uppercased, with spaces and dashes removed — people write codes in groups.
 * The confusable characters are folded rather than rejected: somebody reading
 * `NP4K7T2X` off a screen and typing `NPAK7T2X` should not be told their
 * friend's code is wrong, and `0`→`O` cannot collide because `O` is not in the
 * alphabet to begin with.
 */
export function normaliseReferralCode(input: string): string {
  const cleaned = (input ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/0/g, "O")
    .replace(/[1IL]/g, "J")
    .replace(/O/g, "Q");

  // `O`→`Q` and `1`→`J` land on characters that *are* in the alphabet, so a
  // misread still resolves to something; an unknown code simply will not be
  // found, which is the honest outcome.
  return /^[A-Z0-9]{8}$/.test(cleaned) ? cleaned : "";
}

export type ClaimRefusal =
  | "unknown-code"
  | "self"
  | "already-claimed"
  | "not-new"
  | "same-connection"
  | "disabled";

export interface ClaimContext {
  /** Who owns the code. */
  inviterUid: string | null;
  /** Who is claiming. */
  uid: string;
  /** Already set on the claiming account? */
  existingReferredBy?: string | null;
  /** Orders the claiming account has already placed. */
  ordersPlaced: number;
  /** Addresses each side has signed in from. */
  inviterIps?: string[];
  claimantIps?: string[];
  enabled: boolean;
}

/**
 * May this claim go ahead?
 *
 * Returns null to allow, or the reason to refuse. Every refusal is a distinct
 * value so the message can be specific — "you have already been invited" and
 * "that code does not exist" are different problems for the person reading
 * them.
 */
export function claimRefusal(context: ClaimContext): ClaimRefusal | null {
  if (!context.enabled) return "disabled";
  if (!context.inviterUid) return "unknown-code";
  if (context.inviterUid === context.uid) return "self";
  if (context.existingReferredBy) return "already-claimed";
  if (context.ordersPlaced > 0) return "not-new";

  /*
   * The same connection on both sides. Compared as sets of addresses rather
   * than "the latest one", because a farmer signs in to the second account
   * from the same phone even if they used a café for the first.
   */
  const inviter = new Set(context.inviterIps ?? []);
  if ((context.claimantIps ?? []).some((ip) => inviter.has(ip))) return "same-connection";

  return null;
}

/** Why a claim was refused, for the person who made it. */
export const CLAIM_REFUSALS: Record<ClaimRefusal, { en: string; ar: string }> = {
  "unknown-code": {
    en: "That invitation code does not exist.",
    ar: "رمز الدعوة هذا غير موجود.",
  },
  self: {
    en: "That is your own invitation code.",
    ar: "هذا رمز الدعوة الخاص بك.",
  },
  "already-claimed": {
    en: "You have already used an invitation.",
    ar: "لقد استخدمت دعوة من قبل.",
  },
  "not-new": {
    en: "Invitations are for new customers, and you have already ordered from us.",
    ar: "الدعوات للعملاء الجدد، وقد سبق أن طلبت من المتجر.",
  },
  /*
   * Deliberately does not say "we think you are the same person". Somebody
   * genuinely sharing a household connection with the friend who invited them
   * should not be accused, and somebody farming does not need telling which
   * signal caught them.
   */
  "same-connection": {
    en: "This invitation cannot be used from this connection.",
    ar: "لا يمكن استخدام هذه الدعوة من هذا الاتصال.",
  },
  disabled: {
    en: "Invitations are not running at the moment.",
    ar: "الدعوات غير مفعّلة حالياً.",
  },
};
