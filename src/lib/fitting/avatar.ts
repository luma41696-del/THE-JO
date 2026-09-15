/**
 * Avatar geometry, from measurements.
 *
 * This is the honest version of "a 3D model of you": a parametric mannequin
 * whose proportions come from numbers the customer typed, not a reconstruction
 * of a photograph. Reconstructing a body from one casual photo is a research
 * problem with a per-request cost (see FITTING-ROOM.md); pretending a generic
 * mesh *is* that reconstruction is the thing this module exists not to do.
 *
 * What it genuinely gives you: correct proportion. A 96cm chest and a 78cm
 * waist produce a visibly different silhouette from 112/94, and a garment
 * sized against the same numbers sits differently on each. That is enough to
 * answer "will this look boxy on me", which is the question a flat product
 * photo cannot answer at all.
 *
 * Pure maths, no Three.js import — so it can be unit-tested in Node and the
 * renderer stays a thin shell over it.
 */

import type { FitProfile } from "@/types";

/** Everything the mesh builder needs, all in centimetres. */
export interface AvatarParams {
  heightCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  /** Shoulder span, derived when not supplied. */
  shoulderCm: number;
  /** Inside leg, derived when not supplied. */
  inseamCm: number;
}

/**
 * Population medians, used only to fill gaps — never to invent a whole body.
 *
 * `avatarFromProfile` returns null when height is missing, because a figure
 * built entirely from defaults is a stock mannequin wearing a customer's name,
 * and showing one would be the exact overclaim this feature must avoid.
 */
const FALLBACK = { heightCm: 170, chestCm: 94, waistCm: 78, hipCm: 100 };

/** Plausible human range. Outside it, the input is a typo, not a body. */
const RANGE = {
  heightCm: [120, 220],
  chestCm: [60, 160],
  waistCm: [50, 160],
  hipCm: [60, 170],
} as const;

function clamp(value: number, [min, max]: readonly [number, number]) {
  return Math.min(max, Math.max(min, value));
}

export function isPlausible(key: keyof typeof RANGE, value: number): boolean {
  const [min, max] = RANGE[key];
  return Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Build avatar parameters from a saved fit profile.
 *
 * Returns `null` without a height: every other dimension is expressed as a
 * fraction of it, and a body with no scale is not a body.
 */
export function avatarFromProfile(profile: FitProfile | null | undefined): AvatarParams | null {
  if (!profile?.heightCm || !isPlausible("heightCm", profile.heightCm)) return null;

  const heightCm = clamp(profile.heightCm, RANGE.heightCm);

  /*
   * Missing girths fall back to a figure scaled to *this* height rather than
   * to the population median outright — a 150cm person defaulting to a 94cm
   * chest would render as barrel-shaped, which reads as a bug rather than a
   * default.
   */
  const scale = heightCm / FALLBACK.heightCm;

  const chestCm = clamp(profile.chestCm ?? FALLBACK.chestCm * scale, RANGE.chestCm);
  const waistCm = clamp(profile.waistCm ?? FALLBACK.waistCm * scale, RANGE.waistCm);
  const hipCm = clamp(profile.hipCm ?? FALLBACK.hipCm * scale, RANGE.hipCm);

  return {
    heightCm,
    chestCm,
    waistCm,
    hipCm,
    // Anthropometric approximations: shoulder span tracks chest girth, and the
    // inside leg is a fairly stable fraction of stature across adults.
    shoulderCm: chestCm * 0.44,
    inseamCm: heightCm * 0.45,
  };
}

/** How complete the profile is — drives the "add your measurements" prompt. */
export function profileCompleteness(profile: FitProfile | null | undefined) {
  const fields = ["heightCm", "chestCm", "waistCm", "hipCm"] as const;
  const given = fields.filter((f) => {
    const value = profile?.[f];
    return typeof value === "number" && isPlausible(f, value);
  });
  return { given: given.length, total: fields.length, missing: fields.filter((f) => !given.includes(f)) };
}

/* -------------------------------------------------------------------------- */
/*  Silhouette                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The body as a stack of horizontal rings, bottom to top.
 *
 * A lathe profile rather than a skinned humanoid: it is honest about being a
 * mannequin, it has no uncanny face to fall into a valley, and it rebuilds in
 * under a millisecond when a measurement changes — which is what makes the
 * slider feel live.
 *
 * `y` is a fraction of total height; `r` is a radius in centimetres, derived
 * from girth on the assumption of an elliptical cross-section flattened to a
 * circle of equal circumference.
 */
export interface Ring {
  y: number;
  r: number;
}

const circumferenceToRadius = (cm: number) => cm / (2 * Math.PI);

export function bodyProfile(params: AvatarParams): Ring[] {
  const chest = circumferenceToRadius(params.chestCm);
  const waist = circumferenceToRadius(params.waistCm);
  const hip = circumferenceToRadius(params.hipCm);
  const shoulder = circumferenceToRadius(params.shoulderCm * 2.4);
  const neck = circumferenceToRadius(params.chestCm * 0.37);

  /*
   * The landmark heights are proportions of stature taken from standard
   * anthropometric tables, so a tall and a short figure stay recognisably the
   * same species rather than one looking stretched.
   */
  return [
    { y: 0.0, r: hip * 0.42 }, // ankles
    { y: 0.06, r: hip * 0.5 },
    { y: 0.26, r: hip * 0.62 }, // knees
    { y: 0.42, r: hip * 0.86 }, // thigh
    { y: 0.52, r: hip }, // hip
    { y: 0.62, r: waist }, // waist
    { y: 0.72, r: chest }, // chest
    { y: 0.8, r: shoulder }, // shoulder
    { y: 0.86, r: neck }, // neck
    { y: 0.9, r: neck * 1.9 }, // head
    { y: 0.98, r: neck * 1.2 },
    { y: 1.0, r: neck * 0.2 },
  ];
}

/**
 * Radius at an arbitrary height, interpolated between rings.
 *
 * Garments use this to sit *on* the body rather than intersecting it — the
 * single thing that separates a fitted garment from a cylinder floating near
 * a figure.
 */
export function radiusAt(rings: Ring[], y: number): number {
  const clamped = Math.min(1, Math.max(0, y));
  for (let i = 0; i < rings.length - 1; i += 1) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    if (clamped >= a.y && clamped <= b.y) {
      const span = b.y - a.y || 1;
      const t = (clamped - a.y) / span;
      return a.r + (b.r - a.r) * t;
    }
  }
  return rings[rings.length - 1]?.r ?? 0;
}

