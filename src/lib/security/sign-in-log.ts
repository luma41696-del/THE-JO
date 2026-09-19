/**
 * The addresses an account has signed in from.
 *
 * Recorded so that an account found to be abusive can be blocked at the door
 * as well as at the account, which is the whole point: disabling the login
 * stops that login, and the person registers again in a minute.
 *
 * ## This is personal data, and it is kept like it
 *
 * An IP address identifies a household or a phone. Three rules follow from
 * that, and they are the reason this is a bounded list on the account rather
 * than an append-only log:
 *
 *  1. **Only a handful are kept.** `MAX_ADDRESSES` most recent, and the rest
 *     fall off. A year of sign-ins is a movement history; the last few
 *     addresses are what a block actually needs.
 *  2. **It lives on the account document**, so deleting the account deletes
 *     it, with no second place to remember to clear.
 *  3. **It is never shown to the customer's fellow shoppers, never exported,
 *     and never used for anything but this.** The privacy page says so.
 *
 * Pure, so the bounding and the ordering can be asserted rather than trusted.
 */

/** Enough to catch a phone and a home connection; not a movement history. */
export const MAX_ADDRESSES = 5;

export interface SeenAddress {
  ip: string;
  /** First time this address was seen for this account. */
  first: number;
  /** Most recent. What the list is sorted by. */
  last: number;
  /** How many sign-ins from it. A one-off reads differently from a habit. */
  count: number;
}

/**
 * Fold one sign-in into the stored list.
 *
 * Returns a new array; the input is not touched, which is what lets the caller
 * compare before and after and skip a write that would change nothing.
 */
export function recordSignIn(
  existing: SeenAddress[] | undefined,
  ip: string,
  at: number,
): SeenAddress[] {
  const clean = (existing ?? []).filter(
    (entry): entry is SeenAddress => typeof entry?.ip === "string" && entry.ip.length > 0,
  );

  const known = clean.find((entry) => entry.ip === ip);

  const merged: SeenAddress[] = known
    ? clean.map((entry) =>
        entry.ip === ip
          ? {
              ...entry,
              // `first` is never moved forward — it is the only field that
              // says how long this address has been associated with the
              // account, and overwriting it would erase that.
              first: Math.min(entry.first || at, at),
              last: Math.max(entry.last || 0, at),
              count: (entry.count || 0) + 1,
            }
          : entry,
      )
    : [...clean, { ip, first: at, last: at, count: 1 }];

  /*
   * Newest first, then cut. Sorting before the cut is what makes the cap drop
   * the *oldest* address rather than whichever happened to be last in the
   * array — the bug that would quietly keep a stale address forever while
   * discarding the one somebody is signing in from today.
   */
  return merged.sort((a, b) => b.last - a.last).slice(0, MAX_ADDRESSES);
}

/**
 * Is the stored list already correct for this sign-in?
 *
 * Used to skip a write. A customer refreshing a tab should not cost a
 * Firestore transaction every time, and the interesting change — a new
 * address — is rare.
 */
export function isRecentlyRecorded(
  existing: SeenAddress[] | undefined,
  ip: string,
  at: number,
  withinMs: number,
): boolean {
  const known = (existing ?? []).find((entry) => entry.ip === ip);
  return Boolean(known && at - (known.last || 0) < withinMs);
}
