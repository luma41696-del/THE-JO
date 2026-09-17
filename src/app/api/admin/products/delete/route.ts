import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { storagePathFromUrl, urlsUsedBy, usageAcross } from "@/lib/media";
import { revalidateAll } from "@/lib/revalidate";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import {
  describeBatch,
  describePlan,
  emptyPlan,
  mergePlans,
  type DeletionPlan,
} from "@/lib/admin/delete-product";
import type { Product } from "@/types";

/**
 * Deleting products for good — one, or a whole selection.
 *
 * Three doors on one endpoint, because they have to agree:
 *
 *  - **GET `?id=`** returns the plan for one product: what would be removed,
 *    and what would be kept and why. The dialog shows this before anything
 *    happens.
 *  - **DELETE `?id=`** carries that out.
 *  - **POST `{ ids, preview }`** does both for a selection.
 *
 * ## One product is a batch of one
 *
 * There is no separate single-product path. `buildPlans` takes a list and the
 * one-product routes hand it a list of one, so the dialog on a product page
 * and the dialog over a selection cannot drift apart — a guard added to one is
 * a guard on both, and there is no second implementation to forget.
 *
 * ## The thing a batch gets wrong if you write it the obvious way
 *
 * Shared photographs. A file is kept when another product still uses it, so
 * planning each product on its own means two products sharing an image each
 * see the *other* still holding it, each keep it, and the file outlives both
 * with nothing pointing at it. The whole selection is therefore ignored when
 * counting usage, not just the product in hand. This is the entire reason
 * `buildPlans` is plural.
 *
 * ## Why the reads are batched and the writes are not
 *
 * Reads: asking per product would be four queries times the selection, plus a
 * full catalogue read each time. `in` and `array-contains-any` take thirty ids
 * at once, so a selection of any working size is a handful of queries.
 *
 * Writes: each product is deleted on its own, so a failure is *that product's*
 * failure. "Thirty-six went, these three did not, and here is why" is an
 * answer somebody can act on; a half-finished cross-product batch is not.
 *
 * Administrator only. Archiving is the reversible option and is staff work;
 * this is not reversible by anyone, so it is not.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How many products one request will delete.
 *
 * Deliberately small, and smaller than the bulk *edit* route's 200. The client
 * sends a large selection as several requests in turn and shows the progress,
 * which keeps any single request inside the platform's function timeout
 * whatever plan the shop is on — a timeout halfway through a deletion is the
 * one failure with no good report to give.
 */
const MAX_DELETE = 25;

/** Planning only reads, so a preview may cover a selection far larger. */
const MAX_PREVIEW = 200;

/** Firestore's ceiling on `in` and `array-contains-any` comparison values. */
const QUERY_IN_LIMIT = 30;

/** Products deleted at once. Enough to be quick, few enough to stay polite. */
const CONCURRENCY = 4;

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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Reading                                                                    */
/* -------------------------------------------------------------------------- */

interface Catalogue {
  products: ({ id: string } & Partial<Product>)[];
  orders: { id: string; items: { productId?: string }[] }[];
}

/**
 * The two collections that have to be read whole, read once for the request.
 *
 * Orders are scanned rather than queried. `where("items.productId", "==", id)`
 * is the obvious line and Firestore cannot answer it: `items` is an array of
 * maps, and no index reaches a field inside one. Written anyway it gives a
 * query that always matches nothing and a fallback that always runs, so the
 * scan is the only path and it is the one written.
 *
 * A thousand is a ceiling, not a guarantee. The number is shown in a dialog,
 * and nothing is written to an order either way.
 */
async function readCatalogue(db: FirebaseFirestore.Firestore): Promise<Catalogue> {
  const [products, orders] = await Promise.all([
    db.collection("products").get(),
    db.collection("orders").limit(1000).get(),
  ]);

  return {
    products: products.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Partial<Product>) })),
    orders: orders.docs.map((doc) => ({
      id: doc.id,
      items: (doc.data().items ?? []) as { productId?: string }[],
    })),
  };
}

/** Distinct orders holding any of these products — never summed per product. */
function countOrdersTouching(catalogue: Catalogue, ids: Set<string>): number {
  return catalogue.orders.filter((order) =>
    order.items.some((item) => item.productId && ids.has(item.productId)),
  ).length;
}

