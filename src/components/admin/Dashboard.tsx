"use client";

import { useMemo, useState } from "react";
import Image from "next/image";

import { Link } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { formatDate, formatPrice, t as pick } from "@/lib/format";
import {
  RANGES,
  actionQueue,
  buildTimeseries,
  categoryBreakdown,
  computeKpis,
  statusCounts,
  topProducts,
  type RangeKey,
} from "@/lib/admin/analytics";
import { AdminPageHeader } from "./AdminShell";
import { DataTable, FilterChips, OrderStatusPill, Panel, StatTile, type Column } from "./AdminUI";
import { CompositionDonut, RankedBars, RevenueChart } from "./charts/Charts";
import { ExportMenu } from "./ExportMenu";
import type { Order, SupportTicket } from "@/types";

/**
 * Operations dashboard.
 *
 * Ordered by what someone opening this at 9am actually needs, in that order:
 *
 *  1. **Is the business up or down** — four KPIs, each against the equivalent
 *     preceding window so the number means something.
 *  2. **What do I have to do today** — the fulfilment queue and open tickets,
 *     with counts, above the fold.
 *  3. **What is selling** — the revenue curve, then the product and category
 *     breakdowns.
 *
 * Analysis sits below action. A dashboard that opens on a beautiful chart while
 * six orders sit unpacked is decoration.
 */
