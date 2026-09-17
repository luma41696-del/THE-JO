import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { storagePathFromUrl, urlsUsedBy, usageAcross } from "@/lib/media";
import { revalidateAll } from "@/lib/revalidate";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { describePlan, emptyPlan, type DeletionPlan } from "@/lib/admin/delete-product";
import type { Product } from "@/types";

/**
 * Deleting a product for good.
 *
 * Two modes on one endpoint, because they have to agree:
 *
 *  - **GET** returns the plan — what would be removed, and what would be kept
 *    and why. The confirmation dialog shows this before anything happens.
 *  - **DELETE** carries it out.
 *
 * Both build the plan with the same function, so the dialog cannot promise one
 * thing and the deletion do another.
 *
 * Administrator only. Archiving is the reversible option and is staff work;
 * this is not reversible by anyone, so it is not.
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
        "Only an administrator can delete a product. Archiving keeps it out of the shop and can be undone.",
        403,
      ),
    } as const;
  }
  return { caller } as const;
}

/**
 * Everything that points at this product.
 *
 * Read before anything is written, so the dialog and the deletion are working
 * from the same picture — and so a failure halfway through has not already
 * half-removed something nobody was told about.
 */
async function buildPlan(
  db: FirebaseFirestore.Firestore,
  product: Product,
): Promise<DeletionPlan> {
  const plan = emptyPlan();

  /*
   * Files, minus anything another product still uses.
   *
   * `usageAcross` with this product ignored is exactly the question: who else
   * points at this file? One photograph can sit on several products through
   * the media library, and removing a shared one leaves a hole on a live page.
   */
  const allProducts = await db.collection("products").get();
  const usage = usageAcross(
    allProducts.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Partial<Product>) })),
    product.id,
  );

  for (const url of urlsUsedBy(product)) {
    const path = storagePathFromUrl(url);
    // A `/demo/…` asset shipped with the shop has no object behind it.
    if (!path) continue;
    const others = usage.get(path);
    if (others && others.count > 0) plan.filesKept.push({ path, usedBy: others.productIds });
    else plan.filesToDelete.push(path);
  }

  const [reviews, alerts, collections, orders, wishlists] = await Promise.all([
    db.collection("reviews").where("productId", "==", product.id).get(),
    db.collection("stockAlerts").where("productId", "==", product.id).get(),
    db.collection("collections").where("productIds", "array-contains", product.id).get(),
    /*
     * Orders are scanned, not queried.
     *
     * `where("items.productId", "==", id)` is the obvious line and Firestore
     * cannot answer it: `items` is an array of maps, and there is no index
     * that reaches a field inside one. Writing it anyway gives a query that
     * always returns nothing and a fallback that always runs — so the scan is
     * the only path, and it is the one written.
     *
     * A thousand is a ceiling, not a guarantee. This number is shown in a
     * dialog and nothing is written to an order either way.
     */
    db.collection("orders").limit(1000).get(),
    db.collection("users").where("wishlist", "array-contains", product.id).get(),
  ]);

  plan.reviewIds = reviews.docs.map((doc) => doc.id);
  plan.alertIds = alerts.docs.map((doc) => doc.id);
  plan.collectionIds = collections.docs.map((doc) => doc.id);
  plan.wishlistUserIds = wishlists.docs.map((doc) => doc.id);

  plan.orderCount = orders.docs.filter((doc) =>
    ((doc.data().items ?? []) as { productId?: string }[]).some(
      (item) => item.productId === product.id,
    ),
  ).length;

  // Other products that name this one as an upsell or a cross-sell.
  plan.linkedProductIds = allProducts.docs
    .filter((doc) => {
      if (doc.id === product.id) return false;
      const data = doc.data() as Partial<Product>;
      return (
        (data.upsellIds ?? []).includes(product.id) ||
        (data.crossSellIds ?? []).includes(product.id)
      );
    })
    .map((doc) => doc.id);

  return plan;
}

async function loadProduct(db: FirebaseFirestore.Firestore, id: string) {
  const snap = await db.collection("products").doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<Product, "id">) } as Product;
}

/* -------------------------------------------------------------------------- */