/**
 * Everything that points at each of these products.
 *
 * Read before anything is written, so the dialog and the deletion work from
 * the same picture — and so a failure partway has not already removed
 * something nobody was told about.
 */
async function buildPlans(
  db: FirebaseFirestore.Firestore,
  catalogue: Catalogue,
  products: Product[],
): Promise<Map<string, DeletionPlan>> {
  const ids = products.map((product) => product.id);
  const selection = new Set(ids);
  const plans = new Map<string, DeletionPlan>(ids.map((id) => [id, emptyPlan()]));

  /*
   * Files. `usageAcross` ignoring the whole selection is exactly the question
   * worth asking: once these are gone, who is left pointing at this file?
   */
  const usage = usageAcross(catalogue.products, selection);
  for (const product of products) {
    const plan = plans.get(product.id)!;
    for (const url of urlsUsedBy(product)) {
      const path = storagePathFromUrl(url);
      // A `/demo/…` asset shipped with the shop has no object behind it.
      if (!path) continue;
      const others = usage.get(path);
      if (others && others.count > 0) plan.filesKept.push({ path, usedBy: others.productIds });
      else plan.filesToDelete.push(path);
    }
  }

  const groups = chunk(ids, QUERY_IN_LIMIT);

  const [reviewSets, alertSets, collectionSets, wishlistSets] = await Promise.all([
    Promise.all(groups.map((g) => db.collection("reviews").where("productId", "in", g).get())),
    Promise.all(groups.map((g) => db.collection("stockAlerts").where("productId", "in", g).get())),
    Promise.all(
      groups.map((g) =>
        db.collection("collections").where("productIds", "array-contains-any", g).get(),
      ),
    ),
    Promise.all(
      groups.map((g) => db.collection("users").where("wishlist", "array-contains-any", g).get()),
    ),
  ]);

  // `in` returns the union, so each row is filed under the product it names.
  const byProductId = (
    sets: FirebaseFirestore.QuerySnapshot[],
    onto: (plan: DeletionPlan) => string[],
  ) => {
    for (const set of sets) {
      for (const doc of set.docs) {
        const owner = (doc.data() as { productId?: string }).productId;
        const plan = owner ? plans.get(owner) : undefined;
        if (plan) onto(plan).push(doc.id);
      }
    }
  };

  byProductId(reviewSets, (plan) => plan.reviewIds);
  byProductId(alertSets, (plan) => plan.alertIds);

  // `array-contains-any` returns the union too: one document can hold several.
  const byMembership = (
    sets: FirebaseFirestore.QuerySnapshot[],
    field: "productIds" | "wishlist",
    onto: (plan: DeletionPlan) => string[],
  ) => {
    for (const set of sets) {
      for (const doc of set.docs) {
        const members = ((doc.data() as Record<string, unknown>)[field] ?? []) as string[];
        for (const member of new Set(members)) {
          const plan = plans.get(member);
          if (plan) onto(plan).push(doc.id);
        }
      }
    }
  };

  byMembership(collectionSets, "productIds", (plan) => plan.collectionIds);
  byMembership(wishlistSets, "wishlist", (plan) => plan.wishlistUserIds);

  for (const product of products) {
    const plan = plans.get(product.id)!;

    plan.orderCount = countOrdersTouching(catalogue, new Set([product.id]));

    /*
     * Other products naming this one as an upsell or cross-sell — excluding
     * any that are themselves going. Cleaning a list on a product that is
     * about to be deleted is a write nobody will ever read.
     */
    plan.linkedProductIds = catalogue.products
      .filter(
        (other) =>
          !selection.has(other.id) &&
          ((other.upsellIds ?? []).includes(product.id) ||
            (other.crossSellIds ?? []).includes(product.id)),
      )
      .map((other) => other.id);
  }

  return plans;
}

async function loadProducts(db: FirebaseFirestore.Firestore, ids: string[]) {
  const snaps = await Promise.all(ids.map((id) => db.collection("products").doc(id).get()));
  const found: Product[] = [];
  const missing: string[] = [];
  snaps.forEach((snap, index) => {
    if (snap.exists) found.push({ id: snap.id, ...(snap.data() as Omit<Product, "id">) } as Product);
    else missing.push(ids[index]!);
  });
  return { found, missing };
}

