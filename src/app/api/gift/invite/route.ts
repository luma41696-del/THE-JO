import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { canPlay } from "@/lib/gift";
import type { GiftCampaign } from "@/types";

/**
 * "May I play right now, and what is on the wheel?"
 *
 * The game exists so a customer wins something; a game that waits on a page
 * nobody navigates to does not do that. So the shop now asks *them*, when they
 * sign in — and this is the read that decides whether asking is honest.
 *
 * Read-only by construction: no transaction, no writes, nothing drawn. It
 * answers the same question `/api/gift/play` will answer again, inside its own
 * transaction, at the moment it matters. That duplication is deliberate — an
 * invitation is a guess about the near future, and the only check that can be
 * trusted is the one holding the lock. Being invited is never a promise of a
 * prize, and nothing here can award one.
 *
 * It is also scoped to the caller: a signed-in account reads its own play
 * history and no one else's, which is why it needs the Admin SDK rather than a
 * client query — `giftPlays` is not client-writable and only the owner may
 * read it, but counting them needs a query the rules cannot express per-row.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAdminConfigured()) {
    // No backend here. Say so rather than inventing an eligible customer.
    return NextResponse.json({ ok: true, eligible: false, reason: "no-campaign" });
  }

  const caller = await verifyRequest(request);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const now = Date.now();

    const campaigns = await db
      .collection("giftCampaigns")
      .where("status", "==", "active")
      .limit(1)
      .get();

    const doc = campaigns.docs[0];
    const campaign = doc
      ? ({ ...(doc.data() as GiftCampaign), id: doc.id } as GiftCampaign)
      : null;

    if (!campaign) {
      return NextResponse.json({ ok: true, eligible: false, reason: "no-campaign" });
    }

    const plays = await db
      .collection("giftPlays")
      .where("uid", "==", caller.uid)
      .where("campaignId", "==", campaign.id)
      .get();

    const attempts = plays.size;
    const lastPlayedAt = plays.docs.reduce(
      (latest, play) => Math.max(latest, Number(play.data().playedAt ?? 0)),
      0,
    );

    const verdict = canPlay(campaign, {
      uid: caller.uid,
      now,
      attempts,
      lastPlayedAt: lastPlayedAt || null,
    });

    if (!verdict.ok) {
      /*
       * The reason travels, the campaign does not. Someone in a cooldown has
       * no use for a wheel they cannot spin, and sending the prize list to a
       * browser that will not render it is a payload for nothing.
       */
      return NextResponse.json({
        ok: true,
        eligible: false,
        reason: verdict.reason,
        ...(verdict.nextPlayAt ? { nextPlayAt: verdict.nextPlayAt } : {}),
      });
    }

    return NextResponse.json({
      ok: true,
      eligible: true,
      /*
       * `attempts` is what the browser marks as "asked and answered" — see
       * `inviteWindowKey`. It has to come from the server, because the count
       * is the only thing that distinguishes one turn from the next.
       */
      attempts,
      campaign,
    });
  } catch {
    /*
     * A failure to work out whether someone may play is not worth telling them
     * about: the invitation simply does not appear, the wheel stays where it
     * has always been, and nothing about the shop is broken for them.
     */
    return NextResponse.json({ ok: true, eligible: false, reason: "no-campaign" });
  }
}
