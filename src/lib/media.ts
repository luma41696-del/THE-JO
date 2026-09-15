import type { Product, ProductImage } from "@/types";

/**
 * The media library: what an uploaded file is, where it is used, and when it
 * is safe to delete.
 *
 * ## Why this module exists at all
 *
 * The editor used to delete a file from Cloud Storage the instant the merchant
 * pressed × on a thumbnail — before the product was saved, and without asking
 * whether anything else pointed at it. Two ways that loses work:
 *
 *  1. Remove an image from a published product, then close the tab without
 *     saving, or have the save refused as a conflict. The file is gone from
 *     Storage and the published document still lists its URL: a broken image
 *     on a live product page, and no way back.
 *
 *  2. Reuse the same photograph on two products — a size chart, a fabric
 *     swatch, a campaign shot — and removing it from one silently breaks the
 *     other.
 *
 * Removing an image from a form is a statement about *this product*. Deleting
 * a file is a statement about *the shop*. They were the same action; they are
 * not the same thing, and this module keeps them apart.
 *
 * Everything here is pure so the rules can be tested without Firestore.
 */

export interface MediaAsset {
  /** Download URL — the value actually stored on products. The identity. */
  url: string;
  /** Storage object path, for deleting. Derived from the URL at register time. */
  path: string;
  /** The merchant's own words. Copied onto a product when the file is reused. */
  alt: string;
  width: number;
  height: number;
  bytes?: number;
  contentType?: string;
  /** Original filename, lowercased — the only thing a merchant remembers. */
  filename: string;
  uploadedAt: number;
  uploadedBy?: string;
  /** Free text the merchant adds, searched alongside the filename. */
  tags?: string[];
}

/** A file's usage across the catalogue, as counted from the products themselves. */
export interface MediaUsage {
  url: string;
  /** Product ids that reference this file, in gallery or as a design thumbnail. */
  productIds: string[];
  count: number;
}

/* -------------------------------------------------------------------------- */
/*  Identity                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The Storage object path inside a Firebase download URL.
 *
 * `https://firebasestorage.googleapis.com/v0/b/BUCKET/o/products%2Ffoo.jpg?alt=…`
 * carries the path once, percent-encoded, between `/o/` and the query. Parsing
 * it is how a URL stored on a product turns back into something deletable —
 * the alternative is storing the path on every image, which fifteen products
 * of existing data do not have.
 *
 * Returns an empty string for anything that is not a Firebase Storage URL: a
 * seeded `/demo/tee.jpg` asset has no object behind it, and inventing a path
 * for one would mean issuing deletes against files that were never uploaded.
 */
