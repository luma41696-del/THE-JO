/**
 * Where this shop lives.
 *
 * One function, because the same value was being read three ways with three
 * different fallbacks:
 *
 *   `process.env.NEXT_PUBLIC_SITE_URL ?? "https://netsale.shop"`   (emails)
 *   `process.env.NEXT_PUBLIC_SITE_URL ?? ""`                        (JSON-LD)
 *   `process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"`   (metadata)
 *
 * The middle one is the reason this exists. An empty base produced a
 * *relative* canonical URL in the product page's structured data, which is
 * invalid there — search engines need an absolute one, and a relative value is
 * the kind of thing that validates as "present" while being useless.
 *
 * The trailing slash is stripped once here so no caller has to remember
 * whether to add one, and no URL ends up with a double slash in the middle.
 */

const FALLBACK = "http://localhost:3000";

export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (configured && configured.length > 0 ? configured : FALLBACK).replace(/\/+$/, "");
}

/** An absolute URL for a path, with or without its leading slash. */
export function absoluteUrl(path = ""): string {
  const clean = path.replace(/^\/+/, "");
  return clean ? `${siteUrl()}/${clean}` : siteUrl();
}
