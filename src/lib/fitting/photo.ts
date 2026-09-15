"use client";

/**
 * Photo intake and quality checks.
 *
 * The checks run **before** anything is uploaded, on a canvas in the browser.
 * That ordering is the point: telling someone their photo is too dark after a
 * 6MB upload and a 15-second provider round trip is the difference between a
 * feature that guides and one that just fails slowly.
 *
 * None of this is a person detector. It measures resolution, exposure and
 * focus — properties of the file — and says what to fix. It deliberately does
 * not claim to know whether the photo shows a whole body, because a heuristic
 * that guesses wrong would reject a valid photo with a confident, wrong
 * reason.
 */

export type PhotoIssue =
  | "too-small"
  | "too-large"
  | "wrong-type"
  | "too-dark"
  | "too-bright"
  | "blurry"
  | "wrong-shape";

export interface PhotoCheck {
  ok: boolean;
  issues: PhotoIssue[];
  /** A preview data URL, already downscaled for upload. */
  preview?: string;
  width: number;
  height: number;
  /** Diagnostics, so the UI can show *how* dark rather than just "too dark". */
  brightness: number;
  sharpness: number;
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_EDGE = 600;

/** Human sentences for each issue, in both languages. */
export const PHOTO_ISSUE_TEXT: Record<PhotoIssue, { en: string; ar: string }> = {
  "too-small": {
    en: "That image is small — use one at least 600px on its shortest side.",
    ar: "الصورة صغيرة — استخدم صورة لا يقل أقصر ضلع فيها عن ٦٠٠ بكسل.",
  },
  "too-large": {
    en: "That file is over 8MB. Most phones can export a smaller copy.",
    ar: "حجم الملف يتجاوز ٨ ميغابايت. معظم الهواتف تتيح تصدير نسخة أصغر.",
  },
  "wrong-type": {
    en: "Use a JPEG, PNG or WebP photo.",
    ar: "استخدم صورة بصيغة JPEG أو PNG أو WebP.",
  },
  "too-dark": {
    en: "It is quite dark. Stand facing a window or a lamp.",
    ar: "الصورة معتمة. قف مقابل نافذة أو مصدر ضوء.",
  },
  "too-bright": {
    en: "It is washed out. Move away from direct light behind you.",
    ar: "الصورة ساطعة جداً. ابتعد عن الضوء المباشر خلفك.",
  },
  blurry: {
    en: "It looks blurred. Brace the phone, or ask someone to take it.",
    ar: "الصورة غير واضحة. ثبّت الهاتف أو اطلب من شخص التقاطها.",
  },
  "wrong-shape": {
    en: "A full-length portrait works best — taller than it is wide.",
    ar: "الأفضل صورة بالطول الكامل — ارتفاعها أكبر من عرضها.",
  },
};

/** The shooting guidance shown before the picker opens. */
export const PHOTO_GUIDANCE = {
  en: [
    "Stand against a plain wall, full length in frame.",
    "Face the camera, arms slightly away from your sides.",
    "Wear close-fitting clothes — a loose coat hides your shape.",
    "Even light from the front. Avoid a bright window behind you.",
  ],
  ar: [
    "قف أمام جدار سادة، وليظهر جسمك بالكامل في الإطار.",
    "واجه الكاميرا، وأبعد ذراعيك قليلاً عن جانبيك.",
    "ارتدِ ملابس ملتصقة — المعطف الواسع يخفي القوام.",
    "إضاءة متساوية من الأمام، وتجنّب نافذة ساطعة خلفك.",
  ],
};

/**
 * Inspect a photo and produce a downscaled preview.
 *
 * Sharpness uses the variance of a Laplacian over the luminance channel — the
 * standard cheap focus measure. It is a heuristic, so the threshold is set
 * generously: a false "blurry" on a good photo is far more annoying than
 * letting a slightly soft one through.
 */
export async function checkPhoto(file: File): Promise<PhotoCheck> {
  const issues: PhotoIssue[] = [];

  if (!ACCEPTED.includes(file.type)) issues.push("wrong-type");
  if (file.size > MAX_BYTES) issues.push("too-large");

  if (issues.length > 0) {
    return { ok: false, issues, width: 0, height: 0, brightness: 0, sharpness: 0 };
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    return {
      ok: false,
      issues: ["wrong-type"],
      width: 0,
      height: 0,
      brightness: 0,
      sharpness: 0,
    };
  }

  const { width, height } = bitmap;
  if (Math.min(width, height) < MIN_EDGE) issues.push("too-small");
  // Portrait is a preference, not a rule — a slightly-wide photo is still
  // usable, so only a clearly landscape frame is flagged.
  if (width > height * 1.1) issues.push("wrong-shape");

  /*
   * Analysis runs on a small copy. A 4000px photo would take a noticeable
   * moment to walk pixel by pixel on a mid-range phone, and the measurements
   * are scale-invariant anyway.
   */
  const SAMPLE = 256;
  const scale = SAMPLE / Math.max(width, height);
  const sw = Math.max(1, Math.round(width * scale));
  const sh = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let brightness = 0.5;
  let sharpness = 1;

  if (ctx) {
    ctx.drawImage(bitmap, 0, 0, sw, sh);
    const { data } = ctx.getImageData(0, 0, sw, sh);

    // Luminance, Rec. 709.
    const luma = new Float32Array(sw * sh);
    let sum = 0;
    for (let i = 0; i < luma.length; i += 1) {
      const o = i * 4;
      const value =
        (0.2126 * (data[o] ?? 0) + 0.7152 * (data[o + 1] ?? 0) + 0.0722 * (data[o + 2] ?? 0)) / 255;
      luma[i] = value;
      sum += value;
    }
    brightness = sum / luma.length;

    // Laplacian variance.
    let mean = 0;
    const lap = new Float32Array(luma.length);
    for (let y = 1; y < sh - 1; y += 1) {
      for (let x = 1; x < sw - 1; x += 1) {
        const i = y * sw + x;
        const value =
          4 * (luma[i] ?? 0) -
          (luma[i - 1] ?? 0) -
          (luma[i + 1] ?? 0) -
          (luma[i - sw] ?? 0) -
          (luma[i + sw] ?? 0);
        lap[i] = value;
        mean += value;
      }
    }
    mean /= lap.length;
    let variance = 0;
    for (let i = 0; i < lap.length; i += 1) {
      const d = (lap[i] ?? 0) - mean;
      variance += d * d;
    }
    sharpness = (variance / lap.length) * 1000;

    if (brightness < 0.18) issues.push("too-dark");
    if (brightness > 0.86) issues.push("too-bright");
    if (sharpness < 0.4) issues.push("blurry");
  }

  /*
   * A downscaled upload copy. The provider does not need 12 megapixels, and
   * every pixel sent is a pixel of somebody's body leaving the device — the
   * smallest useful image is the right one.
   */
  const MAX_UPLOAD = 1280;
  const uploadScale = Math.min(1, MAX_UPLOAD / Math.max(width, height));
  const outCanvas = document.createElement("canvas");
  outCanvas.width = Math.round(width * uploadScale);
  outCanvas.height = Math.round(height * uploadScale);
  const outCtx = outCanvas.getContext("2d");
  let preview: string | undefined;
  if (outCtx) {
    outCtx.drawImage(bitmap, 0, 0, outCanvas.width, outCanvas.height);
    preview = outCanvas.toDataURL("image/jpeg", 0.86);
  }

  bitmap.close?.();

  return {
    ok: issues.length === 0,
    issues,
    preview,
    width,
    height,
    brightness,
    sharpness,
  };
}

/** Turn a data URL back into a File for upload. */
export async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const blob = await fetch(dataUrl).then((r) => r.blob());
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}
