import type { Metadata } from "next";

import { getAllProducts, getCategories, listProducts } from "@/lib/catalog";
import { FilterBar } from "@/components/shop/FilterBar";
import { ProductGrid } from "@/components/product/ProductGrid";
import { PageIntro } from "@/components/ui/PageIntro";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { t as pick } from "@/lib/format";
import type { Locale, ProductFilters } from "@/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);
  return { title: t.nav.shop, description: t.shop.collectionBody };
}

export const revalidate = 3600;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Normalise a param that may arrive as a string, an array, or not at all. */
function many(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function one(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SearchParams;
}) {
  const [{ locale: raw }, query] = await Promise.all([params, searchParams]);
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = getDictionary(locale);

  const [categories, allProducts] = await Promise.all([getCategories(), getAllProducts()]);

  const categorySlug = one(query.category);
  const category = categories.find((c) => c.slug === categorySlug);

  const filters: ProductFilters = {
    categoryIds: category ? [category.id] : undefined,
    colorIds: many(query.color),
    sizeIds: many(query.size),
    minPrice: one(query.minPrice) ? Number(one(query.minPrice)) : undefined,
    maxPrice: one(query.maxPrice) ? Number(one(query.maxPrice)) : undefined,
    inStockOnly: one(query.inStock) === "true",
    sort: (one(query.sort) as ProductFilters["sort"]) ?? "featured",
  };

  let products = await listProducts(filters);

  // `onSale` is a presentation filter rather than a catalogue facet, so it is
  // applied here instead of widening the `ProductFilters` contract.
  if (one(query.onSale) === "true") {
    products = products.filter((p) => p.compareAtPrice && p.compareAtPrice > p.price);
  }

  const badge = one(query.badge);
  if (badge) {
    products = products.filter((p) => p.badges.includes(badge as never));
  }

  return (
    <>
      <PageIntro
        locale={locale}
        eyebrow={category ? t.shop.category : t.shop.allPieces}
        title={category ? pick(category.name, locale) : t.shop.collectionTitle}
        description={
          category?.description ? pick(category.description, locale) : t.shop.collectionBody
        }
      />

      <FilterBar
        categories={categories}
        products={allProducts}
        resultCount={products.length}
        locale={locale}
      />

      <div className="ns-container py-10 md:py-16">
        <ProductGrid
          products={products}
          locale={locale}
          columns={4}
          priorityCount={4}
          emptyState={
            <div className="mx-auto max-w-sm">
              <p className="text-ink font-display text-lg font-semibold">{t.shop.emptyTitle}</p>
              <p className="text-smoke mt-2 text-[0.9375rem]">{t.shop.emptyBody}</p>
            </div>
          }
        />
      </div>
    </>
  );
}
