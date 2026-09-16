import { NextResponse } from "next/server";

import {
  getActiveOffers,
  getAllProducts,
  getShippingClasses,
  getShippingMethods,
  getShippingZones,
} from "@/lib/catalog";
import { priceCart } from "@/lib/pricing";
import { notifyOrder } from "@/lib/notify/queue";
import { DEFAULT_PAYMENT_METHOD, isPaymentMethodEnabled } from "@/lib/payments";
import { getStoreSettings } from "@/lib/settings";
import {
  designFor,
  hasDesigns,
  hasOptions,
  imagesFor,
  requiredAxes,
  resolveSelection,
} from "@/lib/product";
import { classesInCart, zoneFor } from "@/lib/shipping";
import { categoryPathsFor, evaluateOffer, redemptionId } from "@/lib/offers";
import {
  balanceOf,
  earnEntryFor,
  earnableAmount,
  pointsForOrder,
  type LedgerEntry,
} from "@/lib/loyalty";
import { isPurchasable, unavailableReason } from "@/lib/visibility";
import { cartKey, orderReference } from "@/lib/utils";
import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import type {
  CartItem,
  Locale,
  Localized,
  Offer,
  Order,
  OrderEvent,
  ProductVariant,
} from "@/types";

/**
 * Order creation.
 *
 * The single security boundary of the store. Everything the browser sends is
 * treated as a *request*, never as fact:
 *
 *   - prices come from the catalogue, never from the request body;
 *   - the discount code is re-validated against its window and limits;
 *   - the shipping method is looked up, not accepted;
 *   - quantities are clamped to available stock;
 *   - stock is decremented inside a Firestore transaction, so two people
 *     buying the last piece cannot both succeed.
 *
 * The client's own total is never even read. If it disagrees with ours, ours is
 * what gets charged.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckoutLine {
  productId: string;
  colorId: string;
  sizeId: string;
  /** The chosen artwork, on products that sell several. */
  designId?: string;
  /**
   * Axes beyond colour, size and artwork, as the bag recorded them.
   *
   * Only `id` and `valueId` are read; the labels the browser sends are
   * rebuilt from the catalogue, exactly like the price.
   */
  attributes?: { id?: unknown; valueId?: unknown }[];
  quantity: number;
}

interface CheckoutBody {
  email?: string;
  items?: CheckoutLine[];
  shippingMethodId?: string;
  offerCode?: string | null;
  paymentMethod?: Order["paymentMethod"];
  shippingAddress?: Order["shippingAddress"];
  locale?: Locale;
  /**
   * Generated once per checkout attempt by the client and resent on retry.
   * The first request to claim it creates the order; later ones are told
   * about that order instead of creating a second.
   */
  idempotencyKey?: string;
}

