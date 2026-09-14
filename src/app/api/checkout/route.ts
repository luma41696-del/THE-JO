import { NextResponse } from "next/server";

import {
  getActiveOffers,
  getAllProducts,
  getShippingClasses,
  getShippingMethods,
} from "@/lib/catalog";
import { priceCart } from "@/lib/pricing";
import { hasOptions, resolveSelection } from "@/lib/product";
import { classesInCart } from "@/lib/shipping";
import { cartKey, orderReference } from "@/lib/utils";
import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import type { CartItem, Order, OrderEvent } from "@/types";

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
  quantity: number;
}

interface CheckoutBody {
  email?: string;
  items?: CheckoutLine[];
  shippingMethodId?: string;
  offerCode?: string | null;
  paymentMethod?: Order["paymentMethod"];
  shippingAddress?: Order["shippingAddress"];
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

  if (process.env.NODE_ENV === "production" && body.paymentMethod !== "cod") {
    return bad("Only cash on delivery is currently available.");
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

  const [products, shippingMethods, shippingClasses, offers] = await Promise.all([
    getAllProducts(),
    getShippingMethods(),
    getShippingClasses(),
    getActiveOffers(),
  ]);

  const priced: CartItem[] = [];

  for (const line of lines) {
    const product = products.find((p) => p.id === line.productId);
    if (!product || product.status !== "active") {
      return bad(`A piece in your bag is no longer available.`);
    }

    const variable = hasOptions(product);
    const colorId = variable ? String(line.colorId ?? "") : "";
    const sizeId = variable ? String(line.sizeId ?? "") : "";

    if (variable) {
      const color = product.colors.find((c) => c.id === colorId);
      const size = product.sizes.find((sz) => sz.id === sizeId);
      if (!color || !size) return bad("That colour and size combination is not available.");
    }

    const image = product.images.find((i) => i.colorId === colorId) ?? product.images[0];
    if (!image) return bad("Product imagery is missing.");

    /*
     * Re-resolve the trade item from Firestore. Everything the browser sent
     * about this line — SKU, GTIN, price, and how many it was allowed to add —
     * is discarded here. A tampered localStorage can ask for a hundred of a
     * one-per-order item; the cap it actually gets is the one the catalogue
     * says, and the order is rejected rather than silently trimmed, because
     * quietly shipping fewer than someone paid for is the worse failure.
     */
    const selection = resolveSelection(product, colorId, sizeId);
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
      key: cartKey(product.id, colorId, sizeId),
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

  const totals = priceCart({ items: priced, shippingMethod, shippingClasses, offer });

  /* --- persist ----------------------------------------------------------- */

  const reference = orderReference();
  const now = Date.now();

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
    items: priced,
    totals,
    shippingAddress: { ...address, id: "shipping", isDefault: false },
    shippingMethod,
    ...(offer ? { appliedOfferCode: offer.code } : {}),
    paymentMethod: body.paymentMethod ?? "cod",
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
    const db = getAdminDb();

    const orderRef = db.collection("orders").doc();

    await db.runTransaction(async (tx) => {
      // Read every product first: Firestore transactions require all reads to
      // happen before any write.
      const productRefs = priced.map((item) => db.collection("products").doc(item.productId));
      const snapshots = productRefs.length ? await tx.getAll(...productRefs) : [];

      snapshots.forEach((snapshot, index) => {
        const item = priced[index];
        if (!item) return;
        if (!snapshot.exists) return; // demo catalogue — nothing to decrement

        const stock = (snapshot.data()?.totalStock as number | undefined) ?? 0;
        if (stock < item.quantity) {
          throw new Error(`${item.title.en} sold out while you were checking out.`);
        }
        tx.update(snapshot.ref, {
          totalStock: stock - item.quantity,
          inStock: stock - item.quantity > 0,
        });
      });

      tx.set(orderRef, { ...order, createdAt: new Date(now), updatedAt: new Date(now) });

      if (offer) {
        tx.update(db.collection("offers").doc(offer.id), {
          usageCount: offer.usageCount + 1,
        });
      }
    });

    return NextResponse.json({
      ok: true,
      reference,
      orderId: orderRef.id,
      total: totals.total,
      persisted: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "We could not place your order. Please try again.";
    // 409: the request was well-formed but lost a race for stock.
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}
