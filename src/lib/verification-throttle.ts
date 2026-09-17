/**
 * How often this app is willing to ask Firebase to send a verification email.
 *
 * ## The problem this solves
 *
 * Firebase throttles `sendOobCode` per account, hard and early. Two sends to a
 * freshly created address seconds apart is enough to get
 * `auth/too-many-requests` — and the customer, who pressed one button once,
 * is told they have done something too many times.
 *
 * That is exactly what this shop was doing. Sign-up sent one automatically,
 * then dropped the customer on an account page whose banner offered a "Send
 * the link" button with no hint that anything had been sent. Pressing it was
 * the obvious thing to do, and it was the second send.
 *
 * So the app now tracks when it last asked, per account, and refuses to ask
 * again inside the cooldown — showing a countdown instead of a button that is
 * going to fail. Firebase's own limit is still the authority; this just stops
 * the app walking into it.
 *
 * Kept free of Firebase imports so the rules can be tested without a project.
 */

/**
 * Long enough that Firebase's own limiter has moved on, short enough that a
 * customer whose mail genuinely did not arrive is not left stranded.
 */
export const RESEND_COOLDOWN_MS = 60_000;

const STORAGE_KEY = "net-sale:verification-sent";

/** uid → epoch ms of the last send this app asked for. */
type SentLog = Record<string, number>;

/*
 * Session storage, not memory.
 *
 * The send happens during sign-up and the button that would duplicate it is on
 * a different page. An in-memory record survives that navigation today, because
 * the App Router does not reload the document — but it would not survive a
 * refresh, and "refresh the page to get around the cooldown" is precisely the
 * thing a confused customer does. Session-scoped rather than permanent: a new
 * tab tomorrow should be able to ask again.
 */
function read(): SentLog {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SentLog) : {};
  } catch {
    // Private browsing, storage disabled, or no window at all. The cooldown
    // degrades to in-memory for this page, which is still better than none.
    return {};
  }
}

function write(log: SentLog) {
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Nothing to do. `memory` below still holds it for this page.
  }
}

/** Survives a blocked sessionStorage; lost on reload, which is acceptable. */
const memory: SentLog = {};

/** Record that a send was asked for, so the cooldown starts now. */
export function markVerificationSent(uid: string, now = Date.now()) {
  memory[uid] = now;
  write({ ...read(), [uid]: now });
}

/** Milliseconds until this account may be asked again. Zero means "go ahead". */
export function cooldownRemaining(uid: string, now = Date.now()): number {
  const stored = read()[uid];
  const last = Math.max(stored ?? 0, memory[uid] ?? 0);
  if (!last) return 0;
  return Math.max(0, last + RESEND_COOLDOWN_MS - now);
}

/** Has this app already sent one for this account in this session? */
export function hasSentVerification(uid: string): boolean {
  return Boolean(read()[uid] ?? memory[uid]);
}

/** Forget the record — used once the address is confirmed. */
export function clearVerificationRecord(uid: string) {
  delete memory[uid];
  const log = read();
  delete log[uid];
  write(log);
}

/* -------------------------------------------------------------------------- */

/**
 * A short id for one attempt, so a log line can be tied to a Firebase call.
 *
 * Not a UUID: this is for reading in a console next to a timestamp, and eight
 * hex characters are enough to tell two attempts apart while staying short
 * enough to quote in a bug report.
 */
export function requestId(): string {
  const bytes = new Uint8Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 4; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
