import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { money } from "@/lib/pricing";
import { offerStatus } from "@/lib/offers";
import type { Localized, Offer, OfferStatus, OfferType } from "@/types";

/**
 * Coupon writes.
 *
 * Security Rules keep `offers` unwritable from any client, so this route is the
 * only way a coupon changes. It exists to enforce the things rules cannot: that
 * a percentage is a percentage, that a window ends after it starts, that a code
 * is unique, and that a coupon is never *deleted* — only archived, because
 * orders that already used it must keep their explanation.
 */

interface Body {
  id?: string;
  code?: string;
  type?: OfferType;
  value?: number;
  maxDiscount?: number | null;
  title?: Localized;
  description?: Localized | null;
  minSubtotal?: number | null;
  appliesToCategoryIds?: string[];
  appliesToProductIds?: string[];
  excludesCategoryIds?: string[];
  excludesProductIds?: string[];
  startsAt?: number;
  endsAt?: number;
  usageLimit?: number | null;
  perUserLimit?: number | null;
  assignedUid?: string | null;
  firstOrderOnly?: boolean;
  stackable?: boolean;
  status?: OfferStatus;
}

const STATUSES: OfferStatus[] = ["draft", "active", "paused", "archived"];
const TYPES: OfferType[] = ["percentage", "fixed", "free-shipping", "bundle"];

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Codes are stored upper-case and space-free: one code, one spelling. */
function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

function localized(value: Localized | undefined | null, field: string): Localized | null {
  if (!value) return null;
  if (typeof value.en !== "string" || typeof value.ar !== "string") return null;
  if (!value.en.trim() || !value.ar.trim()) {
    throw new Error(`${field} is required in both English and Arabic.`);
  }
  return { en: value.en.trim(), ar: value.ar.trim() };
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))].slice(0, 200) : [];
}

