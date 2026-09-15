"use client";

import { useMemo, useState } from "react";

import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { formatDate, formatPrice, t as pick } from "@/lib/format";
import { AdminPageHeader } from "./AdminShell";
import { DataTable, FilterChips, OrderStatusPill, orderLabel, type Column } from "./AdminUI";
import { useAdminLocale } from "./AdminLocale";
import { paymentLabel } from "@/lib/payments";
import { ExportMenu } from "./ExportMenu";
import type { Order, OrderStatus } from "@/types";

/**
 * Orders inbox.
 *
 * The default view is **everything that still needs a person** rather than all
 * orders newest-first. An operations screen should open on work, not on history;
 * the full list is one click away.
 *
 * Filtering and search are client-side because the whole board is already in
 * memory and a round trip to re-filter a table someone is looking at is a worse
 * experience than the memory. Past a few thousand orders this moves server-side.
 */

type Filter = "needs-action" | "all" | OrderStatus;

export function OrdersBoard({
  orders,
  initialStatus,
}: {
  orders: Order[];
  initialStatus?: string;
}) {
  const { t, locale } = useAdminLocale();
  const router = useLocalizedRouter();
  const [filter, setFilter] = useState<Filter>(
    (initialStatus as Filter) || "needs-action",
  );
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const base: Partial<Record<Filter, number>> = {
      all: orders.length,
      "needs-action": orders.filter((o) =>
        ["pending", "paid", "processing"].includes(o.status),
      ).length,
    };
    for (const order of orders) {
      base[order.status] = (base[order.status] ?? 0) + 1;
    }
    return base;
  }, [orders]);

  const rows = useMemo(() => {
    let list = orders;

    if (filter === "needs-action") {
      list = list.filter((o) => ["pending", "paid", "processing"].includes(o.status));
    } else if (filter !== "all") {
      list = list.filter((o) => o.status === filter);
    }

    const needle = search.trim().toLowerCase();
    if (needle) {
      list = list.filter((order) =>
        [
          order.reference,
          order.email,
          order.shippingAddress.fullName,
          order.shippingAddress.city,
          order.trackingNumber ?? "",
          ...order.items.map((i) => pick(i.title, "en")),
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }

    return list;
  }, [orders, filter, search]);

  const columns: Column<Order>[] = [
    {
      key: "reference",
      header: t("col.order"),
      cell: (order) => (
        <span>
          <Link href={`/admin/orders/${order.reference}`} className="text-ink font-medium">
            {order.reference}
          </Link>
          <span className="text-mist mt-0.5 block text-[0.6875rem] tabular-nums">
            {order.items.length} {order.items.length === 1 ? t("orders.line") : t("orders.lines")}
          </span>
        </span>
      ),
      sortValue: (order) => order.reference,
    },
    {
      key: "customer",
      header: t("col.customer"),
      cell: (order) => (
        <span>
          <span className="text-ink block">{order.shippingAddress.fullName}</span>
          <span className="text-mist block text-[0.6875rem]">{order.shippingAddress.city}</span>
        </span>
      ),
      sortValue: (order) => order.shippingAddress.fullName,
    },
    {
      key: "placed",
      header: t("col.placed"),
      cell: (order) => <span className="text-smoke">{formatDate(order.createdAt)}</span>,
      sortValue: (order) => order.createdAt,
    },
    {
      key: "payment",
      header: t("col.payment"),
      cell: (order) => (
        <span className="text-ink-muted">{paymentLabel(order.paymentMethod, locale)}</span>
      ),
      sortValue: (order) => order.paymentMethod,
    },
    {
      key: "status",
      header: t("col.status"),
      cell: (order) => <OrderStatusPill status={order.status} />,
      sortValue: (order) => order.status,
    },
    {
      key: "total",
      header: t("col.total"),
      align: "end",
      cell: (order) => (
        <span className="text-ink font-medium tabular-nums">
          {formatPrice(order.totals.total, order.totals.currency)}
        </span>
      ),
      sortValue: (order) => order.totals.total,
    },
  ];

  const FILTERS: { value: Filter; label: string }[] = [
    { value: "needs-action", label: t("orders.needsAction") },
    { value: "all", label: t("common.all") },
    { value: "paid", label: orderLabel("paid", locale) },
    { value: "processing", label: orderLabel("processing", locale) },
    { value: "shipped", label: orderLabel("shipped", locale) },
    { value: "delivered", label: orderLabel("delivered", locale) },
    { value: "refunded", label: orderLabel("refunded", locale) },
    { value: "cancelled", label: orderLabel("cancelled", locale) },
  ];

  return (
    <>
      <AdminPageHeader
        title={t("orders.title")}
        description={t("orders.subtitle")}
        actions={
          <ExportMenu
            rows={rows}
            columns={[
              { header: t("col.reference"), value: (o) => o.reference, width: 14 },
              { header: t("col.placed"), value: (o) => new Date(o.createdAt), format: "date", width: 18 },
              { header: t("col.customer"), value: (o) => o.shippingAddress.fullName, width: 24 },
              { header: t("col.email"), value: (o) => o.email, width: 28 },
              { header: t("col.city"), value: (o) => o.shippingAddress.city },
              { header: t("col.status"), value: (o) => orderLabel(o.status, locale) },
              { header: t("col.payment"), value: (o) => paymentLabel(o.paymentMethod, locale) },
              { header: t("col.items"), value: (o) => o.items.reduce((s, i) => s + i.quantity, 0), format: "number" },
              { header: t("col.subtotal"), value: (o) => o.totals.subtotal, format: "currency" },
              { header: t("col.shipping"), value: (o) => o.totals.shipping, format: "currency" },
              { header: t("col.tax"), value: (o) => o.totals.tax, format: "currency" },
              { header: t("col.total"), value: (o) => o.totals.total, format: "currency" },
              { header: t("col.tracking"), value: (o) => o.trackingNumber ?? "" },
            ]}
            filename="net-sale-orders"
            title={t("orders.export")}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} counts={counts} />

        <label className="relative">
          <span className="sr-only">{t("orders.searchLabel")}</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("orders.searchPlaceholder")}
            className="border-line focus:border-brand bg-paper-raised text-ink placeholder:text-mist w-64 rounded-pill border py-2 ps-9 pe-4 text-[0.8125rem] outline-none transition-colors"
          />
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="text-mist absolute start-3 top-1/2 -translate-y-1/2"
          >
            <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </label>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(order) => order.id}
        onRowClick={(order) => router.push(`/admin/orders/${order.reference}`)}
        initialSort={{ key: "placed", dir: "desc" }}
        empty={
          search
            ? `Nothing matches "${search}".`
            : filter === "needs-action"
              ? t("orders.queueClear")
              : t("orders.noneInState")
        }
      />

      <p className="text-mist mt-3 text-[0.75rem] tabular-nums">
        {t("orders.showing")} {rows.length} {t("common.of")} {orders.length} {t("orders.ordersWord")}
      </p>
    </>
  );
}
