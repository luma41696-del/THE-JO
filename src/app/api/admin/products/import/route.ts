import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { revalidateCatalogue } from "@/lib/revalidate";
import { getCategories } from "@/lib/catalog";
import { categoryPathFor } from "@/lib/categories";
import { planImport, productPatch, type ExistingProduct, type ParsedRow } from "@/lib/import";
import { slugify } from "@/lib/utils";
import type { Product } from "@/types";

/**
 * Applying an import.
 *
 * ## Why it arrives in slices
 *
 * A merchant's file is three hundred rows and a phone tethered to a shop's
 * wifi. One request carrying the lot either finishes or does not, and a
 * connection that drops at row 180 leaves them with no idea which products
 * were written — so the only safe move is to start again, which writes the
 * first 180 twice.
 *
 * Slices make the answer knowable. Each one records how far the job has got,
 * so a dropped connection resumes from there, and a slice that is retried
 * after its response was lost is recognised and skipped rather than applied
 * twice.
 *
 * ## Why the plan is recomputed here
 *
 * The browser showed the merchant a plan. Between then and now a colleague may
 * have repriced something, or created the very product this file is about to
 * create. Trusting the browser's plan would apply "update p1" to a product
 * that has since been archived, or create a second copy of something that now
 * exists. The rows are the merchant's instruction; what they resolve *to* is
 * decided against the catalogue as it is at the moment of writing.
 *
 * ## Why every change is snapshotted
 *
 * An import is the one action that can be wrong three hundred times before
 * anybody sees it. The previous value of every field it touches is recorded
 * first, so the whole thing can be put back — see the undo branch below, and
 * the condition it refuses to undo under.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One slice. Small enough to survive a bad connection, big enough to be worth a round trip. */
const MAX_ROWS_PER_SLICE = 100;
const MAX_CATALOGUE = 2000;

interface ApplyBody {
  action?: "apply" | "undo";
  jobId?: string;
  filename?: string;
  total?: number;
  /** Where this slice starts in the file, zero-based across data rows. */
  offset?: number;
  rows?: ParsedRow[];
}

