import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes so that a caller-supplied `className` always wins over
 * a component's defaults, rather than depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Stable cart-line identity. Same product + colour + size merges quantities. */
export function cartKey(productId: string, colorId: string, sizeId: string) {
  return `${productId}:${colorId}:${sizeId}`;
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
  return `JO-${out}`;
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