export function Dashboard({
  orders,
  tickets,
  now,
}: {
  orders: Order[];
  tickets: SupportTicket[];
  now: number;
}) {
  const [range, setRange] = useState<RangeKey>("30d");

  const kpis = useMemo(() => computeKpis(orders, range, now), [orders, range, now]);
  const series = useMemo(() => buildTimeseries(orders, range, now), [orders, range, now]);
  const products = useMemo(() => topProducts(orders, range, now, 6), [orders, range, now]);
  const categories = useMemo(() => categoryBreakdown(orders, range, now), [orders, range, now]);
  const counts = useMemo(() => statusCounts(orders), [orders]);
  const queue = useMemo(() => actionQueue(orders, 6), [orders]);

  const openTickets = tickets.filter((t) => t.status === "open" || t.status === "pending");
  const currency = kpis.currency;
  const rangeLabel = `vs previous ${RANGES[range].days} days`;

  // Sparklines follow the same buckets as the main chart, so a tile and the
  // curve below it can never tell different stories.
  const revenueSpark = series.map((p) => p.revenue);
  const ordersSpark = series.map((p) => p.orders);

  const queueColumns: Column<Order>[] = [
    {
      key: "reference",
      header: "Order",
      cell: (order) => (
        <Link href={`/admin/orders/${order.reference}`} className="text-ink font-medium">
          {order.reference}
        </Link>
      ),
      sortValue: (order) => order.reference,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (order) => <span className="text-ink-muted">{order.shippingAddress.fullName}</span>,
      sortValue: (order) => order.shippingAddress.fullName,
    },
    {
      key: "placed",
      header: "Placed",
      cell: (order) => <span className="text-smoke">{formatDate(order.createdAt)}</span>,
      sortValue: (order) => order.createdAt,
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

  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="Trading performance and today's queue."
        actions={
          <>
            <FilterChips
              options={(Object.keys(RANGES) as RangeKey[]).map((key) => ({
                value: key,
                label: RANGES[key].label.replace("Last ", ""),
              }))}
              value={range}
              onChange={setRange}
            />
            <ExportMenu
              rows={series}
              columns={[
                { header: "Date", value: (p) => new Date(p.t), format: "date", width: 18 },
                { header: "Revenue", value: (p) => p.revenue, format: "currency" },
                { header: "Orders", value: (p) => p.orders, format: "number" },
                { header: "Units", value: (p) => p.units, format: "number" },
              ]}
              filename="the-jo-sales"
              title={`THE JO — sales, ${RANGES[range].label.toLowerCase()}`}
              currency={currency}
            />
          </>
        }
      />

      {/* 1. Where the business is */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Revenue"
          value={formatPrice(kpis.revenue, currency)}
          change={kpis.revenueChange}
          changeLabel={rangeLabel}
          spark={revenueSpark}
          emphasis
        />
        <StatTile
          label="Orders"
          value={kpis.orders.toLocaleString("en-GB")}
          change={kpis.ordersChange}
          changeLabel={rangeLabel}
          spark={ordersSpark}
        />
        <StatTile
          label="Average order"
          value={formatPrice(kpis.averageOrderValue, currency)}
          change={kpis.aovChange}
          changeLabel={rangeLabel}
        />
        <StatTile label="Units sold" value={kpis.units.toLocaleString("en-GB")} />
      </div>

      {/* 2. What needs doing */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel
          title="Needs fulfilment"
          description="Oldest first — these are paid and waiting."
          actions={
            <Link
              href="/admin/orders?status=paid"
              className="text-smoke hover:text-ink text-[0.75rem] transition-colors"
            >
              All orders →
            </Link>
          }
          padded={false}
        >
          <div className="p-5 pt-0">
            <DataTable
              rows={queue}
              columns={queueColumns}
              rowKey={(order) => order.id}
              empty="Nothing waiting. Every paid order has been packed."
            />
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Fulfilment queue">
            <ul className="space-y-2.5">
              {(
                [
                  ["paid", "Paid, not started"],
                  ["processing", "Processing"],
                  ["packed", "Packed"],
                  ["shipped", "In transit"],
                ] as const
              ).map(([status, label]) => (
                <li key={status} className="flex items-center justify-between gap-3">
                  <span className="text-ink-muted text-[0.8125rem]">{label}</span>
                  <span
                    className={cn(
                      "font-display text-[0.9375rem] font-semibold tabular-nums",
                      counts[status] > 0 ? "text-ink" : "text-mist",
                    )}
                  >
                    {counts[status]}
                  </span>
                </li>
              ))}
              <li className="border-line flex items-center justify-between gap-3 border-t pt-2.5">
                <span className="text-smoke text-[0.8125rem]">Cancelled / refunded</span>
                <span className="text-smoke text-[0.9375rem] tabular-nums">
                  {counts.cancelled + counts.refunded}
                </span>
              </li>
            </ul>
          </Panel>

          <Panel
            title="Support"
            actions={
              <Link
                href="/admin/support"
                className="text-smoke hover:text-ink text-[0.75rem] transition-colors"
              >
                Open →
              </Link>
            }
          >
            <p className="font-display text-ink text-2xl font-semibold tabular-nums">
              {openTickets.length}
            </p>
            <p className="text-mist mt-1 text-[0.75rem]">
              {openTickets.length === 1 ? "ticket needs a reply" : "tickets need a reply"}
            </p>

            {openTickets[0] && (
              <Link
                href={`/admin/support/${openTickets[0].reference}`}
                className="border-line hover:border-ink/30 mt-4 block rounded-md border p-3 transition-colors"
              >
                <p className="text-ink truncate text-[0.8125rem] font-medium">
                  {openTickets[0].subject}
                </p>
                <p className="text-mist mt-0.5 truncate text-[0.75rem]">
                  {openTickets[0].customerName}
                </p>
              </Link>
            )}
          </Panel>
        </div>
      </div>

      {/* 3. What is selling */}
      <div className="mt-4">
        <Panel
          title="Revenue"
          description={`${RANGES[range].label} · ${RANGES[range].bucket === "day" ? "daily" : "weekly"} buckets`}
        >
          <RevenueChart
            points={series.map((p) => ({ t: p.t, value: p.revenue, secondary: p.orders }))}
            currency={currency}
          />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Best sellers"
          description="By units — revenue ranks them differently."
          actions={
            <ExportMenu
              rows={products}
              columns={[
                { header: "Product", value: (p) => pick(p.title, "en"), width: 32 },
                { header: "Units", value: (p) => p.units, format: "number" },
                { header: "Revenue", value: (p) => p.revenue, format: "currency" },
              ]}
              filename="the-jo-best-sellers"
              currency={currency}
              label="Export"
            />
          }
        >
          <ul className="space-y-3">
            {products.map((product, index) => (
              <li key={product.productId}>
                <Link
                  href={`/admin/products/${product.productId}`}
                  className="hover:bg-paper-sunken/60 -mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors"
                >
                  <span className="text-mist w-4 shrink-0 text-[0.75rem] tabular-nums">
                    {index + 1}
                  </span>
                  {product.image && (
                    <span className="bg-paper-sunken relative h-11 w-9 shrink-0 overflow-hidden rounded-sm">
                      <Image
                        src={product.image.url}
                        alt=""
                        fill
                        sizes="36px"
                        className="object-cover"
                      />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="text-ink block truncate text-[0.8125rem] font-medium">
                      {pick(product.title, "en")}
                    </span>
                    <span className="text-mist block text-[0.75rem] tabular-nums">
                      {product.units} units
                    </span>
                  </span>
                  <span className="text-ink shrink-0 text-[0.8125rem] font-medium tabular-nums">
                    {formatPrice(product.revenue, currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Revenue by category" description="Share of kept revenue in the window.">
          <CompositionDonut
            data={categories.map((c) => ({ label: c.categoryId, value: c.revenue }))}
            currency={currency}
          />
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Units by category" description="Volume, which does not track revenue.">
          <RankedBars
            data={categories.map((c) => ({
              label: c.categoryId,
              value: c.units,
              note: formatPrice(c.revenue, currency),
            }))}
            valueLabel="units"
            showValueAs="number"
          />
        </Panel>
      </div>
    </>
  );
}