const MAX_LINES = 40;
const MAX_QTY_PER_LINE = 10;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && !isAdminConfigured()) {
    return bad("Checkout is temporarily unavailable. Please try again later.", 503);
  }

  let body: CheckoutBody;
  try {
    body = (await request.json()) as CheckoutBody;
  } catch {
    return bad("Malformed request body.");
  }

  /*
   * The method must be one the shop can actually take money with — checked
   * against the same list the checkout renders from, not against NODE_ENV.
   *
   * An environment check would have meant a development build accepting a
   * card order that production refuses, which is the wrong way round: the
   * thing you want to discover in development is precisely that the card
   * path does not work yet.
   */
  const paymentMethod = body.paymentMethod ?? DEFAULT_PAYMENT_METHOD;
  if (!isPaymentMethodEnabled(paymentMethod)) {
    return bad("That payment method is not available.");
  }

  /* --- shape validation ------------------------------------------------- */

  const lines = body.items ?? [];
  if (!Array.isArray(lines) || lines.length === 0) return bad("Your bag is empty.");
  if (lines.length > MAX_LINES) return bad("Too many lines in one order.");

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return bad("A valid email is required.");

  const address = body.shippingAddress;
  if (!address?.fullName || !address.line1 || !address.city || !address.phone) {
    return bad("A complete delivery address is required.");
  }

  /* --- identity (optional: guests may check out) ------------------------ */

  const caller = isAdminConfigured() ? await verifyRequest(request) : null;

  /* --- re-price from the catalogue -------------------------------------- */

  const [products, shippingMethods, shippingClasses, shippingZones, offers] = await Promise.all([
    getAllProducts(),
    getShippingMethods(),
    getShippingClasses(),
    getShippingZones(),
    getActiveOffers(),
  ]);

  // One clock for the whole request: a schedule that flips between the
  // visibility check and the order write would be a race against itself.
  const now = Date.now();

  const priced: CartItem[] = [];

  for (const line of lines) {
    const product = products.find((p) => p.id === line.productId);
    if (!product || product.status !== "active") {
      return bad(`A piece in your bag is no longer available.`);
    }

    /*
     * A product pulled for the season is unbuyable, and the check lives here
     * because this is the only door that cannot be walked around. Hiding it
     * from the listings stops a customer *finding* it; it does nothing about a
     * cart saved in October, a bookmarked link, or a direct POST to this
     * route — and stock would be decremented for a piece the warehouse has
     * deliberately taken off the floor.
     *
     * The message says "not available", never "sold out": the stock claim
     * would be false, and there is nothing to gain by telling a customer the
     * piece exists and is being withheld.
     */
    if (!isPurchasable(product, now)) {
      const reason = unavailableReason(product, now);
      return bad(reason?.en ?? `${product.title.en} is not available at the moment.`);
    }

    const variable = hasOptions(product);
    const colorId = variable ? String(line.colorId ?? "") : "";
    const sizeId = variable ? String(line.sizeId ?? "") : "";
    const designId = String(line.designId ?? "");

    /*
     * Axes beyond colour, size and artwork, taken as ids only.
     *
     * The browser also sends the labels it rendered; those are ignored the
     * same way its price is, and rebuilt below from the catalogue. A line
     * claiming "1.5 L" while pointing at the 1.7 L row would otherwise put one
     * thing on the invoice and another in the box.
     */
    const chosenValues: Record<string, string> = {};
    if (variable && Array.isArray(line.attributes)) {
      for (const entry of line.attributes) {
        if (!entry || typeof entry !== "object") continue;
        const id = String((entry as { id?: unknown }).id ?? "").trim();
        const valueId = String((entry as { valueId?: unknown }).valueId ?? "").trim();
        if (id && valueId) chosenValues[id] = valueId;
      }
    }

    /*
     * Every axis the product declares has to be answered, or the line is
     * refused rather than resolved to whichever row sorts first. "Which
     * capacity" is not a question the warehouse should be left guessing.
     */
    const unanswered = requiredAxes(product).find((id) => !chosenValues[id]);
    if (unanswered) {
      const axis = product.attributes?.find((a) => a.id === unanswered);
      return bad(`Choose ${axis?.name.en ?? unanswered} for ${product.title.en}.`);
    }

    const chosenAttributes: {
      id: string;
      name: Localized;
      valueId: string;
      valueLabel: Localized;
    }[] = [];

    for (const attribute of product.attributes ?? []) {
      const wanted = chosenValues[attribute.id];
      if (!wanted) continue;
      const value = attribute.values.find((v) => v.id === wanted);
      // A value the catalogue does not have is a tampered line, not a typo.
      if (!value) return bad(`That option of ${product.title.en} is not available.`);
      chosenAttributes.push({
        id: attribute.id,
        name: attribute.name,
        valueId: value.id,
        valueLabel: value.label,
      });
    }

    if (variable) {
      const color = product.colors.find((c) => c.id === colorId);
      const size = product.sizes.find((sz) => sz.id === sizeId);
      if (!color || !size) return bad("That colour and size combination is not available.");
    }

    /*
     * The artwork is validated against the catalogue, not accepted as sent.
     * A design id that was withdrawn, or invented, must not reach the bench —
     * and a product that offers artwork cannot be ordered without one, or the
     * packing slip would say "Bone / M" and nothing else.
     */
    const design = designId ? designFor(product, designId) : undefined;
    if (designId && (!design || design.available === false)) {
      return bad(`That design of ${product.title.en} is not available.`);
    }
    if (hasDesigns(product) && !design) {
      return bad(`Choose a design for ${product.title.en}.`);
    }

    const image = imagesFor(product, designId, colorId)[0] ?? product.images[0];
    if (!image) return bad("Product imagery is missing.");

    /*
     * Re-resolve the trade item from Firestore. Everything the browser sent
     * about this line — SKU, GTIN, price, and how many it was allowed to add —
     * is discarded here. A tampered localStorage can ask for a hundred of a
     * one-per-order item; the cap it actually gets is the one the catalogue
     * says, and the order is rejected rather than silently trimmed, because
     * quietly shipping fewer than someone paid for is the worse failure.
     */
    const selection = resolveSelection(product, colorId, sizeId, designId, chosenValues);
    if (!selection.buyable || selection.cap.max < 1) {
      return bad(`${product.title.en} has sold out.`);
    }

    const requested = Math.max(1, Math.floor(Number(line.quantity) || 1));
    const ceiling = Math.min(selection.cap.max, MAX_QTY_PER_LINE);
    if (requested > ceiling) {
      return bad(
        selection.cap.reason === "per-order"
          ? `${product.title.en} is limited to ${ceiling} per order.`
          : `Only ${ceiling} of ${product.title.en} remain.`,
      );
    }

    priced.push({
      key: cartKey(product.id, colorId, sizeId, designId, chosenValues),
      productId: product.id,
      sku: selection.sku,
      ...(selection.gtin === undefined ? {} : { gtin: selection.gtin }),
      slug: product.slug,
      title: product.title,
      image,
      colorId,
      colorName: product.colors.find((c) => c.id === colorId)?.name ?? { en: "", ar: "" },
      sizeId,
      sizeLabel: product.sizes.find((sz) => sz.id === sizeId)?.label ?? "",
      ...(design ? { designId, designName: design.name } : {}),
      ...(chosenAttributes.length > 0 ? { attributes: chosenAttributes } : {}),
      // Authoritative price. The browser's number never reaches this object.
      unitPrice: selection.price,
      ...(product.compareAtPrice === undefined ? {} : { compareAtPrice: product.compareAtPrice }),
      currency: product.currency,
      quantity: requested,
      maxQuantity: ceiling,
      maxReason: selection.cap.reason,
      ...(product.shippingClassId === undefined
        ? {}
        : { shippingClassId: product.shippingClassId }),
      addedAt: Date.now(),
    });
  }

  const shippingMethod =
    shippingMethods.find((m) => m.id === body.shippingMethodId) ?? shippingMethods[0];
  if (!shippingMethod) return bad("No delivery method is available.");

  /*
   * A class can forbid a speed outright. The picker hides those, but the
   * request is re-checked here — the client is not the gatekeeper, and an
   * order that promises same-day for a bulky coat is a promise the warehouse
   * cannot keep.
   */
  const blocking = classesInCart(priced, shippingClasses).filter((c) =>
    c.excludedSpeeds.includes(shippingMethod.speed),
  );
  if (blocking.length > 0) {
    return bad(
      `${shippingMethod.name.en} is not available for ${blocking
        .map((c) => c.name.en.toLowerCase())
        .join(" and ")} items.`,
    );
  }

  const offer = body.offerCode
    ? (offers.find((o) => o.code.toLowerCase() === String(body.offerCode).toLowerCase()) ?? null)
    : null;

  /*
   * The zone is resolved here from the address the order actually carries,
   * never taken from the request. The browser computed one to show a price;
   * this one decides what is charged, and the two agreeing is the point of
   * both calling the same `zoneFor`.
   */
  const shippingZone = zoneFor(shippingZones, address);

  if (shippingZone?.excluded) {
    // The client blocks this at the address step. A direct POST does not go
    // through that step, and an order the courier cannot deliver is worse
    // than a refusal the customer can act on.
    return bad(`We do not deliver to ${shippingZone.name.en} yet.`);
  }

  const totals = priceCart({
    items: priced,
    shippingMethod,
    shippingClasses,
    shippingZone,
    offer,
  });

  /* --- persist ----------------------------------------------------------- */

  const reference = orderReference();

  const timeline: OrderEvent[] = [
    {
      status: "pending",
      at: now,
      note: { en: "Order received", ar: "تم استلام الطلب" },
    },
  ];

  const order: Omit<Order, "id"> = {
    reference,
    uid: caller?.uid ?? "guest",
    email,
    locale: body.locale === "ar" ? "ar" : "en",
    items: priced,
    totals,
    shippingAddress: { ...address, id: "shipping", isDefault: false },
    shippingMethod,
    ...(offer ? { appliedOfferCode: offer.code } : {}),
    paymentMethod,
    status: "pending",
    timeline,
    estimatedDeliveryAt: now + shippingMethod.maxDays * 86_400_000,
    createdAt: now,
    updatedAt: now,
  };

  if (!isAdminConfigured()) {
    // Development path: the storefront and the whole flow are exercisable
    // before a service account exists. Nothing is written, and the response
    // says so explicitly rather than pretending an order was stored.
    return NextResponse.json({
      ok: true,
      reference,
      total: totals.total,
      persisted: false,
      note:
        "Firebase Admin is not configured, so this order was priced and validated " +
        "but not written. Add FIREBASE_ADMIN_* to .env.local to persist orders.",
    });
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const db = getAdminDb();

    const orderRef = db.collection("orders").doc();
    const uid = caller?.uid ?? null;

    /*
     * Idempotency.
     *
     * A customer who taps "Place order" twice, or whose phone retries a
     * request that actually succeeded, must end up with one order and one
     * coupon redemption. The client sends a key it generates once per
     * checkout attempt; the first request to claim it wins, and every later
     * request with the same key is told about the order that already exists
     * rather than creating a second one.
     */
    const idempotencyKey =
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim().slice(0, 128)
        : null;
    const claimRef = idempotencyKey
      ? db.collection("checkoutClaims").doc(idempotencyKey)
      : null;

    const result = await db.runTransaction(async (tx) => {
      /* ---- reads (Firestore requires all reads before any write) -------- */

      if (claimRef) {
        const claim = await tx.get(claimRef);
        if (claim.exists) {
          const data = claim.data() ?? {};
          // Already processed. Return the original outcome untouched — no
          // second order, no second redemption, no second stock decrement.
          return {
            duplicate: true,
            reference: String(data.reference ?? reference),
            orderId: String(data.orderId ?? orderRef.id),
            total: Number(data.total ?? totals.total),
          };
        }
      }

      /*
       * Aggregate by product before reading.
       *
       * Two lines of the same product (two sizes of one shirt) hit the same
       * document. Reading it once per line and subtracting from the value
       * each read returned would apply only the last subtraction — the
       * classic lost update, and the reason a two-size order used to leave
       * stock too high.
       */
      const wanted = new Map<string, { total: number; lines: typeof priced }>();
      for (const item of priced) {
        const entry = wanted.get(item.productId) ?? { total: 0, lines: [] };
        entry.total += item.quantity;
        entry.lines.push(item);
        wanted.set(item.productId, entry);
      }

      const productIds = [...wanted.keys()];
      const productRefs = productIds.map((id) => db.collection("products").doc(id));
      const snapshots = productRefs.length ? await tx.getAll(...productRefs) : [];

      const offerRef = offer ? db.collection("offers").doc(offer.id) : null;
      const offerSnap = offerRef ? await tx.get(offerRef) : null;

      const redemptionRef =
        offer && uid
          ? db.collection("offerRedemptions").doc(redemptionId(offer.id, uid))
          : null;
      const redemptionSnap = redemptionRef ? await tx.get(redemptionRef) : null;

      /*
       * The account's points history, read here with everything else.
       *
       * Firestore wants every read in a transaction before any write, and the
       * tier this order earns at is derived from the ledger — so it is read
       * now rather than outside, where a concurrent redemption could make the
       * balance we credit against one that no longer exists.
       */
      const loyaltySnap = uid
        ? await tx.get(
            db
              .collection("loyalty")
              .doc(uid)
              .collection("entries")
              .orderBy("at", "desc")
              .limit(500),
          )
        : null;
      const loyaltyBalance = loyaltySnap
        ? balanceOf(
            loyaltySnap.docs.map((doc) => ({
              id: doc.id,
              ...(doc.data() as Omit<LedgerEntry, "id">),
            })),
            now,
          )
        : null;

      /* ---- coupon: re-check against numbers read inside the tx ---------- */

      let freshOffer: Offer | null = null;
      if (offer && offerSnap) {
        /*
         * The coupon is re-evaluated here, not trusted from the earlier
         * validation. Between that check and this transaction the last
         * redemption may have been taken by someone else — and `usageCount`
         * read outside a transaction is exactly how a "5000 uses" campaign
         * hands out 5003. This read is serialised with the write below.
         */
        freshOffer = offerSnap.exists
          ? ({ ...(offerSnap.data() as Offer), id: offerSnap.id } as Offer)
          : offer;

        const userUsage = (redemptionSnap?.data()?.count as number | undefined) ?? 0;
        const verdict = evaluateOffer(freshOffer, {
          items: priced,
          subtotal: totals.subtotal,
          now,
          currency: totals.currency,
          userUsage,
          uid,
          categoryPaths: categoryPathsFor(products),
        });

        if (!verdict.ok) {
          // The customer's language is chosen by the caller; English is the
          // API's own tongue and the storefront maps the reason code back.
          throw new CheckoutRejection(verdict.message.en, verdict.reason ?? "not-active");
        }
      }

      /* ---- writes ------------------------------------------------------- */

      snapshots.forEach((snapshot, index) => {
        const productId = productIds[index];
        if (!productId) return;
        const entry = wanted.get(productId);
        if (!entry || !snapshot.exists) return; // demo catalogue — nothing to decrement

        const data = snapshot.data() ?? {};
        const variants = Array.isArray(data.variants)
          ? ([...data.variants] as ProductVariant[])
          : null;

        if (variants) {
          /*
           * Decrement the *chosen* variant, not the product total. Stock
           * lives per permutation, so taking it off the parent left the
           * medium sold out in reality and available on screen.
           */
          for (const line of entry.lines) {
            const index_ = variants.findIndex(
              (v) =>
                v.colorId === line.colorId &&
                v.sizeId === line.sizeId &&
                // An unscoped row predates designs and serves them all.
                (!v.designId || v.designId === (line.designId ?? "")),
            );
            if (index_ === -1) continue;
            const variant = variants[index_]!;
            if (variant.stock < line.quantity) {
              throw new CheckoutRejection(
                `${line.title.en} (${line.sizeLabel}) sold out while you were checking out.`,
                "sold-out",
              );
            }
            variants[index_] = { ...variant, stock: variant.stock - line.quantity };
          }
          const total = variants.reduce((sum, v) => sum + v.stock, 0);
          tx.update(snapshot.ref, { variants, totalStock: total, inStock: total > 0 });
        } else {
          const stock = (data.totalStock as number | undefined) ?? 0;
          if (stock < entry.total) {
            throw new CheckoutRejection(
              `${entry.lines[0]?.title.en ?? "An item"} sold out while you were checking out.`,
              "sold-out",
            );
          }
          tx.update(snapshot.ref, {
            totalStock: stock - entry.total,
            inStock: stock - entry.total > 0,
          });
        }
      });

      tx.set(orderRef, { ...order, createdAt: new Date(now), updatedAt: new Date(now) });

      if (offerRef) {
        // `increment` rather than a read value: the read above guards the
        // limit, and the atomic op guards the arithmetic.
        tx.update(offerRef, { usageCount: FieldValue.increment(1) });
      }

      if (redemptionRef && offer && uid) {
        tx.set(
          redemptionRef,
          {
            offerId: offer.id,
            uid,
            count: FieldValue.increment(1),
            orderIds: FieldValue.arrayUnion(orderRef.id),
            firstUsedAt: redemptionSnap?.exists
              ? (redemptionSnap.data()?.firstUsedAt ?? now)
              : now,
            lastUsedAt: now,
          },
          { merge: true },
        );
      }

      if (claimRef) {
        tx.set(claimRef, {
          orderId: orderRef.id,
          reference,
          total: totals.total,
          uid,
          at: new Date(now),
        });
      }

      /*
       * Points, inside the same transaction as the order.
       *
       * They have to land together. An order that commits without its points
       * is a customer who paid and was not credited — which they notice, and
       * which nobody can reconstruct afterwards without reading the order log
       * by hand. Points written first for an order that then fails are worse:
       * a balance from a purchase that never happened.
       *
       * Guests earn nothing, because there is no account to credit. The tier
       * is read from the ledger, so a customer crossing into silver on this
       * order earns the new rate from the next one — the alternative is
       * counting the order towards the tier it is itself being paid at, which
       * pays the higher rate on the purchase that only just qualified.
       */
      if (uid) {
        const spend = earnableAmount(totals);
        const points = pointsForOrder(totals, loyaltyBalance?.lifetimeSpend ?? 0);
        if (points > 0) {
          const entry = earnEntryFor({
            uid,
            orderId: orderRef.id,
            orderReference: reference,
            points,
            spend,
            now,
          });
          tx.set(
            db.collection("loyalty").doc(uid).collection("entries").doc(entry.docId),
            entry.data,
          );
        }
      }

      return {
        duplicate: false,
        reference,
        orderId: orderRef.id,
        total: totals.total,
      };
    });

    /*
     * Confirm by email, after the transaction has committed.
     *
     * Outside it on purpose: a mail provider being down must never roll back a
     * paid order and the stock decrement that went with it. `notifyOrder`
     * never throws and is idempotent per order, so a retried checkout that
     * lands on the duplicate path cannot send a second confirmation either.
     */
    if (!result.duplicate) {
      const settings = await getStoreSettings();
      await notifyOrder(
        db,
        { ...order, id: result.orderId } as Order,
        "order-received",
        settings,
        now,
      );
    }

    return NextResponse.json({
      ok: true,
      reference: result.reference,
      orderId: result.orderId,
      total: result.total,
      persisted: true,
      ...(result.duplicate ? { duplicate: true } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "We could not place your order. Please try again.";
    const reason = error instanceof CheckoutRejection ? error.reason : "conflict";
    // 409: the request was well-formed but lost a race for stock or a coupon.
    return NextResponse.json({ ok: false, error: message, reason }, { status: 409 });
  }
}

/** Carries a machine-readable reason alongside the human sentence. */
class CheckoutRejection extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "CheckoutRejection";
  }
}
