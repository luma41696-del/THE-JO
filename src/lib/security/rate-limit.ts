import "server-only";

/**
 * Rate limiting for route handlers.
 *
 * ## What this is for
 *
 * Several routes here take a request from anybody at all: the newsletter sign
 * up, guest checkout, the support form, the session exchange. Without a limit,
 * one script can enumerate order references, send ten thousand newsletter
 * confirmations from the shop's own domain, or sit on the session endpoint
 * trying stolen tokens. None of those need a clever exploit — just a loop.
 *
 * ## Why Firestore rather than memory
 *
 * The obvious implementation is a `Map` in module scope, and on Vercel it is
 * close to useless: every serverless instance gets its own, instances come and
 * go per request under load, and the attacker's traffic is spread across all
 * of them. A limit of five that is really five *per instance* is not a limit.
 *
 * So the counter lives in Firestore, shared by every instance, and costs one
 * transaction per limited request. That is a real cost and it is why this is
 * applied to the handful of routes that need it rather than to everything.
 *
 * The in-memory path below is the fallback for local development, where
 * Firebase Admin is often not configured. It is explicitly *not* the
 * production path, because a per-instance limit would be a comforting number
 * in a log rather than a defence.
 *
 * ## One thing to set up once
 *
 * Each document is one key in one window and is never read again after that
 * window closes, so the collection grows forever unless something removes
 * them. Every document carries `resetAt` for exactly this: set a Firestore TTL
 * policy on `rateLimits.resetAt` (Firestore console -> TTL), and Google deletes
 * them without a cron job or a bill for the reads a sweep would cost. Without
 * that policy nothing breaks — it just accumulates.
 */

/** A fixed window. Simple, predictable, and good enough for abuse control. */
export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** How many more are allowed in this window. */
  remaining: number;
  /** Seconds until the window resets. Sent as `Retry-After` on a refusal. */
  retryAfter: number;
}

/* -------------------------------------------------------------------------- */
/*  Who is asking                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The caller's identity for limiting: their uid if signed in, else their IP.
 *
 * `x-forwarded-for` is only trustworthy because Vercel sets it — the platform
 * overwrites whatever the client sent, and the leftmost entry is the real peer.
 * On any host that does *not* do that, this header is attacker-controlled and
 * this function would be handing out fresh buckets on request. If this ever
 * moves off Vercel, that assumption has to move with it.
 *
 * A signed-in caller is keyed by uid instead, so that a household behind one
 * NAT address does not share a limit — and so that an abuser cannot escape one
 * by changing networks.
 */
export function callerKey(request: Request, uid?: string | null): string {
  if (uid) return `uid:${uid}`;

  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  const ip = first || request.headers.get("x-real-ip")?.trim() || "unknown";
  return `ip:${ip}`;
}

/* -------------------------------------------------------------------------- */
/*  The counter                                                               */
/* -------------------------------------------------------------------------- */

/** Development only — see the note at the top of this file. */
const local = new Map<string, { count: number; resetAt: number }>();

function windowStart(now: number, windowSeconds: number): number {
  return Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
}

function inMemory(key: string, rule: RateLimitRule, now: number): RateLimitResult {
  const start = windowStart(now, rule.windowSeconds);
  const resetAt = start + rule.windowSeconds * 1000;
  const current = local.get(key);

  const count = current && current.resetAt === resetAt ? current.count + 1 : 1;
  local.set(key, { count, resetAt });

  // Unbounded growth is a memory leak in a long-lived dev server; the window
  // is short, so anything expired is dead weight.
  if (local.size > 5000) {
    for (const [k, v] of local) if (v.resetAt <= now) local.delete(k);
  }

  return {
    ok: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfter: Math.ceil((resetAt - now) / 1000),
  };
}

/**
 * Count one request against `key`, and say whether it is allowed.
 *
 * **Fails open.** If Firestore is unreachable the request is allowed through,
 * because the alternative is a shop that stops taking orders the moment its
 * rate-limit store has a bad minute. The trade is deliberate: this protects
 * against volume, and a failure here is itself rare and loud in the logs.
 */
export async function rateLimit(
  key: string,
  rule: RateLimitRule,
  now = Date.now(),
): Promise<RateLimitResult> {
  const { isAdminConfigured } = await import("@/lib/firebase/admin");
  if (!isAdminConfigured()) return inMemory(key, rule, now);

  const start = windowStart(now, rule.windowSeconds);
  const resetAt = start + rule.windowSeconds * 1000;

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    // The window start is part of the document id, so a new window is a new
    // document and there is nothing to reset or clean up on the hot path.
    const ref = db.collection("rateLimits").doc(`${encodeKey(key)}_${start}`);

    const count = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = ((snap.data()?.count as number | undefined) ?? 0) + 1;
      tx.set(ref, { count: next, resetAt: new Date(resetAt), key }, { merge: true });
      return next;
    });

    return {
      ok: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfter: Math.ceil((resetAt - now) / 1000),
    };
  } catch (error) {
    console.warn("[net sale] rate limit store unavailable — allowing the request.", error);
    return { ok: true, remaining: rule.limit, retryAfter: 0 };
  }
}

/** Firestore document ids may not contain `/`, and are capped at 1500 bytes. */
function encodeKey(key: string): string {
  return key.replace(/\//g, "_").slice(0, 200);
}

/* -------------------------------------------------------------------------- */
/*  The answer a refused caller gets                                          */
/* -------------------------------------------------------------------------- */

/**
 * A 429 that says when to come back, and nothing else.
 *
 * Deliberately the same body whatever the route: an error that distinguishes
 * "too many sign-in attempts for this account" from "too many for this
 * address" is an oracle telling an attacker which accounts exist.
 */
export function tooManyRequests(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ ok: false, error: "Too many requests. Please wait and try again." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.max(1, result.retryAfter)),
      },
    },
  );
}

/* -------------------------------------------------------------------------- */
/*  The rules themselves                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Chosen against what a real person does, not against a round number.
 *
 * A customer places one order, maybe two if the first card fails. Nobody
 * subscribes to a newsletter four times. The limits are far above ordinary
 * use and far below what a script needs to be worth running.
 */
export const RULES = {
  /** Sign-in token exchange. Credential stuffing is a volume attack. */
  session: { limit: 10, windowSeconds: 60 },
  /** Placing an order. Also what stops a card-testing loop. */
  checkout: { limit: 8, windowSeconds: 60 },
  /** Anything that sends an email or an SMS on the shop's behalf. */
  messaging: { limit: 5, windowSeconds: 300 },
  /** Writing something other people will read. */
  content: { limit: 20, windowSeconds: 300 },
  /** Reads that are cheap individually and expensive in a loop. */
  read: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;
