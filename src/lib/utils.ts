import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's *stock* scales. Our `@theme` block in
 * `globals.css` adds font sizes and shadows with word-shaped names, and
 * tailwind-merge's fallback for an unrecognised `text-*` / `shadow-*` word is
 * "it must be a colour" — so it filed `text-display` in the same group as
 * `text-ink` and silently dropped whichever came first.
 *
 * That is not a cosmetic detail: every section heading on the site lost its
 * font size, collapsed to 16px, and then never appeared at all, because the
 * masked `Reveal` wrapper shrank to the collapsed height and clipped the
 * element out of the viewport — so the IntersectionObserver that was supposed
 * to fade it in never saw it intersect.
 *
 * Listing the custom names here files them in the right group. Any new
 * `--text-*` or `--shadow-*` token in `@theme` must be added here too.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["hero", "display", "eyebrow"] }],
      shadow: [{ shadow: ["brand", "lift", "float", "hover"] }],
    },
  },
});

/**
 * Merge Tailwind classes so that a caller-supplied `className` always wins over
 * a component's defaults, rather than depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Stable cart-line identity. Same product + colour + size + design merges.
 *
 * The design segment is **appended only when there is one**, so a line written
 * before designs existed keeps byte-for-byte the same key. Carts are persisted
 * in the browser and synced to Firestore; a key format that changed shape for
 * everyone would orphan every line already in a customer's bag, and the
 * quantity stepper and remove button both address a line by its key.
 */
export function cartKey(productId: string, colorId: string, sizeId: string, designId = "") {
  const base = `${productId}:${colorId}:${sizeId}`;
  return designId ? `${base}:${designId}` : base;
}

/** Clamp with no surprises when min > max. */
export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Map a value from one range to another, clamped to the output range. */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
) {
  if (inMax === inMin) return outMin;
  const t = (value - inMin) / (inMax - inMin);
  return clamp(outMin + t * (outMax - outMin), Math.min(outMin, outMax), Math.max(outMin, outMax));
}

/** Frame-rate independent interpolation, for cursor and parallax smoothing. */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/**
 * Human-readable order reference. Deliberately excludes I, O, 0 and 1 so a
 * customer reading it off a screen to support cannot transpose them.
 */
export function orderReference(seed = Date.now()) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  let n = seed;
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[(n + Math.floor(Math.random() * alphabet.length)) % alphabet.length];
    n = Math.floor(n / alphabet.length);
  }
  return `NS-${out}`;
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** Percentage saved, rounded down so the badge never overstates the discount. */
export function discountPercent(price: number, compareAt?: number) {
  if (!compareAt || compareAt <= price) return 0;
  return Math.floor(((compareAt - price) / compareAt) * 100);
}

export function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

/** Split an array into chunks — used by the promo rail and outfit grids. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Trailing-edge debounce for search and filter inputs. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export const isBrowser = typeof window !== "undefined";