/* -------------------------------------------------------------------------- */
/*  Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Carry out one product's plan.
 *
 * Firestore first, Storage second, the product row last. The order matters on
 * a partial failure: removing the references while the product still exists
 * leaves a product with no reviews — untidy, and fixable. Removing the product
 * first would leave reviews and wishlist entries pointing at nothing, with no
 * row left to find them from.
 *
 * Throws on failure, so the caller can report *this* product as the one that
 * did not go.
 */
async function executePlan(
  db: FirebaseFirestore.Firestore,
  app: Parameters<typeof import("firebase-admin/storage").getStorage>[0],
  product: Product,
  plan: DeletionPlan,
  caller: { uid: string; email?: string | null },
  batchId: string,
) {
  const batchDeletes: FirebaseFirestore.DocumentReference[] = [
    ...plan.reviewIds.map((reviewId) => db.collection("reviews").doc(reviewId)),
    ...plan.alertIds.map((alertId) => db.collection("stockAlerts").doc(alertId)),
  ];

  for (const slice of chunk(batchDeletes, 400)) {
    const batch = db.batch();
    for (const ref of slice) batch.delete(ref);
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

  for (const slice of chunk(arrayUpdates, 400)) {
    const batch = db.batch();
    for (const { ref, field } of slice) {
      batch.set(ref, { [field]: FieldValue.arrayRemove(product.id) }, { merge: true });
    }
    await batch.commit();
  }

  // Upsell and cross-sell lists on other products.
  for (const slice of chunk(plan.linkedProductIds, 400)) {
    const batch = db.batch();
    for (const linked of slice) {
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
   * Files. Only the ones nothing else points at — `filesKept` is the rest, and
   * it is reported rather than silently skipped.
   */
  if (plan.filesToDelete.length > 0) {
    const { getStorage } = await import("firebase-admin/storage");
    const bucket = getStorage(app).bucket();
    await Promise.all(
      plan.filesToDelete.map(async (path) => {
        // Already gone satisfies "gone". Failing here would block the deletion
        // on a file somebody removed by hand last month.
        await bucket.file(path).delete({ ignoreNotFound: true });
        await db
          .collection("media")
          .doc(path.replace(/\//g, "__"))
          .delete()
          .catch(() => {});
      }),
    );
  }

  await db.collection("products").doc(product.id).delete();

  /*
   * One row per product, even in a batch. "When did this product go, and who
   * took it" is the question asked a fortnight later, and it is asked about a
   * product — `batchId` is what ties a selection back together.
   */
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
    batchId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    at: new Date(),
  });
}

interface Outcome {
  id: string;
  title: string;
  ok: boolean;
  error?: string;
}

/** Delete each product on its own, a few at a time, and report each one. */
async function runDeletions(
  db: FirebaseFirestore.Firestore,
  app: Parameters<typeof import("firebase-admin/storage").getStorage>[0],
  products: Product[],
  plans: Map<string, DeletionPlan>,
  caller: { uid: string; email?: string | null },
  batchId: string,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];

  for (const slice of chunk(products, CONCURRENCY)) {
    const settled = await Promise.all(
      slice.map(async (product): Promise<Outcome> => {
        const title = product.title?.en || product.slug || product.id;
        try {
          await executePlan(db, app, product, plans.get(product.id)!, caller, batchId);
          return { id: product.id, title, ok: true };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "That product could not be deleted.";
          console.error(`[net sale] product delete failed for ${product.id}:`, message);
          return { id: product.id, title, ok: false, error: message };
        }
      }),
    );
    outcomes.push(...settled);
  }

  return outcomes;
}

/* -------------------------------------------------------------------------- */
/*  One product                                                                */
/* -------------------------------------------------------------------------- */

/** What would happen, without doing any of it. */
export async function GET(request: Request) {
  const guard = await gate(request);
  if (guard.error) return guard.error;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return bad("Which product?");

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  const { found } = await loadProducts(db, [id]);
  const product = found[0];
  if (!product) return bad("No such product.", 404);

  const catalogue = await readCatalogue(db);
  const plan = (await buildPlans(db, catalogue, [product])).get(product.id)!;

  return NextResponse.json({
    ok: true,
    plan,
    summary: describePlan(plan, product),
    title: product.title,
    slug: product.slug,
  });
}

export async function DELETE(request: Request) {
  const limit = await rateLimit(`product-delete:${callerKey(request)}`, RULES.content);
  if (!limit.ok) return tooManyRequests(limit);

  const guard = await gate(request);
  if (guard.error) return guard.error;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return bad("Which product?");

  const { getAdminDb, getAdminApp } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  const { found } = await loadProducts(db, [id]);
  const product = found[0];
  if (!product) return bad("No such product.", 404);

  const catalogue = await readCatalogue(db);
  const plans = await buildPlans(db, catalogue, [product]);
  const plan = plans.get(product.id)!;

  const [outcome] = await runDeletions(
    db,
    getAdminApp(),
    [product],
    plans,
    guard.caller,
    `single-${Date.now()}`,
  );

  if (!outcome?.ok) return bad(outcome?.error ?? "That product could not be deleted.", 500);

  // The catalogue, the menus and every cached product page.
  revalidateAll();

  return NextResponse.json({ ok: true, deleted: true, plan });
}

/* -------------------------------------------------------------------------- */
/*  A selection                                                                */
/* -------------------------------------------------------------------------- */

interface BulkBody {
  ids?: string[];
  preview?: boolean;
}

export async function POST(request: Request) {
  let body: BulkBody;
  try {
    body = (await request.json()) as BulkBody;
  } catch {
    return bad("Malformed request body.");
  }

  const preview = body.preview === true;

  // Reading a plan costs nothing; deleting is what the limiter is for.
  if (!preview) {
    const limit = await rateLimit(`product-delete:${callerKey(request)}`, RULES.content);
    if (!limit.ok) return tooManyRequests(limit);
  }

  /*
   * Who is asking, before what they are asking about. A stranger sending two
   * hundred ids should be told they are not signed in, not told what the
   * batch ceiling is.
   */
  const guard = await gate(request);
  if (guard.error) return guard.error;

  const requested = Array.isArray(body.ids)
    ? [...new Set(body.ids.map((id) => String(id).trim()).filter(Boolean))]
    : [];

  if (requested.length === 0) return bad("Select at least one product.");

  const ceiling = preview ? MAX_PREVIEW : MAX_DELETE;
  if (requested.length > ceiling) {
    return bad(
      preview
        ? `That is more than ${MAX_PREVIEW} products. Narrow the selection.`
        : `Delete at most ${MAX_DELETE} products per request.`,
    );
  }

  const { getAdminDb, getAdminApp } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  const { found, missing } = await loadProducts(db, requested);
  if (found.length === 0) return bad("None of those products exist.", 404);

  const catalogue = await readCatalogue(db);
  const plans = await buildPlans(db, catalogue, found);

  /*
   * The selection's own order count, not the sum of the products'. One order
   * holding two of them is one order, and summing would report it as two.
   */
  const orderCount = countOrdersTouching(catalogue, new Set(found.map((p) => p.id)));
  const merged = mergePlans([...plans.values()], orderCount);

  if (preview) {
    return NextResponse.json({
      ok: true,
      preview: true,
      plan: merged,
      count: found.length,
      missing,
      /*
       * The client sends a large selection as several requests of this size.
       * Telling it the number rather than letting it keep its own copy is what
       * stops the two drifting apart into requests the route then refuses.
       */
      maxPerRequest: MAX_DELETE,
      summary: describeBatch(merged, found.length),
      products: found.map((product) => ({
        id: product.id,
        title: product.title?.en || product.slug || product.id,
      })),
    });
  }

  const batchId = `bulk-${Date.now()}-${guard.caller.uid.slice(0, 6)}`;
  const outcomes = await runDeletions(db, getAdminApp(), found, plans, guard.caller, batchId);
  const deleted = outcomes.filter((outcome) => outcome.ok);

  if (deleted.length > 0) revalidateAll();

  /*
   * `ok` is about the request, not the outcome. The client reads `failed` and
   * says so; a selection where every one refused still returns the reasons
   * rather than a bare error with nothing in it.
   */
  return NextResponse.json({
    ok: true,
    batchId,
    requested: requested.length,
    deleted: deleted.length,
    failed: outcomes.filter((outcome) => !outcome.ok),
    missing,
    plan: merged,
  });
}
