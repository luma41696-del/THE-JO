import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import {
  canDelete,
  matchesQuery,
  storagePathFromUrl,
  usageAcross,
  usageOf,
  type MediaAsset,
} from "@/lib/media";
import type { Product } from "@/types";

/**
 * The media library.
 *
 * Every image the shop has uploaded, in one place, so the second product that
 * needs the size chart reuses the file instead of uploading a fourth copy of
 * it.
 *
 * ## Why usage is counted here and not stored
 *
 * The obvious design keeps a `usedBy` array on each asset and maintains it on
 * every product save. That array is wrong the first time anything writes a
 * product without going through this route — a script, an import, a hand edit
 * in the console — and a *stale* usage count is worse than none, because the
 * only thing it is used for is deciding whether deleting a file is safe. A
 * count that says zero when a live product is displaying the image deletes it.
 *
 * So usage is derived from the products themselves, on every request that
 * needs it. The catalogue is small enough that reading it is cheaper than
 * being wrong, and this way the answer cannot drift.
 *
 * ## Why DELETE is a server decision
 *
 * Storage rules let staff delete objects — they have to, or nobody could ever
 * clear anything out. Rules cannot see the catalogue, so they cannot know that
 * the object being deleted is the third photograph of a published product.
 * That check only exists here, which is why the client asks this route rather
 * than calling `deleteObject` itself.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One browse. The library is paged; this is a screenful and then some. */
const PAGE = 120;
/** The catalogue read that backs the usage count. Beyond this it becomes a job. */
const MAX_PRODUCTS = 2000;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function notConfigured() {
  return NextResponse.json(
    {
      ok: false,
      persisted: false,
      error: "Firebase Admin is not configured here, so the media library is unavailable.",
    },
    { status: 503 },
  );
}

async function requireStaff(request: Request) {
  const caller = await verifyRequest(request);
  if (!caller) return { error: bad("Not signed in.", 401) } as const;
  if (caller.role !== "admin" && caller.role !== "staff") {
    return { error: bad("This account does not have permission to manage media.", 403) } as const;
  }
  return { caller } as const;
}

/** Read every product's imagery — the only honest source for a usage count. */
async function readUsage(db: FirebaseFirestore.Firestore, ignoreProductId?: string) {
  const snap = await db.collection("products").select("images", "designs").limit(MAX_PRODUCTS).get();
  const products = snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Pick<Product, "images" | "designs">),
  }));
  return usageAcross(products, ignoreProductId);
}

/* -------------------------------------------------------------------------- */
/*  Browse                                                                    */
/* -------------------------------------------------------------------------- */

export async function GET(request: Request) {
  if (!isAdminConfigured()) return notConfigured();
  const gate = await requireStaff(request);
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    /*
     * Newest first, then filtered in memory.
     *
     * Firestore cannot do substring search, and the alternative — a prefix
     * index on the filename — would answer "linen-shirt" and miss "shirt",
     * which is what a merchant actually types. At this size the honest filter
     * is the right one; past a few thousand files this wants a search index,
     * and that is a different piece of work.
     */
    const [snap, usage] = await Promise.all([
      db.collection("media").orderBy("uploadedAt", "desc").limit(PAGE * 4).get(),
      readUsage(db),
    ]);

    const assets = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as MediaAsset) }))
      .filter((asset) => matchesQuery(asset, query))
      .slice(0, PAGE)
      .map((asset) => {
        const entry = usageOf(usage, asset.url);
        return { ...asset, usedBy: entry?.productIds ?? [], usageCount: entry?.count ?? 0 };
      });

    return NextResponse.json({ ok: true, assets, total: snap.size });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "The media library could not be read.",
      500,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Register a freshly uploaded file                                          */
/* -------------------------------------------------------------------------- */

interface RegisterBody {
  url?: string;
  alt?: string;
  width?: number;
  height?: number;
  bytes?: number;
  contentType?: string;
  filename?: string;
  tags?: string[];
}

