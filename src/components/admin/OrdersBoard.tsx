"use client";

import { useMemo, useState } from "react";

import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { formatDate, formatPrice, t as pick } from "@/lib/format";
import { AdminPageHeader } from "./AdminShell";
import { DataTable, FilterChips, OrderStatusPill, ORDER_LABELS, type Column } from "./AdminUI";
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
      header: "Order",
      cell: (order) => (
        <span>
          <Link href={`/admin/orders/${order.reference}`} className="text-ink font-medium">
            {order.reference}
          </Link>
          <span className="text-mist mt-0.5 block text-[0.6875rem] tabular-nums">
            {order.items.length} {order.items.length === 1 ? "line" : "lines"}
          </span>
        </span>
      ),
      sortValue: (order) => order.reference,
    },
    {
      key: "customer",
      header: "Customer",
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
      header: "Placed",
      cell: (order) => <span className="text-smoke">{formatDate(order.createdAt)}</span>,
      sortValue: (order) => order.createdAt,
    },
    {
      key: "payment",
      header: "Payment",
      cell: (order) => <span className="text-ink-muted capitalize">{order.paymentMethod.replace("-", " ")}</span>,
      sortValue: (order) => order.paymentMethod,
    },
    {
      key: "status",
      header: "Status",
      cell: (order) => <OrderStatusPill status={order.status} />,
      sortValue: (order) => order.status,
    },
    {
      key: "total",
      header: "Total",
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
    { value: "needs-action", label: "Needs action" },
    { value: "all", label: "All" },
    { value: "paid", label: ORDER_LABELS.paid },
    { value: "processing", label: ORDER_LABELS.processing },
    { value: "shipped", label: ORDER_LABELS.shipped },
    { value: "delivered", label: ORDER_LABELS.delivered },
    { value: "refunded", label: ORDER_LABELS.refunded },
    { value: "cancelled", label: ORDER_LABELS.cancelled },
  ];

  return (
    <>
      <AdminPageHeader
        title="Orders"
        description="Every order, with the queue that still needs a person first."
        actions={
          <ExportMenu
            rows={rows}
            columns={[
              { header: "Reference", value: (o) => o.reference, width: 14 },
              { header: "Placed", value: (o) => new Date(o.createdAt), format: "date", width: 18 },
              { header: "Customer", value: (o) => o.shippingAddress.fullName, width: 24 },
              { header: "Email", value: (o) => o.email, width: 28 },
              { header: "City", value: (o) => o.shippingAddress.city },
              { header: "Status", value: (o) => ORDER_LABELS[o.status] },
              { header: "Payment", value: (o) => o.paymentMethod },
              { header: "Items", value: (o) => o.items.reduce((s, i) => s + i.quantity, 0), format: "number" },
              { header: "Subtotal", value: (o) => o.totals.subtotal, format: "currency" },
              { header: "Shipping", value: (o) => o.totals.shipping, format: "currency" },
              { header: "Tax", value: (o) => o.totals.tax, format: "currency" },
              { header: "Total", value: (o) => o.totals.total, format: "currency" },
              { header: "Tracking", value: (o) => o.trackingNumber ?? "" },
            ]}
            filename="net-sale-orders"
            title="net sale — orders"
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} counts={counts} />

        <label className="relative">
          <span className="sr-only">Search orders</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Reference, customer, tracking…"
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
              ? "Nothing waiting — every paid order has been dealt with."
              : "No orders in this state."
        }
      />

      <p className="text-mist mt-3 text-[0.75rem] tabular-nums">
        Showing {rows.length} of {orders.length} orders
      </p>
    </>
  );
}
