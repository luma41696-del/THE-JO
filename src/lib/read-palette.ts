"use client";

import { dominantSwatches, swatchToHex, type Swatch } from "@/lib/visual-search";

/**
 * Read the dominant colours out of a picture, on the device.
 *
 * The browser half of the colour search: the file is drawn to a canvas, the
 * pixels are handed to `dominantSwatches`, and only the resulting hex values
 * ever go anywhere. The image itself is never uploaded.
 *
 * That is a deliberate trade and not just a convenience. A picture somebody
 * searches with is a picture of their room, their wardrobe, sometimes
 * themselves — and a shop that receives one has taken on storing it, securing
 * it and deleting it. Four hex values carry the part that helps and none of
 * the part that is theirs.
 */

/**
 * Sampled at a small size on purpose.
 *
 * A 4000-pixel phone photograph is sixteen million pixels to walk, which locks
 * the tab for a noticeable moment on a mid-range device. Downscaling to 160
 * loses nothing that matters — the question is "roughly what colour is this",
 * and the answer survives a resize far better than it survives a frozen page.
 */
const SAMPLE_EDGE = 160;

export class PaletteError extends Error {}

export async function paletteFromFile(file: File, max = 4): Promise<{ hex: string; weight: number }[]> {
  if (!file.type.startsWith("image/")) {
    throw new PaletteError("That file is not an image.");
  }

  const bitmap = await loadBitmap(file);

  try {
    const scale = Math.min(1, SAMPLE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new PaletteError("This browser cannot read the picture's colours.");

    context.drawImage(bitmap, 0, 0, width, height);

    /*
     * `getImageData` throws on a tainted canvas. It cannot be tainted here —
     * the source is a local file, not a cross-origin URL — but the failure
     * would otherwise surface as an unhandled exception in the middle of a
     * search, so it is named.
     */
    let data: Uint8ClampedArray;
    try {
      data = context.getImageData(0, 0, width, height).data;
    } catch {
      throw new PaletteError("That picture could not be read on this device.");
    }

    const swatches: Swatch[] = dominantSwatches(data, max);
    if (swatches.length === 0) {
      /*
       * Everything in the picture was backdrop or shadow. Saying so is better
       * than searching for white, which returns a page of results with no
       * relationship to what was uploaded.
       */
      throw new PaletteError("No clear colours in that picture. Try one where the piece fills more of the frame.");
    }

    return swatches.map((swatch) => ({ hex: swatchToHex(swatch), weight: swatch.weight }));
  } finally {
    // Frees the decoded image immediately rather than at the next collection,
    // which matters when somebody tries three photographs in a row.
    bitmap.close?.();
  }
}

/** `createImageBitmap` where it exists, an `<img>` where it does not. */
async function loadBitmap(file: File): Promise<ImageBitmap & { close?: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new PaletteError("That picture could not be opened.");
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new PaletteError("That picture could not be opened."));
      element.src = url;
    });
    // Close enough to an ImageBitmap for `drawImage`, which is all it is for.
    return image as unknown as ImageBitmap;
  } finally {
    URL.revokeObjectURL(url);
  }
}
