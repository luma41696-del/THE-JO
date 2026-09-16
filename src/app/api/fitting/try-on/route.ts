import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import {
  MAX_ATTEMPTS,
  RESULT_RETENTION_DAYS,
  callProvider,
  ownsFittingPath,
  providerStatus,
  type TryOnJob,
} from "@/lib/fitting/provider";
import { canStart, isActive, retriable } from "@/lib/fitting/quota";
import type { Product } from "@/types";

/**
 * A try-on, from a photograph to a picture.
 *
 * `callProvider` has existed and been careful for a while, and had no callers:
 * nothing created a job, nothing ran one, and nothing gave a customer the
 * result. This is that path.
 *
 * ## Why create and run are two requests
 *
 * The model takes five to twenty seconds. A single request that creates the
 * job, waits for the image and returns it is the pleasant design and the one
 * that dies against a serverless timeout — and when it dies, it dies *after*
 * the provider has been paid, with nothing recorded. So the job is written
 * first, and running it is a separate call that can be repeated: if the run
 * times out, the job is still there, still owned, and still knows how many
 * attempts it has had.
 *
 * ## Why the person's photo is never taken from the request
 *
 * The path arrives as a string, and the Admin SDK reading it bypasses the
 * storage rules that would otherwise stop one customer reading another's body
 * photograph. `ownsFittingPath` is checked here as well as inside the
 * provider, because a check that exists in one place is a check that a
 * refactor removes.
 *
 * ## Why nothing is ever invented
 *
 * With no provider configured the job lands in `not-configured` and the
 * customer is told plainly. The one thing that must not happen is a
 * placeholder presented as a try-on: they would believe it, and it would be a
 * picture of somebody else.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read for the quota window; a rolling month never needs more than this. */
const MAX_JOBS_READ = 100;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function notConfigured() {
  return NextResponse.json(
    { ok: false, error: "Firebase Admin is not configured here." },
    { status: 503 },
  );
}

async function jobsFor(db: FirebaseFirestore.Firestore, uid: string): Promise<TryOnJob[]> {
  const snap = await db
    .collection("tryOnJobs")
    .where("uid", "==", uid)
    .limit(MAX_JOBS_READ)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<TryOnJob, "id">) }));
}

/** Has this account agreed to send its photograph to a third party? */
async function hasConsented(db: FirebaseFirestore.Firestore, uid: string): Promise<boolean> {
  // The same document the profile route writes, addressed by verified uid.
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists && snap.data()?.tryOnConsent === true;
}

/* -------------------------------------------------------------------------- */
/*  What I have, and what I may do                                            */
/* -------------------------------------------------------------------------- */

export async function GET(request: Request) {
  if (!isAdminConfigured()) return notConfigured();

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    if (jobId) {
      const snap = await db.collection("tryOnJobs").doc(jobId).get();
      if (!snap.exists) return bad("No such try-on.", 404);
      const job = { id: snap.id, ...(snap.data() as Omit<TryOnJob, "id">) };
      /*
       * Checked, not assumed. The id is opaque but guessable in principle, and
       * what sits behind it is a generated image of somebody's body.
       */
      if (job.uid !== caller.uid) return bad("That try-on belongs to another account.", 403);
      return NextResponse.json({ ok: true, job });
    }

    const jobs = await jobsFor(db, caller.uid);
    const status = providerStatus();
    const verdict = canStart({
      jobs,
      consented: await hasConsented(db, caller.uid),
      providerConfigured: status.configured,
    });

    return NextResponse.json({
      ok: true,
      // Shown before the button, so a limit is never a surprise at submit.
      canStart: verdict.ok,
      reason: verdict.reason ?? null,
      message: verdict.message,
      remainingToday: verdict.remainingToday,
      remainingMonth: verdict.remainingMonth,
      providerConfigured: status.configured,
      jobs: jobs
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 10)
        .map(({ id, productId, state, resultPath, error, createdAt, expiresAt }) => ({
          id,
          productId,
          state,
          resultPath: resultPath ?? null,
          error: error ?? null,
          createdAt,
          expiresAt,
        })),
    });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Your try-ons could not be read.", 500);
  }
}

/* -------------------------------------------------------------------------- */
/*  Start one, or run it                                                      */
/* -------------------------------------------------------------------------- */

interface Body {
  action?: "create" | "run";
  jobId?: string;
  productId?: string;
  variantSku?: string;
  personImagePath?: string;
}

