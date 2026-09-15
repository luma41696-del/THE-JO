import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { revalidateMerchandising } from "@/lib/revalidate";
import type {
  BannerSlot,
  BannerStatus,
  BannerTextPosition,
  BannerTextTone,
  BannerTone,
  Localized,
  ProductImage,
} from "@/types";

/**
 * Banner writes.
 *
 * A banner is the only thing in the store a merchant changes on a deadline —
 * a sale starts at midnight, a campaign has to come down when the stock runs
 * out. So every write revalidates the storefront immediately rather than
 * waiting on the hourly window, and a banner is never deleted: archiving keeps
 * the artwork and the copy for the next time the campaign runs.
 */

interface Body {
  id?: string;
  slot?: BannerSlot;
  tone?: BannerTone;
  eyebrow?: Localized | null;
  title?: Localized;
  body?: Localized | null;
  cta?: { label: Localized; href: string } | null;
  media?: ProductImage | null;
  mediaMobile?: ProductImage | null;
  textPosition?: BannerTextPosition;
  textTone?: BannerTextTone;
  scrim?: number;
  startsAt?: number | null;
  endsAt?: number | null;
  priority?: number;
  span?: 1 | 2;
  status?: BannerStatus;
}

const SLOTS: BannerSlot[] = [
  "hero",
  "promo-rail",
  "spotlight",
  "category-strip",
  "announcement",
];
const TONES: BannerTone[] = ["ink", "brand", "sand", "paper"];
const STATUSES: BannerStatus[] = ["draft", "active", "paused", "archived"];
const POSITIONS: BannerTextPosition[] = [
  "start-top",
  "start-middle",
  "start-bottom",
  "center-middle",
  "end-top",
  "end-middle",
  "end-bottom",
];

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function localized(value: Localized | undefined | null, field: string): Localized | null {
  if (!value) return null;
  if (typeof value.en !== "string" || typeof value.ar !== "string") return null;
  if (!value.en.trim() || !value.ar.trim()) {
    throw new Error(`${field} is required in both English and Arabic.`);
  }
  return { en: value.en.trim(), ar: value.ar.trim() };
}

/**
 * Accept an image only from our own Storage bucket or the bundled demo assets.
 *
 * These render through `next/image` with `dangerouslyAllowSVG` enabled, so a
 * URL pointing anywhere else would be a way to serve an executable SVG from a
 * trusted origin.
 */