/** What would happen, without doing any of it. */
export async function GET(request: Request) {
  const guard = await gate(request);
  if (guard.error) return guard.error;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return bad("Which product?");

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  const product = await loadProduct(db, id);
  if (!product) return bad("No such product.", 404);

  const plan = await buildPlan(db, product);
  return NextResponse.json({
    ok: true,
    plan,
    summary: describePlan(plan, product),
    title: product.title,
    slug: product.slug,
  });
}

/* -------------------------------------------------------------------------- */

export async function DELETE(request: Request) {
  const limit = await rateLimit(`product-delete:${callerKey(request)}`, RULES.content);
  if (!limit.ok) return tooManyRequests(limit);

  const guard = await gate(request);
  if (guard.error) return guard.error;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return bad("Which product?");

  const { getAdminDb, getAdminApp } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  const product = await loadProduct(db, id);
  if (!product) return bad("No such product.", 404);

  const plan = await buildPlan(db, product);

  try {
    /*
     * Firestore first, Storage second, the product row last.
     *
     * The order matters on a partial failure. Removing the references while
     * the product still exists leaves a product with no reviews — untidy, and
     * fixable. Removing the product first would leave reviews and wishlist
     * entries pointing at nothing, with no row left to find them from.
     */
    const batchDeletes: FirebaseFirestore.DocumentReference[] = [
      ...plan.reviewIds.map((reviewId) => db.collection("reviews").doc(reviewId)),
      ...plan.alertIds.map((alertId) => db.collection("stockAlerts").doc(alertId)),
    ];

    for (let i = 0; i < batchDeletes.length; i += 400) {
      const batch = db.batch();
      for (const ref of batchDeletes.slice(i, i + 400)) batch.delete(ref);
      await batch.commit();
    }

    // Array memberships: taken out rather than the document deleted.
    const arrayUpdates: { ref: FirebaseFirestore.DocumentReference; field: string }[] = [
      ...plan.collectionIds.map((cid) => ({
        ref: db.collection("collections").doc(cid),
        field: "productIds",
      })),
      ...plan.wishlistUserIds.map((uid) => ({
        ref: db.collection("users").doc(uid),
        field: "wishlist",
      })),
    ];

    for (let i = 0; i < arrayUpdates.length; i += 400) {
      const batch = db.batch();
      for (const { ref, field } of arrayUpdates.slice(i, i + 400)) {
        batch.set(ref, { [field]: FieldValue.arrayRemove(product.id) }, { merge: true });
      }
      await batch.commit();
    }

    // Upsell and cross-sell lists on other products.
    for (let i = 0; i < plan.linkedProductIds.length; i += 400) {
      const batch = db.batch();
      for (const linked of plan.linkedProductIds.slice(i, i + 400)) {
        batch.set(
          db.collection("products").doc(linked),
          {
            upsellIds: FieldValue.arrayRemove(product.id),
            crossSellIds: FieldValue.arrayRemove(product.id),
          },
          { merge: true },
        );
      }
      await batch.commit();
    }

    /*
     * Files. Only the ones nothing else points at — `filesKept` is the rest,
     * and it is reported rather than silently skipped.
     */
    if (plan.filesToDelete.length > 0) {
      const { getStorage } = await import("firebase-admin/storage");
      const bucket = getStorage(getAdminApp()).bucket();
      await Promise.all(
        plan.filesToDelete.map(async (path) => {
          // Already gone satisfies "gone". Failing here would block the
          // deletion on a file somebody removed by hand last month.
          await bucket.file(path).delete({ ignoreNotFound: true });
          await db.collection("media").doc(path.replace(/\//g, "__")).delete().catch(() => {});
        }),
      );
    }

    await db.collection("products").doc(product.id).delete();

    await db.collection("auditLog").add({
      action: "product.delete",
      productId: product.id,
      slug: product.slug,
      title: product.title?.en ?? "",
      filesDeleted: plan.filesToDelete.length,
      filesKept: plan.filesKept.length,
      reviewsDeleted: plan.reviewIds.length,
      alertsDeleted: plan.alertIds.length,
      wishlistsCleaned: plan.wishlistUserIds.length,
      ordersUntouched: plan.orderCount,
      actorUid: guard.caller.uid,
      actorEmail: guard.caller.email,
      at: new Date(),
    });

    // The catalogue, the menus and every cached product page.
    revalidateAll();

    return NextResponse.json({ ok: true, deleted: true, plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "That product could not be deleted.";
    console.error(`[net sale] product delete failed for ${product.id}:`, message);
    return bad(message, 500);
  }
}
