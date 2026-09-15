import { NextResponse } from "next/server";

import { getAllProducts, getShippingMethods } from "@/lib/catalog";
import { categoryPathsFor, evaluateOffer, findOfferByCode, redemptionId } from "@/lib/offers";
import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { demoOffers } from "@/data/demo";
import type { CartItem, Offer } from "@/types";

/**
 * Validate a coupon against a basket, server-side.
 *
 * The cart used to decide this from the list of *active* offers it was handed,
 * which produced the worst possible message: a code that had simply expired
 * came back as "not recognised", so the customer assumed they had mistyped it
 * and tried again. Worse, two rules could not be checked in the browser at all
 * — the per-customer redemption limit and the first-order-only flag both need
 * history the client does not have — so the cart would accept a code that the
 * checkout then refused, with no explanation in between.
 *
 * This endpoint sees every coupon and the caller's own redemption count, and
 * returns the same evaluation the checkout transaction will reach.
 *
 * **It does not leak.** A coupon assigned to another account reports "not
 * recognised" rather than "not valid on this account", because the latter
 * confirms the code exists — which is all an attacker guessing at gift codes
 * needs to know.
 */

export const dynamic = "force-dynamic";

interface Body {
  code?: string;
  items?: CartItem[];
}

const MAX_LINES = 40;

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request body." }, { status: 400 });
  }

  const code = String(body.code ?? "").trim();
  if (!code) {
    return NextResponse.json({ ok: false, error: "A code is required." }, { status: 400 });
  }

  /*
   * Lines are used for scope and subtotal only, and every price is re-read
   * from the catalogue — the browser's numbers decide nothing here, exactly as
   * at checkout.
   */
  const lines = Array.isArray(body.items) ? body.items.slice(0, MAX_LINES) : [];
  const products = await getAllProducts();

  const priced: CartItem[] = [];
  for (const line of lines) {
    const product = products.find((p) => p.id === line.productId);
    if (!product) continue;
    const variant = product.variants?.find(
      (v) => v.colorId === line.colorId && v.sizeId === line.sizeId,
    );
    priced.push({
      ...line,
      unitPrice: variant?.priceOverride ?? product.price,
      quantity: Math.max(1, Math.min(Math.floor(Number(line.quantity) || 1), 10)),
      currency: product.currency,
    });
  }

  const subtotal = priced.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  /* --- find the coupon among *all* of them, not just the live ones ------- */

  let offers: Offer[] = demoOffers;
  let uid: string | null = null;
  let userUsage = 0;
  let isFirstOrder: boolean | undefined;

  if (isAdminConfigured()) {
    const caller = await verifyRequest(request);
    uid = caller?.uid ?? null;

    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const snap = await db.collection("offers").get();
    if (!snap.empty) {
      offers = snap.docs.map((d) => ({ ...(d.data() as Offer), id: d.id }));
    }

    const offer = findOfferByCode(offers, code);

    if (offer && uid) {
      const redemption = await db
        .collection("offerRedemptions")
        .doc(redemptionId(offer.id, uid))
        .get();
      userUsage = (redemption.data()?.count as number | undefined) ?? 0;

      // Only asked for when a coupon actually cares, to keep the common path
      // to a single read.
      if (offer.firstOrderOnly) {
        const prior = await db
          .collection("orders")
          .where("uid", "==", uid)
          .limit(1)
          .get();
        isFirstOrder = prior.empty;
      }
    }
  }

  const offer = findOfferByCode(offers, code);

  // Someone else's personal code must be indistinguishable from a typo.
  if (offer?.assignedUid && offer.assignedUid !== uid) {
    return NextResponse.json({
      ok: false,
      reason: "not-found",
      message: { en: "That code is not recognised.", ar: "هذا الرمز غير معروف." },
    });
  }

  const verdict = evaluateOffer(offer, {
    items: priced,
    subtotal,
    currency: priced[0]?.currency ?? "JOD",
    userUsage,
    uid,
    isFirstOrder,
    categoryPaths: categoryPathsFor(products),
  });

  /*
   * Free-shipping coupons report what they are actually worth on this basket,
   * so the cart can show "saves 5.000 JOD" rather than a vague badge.
   */
  let shippingSaving = 0;
  if (verdict.ok && verdict.freeShipping) {
    const methods = await getShippingMethods();
    shippingSaving = methods[0]?.price ?? 0;
  }

  return NextResponse.json({
    ok: verdict.ok,
    reason: verdict.reason ?? null,
    message: verdict.message,
    discount: verdict.discount,
    freeShipping: verdict.freeShipping,
    shippingSaving,
    ...(verdict.ok && offer
      ? { offer: { id: offer.id, code: offer.code, title: offer.title, type: offer.type } }
      : {}),
  });
}
