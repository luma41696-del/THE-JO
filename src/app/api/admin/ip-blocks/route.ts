import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { blockDocId, clientIp, parseRule, ruleMatches, RULE_PROBLEMS } from "@/lib/security/ip";
import { invalidate, listBlocks } from "@/lib/security/ip-blocks";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

/**
 * The address blocklist.
 *
 * ## Administrator only, and not because of consistency
 *
 * Blocking an account is staff work and reversible against one person.
 * Blocking an address reaches people who are not the target: a mobile carrier
 * puts thousands of subscribers behind one public address, and a /24 is two
 * hundred and fifty-six of them. The blast radius is the reason for the
 * higher bar, not tidiness.
 *
 * ## It will not let you block yourself
 *
 * The one refusal worth writing code for. An operator blocking the range they
 * are sitting in loses the admin, and loses the screen that would undo it —
 * there is no way back except the Firestore console. So a rule that matches
 * the caller's own address is refused, and the message says so.
 *
 * This is not paranoia about typos, though it catches those. It is the shape
 * of the actual mistake: somebody reads an address out of a log, does not
 * notice it is the office's own, and blocks it.
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
    return {
      error: bad(
        "Only an administrator can block an address. Blocking the account is staff work and is the safer tool.",
        403,
      ),
    } as const;
  }
  return { caller } as const;
}

export async function GET(request: Request) {
  const guard = await gate(request);
  if (guard.error) return guard.error;

  return NextResponse.json({
    ok: true,
    blocks: await listBlocks(),
    /*
     * The caller's own address, shown in the screen so an operator can see
     * what they are sitting behind before typing something next to it.
     */
    yours: clientIp(request.headers),
  });
}

export async function POST(request: Request) {
  const limit = await rateLimit(`ip-block:${callerKey(request)}`, RULES.content);
  if (!limit.ok) return tooManyRequests(limit);

  const guard = await gate(request);
  if (guard.error) return guard.error;

  let body: { ip?: string; reason?: string; uid?: string };
  try {
    body = (await request.json()) as { ip?: string; reason?: string; uid?: string };
  } catch {
    return bad("Malformed request body.");
  }

  const parsed = parseRule(body.ip ?? "");
  if ("problem" in parsed) return bad(RULE_PROBLEMS[parsed.problem].en);
  const rule = parsed.rule;

  // The guard described at the top of this file.
  const mine = clientIp(request.headers);
  if (mine && ruleMatches(rule, mine)) {
    return bad(
      `That range covers the address you are connecting from (${mine}). Blocking it would lock you out of the admin, and out of the screen that would undo it.`,
      400,
    );
  }

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  const record = {
    text: rule.text,
    reason: (body.reason ?? "").trim().slice(0, 300) || null,
    uid: (body.uid ?? "").trim() || null,
    addedBy: guard.caller.email ?? guard.caller.uid,
    addedAt: Date.now(),
  };

  /*
   * Keyed on the canonical rule, so adding the same range twice is one row
   * rather than two that look different because one was typed as a host —
   * with `/` swapped out, because a Firestore id cannot contain one.
   */
  await db.collection("ipBlocks").doc(blockDocId(rule.text)).set(record, { merge: true });

  await db.collection("auditLog").add({
    action: "ip.block",
    rule: rule.text,
    reason: record.reason,
    uid: record.uid,
    actorUid: guard.caller.uid,
    actorEmail: guard.caller.email,
    at: new Date(),
  });

  // The instance the operator is looking at stops caching the old list now.
  invalidate();

  return NextResponse.json({ ok: true, rule: rule.text });
}

export async function DELETE(request: Request) {
  const guard = await gate(request);
  if (guard.error) return guard.error;

  const text = new URL(request.url).searchParams.get("ip")?.trim();
  if (!text) return bad("Which address?");

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  /*
   * Deleted by the text as stored, not by re-parsing it. A rule written before
   * the width limits were tightened can no longer be parsed, and that is
   * exactly the row somebody needs to be able to remove.
   */
  await db.collection("ipBlocks").doc(blockDocId(text)).delete();

  await db.collection("auditLog").add({
    action: "ip.unblock",
    rule: text,
    actorUid: guard.caller.uid,
    actorEmail: guard.caller.email,
    at: new Date(),
  });

  invalidate();

  return NextResponse.json({ ok: true, removed: text });
}
