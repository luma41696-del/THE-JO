import { NextResponse } from "next/server";

import { searchProducts } from "@/lib/catalog";

/**
 * Product search.
 *
 * Reads through the same catalogue layer as the pages, so search results can
 * never show a product the storefront would not. In-memory matching is right
 * for a twelve-piece collection; past a few thousand SKUs this endpoint should
 * proxy a real index (Algolia / Typesense) without the client noticing.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const term = (searchParams.get("q") ?? "").slice(0, 80);

  if (term.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  const products = await searchProducts(term, 8);

  // Only the fields the dropdown renders — no need to ship whole documents.
  return NextResponse.json(
    {
      results: products.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        subtitle: p.subtitle ?? null,
        price: p.price,
        compareAtPrice: p.compareAtPrice ?? null,
        currency: p.currency,
        image: p.images[0] ?? null,
        categoryId: p.categoryId,
      })),
    },
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  );
}
