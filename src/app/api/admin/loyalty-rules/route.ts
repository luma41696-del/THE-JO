import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { getEarnRules, invalidateEarnRules } from "@/lib/loyalty-earning.server";
import { DEFAULT_EARN_RULES, LIMITS, sanitiseRules } from "@/lib/loyalty-earning";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

/**
 * What the shop pays for points, and what a point is worth.
 *
 * ## Administrator only
 *
 * Every field here is money. `pointValue` multiplies every balance the shop
 * has ever issued: moving it from 0.05 to 0.5 turns an existing thousand-point
 * balance from fifty dinars into five hundred, retroactively, for every
 * customer at once. That is not a staff-level control.
 *
 * ## Everything is clamped on the way in
 *
 * `sanitiseRules` bounds each field, and the bounds are returned to the form so
 * it can show them. The realistic accident is a stray zero in a text box, and
 * nothing downstream of here would question one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function gate(request: Request) {
  if (!isAdminConfigured()) {
    return { error: bad("Firebase Admin is not configured here.", 503) } as const;
  }
  const caller = await verifyRequest(request);
  if (!caller) return { error: bad("Not signed in.", 401) } as const;
  if (caller.role !== "admin") {
    return { error: bad("Only an administrator can change what points are worth.", 403) } as const;
  }
  return { caller } as const;
}

export async function GET(request: Request) {
  const guard = await gate(request);
  if (guard.error) return guard.error;

  const { getAdminDb } = await import("@/lib/firebase/admin");
  return NextResponse.json({
    ok: true,
    rules: await getEarnRules(getAdminDb()),
    limits: LIMITS,
    defaults: DEFAULT_EARN_RULES,
  });
}

export async function PUT(request: Request) {
  const limit = await rateLimit(`loyalty-rules:${callerKey(request)}`, RULES.content);
  if (!limit.ok) return tooManyRequests(limit);

  const guard = await gate(request);
  if (guard.error) return guard.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("Malformed request body.");
  }

  const rules = sanitiseRules((body as { rules?: unknown })?.rules);

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  const before = await getEarnRules(db);
  await db.collection("settings").doc("loyalty").set(rules, { merge: true });

  /*
   * Recorded with the before and after, not just the after. "Who changed what
   * a point is worth, and from what" is the question asked when a month's
   * redemptions look wrong, and the new value alone cannot answer it.
   */
  await db.collection("auditLog").add({
    action: "loyalty.rules",
    before,
    after: rules,
    actorUid: guard.caller.uid,
    actorEmail: guard.caller.email,
    at: new Date(),
  });

  invalidateEarnRules();

  return NextResponse.json({ ok: true, rules });
}
