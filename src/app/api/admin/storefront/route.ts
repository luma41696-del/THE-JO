import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { getStorefront, invalidateStorefront } from "@/lib/storefront-state.server";
import { currentState, sanitiseStorefront } from "@/lib/storefront-state";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

/**
 * Opening and closing the shop.
 *
 * ## Administrator only
 *
 * Closing the storefront stops every sale at once. Staff run the shop; taking
 * it down is not running it. The middleware enforces whatever is stored here
 * without asking who set it, so this is the only gate there is.
 *
 * ## The admin cannot be closed by this
 *
 * Not by policy — by construction. `ALWAYS_OPEN` in `storefront-state.ts`
 * exempts `/admin`, the admin API and the auth routes, so no value this route
 * can store will ever shut the door it is operated from.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Reading is staff work; changing it is not.
 *
 * Staff need to know the shop is shut — they are the ones answering the
 * customer asking why — and the admin banner that tells them reads through
 * this route. Only an administrator may throw the switch.
 */
async function gate(request: Request, write: boolean) {
  if (!isAdminConfigured()) {
    return { error: bad("Firebase Admin is not configured here.", 503) } as const;
  }
  const caller = await verifyRequest(request);
  if (!caller) return { error: bad("Not signed in.", 401) } as const;

  const allowed = write ? caller.role === "admin" : caller.role === "admin" || caller.role === "staff";
  if (!allowed) {
    return { error: bad("Only an administrator can open or close the shop.", 403) } as const;
  }
  return { caller } as const;
}

export async function GET(request: Request) {
  const guard = await gate(request, false);
  if (guard.error) return guard.error;

  const settings = await getStorefront();
  return NextResponse.json({
    ok: true,
    settings,
    /*
     * The stored state and the state right now are different things once a
     * reopening time has passed. The form shows what is stored; the banner
     * shows what visitors are getting.
     */
    effective: currentState(settings),
  });
}

export async function PUT(request: Request) {
  const limit = await rateLimit(`storefront:${callerKey(request)}`, RULES.content);
  if (!limit.ok) return tooManyRequests(limit);

  const guard = await gate(request, true);
  if (guard.error) return guard.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("Malformed request body.");
  }

  const settings = sanitiseStorefront((body as { settings?: unknown })?.settings, {
    dropExpired: true,
  });

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  const before = await getStorefront();

  const record = {
    ...settings,
    /*
     * Who closed it and when, kept so the admin banner can say so. A shop
     * found closed on a Monday morning is a question about who and why, and
     * the settings document is the only thing that can answer it.
     */
    ...(settings.state === "open"
      ? { closedBy: null, closedAt: null }
      : { closedBy: guard.caller.email ?? guard.caller.uid, closedAt: Date.now() }),
    // Written explicitly so clearing a reopening time actually clears it —
    // `merge: true` would otherwise leave the old one in place.
    reopensAt: settings.reopensAt ?? null,
    message: settings.message ?? null,
  };

  await db.collection("settings").doc("storefront").set(record, { merge: true });

  await db.collection("auditLog").add({
    action: "storefront.state",
    before: { state: before.state, reason: before.reason, reopensAt: before.reopensAt ?? null },
    after: { state: settings.state, reason: settings.reason, reopensAt: settings.reopensAt ?? null },
    actorUid: guard.caller.uid,
    actorEmail: guard.caller.email,
    at: new Date(),
  });

  invalidateStorefront();

  return NextResponse.json({ ok: true, settings, effective: currentState(settings) });
}