function image(value: ProductImage | null | undefined): ProductImage | undefined {
  if (!value || typeof value.url !== "string") return undefined;
  const ok =
    value.url.startsWith("/demo/") ||
    value.url.includes("firebasestorage.googleapis.com") ||
    value.url.includes(".firebasestorage.app");
  if (!ok) return undefined;
  return {
    url: value.url,
    alt: typeof value.alt === "string" ? value.alt.trim().slice(0, 300) : "",
    width: Number.isFinite(Number(value.width)) ? Math.round(Number(value.width)) : 1600,
    height: Number.isFinite(Number(value.height)) ? Math.round(Number(value.height)) : 900,
  };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  const slot = SLOTS.includes(body.slot as BannerSlot) ? (body.slot as BannerSlot) : "promo-rail";
  const tone = TONES.includes(body.tone as BannerTone) ? (body.tone as BannerTone) : "ink";
  const status = STATUSES.includes(body.status as BannerStatus)
    ? (body.status as BannerStatus)
    : "draft";

  let title: Localized | null;
  let eyebrow: Localized | null;
  let copy: Localized | null;
  try {
    title = localized(body.title, "Title");
    eyebrow = body.eyebrow ? localized(body.eyebrow, "Eyebrow") : null;
    copy = body.body ? localized(body.body, "Body") : null;
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Invalid text.");
  }
  if (!title) return bad("A title is required in both languages.");

  let cta: { label: Localized; href: string } | null = null;
  if (body.cta && (body.cta.label?.en || body.cta.label?.ar || body.cta.href)) {
    let label: Localized | null;
    try {
      label = localized(body.cta.label, "Button label");
    } catch (error) {
      return bad(error instanceof Error ? error.message : "Invalid button label.");
    }
    const href = String(body.cta.href ?? "").trim();
    if (!label) return bad("A button needs a label in both languages.");
    /*
     * Internal links only. An absolute URL here would let whoever can edit a
     * banner point the storefront's main call to action at any site they like.
     */
    if (!href.startsWith("/")) {
      return bad("A button link must be an internal path beginning with /.");
    }
    cta = { label, href };
  }

  const startsAt = body.startsAt === null || body.startsAt === undefined ? undefined : Number(body.startsAt);
  const endsAt = body.endsAt === null || body.endsAt === undefined ? undefined : Number(body.endsAt);
  if (startsAt !== undefined && endsAt !== undefined && endsAt <= startsAt) {
    return bad("The end of the window must be after its start.");
  }
  if (status === "active" && endsAt !== undefined && endsAt <= Date.now()) {
    return bad("This window has already closed. Set a future end date, or save it as a draft.");
  }

  const media = image(body.media);
  // A hero with no artwork is a coloured rectangle with a headline on it —
  // occasionally deliberate, so it is allowed, but not for a live one.
  if (status === "active" && slot === "hero" && !media) {
    return bad("A live hero banner needs a desktop image.");
  }

  const payload = {
    slot,
    tone,
    ...(eyebrow ? { eyebrow } : {}),
    title,
    ...(copy ? { body: copy } : {}),
    ...(cta ? { cta } : {}),
    ...(media ? { media } : {}),
    ...(image(body.mediaMobile) ? { mediaMobile: image(body.mediaMobile) } : {}),
    textPosition: POSITIONS.includes(body.textPosition as BannerTextPosition)
      ? body.textPosition
      : "start-middle",
    textTone: body.textTone === "dark" ? ("dark" as BannerTextTone) : ("light" as BannerTextTone),
    scrim: Math.min(1, Math.max(0, Number(body.scrim ?? 0.35))),
    ...(startsAt === undefined ? {} : { startsAt }),
    ...(endsAt === undefined ? {} : { endsAt }),
    priority: Math.max(0, Math.floor(Number(body.priority ?? 0))),
    span: body.span === 2 ? 2 : 1,
    status,
    // Mirrored so readers predating `status` agree with ones that do not.
    active: status === "active",
    updatedAt: new Date(),
  };

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false, validated: payload });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to edit campaigns.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const ref = body.id ? db.collection("banners").doc(body.id) : db.collection("banners").doc();
    const existing = body.id ? await ref.get() : null;
    if (body.id && !existing?.exists) return bad("That banner no longer exists.", 404);

    await ref.set({ ...payload, ...(existing?.exists ? {} : { createdAt: new Date() }) }, { merge: true });

    await db.collection("auditLog").add({
      action: body.id ? "banner.update" : "banner.create",
      bannerId: ref.id,
      slot,
      status,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    revalidateMerchandising();
    return NextResponse.json({ ok: true, persisted: true, id: ref.id });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The banner could not be saved.", 500);
  }
}

/** Status changes and reordering — the frequent, low-risk edits. */
export async function PATCH(request: Request) {
  let body: { id?: string; status?: BannerStatus; priority?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("Malformed request body.");
  }

  const id = String(body.id ?? "");
  if (!id) return bad("A banner id is required.");

  const status = STATUSES.includes(body.status as BannerStatus)
    ? (body.status as BannerStatus)
    : null;
  const priority =
    body.priority === undefined ? null : Math.max(0, Math.floor(Number(body.priority)));
  if (status === null && priority === null) return bad("Nothing to change.");

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false, validated: { id, status, priority } });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to edit campaigns.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const ref = db.collection("banners").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return bad("That banner no longer exists.", 404);

    await ref.update({
      ...(status ? { status, active: status === "active" } : {}),
      ...(priority === null ? {} : { priority }),
      updatedAt: new Date(),
    });

    await db.collection("auditLog").add({
      action: status ? "banner.status" : "banner.reorder",
      bannerId: id,
      ...(status ? { to: status } : { priority }),
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    revalidateMerchandising();
    return NextResponse.json({ ok: true, persisted: true, id });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The banner could not be updated.", 500);
  }
}