/**
 * Record a file that the client has just uploaded.
 *
 * The upload itself stays on the client: streaming ten megabytes through a
 * serverless function to put it where the browser could have put it directly
 * buys nothing and costs the merchant a progress bar that stops moving.
 *
 * The document id is the object path, so registering the same file twice
 * updates one record instead of creating two. A failure here is deliberately
 * not fatal to the caller — the image is already uploaded and already on the
 * product; not appearing in the library yet is a smaller problem than an
 * upload that reports failure after succeeding.
 */
export async function POST(request: Request) {
  if (!isAdminConfigured()) return notConfigured();
  const gate = await requireStaff(request);
  if (gate.error) return gate.error;

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return bad("Malformed request body.");
  }

  const url = String(body.url ?? "").trim();
  const path = storagePathFromUrl(url);
  if (!path) return bad("That is not an uploaded file, so there is nothing to record.");

  const width = Number(body.width);
  const height = Number(body.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return bad("An image needs real pixel dimensions.");
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const asset: MediaAsset = {
      url,
      path,
      alt: String(body.alt ?? "").slice(0, 300),
      width,
      height,
      filename: String(body.filename ?? path.split("/").pop() ?? "image").toLowerCase().slice(0, 160),
      uploadedAt: Date.now(),
      uploadedBy: gate.caller.uid,
      ...(Number.isFinite(Number(body.bytes)) ? { bytes: Number(body.bytes) } : {}),
      ...(body.contentType ? { contentType: String(body.contentType).slice(0, 80) } : {}),
      ...(Array.isArray(body.tags)
        ? { tags: body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12) }
        : {}),
    };

    // The path as the id: one document per object, however many times it is
    // registered. `docId` cannot contain a slash, so the separator is swapped.
    const id = path.replace(/\//g, "__");
    await db.collection("media").doc(id).set(asset, { merge: true });

    return NextResponse.json({ ok: true, persisted: true, asset: { id, ...asset } });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "That file could not be recorded.",
      500,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Delete a file for good                                                    */
/* -------------------------------------------------------------------------- */

interface DeleteBody {
  url?: string;
  /**
   * The product whose form the request came from, excluded from the usage
   * count because its incoming imagery is what the caller just saved.
   */
  ignoreProductId?: string;
}

/**
 * Remove a file from Storage and from the library.
 *
 * Refuses while anything still points at it, and says what. The refusal is the
 * feature — see `lib/media`. Deleting the Storage object first and the record
 * second means a crash in between leaves a library entry for a file that is
 * gone, which shows as a broken thumbnail in one admin screen. The other order
 * leaves an unreferenced object nobody can find or remove. A visible mess in a
 * staff-only screen beats an invisible one.
 */
export async function DELETE(request: Request) {
  if (!isAdminConfigured()) return notConfigured();
  const gate = await requireStaff(request);
  if (gate.error) return gate.error;

  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return bad("Malformed request body.");
  }

  const url = String(body.url ?? "").trim();
  if (!url) return bad("Which file?");

  try {
    const { getAdminDb, getAdminApp } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const usage = await readUsage(db, body.ignoreProductId);
    const verdict = canDelete(url, usage);
    if (!verdict.ok) {
      return NextResponse.json(
        {
          ok: false,
          persisted: false,
          reason: verdict.reason,
          usedBy: verdict.usedBy ?? [],
          error: verdict.message.en,
          errorAr: verdict.message.ar,
        },
        { status: 409 },
      );
    }

    const path = storagePathFromUrl(url);
    const { getStorage } = await import("firebase-admin/storage");
    await getStorage(getAdminApp())
      .bucket()
      .file(path)
      // A file that is already gone satisfies "this file is gone". Failing
      // here would leave the library unable to clean up after a partial
      // delete, which is the state this is meant to fix.
      .delete({ ignoreNotFound: true });

    await db.collection("media").doc(path.replace(/\//g, "__")).delete();

    await db.collection("auditLog").add({
      action: "media.delete",
      path,
      actorUid: gate.caller.uid,
      actorEmail: gate.caller.email,
      at: new Date(),
    });

    return NextResponse.json({ ok: true, persisted: true, path });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "That file could not be deleted.",
      500,
    );
  }
}