interface RowOutcome {
  line: number;
  ok: boolean;
  action?: "create" | "update" | "skip";
  id?: string;
  reason?: string;
  reasonAr?: string;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function requireStaff(request: Request) {
  const caller = await verifyRequest(request);
  if (!caller) return { error: bad("Not signed in.", 401) } as const;
  if (caller.role !== "admin" && caller.role !== "staff") {
    return { error: bad("This account does not have permission to import products.", 403) } as const;
  }
  return { caller } as const;
}

/** The catalogue, in the shape the planner compares against. */
async function readCatalogue(db: FirebaseFirestore.Firestore): Promise<ExistingProduct[]> {
  const snap = await db.collection("products").limit(MAX_CATALOGUE).get();
  return snap.docs.map((doc) => {
    const data = doc.data() as Product;
    return {
      id: doc.id,
      slug: data.slug,
      sku: data.sku,
      title: data.title,
      description: data.description,
      price: data.price,
      compareAtPrice: data.compareAtPrice,
      totalStock: data.totalStock,
      categoryId: data.categoryId,
      status: data.status,
      tags: data.tags,
      type: data.type,
      gtin: data.gtin,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Reading a job, for resume                                                 */
/* -------------------------------------------------------------------------- */

export async function GET(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Firebase Admin is not configured." }, { status: 503 });
  }
  const gate = await requireStaff(request);
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    if (jobId) {
      const snap = await db.collection("importJobs").doc(jobId).get();
      if (!snap.exists) return NextResponse.json({ ok: true, job: null });
      return NextResponse.json({ ok: true, job: { id: snap.id, ...snap.data() } });
    }

    /*
     * The recent jobs, so an interrupted import can be found again without the
     * merchant having kept the tab open. An import that stopped halfway is
     * invisible otherwise — and invisible is what makes people re-run the file.
     */
    const recent = await db
      .collection("importJobs")
      .orderBy("startedAt", "desc")
      .limit(10)
      .get();

    return NextResponse.json({
      ok: true,
      jobs: recent.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The import jobs could not be read.", 500);
  }
}

/* -------------------------------------------------------------------------- */
/*  Applying, and putting back                                                */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
  let body: ApplyBody;
  try {
    body = (await request.json()) as ApplyBody;
  } catch {
    return bad("Malformed request body.");
  }

  if (!isAdminConfigured()) {
    return NextResponse.json(
      { ok: false, persisted: false, error: "Firebase Admin is not configured here, so nothing was imported." },
      { status: 503 },
    );
  }

  const gate = await requireStaff(request);
  if (gate.error) return gate.error;
  const caller = gate.caller;

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  if (body.action === "undo") return undo(db, body, caller);

  const jobId = String(body.jobId ?? "").trim();
  if (!jobId || !/^[A-Za-z0-9_-]{6,64}$/.test(jobId)) return bad("A job needs an id.");

  const offset = Number(body.offset ?? 0);
  if (!Number.isInteger(offset) || offset < 0) return bad("Where does this slice start?");

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return bad("Nothing to import.");
  if (rows.length > MAX_ROWS_PER_SLICE) {
    return bad(`Send at most ${MAX_ROWS_PER_SLICE} rows at a time.`);
  }

  try {
    const jobRef = db.collection("importJobs").doc(jobId);
    const jobSnap = await jobRef.get();
    const job = jobSnap.data() as { applied?: number; status?: string; actorUid?: string } | undefined;

    if (job?.status === "undone") {
      return bad("That import has been undone. Start a new one.", 409);
    }

    /*
     * A slice whose response was lost and which the client has retried.
     *
     * Without this the retry applies every row a second time — harmless for an
     * update, and a second copy of the product for a create. The job's own
     * record of how far it got is the only thing that can tell the difference.
     */
    const applied = Number(job?.applied ?? 0);
    const skipCount = Math.max(0, Math.min(rows.length, applied - offset));
    const pending = rows.slice(skipCount);

    if (pending.length === 0) {
      return NextResponse.json({
        ok: true,
        persisted: true,
        alreadyApplied: true,
        applied,
        outcomes: rows.map((row) => ({ line: row.line, ok: true, action: "skip" as const })),
      });
    }

    const [catalogue, categories] = await Promise.all([readCatalogue(db), getCategories()]);
    const plan = planImport(pending, catalogue);
    const byId = new Map(catalogue.map((product) => [product.id, product]));

    const outcomes: RowOutcome[] = [];
    const batch = db.batch();
    let created = 0;
    let updated = 0;
    let writes = 0;

    for (const row of plan.rows) {
      if (row.action === "error") {
        outcomes.push({
          line: row.line,
          ok: false,
          reason: row.problems[0]?.message.en,
          reasonAr: row.problems[0]?.message.ar,
        });
        continue;
      }
      if (row.action === "duplicate") {
        outcomes.push({
          line: row.line,
          ok: false,
          reason: `The same product is already on line ${row.duplicateOfLine}.`,
          reasonAr: `المنتج نفسه موجود في السطر ${row.duplicateOfLine}.`,
        });
        continue;
      }

      if (row.action === "update") {
        // Nothing to write. Reported as fine, so re-running yesterday's file
        // says "nothing to do" rather than rewriting the catalogue.
        if (!row.changes || row.changes.length === 0) {
          outcomes.push({ line: row.line, ok: true, action: "skip", id: row.matchedId });
          continue;
        }

        const existing = byId.get(row.matchedId!);
        const ref = db.collection("products").doc(row.matchedId!);
        const patch: Record<string, unknown> = {
          ...productPatch(row, existing),
          updatedAt: Date.now(),
        };
        if (patch.categoryId) {
          patch.categoryPath = categoryPathFor(categories, String(patch.categoryId));
        }

        // The previous value of everything this row touches, before it moves.
        batch.set(jobRef.collection("changes").doc(row.matchedId!), {
          existed: true,
          before: snapshotOf(existing, Object.keys(patch)),
          at: Date.now(),
        });
        batch.set(ref, patch, { merge: true });
        outcomes.push({ line: row.line, ok: true, action: "update", id: row.matchedId });
        updated += 1;
        writes += 2;
        continue;
      }

      // create
      const ref = db.collection("products").doc();
      const base = productPatch(row);
      const slug = String(base.slug ?? slugify(String((base.title as { en?: string })?.en ?? ref.id)));

      const document: Record<string, unknown> = {
        // The shape a product needs to exist at all. An import creates a
        // *draft* unless the file says otherwise: a row that arrives without a
        // status should not put something on the storefront that nobody has
        // looked at.
        status: "draft",
        type: "simple",
        currency: "JOD",
        images: [],
        colors: [],
        sizes: [],
        variants: [],
        tags: [],
        badges: [],
        collectionIds: [],
        upsellIds: [],
        crossSellIds: [],
        totalStock: 0,
        inStock: false,
        ...base,
        slug,
        categoryPath: categoryPathFor(categories, String(base.categoryId ?? "")),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        importedBy: jobId,
      };

      batch.set(jobRef.collection("changes").doc(ref.id), { existed: false, at: Date.now() });
      batch.set(ref, document);
      outcomes.push({ line: row.line, ok: true, action: "create", id: ref.id });
      created += 1;
      writes += 2;
    }

    batch.set(
      jobRef,
      {
        filename: String(body.filename ?? "").slice(0, 200),
        total: Number(body.total ?? 0),
        applied: offset + rows.length,
        created: FieldValue.increment(created),
        updated: FieldValue.increment(updated),
        failed: FieldValue.increment(outcomes.filter((outcome) => !outcome.ok).length),
        status: offset + rows.length >= Number(body.total ?? 0) ? "done" : "running",
        actorUid: caller.uid,
        actorEmail: caller.email,
        startedAt: jobSnap.exists ? (job as { startedAt?: unknown })?.startedAt ?? Date.now() : Date.now(),
        updatedAtMs: Date.now(),
      },
      { merge: true },
    );

    await batch.commit();
    if (writes > 0) revalidateCatalogue();

    return NextResponse.json({
      ok: true,
      persisted: true,
      applied: offset + rows.length,
      created,
      updated,
      outcomes,
    });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The import could not be applied.", 500);
  }
}

/** Only the fields this write is about to change, as they are now. */
function snapshotOf(existing: ExistingProduct | undefined, keys: string[]): Record<string, unknown> {
  if (!existing) return {};
  const source = existing as unknown as Record<string, unknown>;
  const before: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "updatedAt" || key === "categoryPath") continue;
    // `null` records "this field did not exist", which undo restores as a
    // deletion. Leaving it out would make undo silently keep the new value.
    before[key] = source[key] ?? null;
  }
  return before;
}

/* -------------------------------------------------------------------------- */
/*  Undo                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Put the catalogue back the way it was before this import.
 *
 * Refuses per product where somebody has edited since. An import's undo is a
 * statement about *this import's* changes; a product that has moved on has a
 * newer, deliberate edit on top, and restoring the old value would quietly
 * throw away work the undo was never asked about. Those are reported by name
 * rather than skipped silently.
 *
 * Products the import created are deleted. Products it changed get their
 * previous field values back — including fields that did not exist before,
 * which are removed rather than left at the imported value.
 */
async function undo(
  db: FirebaseFirestore.Firestore,
  body: ApplyBody,
  caller: { uid: string; email: string | null },
) {
  const jobId = String(body.jobId ?? "").trim();
  if (!jobId) return bad("Which import?");

  try {
    const jobRef = db.collection("importJobs").doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) return bad("That import no longer exists.", 404);
    if ((jobSnap.data() as { status?: string }).status === "undone") {
      return bad("That import has already been undone.", 409);
    }

    const changes = await jobRef.collection("changes").get();
    if (changes.empty) return bad("That import changed nothing, so there is nothing to put back.");

    const ids = changes.docs.map((doc) => doc.id);
    const products = await db.getAll(...ids.map((id) => db.collection("products").doc(id)));
    const current = new Map(products.map((snap) => [snap.id, snap]));

    const batch = db.batch();
    const kept: string[] = [];
    let restored = 0;
    let deleted = 0;

    for (const change of changes.docs) {
      const record = change.data() as { existed: boolean; before?: Record<string, unknown>; at: number };
      const snap = current.get(change.id);
      if (!snap?.exists) continue; // already gone; undo has nothing to do

      const product = snap.data() as Product;

      /*
       * Edited since the import. The `updatedAt` this import wrote is the one
       * recorded on the change; anything later is somebody else's work.
       */
      if (typeof product.updatedAt === "number" && product.updatedAt > record.at + 1000) {
        kept.push(product.title?.en || product.title?.ar || change.id);
        continue;
      }

      if (!record.existed) {
        batch.delete(snap.ref);
        deleted += 1;
        continue;
      }

      const restore: Record<string, unknown> = { updatedAt: Date.now() };
      for (const [key, value] of Object.entries(record.before ?? {})) {
        restore[key] = value === null ? FieldValue.delete() : value;
      }
      batch.set(snap.ref, restore, { merge: true });
      restored += 1;
    }

    batch.set(
      jobRef,
      {
        status: "undone",
        undoneAt: Date.now(),
        undoneBy: caller.uid,
        undoRestored: restored,
        undoDeleted: deleted,
        undoKept: kept.slice(0, 50),
      },
      { merge: true },
    );

    await batch.commit();

    await db.collection("auditLog").add({
      action: "product.importUndo",
      jobId,
      restored,
      deleted,
      keptBecauseEdited: kept.length,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    revalidateCatalogue();

    return NextResponse.json({ ok: true, persisted: true, restored, deleted, kept });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The import could not be undone.", 500);
  }
}
