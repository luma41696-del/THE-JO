import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { slugify } from "@/lib/utils";
import { money } from "@/lib/pricing";
import type { Localized, Product } from "@/types";

/**
 * Catalogue writes.
 *
 * Security Rules gate `products` on the `staff`/`admin` claim, so a compromised
 * client key cannot edit the catalogue. This route exists so the *server* also
 * enforces the shape: a price that is a string, a slug that collides, an Arabic
 * title that was never filled in. Rules can check who you are; they are a poor
 * place to check what you sent.
 *
 * `inStock` and `totalStock` are derived here rather than accepted. Stock is
 * the property most likely to be wrong in a request body, and the one where
 * being wrong oversells.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  id?: string;
  slug?: string;
  title?: Localized;
  subtitle?: Localized;
  description?: Localized;
  categoryId?: string;
  price?: number;
  compareAtPrice?: number | null;
  totalStock?: number;
  status?: Product["status"];
  tags?: string[];
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function localized(value: Localized | undefined, field: string): Localized | null {
  if (!value || typeof value.en !== "string" || typeof value.ar !== "string") return null;
  if (!value.en.trim() || !value.ar.trim()) {
    // Both languages or neither. A product live in one language and blank in
    // the other is worse than an unpublished one.
    throw new Error(`${field} is required in both English and Arabic.`);
  }
  return { en: value.en.trim(), ar: value.ar.trim() };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  /* --- shape ------------------------------------------------------------- */

  let title: Localized | null;
  try {
    title = localized(body.title, "Title");
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Invalid title.");
  }
  if (!title) return bad("A title is required in both languages.");

  const slug = slugify(body.slug ?? title.en);
  if (!slug) return bad("A usable slug is required.");

  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) return bad("Price must be greater than zero.");

  const compareAt =
    body.compareAtPrice === null || body.compareAtPrice === undefined
      ? undefined
      : Number(body.compareAtPrice);
  if (compareAt !== undefined && (!Number.isFinite(compareAt) || compareAt < 0)) {
    return bad("Compare-at price must be a positive number.");
  }
  if (compareAt !== undefined && compareAt > 0 && compareAt <= price) {
    return bad("Compare-at price must be higher than the price, or left empty.");
  }

  const totalStock = Math.max(0, Math.floor(Number(body.totalStock) || 0));
  const status: Product["status"] =
    body.status === "active" || body.status === "archived" ? body.status : "draft";

  const payload = {
    slug,
    title,
    subtitle: body.subtitle?.en || body.subtitle?.ar ? body.subtitle : undefined,
    description: body.description ?? { en: "", ar: "" },
    categoryId: body.categoryId ?? "outerwear",
    categoryPath: [body.categoryId ?? "outerwear"],
    price: money(price, "JOD"),
    compareAtPrice: compareAt && compareAt > 0 ? money(compareAt, "JOD") : undefined,
    currency: "JOD" as const,
    totalStock,
    // Derived, never trusted from the body.
    inStock: totalStock > 0,
    status,
    tags: Array.isArray(body.tags) ? body.tags.slice(0, 25).map(String) : [],
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
    return bad("This account does not have permission to edit the catalogue.", 403);
  }

  /* --- write -------------------------------------------------------------- */

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    // A slug is a public URL, so a collision is a broken link, not a warning.
    const clash = await db.collection("products").where("slug", "==", slug).limit(1).get();
    if (!clash.empty && clash.docs[0]!.id !== body.id) {
      return bad(`The slug "${slug}" is already used by another product.`, 409);
    }

    const ref = body.id
      ? db.collection("products").doc(body.id)
      : db.collection("products").doc();

    const existing = body.id ? await ref.get() : null;

    await ref.set(
      {
        ...payload,
        ...(existing?.exists ? {} : { publishedAt: new Date(), images: [], colors: [], sizes: [] }),
      },
      { merge: true },
    );

    await db.collection("auditLog").add({
      action: body.id ? "product.update" : "product.create",
      productId: ref.id,
      slug,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    return NextResponse.json({ ok: true, persisted: true, id: ref.id, slug });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not save the product." },
      { status: 500 },
    );
  }
}
