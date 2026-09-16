import { NextResponse } from "next/server";

import { getShopProducts } from "@/lib/catalog";
import { scoreByPalette } from "@/lib/visual-search";

/**
 * Search by the colours in a picture.
 *
 * ## The picture never leaves the browser
 *
 * What arrives here is a handful of hex values, not an image. The colours are
 * read from the file on the device with a canvas, and the file itself is never
 * uploaded, never written anywhere, and never seen by this shop.
 *
 * That is worth doing even though an upload would be easier. A photograph
 * somebody takes to search with is a photograph of their room, their wardrobe,
 * sometimes themselves — and a shop that receives it has taken on the job of
 * storing it, securing it, and deleting it. Four hex values carry the part that
 * is useful for matching and none of the part that is theirs.
 *
 * ## What it matches on
 *
 * Colour. Said plainly here and in the UI, because the honest description is
 * also the useful one: a customer who knows it matches colour understands a
 * result that is the right shade and the wrong shape, and a customer told it
 * is "visual search" concludes it is broken.
 *
 * Real shape similarity needs an embedding model — a hosted service that
 * charges per image. `scoreByPalette` is shaped so one can be added beside it
 * without this route or the UI changing.
 */

export const runtime = "nodejs";

/** Four is what the sampler returns; a few more costs nothing to accept. */
const MAX_SWATCHES = 8;

interface Body {
  palette?: { hex?: string; weight?: number }[];
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request body." }, { status: 400 });
  }

  const palette = (Array.isArray(body.palette) ? body.palette : [])
    .map((entry) => ({
      hex: String(entry?.hex ?? "").trim(),
      weight: Number.isFinite(Number(entry?.weight)) ? Number(entry?.weight) : 1,
    }))
    // Validated here rather than trusted: the matcher treats an unreadable hex
    // as infinitely distant, so a bad value degrades quietly into no results
    // at all — which reads as a broken feature rather than a bad request.
    .filter((entry) => /^#[0-9a-f]{6}$/i.test(entry.hex))
    .slice(0, MAX_SWATCHES);

  if (palette.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No usable colours were read from that picture." },
      { status: 400 },
    );
  }

  // The same catalogue layer the pages read, so a match can never surface
  // something the storefront is hiding.
  const products = await getShopProducts();
  const matches = scoreByPalette(products, palette, 24);

  return NextResponse.json(
    {
      ok: true,
      matchedOn: "colour",
      results: matches.map(({ product, score, matchedHex }) => ({
        id: product.id,
        slug: product.slug,
        title: product.title,
        subtitle: product.subtitle ?? null,
        price: product.price,
        compareAtPrice: product.compareAtPrice ?? null,
        currency: product.currency,
        image: product.images[0] ?? null,
        categoryId: product.categoryId,
        score: Math.round(score * 100) / 100,
        matchedHex,
      })),
    },
    // Short and shared: the same palette from two people is the same answer,
    // and the catalogue behind it changes on the hour, not the second.
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  );
}