export function storagePathFromUrl(url: string): string {
  if (!url.includes("firebasestorage")) return "";
  const match = /\/o\/([^?]+)/.exec(url);
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

/**
 * Two URLs for the same object.
 *
 * Firebase appends an access token to a download URL, and re-requesting one
 * for the same object can return a different token. Comparing whole URLs would
 * then count one file as two — and, worse, report a file as unused while a
 * product still displays it. Compare the object path where there is one.
 */
export function sameAsset(a: string, b: string): boolean {
  if (a === b) return true;
  const pathA = storagePathFromUrl(a);
  const pathB = storagePathFromUrl(b);
  return pathA !== "" && pathA === pathB;
}

/** Every file URL a product points at: gallery images and design thumbnails. */
export function urlsUsedBy(product: Partial<Product>): string[] {
  const urls = (product.images ?? []).map((image) => image.url);
  for (const design of product.designs ?? []) {
    if (design.thumbnail?.url) urls.push(design.thumbnail.url);
  }
  return [...new Set(urls.filter(Boolean))];
}

/**
 * Count usage of each file across a set of products.
 *
 * `ignoreProductId` excludes the product being saved, because its *incoming*
 * imagery is what the caller is about to write — counting the stored version
 * would report the file it is removing as still in use by itself.
 */
export function usageAcross(
  products: { id: string; images?: ProductImage[]; designs?: Product["designs"] }[],
  ignoreProductId?: string,
): Map<string, MediaUsage> {
  const usage = new Map<string, MediaUsage>();

  for (const product of products) {
    if (ignoreProductId && product.id === ignoreProductId) continue;
    for (const url of urlsUsedBy(product)) {
      const key = storagePathFromUrl(url) || url;
      const entry = usage.get(key) ?? { url, productIds: [], count: 0 };
      if (!entry.productIds.includes(product.id)) {
        entry.productIds.push(product.id);
        entry.count += 1;
      }
      usage.set(key, entry);
    }
  }

  return usage;
}

/** Look one URL up in a usage map built by `usageAcross`. */
export function usageOf(usage: Map<string, MediaUsage>, url: string): MediaUsage | undefined {
  return usage.get(storagePathFromUrl(url) || url);
}

/* -------------------------------------------------------------------------- */
/*  Deleting                                                                  */
/* -------------------------------------------------------------------------- */

export type DeleteRefusal = "in-use" | "not-a-managed-file";

export interface DeleteVerdict {
  ok: boolean;
  reason?: DeleteRefusal;
  /** Who still points at it, so the merchant can go and look. */
  usedBy?: string[];
  message: { en: string; ar: string };
}

/**
 * May this file be deleted from Storage?
 *
 * The refusal is the point. A merchant clearing out an old campaign shot has
 * no way to know it is also the third photograph on a product they published
 * two months ago; the only thing that does know is this count. Deleting it
 * anyway leaves a live page with a hole in it that nobody notices until a
 * customer does.
 *
 * Seeded `/demo/…` assets are refused for a different reason: there is no
 * object behind them, so "deleted" would be a claim about nothing.
 */
export function canDelete(url: string, usage: Map<string, MediaUsage>): DeleteVerdict {
  if (!storagePathFromUrl(url)) {
    return {
      ok: false,
      reason: "not-a-managed-file",
      message: {
        en: "That image shipped with the shop rather than being uploaded, so there is no file to remove.",
        ar: "هذه الصورة جاءت مع المتجر ولم تُرفع، فلا يوجد ملف لحذفه.",
      },
    };
  }

  const entry = usageOf(usage, url);
  if (entry && entry.count > 0) {
    return {
      ok: false,
      reason: "in-use",
      usedBy: entry.productIds,
      message: {
        en:
          entry.count === 1
            ? "One product still uses this image. Remove it there first."
            : `${entry.count} products still use this image. Remove it from them first.`,
        ar:
          entry.count === 1
            ? "ما زال منتج واحد يستخدم هذه الصورة. أزِلها منه أولًا."
            : `ما زال ${entry.count} منتجات تستخدم هذه الصورة. أزِلها منها أولًا.`,
      },
    };
  }

  return { ok: true, message: { en: "Deleted.", ar: "حُذفت." } };
}

/**
 * Which of a form's removed files are now genuinely orphaned.
 *
 * Called **after** a save succeeds, never before: until the document is
 * written, the stored product still points at every one of them.
 *
 * `keptUrls` is what the product now holds — a file dragged out of the gallery
 * and back in during the same session must not be deleted. `usage` covers
 * every *other* product.
 */
export function orphanedAfterSave(
  removedUrls: string[],
  keptUrls: string[],
  usage: Map<string, MediaUsage>,
): string[] {
  return removedUrls.filter((url) => {
    if (!storagePathFromUrl(url)) return false;
    if (keptUrls.some((kept) => sameAsset(kept, url))) return false;
    const entry = usageOf(usage, url);
    return !entry || entry.count === 0;
  });
}

/* -------------------------------------------------------------------------- */
/*  Searching                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Does this asset match what was typed?
 *
 * Filename, alt text and tags, case- and diacritic-insensitively, so an Arabic
 * alt typed with or without harakat finds the same file. The library is
 * browsed by people looking for "the linen one" — matching on the storage path
 * would only ever find things by their timestamp suffix.
 */
export function matchesQuery(asset: MediaAsset, query: string): boolean {
  const needle = normalise(query);
  if (!needle) return true;
  const haystack = normalise([asset.filename, asset.alt, ...(asset.tags ?? [])].join(" "));
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

/** Lowercase, strip Arabic diacritics, and fold the letter variants that differ only by how somebody typed them. */
export function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim();
}

/** A readable size for the card, because "2411923" is not a number anybody reads. */
export function humanBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The asset record for a freshly uploaded image. */
export function assetFrom(
  image: ProductImage,
  file: { name: string; size?: number; type?: string },
  uploadedBy?: string,
): MediaAsset {
  return {
    url: image.url,
    path: storagePathFromUrl(image.url),
    alt: image.alt ?? "",
    width: image.width,
    height: image.height,
    bytes: file.size,
    contentType: file.type,
    filename: file.name.toLowerCase(),
    uploadedAt: Date.now(),
    ...(uploadedBy ? { uploadedBy } : {}),
  };
}