export async function POST(request: Request) {
  if (!isAdminConfigured()) return notConfigured();

  const caller = await verifyRequest(request);
  if (!caller) return bad("Sign in to use the fitting room.", 401);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  if (body.action === "run") return run(db, caller.uid, String(body.jobId ?? ""));

  /* ---- create ---------------------------------------------------------- */

  const productId = String(body.productId ?? "").trim();
  const personImagePath = String(body.personImagePath ?? "").trim();
  if (!productId) return bad("Which piece?");

  /*
   * The ownership check, first and before any read.
   *
   * A path outside this account's own folder is not a mistake to correct, it
   * is an attempt to have the server fetch somebody else's body photograph
   * with credentials that can.
   */
  if (!ownsFittingPath(caller.uid, personImagePath)) {
    return bad("That photo does not belong to this account.", 403);
  }

  try {
    const status = providerStatus();
    const [jobs, consented, productSnap] = await Promise.all([
      jobsFor(db, caller.uid),
      hasConsented(db, caller.uid),
      db.collection("products").doc(productId).get(),
    ]);

    if (!productSnap.exists) return bad("That piece is no longer in the catalogue.", 404);
    const product = productSnap.data() as Product;
    if (product.status !== "active") return bad("That piece is not on sale.", 409);

    const verdict = canStart({ jobs, consented, providerConfigured: status.configured });
    if (!verdict.ok) {
      /*
       * Refused *before* a job exists, so a refusal costs nothing and leaves
       * no record to explain later. The customer's own language travels with
       * the message; the panel picks the half it needs.
       */
      return NextResponse.json(
        {
          ok: false,
          reason: verdict.reason,
          error: verdict.message.en,
          errorAr: verdict.message.ar,
          remainingToday: verdict.remainingToday,
          remainingMonth: verdict.remainingMonth,
        },
        { status: 409 },
      );
    }

    const now = Date.now();
    const ref = db.collection("tryOnJobs").doc();
    const job: Omit<TryOnJob, "id"> & { personImagePath: string; productImageUrl: string } = {
      uid: caller.uid,
      productId,
      ...(body.variantSku ? { variantSku: String(body.variantSku) } : {}),
      state: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + RESULT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      personImagePath,
      productImageUrl: product.images?.[0]?.url ?? "",
    };

    if (!job.productImageUrl) {
      return bad("That piece has no photograph to try on.", 409);
    }

    await ref.set(job);
    return NextResponse.json({ ok: true, persisted: true, jobId: ref.id, state: "queued" });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "That try-on could not be started.", 500);
  }
}

/* -------------------------------------------------------------------------- */
/*  Running one                                                               */
/* -------------------------------------------------------------------------- */

async function run(db: FirebaseFirestore.Firestore, uid: string, jobId: string) {
  if (!jobId) return bad("Which try-on?");

  const ref = db.collection("tryOnJobs").doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) return bad("No such try-on.", 404);

  const job = { id: snap.id, ...(snap.data() as Omit<TryOnJob, "id"> & {
    personImagePath?: string;
    productImageUrl?: string;
  }) };

  if (job.uid !== uid) return bad("That try-on belongs to another account.", 403);

  // Already answered. Returning it is the honest reply to a client that
  // retried, and spends nothing doing so.
  if (job.state === "done" || job.state === "not-configured") {
    return NextResponse.json({ ok: true, job });
  }
  if (job.state === "failed" && !retriable(job)) {
    return NextResponse.json({ ok: true, job });
  }
  /*
   * Somebody else's request is already running this one. Two runs would pay
   * twice for one job and race over the same document.
   */
  if (job.state === "running" && isActive(job)) {
    return NextResponse.json({ ok: true, job });
  }

  const status = providerStatus();
  if (!status.configured) {
    /*
     * Recorded as its own state rather than as a failure. It is not a delivery
     * problem, it is a shop that has not switched the feature on — and
     * `wasBilled` reads this state to keep it off the customer's allowance,
     * because nothing was spent.
     */
    const settled = {
      state: "not-configured" as const,
      error: `No try-on provider is configured (missing ${status.missing.join(", ")}).`,
      updatedAt: Date.now(),
    };
    await ref.set(settled, { merge: true });
    return NextResponse.json({ ok: true, job: { ...job, ...settled } });
  }

  const attempts = (job.attempts ?? 0) + 1;
  await ref.set({ state: "running", attempts, updatedAt: Date.now() }, { merge: true });

  const result = await callProvider({
    uid,

    personImagePath: String(job.personImagePath ?? ""),
    productImageUrl: String(job.productImageUrl ?? ""),
  });

  const settled = result.ok
    ? {
        state: "done" as const,
        resultPath: result.resultPath,
        error: null,
        updatedAt: Date.now(),
      }
    : {
        state: "failed" as const,
        error: result.error,
        updatedAt: Date.now(),
      };

  await ref.set(settled, { merge: true });

  return NextResponse.json({
    ok: true,
    job: { ...job, ...settled, attempts },
    ...(settled.state === "failed" ? { canRetry: attempts < MAX_ATTEMPTS } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/*  Delete it                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Remove a try-on and the image it produced.
 *
 * The result is deleted from Storage first. A job record without its image is
 * a tidy-up problem; an image without its job record is a picture of somebody
 * that nothing in the system knows about, which is the one outcome the consent
 * text rules out.
 */
export async function DELETE(request: Request) {
  if (!isAdminConfigured()) return notConfigured();

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);

  let body: { jobId?: string };
  try {
    body = (await request.json()) as { jobId?: string };
  } catch {
    return bad("Malformed request body.");
  }

  const jobId = String(body.jobId ?? "").trim();
  if (!jobId) return bad("Which try-on?");

  try {
    const { getAdminDb, getAdminApp } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const ref = db.collection("tryOnJobs").doc(jobId);
    const snap = await ref.get();
    // Already gone satisfies "delete it".
    if (!snap.exists) return NextResponse.json({ ok: true, persisted: true });

    const job = snap.data() as TryOnJob;
    if (job.uid !== caller.uid) return bad("That try-on belongs to another account.", 403);

    if (job.resultPath && ownsFittingPath(caller.uid, job.resultPath)) {
      const { getStorage } = await import("firebase-admin/storage");
      await getStorage(getAdminApp())
        .bucket()
        .file(job.resultPath)
        .delete({ ignoreNotFound: true });
    }

    await ref.delete();
    return NextResponse.json({ ok: true, persisted: true });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "That try-on could not be deleted.", 500);
  }
}