function optionalCount(value: number | null | undefined, field: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a whole number, or empty.`);
  return n > 0 ? n : undefined;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  /* --- shape ------------------------------------------------------------- */

  const code = normaliseCode(String(body.code ?? ""));
  if (!code) return bad("A coupon code is required.");
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    return bad("A code may use letters, digits, hyphens and underscores, 3–32 characters.");
  }

  const type = TYPES.includes(body.type as OfferType) ? (body.type as OfferType) : "percentage";

  let title: Localized | null;
  let description: Localized | null;
  try {
    title = localized(body.title, "Title");
    description = body.description ? localized(body.description, "Description") : null;
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Invalid text.");
  }
  if (!title) return bad("A title is required in both languages.");

  const value = Number(body.value ?? 0);
  if (type === "percentage") {
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      return bad("A percentage discount must be between 1 and 100.");
    }
  } else if (type === "fixed") {
    if (!Number.isFinite(value) || value <= 0) {
      return bad("A fixed discount must be greater than zero.");
    }
  }

  let maxDiscount: number | undefined;
  let minSubtotal: number | undefined;
  let usageLimit: number | undefined;
  let perUserLimit: number | undefined;
  try {
    maxDiscount = optionalCount(body.maxDiscount, "Maximum discount");
    minSubtotal = optionalCount(body.minSubtotal, "Minimum spend");
    usageLimit = optionalCount(body.usageLimit, "Total redemption limit");
    perUserLimit = optionalCount(body.perUserLimit, "Per-customer limit");
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Invalid number.");
  }

  const startsAt = Number(body.startsAt);
  const endsAt = Number(body.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
    return bad("A start and end date are required.");
  }
  if (endsAt <= startsAt) {
    return bad("The end of the window must be after its start.");
  }

  const status = STATUSES.includes(body.status as OfferStatus)
    ? (body.status as OfferStatus)
    : "draft";

  /*
   * A coupon with no reachable window is almost always a typo in the dates,
   * and it fails silently — the merchant announces a campaign that refuses
   * every customer. Refusing it here costs one correction; shipping it costs
   * a day of support.
   */
  if (status === "active" && endsAt <= Date.now()) {
    return bad("This window has already closed. Set a future end date, or save it as a draft.");
  }

  const payload = {
    code,
    type,
    value: type === "free-shipping" ? 0 : money(value, "JOD"),
    ...(maxDiscount === undefined ? {} : { maxDiscount: money(maxDiscount, "JOD") }),
    title,
    ...(description ? { description } : {}),
    ...(minSubtotal === undefined ? {} : { minSubtotal: money(minSubtotal, "JOD") }),
    appliesToCategoryIds: ids(body.appliesToCategoryIds),
    appliesToProductIds: ids(body.appliesToProductIds),
    excludesCategoryIds: ids(body.excludesCategoryIds),
    excludesProductIds: ids(body.excludesProductIds),
    startsAt,
    endsAt,
    ...(usageLimit === undefined ? {} : { usageLimit }),
    ...(perUserLimit === undefined ? {} : { perUserLimit }),
    ...(body.assignedUid ? { assignedUid: String(body.assignedUid).slice(0, 128) } : {}),
    firstOrderOnly: body.firstOrderOnly === true,
    stackable: body.stackable === true,
    status,
    // Mirrored so any reader predating `status` agrees with one that does not.
    active: status === "active",
    updatedAt: new Date(),
  };

  /* --- authorisation ----------------------------------------------------- */

  if (!isAdminConfigured()) {
    return NextResponse.json({
      ok: true,
      persisted: false,
      validated: payload,
      note:
        "Firebase Admin is not configured, so the caller could not be verified and " +
        "nothing was written. The payload above passed validation.",
    });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to edit coupons.", 403);
  }

  /* --- write -------------------------------------------------------------- */

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    // A code is how a customer identifies the coupon; two coupons sharing one
    // is a support ticket waiting to happen.
    const clash = await db.collection("offers").where("code", "==", code).limit(1).get();
    if (!clash.empty && clash.docs[0]!.id !== body.id) {
      return bad(`The code "${code}" is already in use.`, 409);
    }

    const ref = body.id ? db.collection("offers").doc(body.id) : db.collection("offers").doc();
    const existing = body.id ? await ref.get() : null;

    if (body.id && !existing?.exists) return bad("That coupon no longer exists.", 404);

    /*
     * `usageCount` is never written here. It belongs to the checkout
     * transaction, which increments it atomically; letting an edit set it
     * would let a careless save hand back redemptions that were already spent.
     */
    await ref.set(
      {
        ...payload,
        ...(existing?.exists ? {} : { usageCount: 0, createdAt: new Date() }),
      },
      { merge: true },
    );

    await db.collection("auditLog").add({
      action: body.id ? "offer.update" : "offer.create",
      offerId: ref.id,
      code,
      status,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    return NextResponse.json({ ok: true, persisted: true, id: ref.id, code });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "The coupon could not be saved.",
      500,
    );
  }
}

/**
 * Status changes — pause, resume, archive.
 *
 * Separate from POST because they are the frequent, low-risk action, and a
 * merchant pausing a campaign should not have to round-trip the whole document
 * (and risk saving a stale copy of every other field over it).
 */
export async function PATCH(request: Request) {
  let body: { id?: string; status?: OfferStatus };
  try {
    body = (await request.json()) as { id?: string; status?: OfferStatus };
  } catch {
    return bad("Malformed request body.");
  }

  const id = String(body.id ?? "");
  if (!id) return bad("A coupon id is required.");
  if (!STATUSES.includes(body.status as OfferStatus)) return bad("Unknown status.");
  const status = body.status as OfferStatus;

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false, validated: { id, status } });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to edit coupons.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const ref = db.collection("offers").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return bad("That coupon no longer exists.", 404);

    const before = offerStatus({ ...(snap.data() as Offer), id } as Offer);

    await ref.update({ status, active: status === "active", updatedAt: new Date() });

    await db.collection("auditLog").add({
      action: "offer.status",
      offerId: id,
      code: snap.data()?.code ?? null,
      from: before,
      to: status,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    return NextResponse.json({ ok: true, persisted: true, id, status });
  } catch (error) {
    return bad(
      error instanceof Error ? error.message : "The coupon could not be updated.",
      500,
    );
  }
}
