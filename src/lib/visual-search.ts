import type { Product } from "@/types";

/**
 * Finding a piece from a photograph.
 *
 * ## What this is, and what it is not
 *
 * It matches on **colour**, and it says so everywhere it appears. That is an
 * honest description of what it does: it reads the dominant colours out of the
 * picture somebody uploaded and finds pieces the shop sells in those colours.
 *
 * It is not a vision model and does not pretend to be. Real visual similarity —
 * "this shape, this drape, this neckline" — needs an embedding model, which is
 * a hosted service that charges per image. Calling this "AI visual search"
 * while it compares colour histograms would be the kind of claim a customer
 * tests once and never trusts again, and the fix for a disappointing result is
 * then invisible to them.
 *
 * Colour alone is more useful than it sounds in a clothing shop: somebody
 * photographing a garment they like is usually most of the way to "this shade
 * of green, roughly this kind of thing", and the catalogue already stores a
 * real hex per colourway.
 *
 * The seam for a model is deliberate: `scoreByPalette` takes a palette and
 * returns ranked products, so an embedding provider can be added beside it
 * later without the UI or the route changing shape.
 *
 * Pure throughout — the browser does the pixel reading and hands the numbers
 * in, so the matching can be tested without a canvas.
 */

export interface Swatch {
  /** 0-255 each. */
  r: number;
  g: number;
  b: number;
  /** Share of the sampled pixels, 0-1. */
  weight: number;
}

/* -------------------------------------------------------------------------- */
/*  Colour space                                                              */
/* -------------------------------------------------------------------------- */

/** `#RRGGBB` to channels. Returns undefined rather than guessing at a bad value. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  const value = parseInt(match[1]!, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/**
 * sRGB to CIELAB.
 *
 * Worth the twenty lines rather than comparing RGB directly: RGB distance
 * treats a step in dark blue as the same size as a step in bright yellow, and
 * people do not — so an RGB match puts navy next to black and calls it close
 * while missing two greens a person would pair instantly.
 */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const f = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  const [rl, gl, bl] = [f(r), f(g), f(b)];

  // D65.
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;

  const k = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [k(x), k(y), k(z)];

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Perceptual distance. Roughly: under 10 reads as the same colour, over 50 as unrelated. */
export function colourDistance(a: string, b: string): number {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  if (!first || !second) return Number.POSITIVE_INFINITY;

  const [l1, a1, b1] = rgbToLab(first.r, first.g, first.b);
  const [l2, a2, b2] = rgbToLab(second.r, second.g, second.b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/* -------------------------------------------------------------------------- */
/*  Reading a picture                                                         */
/* -------------------------------------------------------------------------- */

/** How close two sampled colours must be to count as the same swatch. */
const CLUSTER_RADIUS = 18;

/**
 * The dominant colours in a set of sampled pixels.
 *
 * Takes raw RGBA the way a canvas produces it, so the browser's half of this
 * is three lines and everything worth testing is here.
 *
 * Near-white and near-black are dropped before clustering. In a product
 * photograph they are the backdrop and the shadow, and they are the *most*
 * common pixels by a wide margin — leaving them in means every upload returns
 * "white" and the feature answers the same way for every picture.
 */
export function dominantSwatches(rgba: Uint8ClampedArray | number[], max = 4): Swatch[] {
  const clusters: { r: number; g: number; b: number; count: number }[] = [];
  let considered = 0;

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const alpha = rgba[i + 3]!;
    if (alpha < 200) continue; // transparent padding

    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luminance > 240 || luminance < 18) continue;

    considered += 1;

    const existing = clusters.find(
      (cluster) =>
        Math.abs(cluster.r / cluster.count - r) +
          Math.abs(cluster.g / cluster.count - g) +
          Math.abs(cluster.b / cluster.count - b) <
        CLUSTER_RADIUS * 3,
    );

    if (existing) {
      existing.r += r;
      existing.g += g;
      existing.b += b;
      existing.count += 1;
    } else {
      clusters.push({ r, g, b, count: 1 });
    }
  }

  if (considered === 0) return [];

  return clusters
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((cluster) => ({
      r: Math.round(cluster.r / cluster.count),
      g: Math.round(cluster.g / cluster.count),
      b: Math.round(cluster.b / cluster.count),
      weight: cluster.count / considered,
    }));
}

