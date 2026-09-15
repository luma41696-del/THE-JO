"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { formatDate, formatPrice } from "@/lib/format";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { DataTable, Panel, StatTile, type Column } from "./AdminUI";
import { ExportMenu } from "./ExportMenu";
import type { CustomerSummary } from "@/lib/admin/data";

/**
 * Customer accounts.
 *
 * Ranked by lifetime value, because that is the question this screen is opened
 * to answer. The derived cohort split at the top — one-time against returning —
 * is the single most useful number a small store can look at: it says whether
 * the business is buying growth or earning it.
 */
export function CustomersBoard({
  customers,
  now,
}: {
  customers: CustomerSummary[];
  now: number;
}) {
  const { t } = useAdminLocale();
  const [search, setSearch] = useState("");

  const stats = useMemo(() => {
    const returning = customers.filter((c) => c.orders > 1);
    const revenue = customers.reduce((sum, c) => sum + c.revenue, 0);
    const returningRevenue = returning.reduce((sum, c) => sum + c.revenue, 0);

    return {
      total: customers.length,
      returning: returning.length,
      repeatRate: customers.length ? returning.length / customers.length : 0,
      lifetimeAverage: customers.length ? revenue / customers.length : 0,
      // The figure that justifies a loyalty programme, or kills the idea.
      returningShare: revenue ? returningRevenue / revenue : 0,
    };
  }, [customers]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((c) =>
      [c.name, c.email, c.city].join(" ").toLowerCase().includes(needle),
    );
  }, [customers, search]);

  const columns: Column<CustomerSummary>[] = [
    {
      key: "name",
      header: t("col.customer"),
      cell: (c) => (
        <span>
          <span className="text-ink block font-medium">{c.name}</span>
          <span className="text-mist block text-[0.6875rem]">{c.email}</span>
        </span>
      ),
      sortValue: (c) => c.name,
    },
    {
      key: "city",
      header: t("col.city"),
      cell: (c) => <span className="text-ink-muted">{c.city}</span>,
      sortValue: (c) => c.city,
    },
    {
      key: "orders",
      header: t("col.orders"),
      align: "end",
      cell: (c) => (
        <span className="tabular-nums">
          <span className="text-ink font-medium">{c.orders}</span>
          {c.orders > 1 && (
            <span className="bg-brand-mist text-brand-deep rounded-xs ms-2 px-1.5 py-0.5 text-[0.625rem]">
              {t("customers.repeat")}
            </span>
          )}
        </span>
      ),
      sortValue: (c) => c.orders,
    },
    {
      key: "revenue",
      header: t("customers.lifetimeValue"),
      align: "end",
      cell: (c) => (
        <span className="text-ink font-medium tabular-nums">{formatPrice(c.revenue, "JOD")}</span>
      ),
      sortValue: (c) => c.revenue,
    },
    {
      key: "last",
      header: t("customers.lastOrder"),
      align: "end",
      cell: (c) => {
        const days = Math.round((now - c.lastOrderAt) / 86_400_000);
        return (
          <span className="text-end">
            <span className="text-ink-muted block text-[0.75rem]">{formatDate(c.lastOrderAt)}</span>
            <span
              className={cn(
                "block text-[0.6875rem] tabular-nums",
                days > 90 ? "text-alert" : "text-mist",
              )}
            >
              {days}
              {t("customers.daysAgo")}
            </span>
          </span>
        );
      },
      sortValue: (c) => c.lastOrderAt,
    },
  ];

  return (
    <>
      <AdminPageHeader
        title={t("customers.title")}
        description={t("customers.subtitle")}
        actions={
          <ExportMenu
            rows={rows}
            columns={[
              { header: t("customers.name"), value: (c) => c.name, width: 24 },
              { header: t("col.email"), value: (c) => c.email, width: 30 },
              { header: t("col.city"), value: (c) => c.city },
              { header: t("col.orders"), value: (c) => c.orders, format: "number" },
              { header: t("customers.lifetimeValue"), value: (c) => c.revenue, format: "currency" },
              { header: t("customers.firstOrder"), value: (c) => new Date(c.firstOrderAt), format: "date", width: 18 },
              { header: t("customers.lastOrder"), value: (c) => new Date(c.lastOrderAt), format: "date", width: 18 },
            ]}
            filename="net-sale-customers"
            title={t("customers.export")}
          />
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t("customers.title")} value={stats.total.toLocaleString("en-GB")} />
        <StatTile
          label={t("customers.repeatRate")}
          value={`${Math.round(stats.repeatRate * 100)}%`}
          changeLabel={`${stats.returning} ${t("customers.returning")}`}
        />
        <StatTile
          label={t("customers.revenueFromRepeats")}
          value={`${Math.round(stats.returningShare * 100)}%`}
          emphasis
        />
        <StatTile label={t("customers.averageLifetime")} value={formatPrice(stats.lifetimeAverage, "JOD")} />
      </div>

      <Panel padded={false}>
        <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
          <p className="text-mist text-[0.75rem] tabular-nums">
            {rows.length} of {customers.length}
          </p>
          <label className="relative">
            <span className="sr-only">{t("customers.searchLabel")}</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("customers.searchPlaceholder")}
              className="border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-56 rounded-pill border px-4 py-1.5 text-[0.8125rem] outline-none transition-colors"
            />
          </label>
        </div>
        <div className="p-5">
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(c) => c.uid}
            initialSort={{ key: "revenue", dir: "desc" }}
            empty={search ? t("common.noMatch") : t("customers.empty")}
          />
        </div>
      </Panel>
    </>
  );
}
