import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { availablePrizes, canPlay, drawPrize, giftCode } from "@/lib/gift";
import type { GiftCampaign, GiftPrize } from "@/types";

/**
 * Play the gift game.
 *
 * Everything that matters happens inside one transaction, in this order:
 *
 *   1. read the campaign, and this account's play history
 *   2. check eligibility against those numbers
 *   3. draw a prize
 *   4. increment the prize's issued count
 *   5. write the play record
 *   6. mint the coupon
 *
 * Only then does the browser learn what it won, and the animation runs on an
 * outcome that is already committed. The alternatives all fail:
 *
 *  - Drawing in the browser lets anyone pick their own prize.
 *  - Drawing on the server but writing *after* the animation means a closed
 *    tab is a prize the customer saw and never received.
 *  - Checking the cooldown outside the transaction lets two simultaneous
 *    requests both see "no plays yet" and both win.
 *
 * `POST` is not idempotent here on purpose — a second play is a second play —
 * but a refresh cannot replay one, because the cooldown is re-read from
 * committed data every time.
 */

function bad(message: string, status = 400, reason?: string) {
  return NextResponse.json({ ok: false, error: message, ...(reason ? { reason } : {}) }, { status });
}

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({
      ok: false,
      error: "The gift game needs the store's backend, which is not configured here.",
      reason: "no-campaign",
    });
  }

  const caller = await verifyRequest(request);
  if (!caller) {
    return bad("Sign in to play — your gift is saved to your account.", 401, "not-signed-in");
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const db = getAdminDb();
    const now = Date.now();

    const result = await db.runTransaction(async (tx) => {
      /* ---- reads ------------------------------------------------------ */

      const campaigns = await tx.get(
        db.collection("giftCampaigns").where("status", "==", "active").limit(1),
      );
      const campaignDoc = campaigns.docs[0];
      const campaign = campaignDoc
        ? ({ ...(campaignDoc.data() as GiftCampaign), id: campaignDoc.id } as GiftCampaign)
        : null;

      /*
       * This account's history, read inside the transaction. A query outside
       * it is the classic double-spend: two taps, two reads of "no plays",
       * two prizes.
       */
      const plays = campaign
        ? await tx.get(
            db
              .collection("giftPlays")
              .where("uid", "==", caller.uid)
              .where("campaignId", "==", campaign.id),
          )
        : null;

      const attempts = plays?.size ?? 0;
      const lastPlayedAt = plays?.docs.reduce(
        (latest, doc) => Math.max(latest, Number(doc.data().playedAt ?? 0)),
        0,
      );

      const verdict = canPlay(campaign, {
        uid: caller.uid,
        now,
        attempts,
        lastPlayedAt: lastPlayedAt || null,
      });
      if (!verdict.ok || !campaign || !campaignDoc) {
        return { ok: false as const, verdict };
      }

      /* ---- draw ------------------------------------------------------- */

      const prize = drawPrize(campaign);
      if (!prize) {
        return {
          ok: false as const,
          verdict: {
            ok: false,
            reason: "exhausted" as const,
            message: {
              en: "Every prize has been claimed. Thank you for playing.",
              ar: "نفدت كل الجوائز. شكراً لمشاركتك.",
            },
          },
        };
      }

      /* ---- writes ----------------------------------------------------- */

      const playRef = db.collection("giftPlays").doc();

      // The issued count guards the prize's quantity, so it moves in the same
      // transaction that awards it.
      const prizes: GiftPrize[] = campaign.prizes.map((p) =>
        p.id === prize.id ? { ...p, issued: (p.issued ?? 0) + 1 } : p,
      );
      tx.update(campaignDoc.ref, { prizes, updatedAt: new Date(now) });

      let offerId: string | undefined;
      let code: string | undefined;
      let expiresAt: number | undefined;

      if (prize.reward !== "none") {
        expiresAt = now + Math.max(1, prize.validForDays) * 86_400_000;
        code = giftCode(`${playRef.id}:${caller.uid}`);
        const offerRef = db.collection("offers").doc();
        offerId = offerRef.id;

        /*
         * The gift is a real coupon, so it goes through the same validation,
         * the same atomic redemption and the same limits as any other code —
         * rather than a parallel discount mechanism with its own bugs.
         *
         * `assignedUid` is what makes it personal: the code is useless on any
         * other account, so a shared screenshot buys nobody anything.
         */
        tx.set(offerRef, {
          code,
          type: prize.reward,
          value: prize.reward === "free-shipping" ? 0 : prize.value,
          ...(prize.maxDiscount ? { maxDiscount: prize.maxDiscount } : {}),
          title: prize.label,
          ...(campaign.terms ? { description: campaign.terms } : {}),
          ...(prize.minSubtotal ? { minSubtotal: prize.minSubtotal } : {}),
          appliesToCategoryIds: [],
          appliesToProductIds: [],
          excludesCategoryIds: [],
          excludesProductIds: [],
          startsAt: now,
          endsAt: expiresAt,
          usageLimit: 1,
          usageCount: 0,
          perUserLimit: 1,
          assignedUid: caller.uid,
          firstOrderOnly: false,
          stackable: false,
          status: "active",
          active: true,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        });
      }

      tx.set(playRef, {
        campaignId: campaign.id,
        uid: caller.uid,
        prizeId: prize.id,
        ...(offerId ? { offerId } : {}),
        ...(code ? { code } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        playedAt: now,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        ok: true as const,
        prize,
        code,
        expiresAt,
        cooldownHours: campaign.cooldownHours,
        remaining: availablePrizes({ ...campaign, prizes }).length,
      };
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: result.verdict.reason,
          message: result.verdict.message,
          ...(("nextPlayAt" in result.verdict && result.verdict.nextPlayAt)
            ? { nextPlayAt: result.verdict.nextPlayAt }
            : {}),
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      // The prize is already written. Whatever the browser does with this
      // response — animate it, crash, close — the record and the coupon exist.
      prize: {
        id: result.prize.id,
        label: result.prize.label,
        reward: result.prize.reward,
        value: result.prize.value,
      },
      ...(result.code ? { code: result.code } : {}),
      ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
      nextPlayAt: Date.now() + result.cooldownHours * 3_600_000,
    });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "The game could not be played. Try again.",
      500,
    );
  }
}