/** A swatch as the hex the catalogue stores colours in. */
export function swatchToHex(swatch: Pick<Swatch, "r" | "g" | "b">): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${part(swatch.r)}${part(swatch.g)}${part(swatch.b)}`;
}

/* -------------------------------------------------------------------------- */
/*  Matching                                                                   */
/* -------------------------------------------------------------------------- */

/** Beyond this the colours are not related and a "match" would be noise. */
export const MAX_USEFUL_DISTANCE = 45;

export interface VisualMatch<T> {
  product: T;
  /** 0-1, where 1 is the same colour. */
  score: number;
  /** The colour on the product that matched, so the UI can show why. */
  matchedHex: string;
}

/**
 * Rank products against a palette read from an uploaded picture.
 *
 * Scored against each product's *own* colourways rather than against its
 * photographs. The hexes are what the merchant typed and are exact; sampling
 * the product images would compare one photographer's lighting against
 * another's, which is a comparison of studios rather than of garments.
 *
 * A product is scored by its single best-matching colourway, not by an average
 * across them. A piece offered in eight colours would otherwise always lose to
 * a piece offered in one, when what the customer asked was "do you have this
 * in green" — and the answer is yes if any one of the eight is.
 */
export function scoreByPalette<T extends Pick<Product, "colors" | "status">>(
  products: T[],
  palette: { hex: string; weight: number }[],
  max = 24,
): VisualMatch<T>[] {
  if (palette.length === 0) return [];

  const matches: VisualMatch<T>[] = [];

  for (const product of products) {
    if (product.status !== "active") continue;

    let best = Number.POSITIVE_INFINITY;
    let bestHex = "";

    for (const colour of product.colors ?? []) {
      for (const entry of palette) {
        const distance = colourDistance(colour.hex, entry.hex);
        /*
         * The weight biases towards the picture's *main* colour without
         * letting a small accent be ignored: a red dress photographed against
         * a plant should still match red first, and should still find green
         * things below it rather than not at all.
         */
        const weighted = distance * (1 - entry.weight * 0.35);
        if (weighted < best) {
          best = weighted;
          bestHex = colour.hex;
        }
      }
    }

    if (best > MAX_USEFUL_DISTANCE) continue;
    matches.push({
      product,
      score: Math.max(0, 1 - best / MAX_USEFUL_DISTANCE),
      matchedHex: bestHex,
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, max);
}

/**
 * Pieces that look like this one.
 *
 * The product page's own "more like this", built from the same comparison:
 * its colourways as the palette, and its category as a nudge rather than a
 * filter. A hard category filter would answer "a green coat" with only coats,
 * when somebody looking at a green coat is very often looking for the colour.
 */
export function similarTo<T extends Pick<Product, "id" | "colors" | "status" | "categoryPath">>(
  product: T,
  catalogue: T[],
  max = 6,
): T[] {
  const palette = (product.colors ?? []).map((colour) => ({ hex: colour.hex, weight: 1 }));
  if (palette.length === 0) return [];

  const others = catalogue.filter((candidate) => candidate.id !== product.id);

  return scoreByPalette(others, palette, max * 3)
    .map((match) => ({
      ...match,
      score:
        match.score +
        // Same department, a nudge. Enough to break a tie, not enough to
        // exclude a piece from elsewhere that is the right colour.
        (match.product.categoryPath?.some((id) => product.categoryPath?.includes(id)) ? 0.15 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((match) => match.product);
}
