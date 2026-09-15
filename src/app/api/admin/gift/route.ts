import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import type { GiftCampaign, GiftPrize, Localized } from "@/types";

/**
 * Gift campaign configuration.
 *
 * Two validations here are load-bearing, and both exist because the failure is
 * silent otherwise:
 *
 *  - **`issued` is never accepted from the request.** It is the counter that
 *    enforces a prize's quantity, and it moves only inside the draw
 *    transaction. A save that could reset it would hand back prizes that were
 *    already given out, and nothing would look wrong.
 *  - **At least one prize must have weight.** A campaign where every weight is
 *    zero produces a wheel that cannot land anywhere; the draw returns null and
 *    every customer sees an error they cannot act on.
 */

interface Body {
  id?: string;
  name?: Localized;
  kind?: "wheel" | "scratch";
  prizes?: GiftPrize[];
  startsAt?: number;
  endsAt?: number;
  cooldownHours?: number;
  maxAttempts?: number | null;
  terms?: Localized | null;
  status?: GiftCampaign["status"];
}

const STATUSES: GiftCampaign["status"][] = ["draft", "active", "paused", "archived"];
const REWARDS = ["percentage", "fixed", "free-shipping", "none"] as const;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function localized(value: Localized | undefined | null, field: string): Localized | null {
  if (!value) return null;
  if (typeof value.en !== "string" || typeof value.ar !== "string") return null;
  if (!value.en.trim() || !value.ar.trim()) {
    throw new Error(`${field} is required in both English and Arabic.`);
  }
  return { en: value.en.trim(), ar: value.ar.trim() };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  let name: Localized | null;
  let terms: Localized | null;
  try {
    name = localized(body.name, "Name");
    terms = body.terms ? localized(body.terms, "Terms") : null;
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Invalid text.");
  }
  if (!name) return bad("A campaign name is required in both languages.");

  const startsAt = Number(body.startsAt);
  const endsAt = Number(body.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
    return bad("A start and end date are required.");
  }
  if (endsAt <= startsAt) return bad("The end of the window must be after its start.");

  const status = STATUSES.includes(body.status as GiftCampaign["status"])
    ? (body.status as GiftCampaign["status"])
    : "draft";

  if (status === "active" && endsAt <= Date.now()) {
    return bad("This window has already closed. Set a future end date, or save it as a draft.");
  }

  const incoming = Array.isArray(body.prizes) ? body.prizes : [];
  if (incoming.length < 2) {
    return bad("A wheel needs at least two slices.");
  }

  const prizes = incoming.slice(0, 12).map((prize, index) => {
    let label: Localized | null = null;
    try {
      label = localized(prize.label, `Prize ${index + 1} label`);
    } catch {
      label = null;
    }
    return {
      id: String(prize.id ?? `p${index + 1}`),
      label: label ?? { en: `Prize ${index + 1}`, ar: `جائزة ${index + 1}` },
      reward: REWARDS.includes(prize.reward as (typeof REWARDS)[number])
        ? prize.reward
        : ("none" as const),
      value: Math.max(0, Number(prize.value) || 0),
      ...(prize.maxDiscount ? { maxDiscount: Math.max(0, Number(prize.maxDiscount)) } : {}),
      validForDays: Math.max(1, Math.floor(Number(prize.validForDays) || 14)),
      ...(prize.minSubtotal ? { minSubtotal: Math.max(0, Number(prize.minSubtotal)) } : {}),
      weight: Math.max(0, Number(prize.weight) || 0),
      ...(prize.quantity === undefined || prize.quantity === null
        ? {}
        : { quantity: Math.max(0, Math.floor(Number(prize.quantity))) }),
      // `issued` is deliberately absent — see the note at the top.
    };
  });

  if (prizes.every((p) => p.weight <= 0)) {
    return bad("At least one prize needs a weight above zero, or the wheel cannot land.");
  }

  const percentage = prizes.find((p) => p.reward === "percentage" && p.value > 100);
  if (percentage) return bad("A percentage prize cannot be more than 100%.");

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false, validated: { name, prizes } });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to run campaigns.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const ref = body.id
      ? db.collection("giftCampaigns").doc(body.id)
      : db.collection("giftCampaigns").doc();

    const existing = body.id ? await ref.get() : null;
    if (body.id && !existing?.exists) return bad("That campaign no longer exists.", 404);

    /*
     * Carry each prize's issued count across the edit. Editing a running
     * campaign must not reset how many of a limited prize have already gone
     * out — a prize matched by id keeps its counter, and a genuinely new one
     * starts at zero.
     */
    const before = (existing?.data()?.prizes ?? []) as GiftPrize[];
    const merged = prizes.map((prize) => ({
      ...prize,
      issued: before.find((p) => p.id === prize.id)?.issued ?? 0,
    }));

    /*
     * One active campaign at a time. Two would make "the campaign" ambiguous
     * for the draw, which reads the first active one — and whichever it picked
     * would look arbitrary to the merchant.
     */
    if (status === "active") {
      const others = await db
        .collection("giftCampaigns")
        .where("status", "==", "active")
        .get();
      const batch = db.batch();
      for (const doc of others.docs) {
        if (doc.id === ref.id) continue;
        batch.update(doc.ref, { status: "paused", updatedAt: new Date() });
      }
      await batch.commit();
    }

    await ref.set(
      {
        name,
        kind: body.kind === "scratch" ? "scratch" : "wheel",
        prizes: merged,
        startsAt,
        endsAt,
        cooldownHours: Math.max(0, Math.floor(Number(body.cooldownHours) || 24)),
        ...(body.maxAttempts === null || body.maxAttempts === undefined
          ? {}
          : { maxAttempts: Math.max(1, Math.floor(Number(body.maxAttempts))) }),
        ...(terms ? { terms } : {}),
        status,
        ...(existing?.exists ? {} : { createdAt: new Date() }),
        updatedAt: new Date(),
      },
      { merge: true },
    );

    await db.collection("auditLog").add({
      action: body.id ? "gift.update" : "gift.create",
      campaignId: ref.id,
      status,
      prizes: merged.length,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    return NextResponse.json({ ok: true, persisted: true, id: ref.id });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The campaign could not be saved.", 500);
  }
}
