"use client";

import { useMemo, useState } from "react";
import Image from "next/image";

import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { formatPrice, t as pick } from "@/lib/format";
import { discountPercent } from "@/lib/utils";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { DataTable, FilterChips, type Column } from "./AdminUI";
import { ExportMenu } from "./ExportMenu";
import { Button } from "@/components/ui/Button";
import type { Category, Product } from "@/types";

/**
 * Catalogue board.
 *
 * Sorted by **stock ascending** by default, not alphabetically. The question
 * this screen answers most often is "what is about to run out", and an
 * alphabetical list buries that behind the letter A.
 */

type Filter = "all" | "low-stock" | "on-sale" | "draft" | string;

const LOW_STOCK = 8;

export function ProductsBoard({
  products,
  categories,
}: {
  products: Product[];
  categories: Category[];
}) {
  const { t, locale } = useAdminLocale();
  const router = useLocalizedRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(
    () => ({
      all: products.length,
      "low-stock": products.filter((p) => p.totalStock <= LOW_STOCK).length,
      "on-sale": products.filter((p) => p.compareAtPrice && p.compareAtPrice > p.price).length,
      draft: products.filter((p) => p.status !== "active").length,
    }),
    [products],
  );

  const rows = useMemo(() => {
    let list = products;

    if (filter === "low-stock") list = list.filter((p) => p.totalStock <= LOW_STOCK);
    else if (filter === "on-sale")
      list = list.filter((p) => p.compareAtPrice && p.compareAtPrice > p.price);
    else if (filter === "draft") list = list.filter((p) => p.status !== "active");
    else if (filter !== "all") list = list.filter((p) => p.categoryId === filter);

    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter((p) =>
        [pick(p.title, "en"), pick(p.title, "ar"), p.slug, p.categoryId, ...p.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }

    return list;
  }, [products, filter, search]);

  const columns: Column<Product>[] = [
    {
      key: "product",
      header: t("col.product"),
      cell: (product) => (
        <span className="flex items-center gap-3">
          {product.images[0] && (
            <span className="bg-paper-sunken relative h-12 w-9 shrink-0 overflow-hidden rounded-sm">
              <Image
                src={product.images[0].url}
                alt=""
                fill
                sizes="36px"
                className="object-cover"
              />
            </span>
          )}
          <span className="min-w-0">
            <Link
              href={`/admin/products/${product.id}`}
              className="text-ink block truncate font-medium"
            >
              {pick(product.title, locale)}
            </Link>
            <span className="text-mist block truncate text-[0.6875rem]" dir="rtl" lang="ar">
              {pick(product.title, "ar")}
            </span>
          </span>
        </span>
      ),
      sortValue: (product) => pick(product.title, locale),
    },
    {
      key: "category",
      header: t("col.category"),
      cell: (product) => <span className="text-ink-muted capitalize">{product.categoryId}</span>,
      sortValue: (product) => product.categoryId,
    },
    {
      key: "price",
      header: t("col.price"),
      align: "end",
      cell: (product) => {
        const off = discountPercent(product.price, product.compareAtPrice);
        return (
          <span className="tabular-nums">
            <span className={cn("font-medium", off > 0 ? "text-alert" : "text-ink")}>
              {formatPrice(product.price, product.currency)}
            </span>
            {off > 0 && <span className="text-mist ms-2 text-[0.6875rem]">−{off}%</span>}
          </span>
        );
      },
      sortValue: (product) => product.price,
    },
    {
      key: "stock",
      header: t("col.stock"),
      align: "end",
      cell: (product) => (
        <span
          className={cn(
            "font-medium tabular-nums",
            product.totalStock === 0
              ? "text-alert"
              : product.totalStock <= LOW_STOCK
                ? "text-brand-deep"
                : "text-ink",
          )}
        >
          {product.totalStock}
          {product.totalStock <= LOW_STOCK && product.totalStock > 0 && (
            <span className="text-mist ms-1.5 text-[0.6875rem]">low</span>
          )}
        </span>
      ),
      sortValue: (product) => product.totalStock,
    },
    {
      key: "variants",
      header: t("col.variants"),
      align: "end",
      cell: (product) => (
        <span className="text-smoke tabular-nums">
          {product.colors.length} × {product.sizes.length}
        </span>
      ),
      sortValue: (product) => product.colors.length * product.sizes.length,
    },
    {
      key: "status",
      header: t("col.status"),
      cell: (product) => (
        <span
          className={cn(
            "rounded-pill inline-flex px-2.5 py-1 text-[0.6875rem] font-medium capitalize",
            product.status === "active" ? "bg-mint/12 text-mint" : "bg-paper-sunken text-smoke",
          )}
        >
          {product.status}
        </span>
      ),
      sortValue: (product) => product.status,
    },
  ];

  const filters = [
    { value: "all", label: t("common.all") },
    { value: "low-stock", label: t("products.lowStock") },
    { value: "on-sale", label: t("products.onSale") },
    { value: "draft", label: t("products.draft") },
    ...categories.map((c) => ({ value: c.id, label: pick(c.name, locale) })),
  ];

  return (
    <>
      <AdminPageHeader
        title={t("products.title")}
        description={t("products.subtitle")}
        actions={
          <>
            <ExportMenu
              rows={rows}
              columns={[
                { header: t("col.titleEn"), value: (p) => pick(p.title, "en"), width: 30 },
                { header: t("col.titleAr"), value: (p) => pick(p.title, "ar"), width: 30 },
                { header: t("col.slug"), value: (p) => p.slug, width: 26 },
                { header: t("col.category"), value: (p) => p.categoryId },
                { header: t("col.price"), value: (p) => p.price, format: "currency" },
                { header: t("col.compareAt"), value: (p) => p.compareAtPrice ?? "", format: "currency" },
                { header: t("col.stock"), value: (p) => p.totalStock, format: "number" },
                { header: t("col.colours"), value: (p) => p.colors.map((c) => pick(c.name, locale)).join(", "), width: 28 },
                { header: t("col.sizes"), value: (p) => p.sizes.map((s) => s.label).join(", ") },
                { header: t("col.status"), value: (p) => p.status },
                // Exported from the seeded field, which is demo data. Left in
                // the export for continuity, but the storefront no longer shows
                // it — the product page reads published reviews instead.
                { header: "Seeded rating", value: (p) => p.rating?.average ?? "" },
              ]}
              filename="net-sale-catalogue"
              title={t("products.title")}
            />
            <Link href="/admin/products/new">
              <Button variant="brand" size="sm">
                {t("products.new")}
              </Button>
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips options={filters} value={filter} onChange={setFilter} counts={counts} />

        <label className="relative">
          <span className="sr-only">{t("products.searchLabel")}</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("products.searchPlaceholder")}
            className="border-line focus:border-brand bg-paper-raised text-ink placeholder:text-mist w-56 rounded-pill border py-2 ps-4 pe-4 text-[0.8125rem] outline-none transition-colors"
          />
        </label>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(product) => product.id}
        onRowClick={(product) => router.push(`/admin/products/${product.id}`)}
        initialSort={{ key: "stock", dir: "asc" }}
        empty={search ? t("common.noMatch") : t("products.empty")}
      />
    </>
  );
}
