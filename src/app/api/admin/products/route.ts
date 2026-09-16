import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { slugify } from "@/lib/utils";
import { money } from "@/lib/pricing";
import { isValidGtin } from "@/lib/product";
import { getCategories } from "@/lib/catalog";
import { categoryPathFor } from "@/lib/categories";
import {
  duplicateSkus,
  isHex,
  normaliseSku,
  stockRuleProblems,
  tierProblems,
  type PriceTier,
} from "@/lib/product-options";
import { attributesFor, fillSkus } from "@/lib/variant-matrix";
import type {
  Localized,
  Product,
  ProductAttribute,
  ProductColor,
  ProductDesign,
  ProductImage,
  ProductSize,
  ProductType,
  ProductVariant,
  SizeSystem,
  StockPriceRule,
} from "@/types";

/** The size systems the type allows, for validating what the editor sends. */
const SIZE_SYSTEMS: SizeSystem[] = ["alpha", "numeric", "waist", "shoe", "one-size"];

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
  colors?: ProductColor[];
  sizes?: ProductSize[];
  variants?: ProductVariant[];
  designs?: ProductDesign[];
  priceTiers?: PriceTier[] | null;
  stockPriceRules?: StockPriceRule[] | null;
  attributes?: ProductAttribute[] | null;
  /** The `updatedAt` the editor loaded, for conflict detection. */
  expectedUpdatedAt?: number;
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
   * Colours and sizes.
   *
   * These were never read from the body — only seeded as empty arrays on
   * create. A product made in the admin therefore could not have a colour, a
   * size, or a variant that resolved to anything, and the editor's option
   * table had nothing to render. This is the missing half.
   *
   * Ids are normalised but never regenerated: a variant refers to a colour by
   * id, and so does every line of every past order.
   */
  const colors = Array.isArray(body.colors)
    ? body.colors
        .filter((c) => c && typeof c.id === "string" && c.id.trim())
        .map((c) => ({
          id: String(c.id).trim().slice(0, 24),
          name: {
            en: String(c.name?.en ?? "").trim().slice(0, 40),
            ar: String(c.name?.ar ?? "").trim().slice(0, 40),
          },
          hex: isHex(String(c.hex ?? "")) ? String(c.hex).trim() : "#CCCCCC",
          ...(c.hexSecondary && isHex(String(c.hexSecondary))
            ? { hexSecondary: String(c.hexSecondary).trim() }
            : {}),
        }))
        .slice(0, 30)
    : undefined;

  if (colors) {
    const missingName = colors.find((c) => !c.name.en && !c.name.ar);
    if (missingName) return bad(`Colour "${missingName.id}" needs a name.`);
    const ids = new Set<string>();
    for (const c of colors) {
      if (ids.has(c.id)) return bad(`Two colours share the id "${c.id}".`);
      ids.add(c.id);
    }
  }

  const sizes = Array.isArray(body.sizes)
    ? body.sizes
        .filter((s) => s && typeof s.id === "string" && s.id.trim())
        .map((s) => ({
          id: String(s.id).trim().slice(0, 24),
          label: String(s.label ?? "").trim().slice(0, 24) || String(s.id),
          system: (SIZE_SYSTEMS.includes(String(s.system) as SizeSystem)
            ? String(s.system)
            : "alpha") as SizeSystem,
          ...(s.measurements && typeof s.measurements === "object"
            ? { measurements: s.measurements }
            : {}),
        }))
        .slice(0, 40)
    : undefined;

  if (sizes) {
    const ids = new Set<string>();
    for (const s of sizes) {
      if (ids.has(s.id)) return bad(`Two sizes share the id "${s.id}".`);
      ids.add(s.id);
    }
  }

  /*
   * Quantity tiers. `null` clears them; omitted leaves them as they are.
   */
  const priceTiers =
    body.priceTiers === null
      ? null
      : Array.isArray(body.priceTiers)
        ? body.priceTiers
            .filter((t) => t && Number.isFinite(Number(t.minQuantity)))
            /*
             * Not clamped. Rounding a "1" up to a "2" would silently change
             * what the merchant asked for, and a tier starting at one unit is
             * a mistake worth naming rather than quietly correcting — it is
             * just the price.
             */
            .map((t) => ({
              minQuantity: Math.floor(Number(t.minQuantity)),
              unitPrice: money(Number(t.unitPrice) || 0, "JOD"),
            }))
            .sort((a, b) => a.minQuantity - b.minQuantity)
            .slice(0, 8)
        : undefined;

  if (priceTiers) {
    const problems = tierProblems(priceTiers);
    if (problems.length > 0) return bad(problems[0]!);
  }

  /**
   * Markdowns that follow the remaining stock. `null` clears them.
   *
   * Validated here as well as in the editor, because the editor is not the
   * only way in: an import or a script can write a product, and a rule that
   * would give the last unit away should be refused wherever it arrives from.
   */
  const stockPriceRules =
    body.stockPriceRules === null
      ? null
      : Array.isArray(body.stockPriceRules)
        ? body.stockPriceRules
            .filter((rule) => rule && Number.isFinite(Number(rule.whenStockAtOrBelow)))
            .map((rule) => ({
              whenStockAtOrBelow: Math.floor(Number(rule.whenStockAtOrBelow)),
              percentOff: Number(rule.percentOff) || 0,
            }))
            .sort((a, b) => a.whenStockAtOrBelow - b.whenStockAtOrBelow)
            .slice(0, 6)
        : undefined;

  if (stockPriceRules) {
    const problems = stockRuleProblems(stockPriceRules);
    if (problems.length > 0) return bad(problems[0]!);
  }

  /**
   * The product's own axes. `null` clears them.
   *
   * Stored on the product rather than read from its category at render time:
   * a category whose attributes are edited must not silently rewrite the
   * variant table of everything filed under it, and a product moved between
   * categories must not lose the columns its rows are keyed on.
   */
  const attributes =
    body.attributes === null
      ? null
      : Array.isArray(body.attributes)
        ? body.attributes
            .filter((attribute) => attribute && typeof attribute.id === "string")
            .map((attribute, index) => ({
              id: String(attribute.id).trim().slice(0, 60),
              name: {
                en: String(attribute.name?.en ?? attribute.id).slice(0, 80),
                ar: String(attribute.name?.ar ?? attribute.name?.en ?? attribute.id).slice(0, 80),
              },
              kind: (["color", "size", "design", "custom"] as const).includes(attribute.kind)
                ? attribute.kind
                : ("custom" as const),
              values: (Array.isArray(attribute.values) ? attribute.values : [])
                .filter((value) => value && typeof value.id === "string" && value.id.trim())
                .map((value) => ({
                  id: String(value.id).trim().slice(0, 60),
                  label: {
                    en: String(value.label?.en ?? value.id).slice(0, 80),
                    ar: String(value.label?.ar ?? value.label?.en ?? value.id).slice(0, 80),
                  },
                  ...(value.hex && isHex(String(value.hex)) ? { hex: String(value.hex) } : {}),
                }))
                .slice(0, 200),
              position: index,
            }))
            .filter((attribute) => attribute.id)
            .slice(0, 8)
        : undefined;

  if (attributes) {
    // Two axes sharing an id would key every combination wrongly — the second
    // would overwrite the first in the map the duplicate check is built on.
    const ids = attributes.map((attribute) => attribute.id);
    if (new Set(ids).size !== ids.length) {
      return bad("Two attributes share an id. Give each one its own.");
    }
  }

  /*
   * Variant stock, when the editor sends it.
   *
   * `totalStock` is derived from the rows rather than accepted alongside them:
   * two numbers that must agree will eventually not, and the variant rows are
   * the ones the checkout decrements.
   */
  const sentVariants = Array.isArray(body.variants)
    ? body.variants
        /*
         * A missing code is no longer a reason to drop a row — it is filled in
         * below. Dropping it here would lose a row the merchant typed a price
         * and a stock count into, with a 200 and no mention of it.
         */
        .filter((v): v is ProductVariant => Boolean(v) && typeof v === "object")
        .map((v) => ({
          sku: String(v.sku ?? ""),
          colorId: String(v.colorId ?? ""),
          sizeId: String(v.sizeId ?? ""),
          ...(v.designId ? { designId: String(v.designId) } : {}),
          stock: Math.max(0, Math.floor(Number(v.stock) || 0)),
          ...(v.priceOverride === undefined || v.priceOverride === null
            ? {}
            : { priceOverride: money(Number(v.priceOverride), "JOD") }),
          ...(v.gtin ? { gtin: String(v.gtin) } : {}),
          ...(v.barcode ? { barcode: String(v.barcode) } : {}),
          /*
           * Written only when the answer is no.
           *
           * The field means "is this permutation sold at all", and absent
           * means yes — so a product where nothing is switched off carries no
           * new field, and every variant written before the flag existed keeps
           * selling. Storing `true` everywhere would be the same fact spelled
           * more expensively, on four hundred rows.
           */
          ...(v.available === false ? { available: false } : {}),
          /*
           * A sale price for this permutation alone.
           *
           * Stored only when it is a real number: `undefined` and `null` both
           * mean "not on sale", and writing null would leave a field the
           * storefront has to special-case forever.
           */
          ...(v.salePrice === undefined ||
          v.salePrice === null ||
          !Number.isFinite(Number(v.salePrice))
            ? {}
            : { salePrice: money(Number(v.salePrice), "JOD") }),
          /*
           * Axes beyond colour and size. Kept as a plain string map with empty
           * values dropped — an empty string is a value that matches nothing,
           * and it would make two identical rows look like different
           * permutations to the duplicate check.
           */
          ...(v.attributes && typeof v.attributes === "object"
            ? {
                attributes: Object.fromEntries(
                  Object.entries(v.attributes as Record<string, unknown>)
                    .map(([key, value]) => [String(key), String(value ?? "").trim()])
                    .filter(([, value]) => value !== "")
                    .slice(0, 12),
                ),
              }
            : {}),
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
   * Codes for the rows that have none.
   *
   * The table asks for a price and nothing else, so a row can legitimately
   * arrive without a code. It cannot be *stored* without one — the code goes
   * on the order line, the picking list and the invoice — so it is derived
   * from the parent code and the row's own values, which is the same shape the
   * generator produces. Done here rather than in the parse above because it
   * needs the artwork list, which is parsed after the rows.
   */
  const variants = sentVariants
    ? fillSkus(
        sentVariants,
        attributesFor({ colors, sizes, designs }, attributes ?? []),
        (typeof body.sku === "string" && body.sku.trim()) || slug.toUpperCase(),
      )
    : undefined;

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
    /*
     * Two rows answering to one code means stock decrements hit whichever is
     * found first and a picking list is ambiguous. Checked here because the
     * generator is not the only way rows arrive — imports and hand edits both
     * bypass it.
     */
    const dupes = duplicateSkus(variants);
    if (dupes.length > 0) {
      return bad(`Two variants share the code ${dupes[0]}. Every variant needs its own.`);
    }

    const noSku = variants.find((v) => !normaliseSku(v.sku));
    if (noSku) {
      return bad(
        "A variant has no code, and none could be built for it. Give the product a SKU, or give this row a value on at least one attribute.",
      );
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

  /*
   * The product's stock is the sum of the rows it can actually sell.
   *
   * A switched-off combination contributes nothing, however many units it
   * holds. Counting them would make a product read as well stocked on the
   * strength of twelve units nobody can buy — the listing would show it as
   * available, and every shopper who clicked through would find the only
   * stocked option refused. The units are still there on the row for the day
   * the combination is switched back on.
   */
  const derivedStock = variants
    ? variants.reduce((sum, v) => sum + (v.available === false ? 0 : v.stock), 0)
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
    ...(colors ? { colors } : {}),
    ...(sizes ? { sizes } : {}),
    // `null` clears the ladder; omitted leaves whatever is stored.
    ...(priceTiers === undefined
      ? {}
      : { priceTiers: priceTiers === null ? FieldValue.delete() : priceTiers }),
    ...(stockPriceRules === undefined
      ? {}
      : {
          stockPriceRules:
            stockPriceRules === null ? FieldValue.delete() : stockPriceRules,
        }),
    ...(attributes === undefined
      ? {}
      : { attributes: attributes === null ? FieldValue.delete() : attributes }),
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

    /*
     * Optimistic concurrency, before anything is written.
     *
     * The editor is a long-lived form: a merchant can have a product open for
     * twenty minutes while a colleague edits the same one in another window.
     * A plain merge write means the second save silently overwrites the first,
     * and nobody finds out until a price is wrong.
     *
     * The client sends the `updatedAt` it loaded. If the stored document has
     * moved on, this refuses and hands back what is there now, so the editor
     * can show the difference rather than quietly winning.
     *
     * `expectedUpdatedAt` is optional: an import or a script that has not read
     * the document is not pretending to know its version, and blocking those
     * would be a check that only punishes the careful caller.
     */
    if (existing?.exists && body.expectedUpdatedAt !== undefined) {
      const stored = existing.data()?.updatedAt;
      const storedMs =
        stored instanceof Date
          ? stored.getTime()
          : typeof stored?.toMillis === "function"
            ? stored.toMillis()
            : Number(stored) || 0;

      /*
       * Compared exactly, in milliseconds.
       *
       * A tolerance was the obvious thing to write and it is wrong: two saves
       * inside the same second are precisely the concurrent edit this exists
       * to catch, and a one-second window let the second one through. The
       * value survives the round trip without loss — Firestore stores a
       * Timestamp, `serialise` hands the client milliseconds, and the client
       * sends that number back.
       */
      if (storedMs > 0 && storedMs !== Number(body.expectedUpdatedAt)) {
        return NextResponse.json(
          {
            ok: false,
            conflict: true,
            error:
              "This product was changed by someone else while you were editing. " +
              "Reload to see their version before saving.",
            storedUpdatedAt: storedMs,
          },
          { status: 409 },
        );
      }
    }

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
              // Same rule as images: seed only what the payload did not send.
              // These were unconditional, so a create that arrived *with*
              // colours had them overwritten by an empty array on the way in.
              ...(colors ? {} : { colors: [] }),
              ...(sizes ? {} : { sizes: [] }),
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