/** A size's own garment measurements, in centimetres of circumference. */
export interface GarmentMeasurements {
  chest?: number;
  waist?: number;
  hip?: number;
}

/** Where each of those measurements is taken, as a fraction of stature. */
const LANDMARK = { hip: 0.52, waist: 0.62, chest: 0.72 } as const;

/**
 * The garment's radius at a given height.
 *
 * This is what makes a size visible rather than decorative. Without it every
 * size of a garment renders identically — the same silhouette in the same
 * colour — and the figure answers "what does this shape look like" when the
 * customer asked "what does *my size* look like".
 *
 * The rule is a difference, not a replacement: at each landmark the size table
 * gives, the gap between the garment and the body is measured, and that gap is
 * interpolated across the rest of the garment. So the piece keeps the body's
 * shape — a waist still narrows — while sitting at the distance the real
 * measurement implies, and the ease is used only where the table is silent.
 *
 * A negative gap is left negative. A size 8cm smaller than the body renders
 * smaller than the body, and the figure shows through at the edges, which is
 * exactly what a garment that will not close looks like.
 */
export function garmentRadiusAt(
  rings: Ring[],
  y: number,
  ease: number,
  measurements?: GarmentMeasurements,
): number {
  const body = radiusAt(rings, y);

  const gaps = (["hip", "waist", "chest"] as const)
    .map((key) => {
      const cm = measurements?.[key];
      if (cm === undefined || !Number.isFinite(cm) || cm <= 0) return null;
      const at: number = LANDMARK[key];
      return { y: at, gap: circumferenceToRadius(cm) - radiusAt(rings, at) };
    })
    .filter((entry): entry is { y: number; gap: number } => entry !== null);

  if (gaps.length === 0) return body + ease;

  // Below the lowest landmark and above the highest, hold the nearest gap
  // rather than extrapolating — a hem is not evidence about a shoulder.
  const first = gaps[0]!;
  const last = gaps[gaps.length - 1]!;
  if (y <= first.y) return body + first.gap;
  if (y >= last.y) return body + last.gap;

  for (let i = 0; i < gaps.length - 1; i += 1) {
    const a = gaps[i]!;
    const b = gaps[i + 1]!;
    if (y >= a.y && y <= b.y) {
      const t = (y - a.y) / (b.y - a.y || 1);
      return body + a.gap + (b.gap - a.gap) * t;
    }
  }

  return body + ease;
}

/* -------------------------------------------------------------------------- */
/*  Garments                                                                  */
/* -------------------------------------------------------------------------- */

export type GarmentKind = "coat" | "top" | "dress" | "trouser" | "shoe" | "bag";

/** Where a garment starts and stops, as fractions of height. */
export interface GarmentSpan {
  from: number;
  to: number;
  /** Extra room over the body, in centimetres of radius. */
  ease: number;
  /** Split into two legs rather than one tube. */
  legs?: boolean;
}

/**
 * Map a product to a garment shape using its **ancestry**, not its leaf
 * category — the same bug that sized trousers by the chest lives here if the
 * leaf is matched.
 */
export function garmentKind(categoryPath: string[]): GarmentKind | null {
  const has = (id: string) => categoryPath.includes(id);
  if (has("outerwear")) return "coat";
  if (has("dresses")) return "dress";
  if (has("trousers")) return "trouser";
  if (has("knitwear")) return "top";
  if (has("footwear")) return "shoe";
  if (has("bags")) return "bag";
  return null;
}

/**
 * The garment's extent and ease.
 *
 * `ease` is what makes a size choice visible: a relaxed coat carries ~6cm of
 * radius over the body, a slim top ~1cm. Feeding the *chosen size's*
 * measurement in rather than the body's is what makes a too-small size look
 * too small instead of simply rendering the same shape in a different colour.
 */
export function garmentSpan(kind: GarmentKind, silhouette: string): GarmentSpan | null {
  const ease =
    silhouette === "oversized" ? 7 : silhouette === "relaxed" ? 4.5 : silhouette === "slim" ? 1 : 2.5;

  switch (kind) {
    case "coat":
      return { from: 0.3, to: 0.82, ease: ease + 1.5 };
    case "dress":
      return { from: 0.34, to: 0.78, ease };
    case "top":
      return { from: 0.56, to: 0.79, ease };
    case "trouser":
      return { from: 0.04, to: 0.63, ease, legs: true };
    case "shoe":
      return { from: 0.0, to: 0.05, ease: 1.5 };
    case "bag":
      // Carried, not worn: positioned beside the body by the renderer.
      return { from: 0.45, to: 0.6, ease: 0 };
    default:
      return null;
  }
}
