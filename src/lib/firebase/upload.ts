"use client";

import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";

import { getStorageClient } from "@/lib/firebase/client";
import type { ProductImage } from "@/types";

/**
 * Image uploads from the admin.
 *
 * The Storage rules already refused SVG and anything over 10MB; nothing in the
 * app ever called them. This is the missing half — the file input in the
 * product editor was a real `<input type="file">` wired to nothing at all, so
 * an admin could pick an image, see it accepted, and save a product with no
 * imagery.
 *
 * Validation is repeated here rather than left to the rules. The rules are the
 * authority, but a rejection from them arrives as an opaque
 * `storage/unauthorized` after the whole file has uploaded — checking first
 * means the admin is told "that's an SVG" in the moment, not after a 9MB
 * round trip.
 */

/** Mirrors `isSafeImage()` in storage.rules. SVG is deliberately absent. */
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const MAX_BYTES = 10 * 1024 * 1024;

export const ACCEPT_ATTRIBUTE = ACCEPTED.join(",");

export class UploadError extends Error {}

export interface UploadOptions {
  /** 0–1. Called often; cheap to render a bar from. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

function validate(file: File) {
  if (!ACCEPTED.includes(file.type)) {
    throw new UploadError(
      file.type === "image/svg+xml"
        ? "SVG cannot be uploaded: it is an executable document and would be a stored-XSS risk. Export a PNG or WebP."
        : `${file.type || "That file type"} is not an image we accept. Use JPEG, PNG, WebP, AVIF or GIF.`,
    );
  }
  if (file.size > MAX_BYTES) {
    throw new UploadError(
      `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 10MB — resize it first.`,
    );
  }
}

/** Read an image's real pixel dimensions, which `ProductImage` requires. */
function measure(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // A file the browser cannot decode is not usable as product imagery, but
      // a plausible ratio keeps the layout from collapsing if one slips past.
      resolve({ width: 1200, height: 1600 });
    };
    img.src = url;
  });
}

/** A collision-proof, human-readable object name. */
function objectName(file: File) {
  const clean = file.name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const stamp = Date.now().toString(36);
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  return `${clean || "image"}-${stamp}.${ext}`;
}

/**
 * Upload one product image and return the record to store on the product.
 *
 * `alt` is required by `ProductImage` and is deliberately not auto-filled from
 * the filename — "IMG_4821" is worse than nothing for a screen reader. The
 * editor asks for it.
 */
export async function uploadProductImage(
  productId: string,
  file: File,
  alt: string,
  options: UploadOptions = {},
): Promise<ProductImage> {
  validate(file);

  const { width, height } = await measure(file);
  const storage = getStorageClient();
  const path = `products/${productId}/${objectName(file)}`;
  const task = uploadBytesResumable(ref(storage, path), file, {
    contentType: file.type,
    cacheControl: "public, max-age=31536000, immutable",
  });

  options.signal?.addEventListener("abort", () => task.cancel(), { once: true });

  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) =>
        options.onProgress?.(
          snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0,
        ),
      (error) => {
        // Translate Firebase's codes into something a merchant can act on.
        const code = (error as { code?: string }).code ?? "";
        if (code === "storage/unauthorized") {
          reject(new UploadError("Your account is not allowed to upload product imagery."));
        } else if (code === "storage/canceled") {
          reject(new UploadError("Upload cancelled."));
        } else if (code === "storage/retry-limit-exceeded") {
          reject(new UploadError("The connection dropped. Try again on a steadier network."));
        } else {
          reject(new UploadError(error.message));
        }
      },
      () => resolve(),
    );
  });

  return {
    url: await getDownloadURL(task.snapshot.ref),
    alt: alt.trim(),
    width,
    height,
  };
}

/**
 * Remove an uploaded image from Storage.
 *
 * A missing object is treated as success: the goal is "this image is gone",
 * and an image that was never there satisfies it. Failing here would leave the
 * admin unable to clean up a half-finished record.
 */
export async function deleteProductImage(url: string): Promise<void> {
  if (!url.includes("firebasestorage")) return; // a seeded /demo asset
  try {
    await deleteObject(ref(getStorageClient(), url));
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "storage/object-not-found") return;
    throw new UploadError("That image could not be removed from storage.");
  }
}
