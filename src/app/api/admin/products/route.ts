import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { slugify } from "@/lib/utils";
import { money } from "@/lib/pricing";
import { isValidGtin } from "@/lib/product";
import { getCategories } from "@/lib/catalog";
import { categoryPathFor } from "@/lib/categories";
import type {
  Localized,
  Product,
  ProductDesign,
  ProductImage,
  ProductType,
  ProductVariant,
} from "@/types";

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

  images?: ProductImage[];
  variants?: ProductVariant[];
  designs?: ProductDesign[];
  type?: ProductType;
  sku?: string;
  gtin?: string | null;
  shippingClassId?: string | null;
  maxPerOrder?: number | null;
  upsellIds?: string[];
  crossSellIds?: string[];
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

  const type: ProductType = body.type === "simple" ? "simple" : "variable";

  /*
   * A bad GTIN is rejected rather than stored. It is the one field here whose
   * correctness can be checked outright, and an invalid one is not a cosmetic
   * problem: every marketplace feed rejects the product, and that rejection
   * surfaces days later in someone else's dashboard rather than here.
   */
  const gtin = typeof body.gtin === "string" ? body.gtin.trim() : "";
  if (gtin && !isValidGtin(gtin)) {
    return bad("That GTIN's check digit does not match. Re-enter the barcode.");
  }
  if (gtin && type === "variable") {
    // The parent of a variable product is not a trade item, so it has no GTIN
    // to carry — accepting one here would put the same barcode on every size.
    return bad("A variable product carries GTINs on its variants, not on the parent.");
  }

  const maxPerOrderRaw =
    body.maxPerOrder === null || body.maxPerOrder === undefined
      ? undefined
      : Math.floor(Number(body.maxPerOrder));
  if (maxPerOrderRaw !== undefined && (!Number.isFinite(maxPerOrderRaw) || maxPerOrderRaw < 0)) {
    return bad("Max per order must be a whole number, or left empty.");
  }
  const maxPerOrder = maxPerOrderRaw && maxPerOrderRaw > 0 ? maxPerOrderRaw : undefined;

  const ids = (value: unknown) =>
    Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))].slice(0, 12) : [];

  /*
   * Image records are rebuilt field by field rather than trusted wholesale.
   *
   * The URL is the one that matters: these are rendered through `next/image`
   * with `dangerouslyAllowSVG` on, so a URL pointing anywhere but our own
   * Storage bucket would be a way to serve an executable SVG from a trusted
   * path. Only `firebasestorage` and the bundled `/demo` assets are accepted.
   */
  const images = Array.isArray(body.images)
    ? body.images
        .filter((image): image is ProductImage => Boolean(image) && typeof image.url === "string")
        .filter(
          (image) =>
            image.url.startsWith("/demo/") ||
            image.url.includes("firebasestorage.googleapis.com") ||
            image.url.includes(".firebasestorage.app"),
        )
        .map((image) => ({
          url: image.url,
          // Alt text is required for an accessible storefront; an image that
          // arrives without it is stored with an empty string rather than the
          // filename, so the gap is visible in the editor instead of hidden.
          alt: typeof image.alt === "string" ? image.alt.trim().slice(0, 300) : "",
          width: Number.isFinite(Number(image.width)) ? Math.round(Number(image.width)) : 1200,
          height: Number.isFinite(Number(image.height)) ? Math.round(Number(image.height)) : 1600,
          ...(image.colorId ? { colorId: String(image.colorId) } : {}),
        }))
        .slice(0, 12)
    : undefined;

  /*
   * Variant stock, when the editor sends it.
   *
   * `totalStock` is derived from the rows rather than accepted alongside them:
   * two numbers that must agree will eventually not, and the variant rows are
   * the ones the checkout decrements.
   */
  const variants = Array.isArray(body.variants)
    ? body.variants
        .filter((v): v is ProductVariant => Boolean(v) && typeof v.sku === "string")
        .map((v) => ({
          sku: String(v.sku),
          colorId: String(v.colorId ?? ""),
          sizeId: String(v.sizeId ?? ""),
          ...(v.designId ? { designId: String(v.designId) } : {}),
          stock: Math.max(0, Math.floor(Number(v.stock) || 0)),
          ...(v.priceOverride === undefined || v.priceOverride === null
            ? {}
            : { priceOverride: money(Number(v.priceOverride), "JOD") }),
          ...(v.gtin ? { gtin: String(v.gtin) } : {}),
          ...(v.barcode ? { barcode: String(v.barcode) } : {}),
        }))
        .slice(0, 400)
    : undefined;

  /*
   * Artwork options.
   *
   * Rebuilt field by field for the same reason as images: a design carries a
   * thumbnail URL that is rendered through `next/image`, so an off-bucket URL
   * would be a way to serve an executable SVG from a trusted path. The same
   * allow-list applies, and a design whose thumbnail fails it is dropped
   * rather than stored pointing somewhere else.
   */
  const designs = Array.isArray(body.designs)
    ? body.designs
        .filter(
          (d): d is ProductDesign =>
            Boolean(d) && typeof d.id === "string" && Boolean(d.thumbnail?.url),
        )
        .filter(
          (d) =>
            d.thumbnail.url.startsWith("/demo/") ||
            d.thumbnail.url.includes("firebasestorage.googleapis.com") ||
            d.thumbnail.url.includes(".firebasestorage.app"),
        )
        .map((d, index) => ({
          id: String(d.id).slice(0, 64),
          name: {
            en: String(d.name?.en ?? "").trim().slice(0, 80),
            ar: String(d.name?.ar ?? "").trim().slice(0, 80),
          },
          thumbnail: {
            url: d.thumbnail.url,
            alt: typeof d.thumbnail.alt === "string" ? d.thumbnail.alt.trim().slice(0, 300) : "",
            width: Number.isFinite(Number(d.thumbnail.width)) ? Math.round(Number(d.thumbnail.width)) : 600,
            height: Number.isFinite(Number(d.thumbnail.height)) ? Math.round(Number(d.thumbnail.height)) : 600,
          },
          ...(d.priceDelta === undefined || d.priceDelta === null || Number(d.priceDelta) === 0
            ? {}
            : { priceDelta: money(Number(d.priceDelta), "JOD") }),
          available: d.available !== false,
          position: typeof d.position === "number" ? d.position : index,
        }))
        .slice(0, 60)
    : undefined;

  if (designs) {
    // Both languages or neither, exactly as every other customer-facing name
    // on this product — a picker labelled in English on the Arabic site is a
    // half-translated shop.
    const unnamed = designs.find((d) => !d.name.en || !d.name.ar);
    if (unnamed) {
      return bad(`The design "${unnamed.id}" needs a name in both English and Arabic.`);
    }

    const ids = new Set<string>();
    const duplicate = designs.find((d) => (ids.has(d.id) ? true : (ids.add(d.id), false)));
    if (duplicate) {
      return bad(`Two designs share the id "${duplicate.id}".`);
    }
  }

  /*
   * A variant may only name a design that exists on this product.
   *
   * Without this, renaming or re-adding a design leaves orphan rows: stock
   * that no picker can reach, counted in the product's total, so the
   * storefront advertises units nobody can buy.
   */
  if (variants && designs && designs.length > 0) {
    const known = new Set(designs.map((d) => d.id));
    const orphan = variants.find((v) => v.designId && !known.has(v.designId));
    if (orphan) {
      return bad(`Variant ${orphan.sku} points at design "${orphan.designId}", which does not exist.`);
    }
  }

  if (variants) {
    const bad = variants.find((v) => v.gtin && !isValidGtin(v.gtin));
    if (bad) {
      return NextResponse.json(
        { ok: false, error: `The GTIN on ${bad.sku} has an invalid check digit.` },
        { status: 400 },
      );
    }
  }

  const derivedStock = variants
    ? variants.reduce((sum, v) => sum + v.stock, 0)
    : undefined;

  const productId = body.id ?? slug;
  const upsellIds = ids(body.upsellIds).filter((id) => id !== productId);
  const crossSellIds = ids(body.crossSellIds).filter((id) => id !== productId);

  // A product that recommends itself is a loop the UI would render as an
  // upgrade on its own page. Cheap to prevent, confusing to debug later.
  if (
    ids(body.upsellIds).includes(productId) ||
    ids(body.crossSellIds).includes(productId)
  ) {
    return bad("A product cannot upsell or cross-sell itself.");
  }

  const categoryId = body.categoryId ?? "outerwear";

  /*
   * `categoryPath` is the product's ancestry, and it has to be the *real* one:
   * a listing filtered on a department matches against this array, so a
   * product filed under "Coats" with a path of just ["outerwear-coats"] would
   * vanish from the Outerwear page entirely. Read the tree and resolve it.
   */
  const categories = await getCategories();
  const categoryPath = categoryPathFor(categories, categoryId);

  const payload = {
    slug,
    title,
    subtitle: body.subtitle?.en || body.subtitle?.ar ? body.subtitle : undefined,
    description: body.description ?? { en: "", ar: "" },
    categoryId,
    categoryPath,
    price: money(price, "JOD"),
    compareAtPrice: compareAt && compareAt > 0 ? money(compareAt, "JOD") : undefined,
    currency: "JOD" as const,
    ...(images ? { images } : {}),
    ...(variants ? { variants } : {}),
    ...(designs ? { designs } : {}),
    totalStock: derivedStock ?? totalStock,
    // Derived, never trusted from the body.
    inStock: (derivedStock ?? totalStock) > 0,
    status,
    tags: Array.isArray(body.tags) ? body.tags.slice(0, 25).map(String) : [],
    type,
    sku: (typeof body.sku === "string" && body.sku.trim()) || slug.toUpperCase(),
    gtin: gtin || undefined,
    shippingClassId:
      typeof body.shippingClassId === "string" && body.shippingClassId
        ? body.shippingClassId
        : "standard",
    maxPerOrder,
    upsellIds,
    crossSellIds,
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

    // Firestore rejects undefined. Omitted editor fields preserve old values;
    // explicitly cleared fields must be deleted because this is a merge write.
    const { subtitle, compareAtPrice, gtin: barcode, maxPerOrder: limit, ...required } = payload;

    await ref.set(
      {
        ...required,
        ...(body.subtitle === undefined ? {} : { subtitle: subtitle ?? FieldValue.delete() }),
        ...(body.compareAtPrice === undefined
          ? {}
          : { compareAtPrice: compareAtPrice ?? FieldValue.delete() }),
        ...(type === "variable"
          ? { gtin: FieldValue.delete() }
          : body.gtin === undefined ? {} : { gtin: barcode ?? FieldValue.delete() }),
        ...(body.maxPerOrder === undefined ? {} : { maxPerOrder: limit ?? FieldValue.delete() }),
        ...(existing?.exists
          ? {}
          : {
              publishedAt: new Date(),
              // Only seed what the payload did not supply, so a create that
              // arrives with imagery does not have it wiped.
              ...(images ? {} : { images: [] }),
              colors: [],
              sizes: [],
            }),
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
