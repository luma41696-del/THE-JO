"use client";

import { useMemo, useState } from "react";

import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { formatDate, formatPrice } from "@/lib/format";
import { AdminPageHeader } from "./AdminShell";
import { DataTable, InvoiceStatusPill, StatTile, type Column } from "./AdminUI";
import { ExportMenu } from "./ExportMenu";
import { useAdminLocale } from "./AdminLocale";
import { taxLabel } from "@/lib/pricing";
import type { Invoice } from "@/types";

/**
 * Invoice ledger.
 *
 * The totals across the top are the accounting view, not the marketing one:
 * **net of credits**. A credited invoice still exists and still has a number —
 * it is never deleted, because a gap in an invoice sequence is a problem with a
 * tax authority — but its value is subtracted rather than counted.
 */
export function InvoicesBoard({ invoices }: { invoices: Invoice[] }) {
  const { t, locale } = useAdminLocale();
  const router = useLocalizedRouter();
  const [search, setSearch] = useState("");

  const stats = useMemo(() => {
    const paid = invoices.filter((i) => i.status === "paid");
    const credited = invoices.filter((i) => i.status === "credited");
    const gross = paid.reduce((sum, i) => sum + i.total, 0);
    const creditedTotal = credited.reduce((sum, i) => sum + i.total, 0);

    return {
      count: invoices.length,
      gross,
      credited: creditedTotal,
      net: gross - creditedTotal,
      tax: paid.reduce((sum, i) => sum + i.tax, 0),
    };
  }, [invoices]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return invoices;
    return invoices.filter((invoice) =>
      [invoice.number, invoice.orderReference, invoice.billTo.name, invoice.billTo.email]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [invoices, search]);

  const columns: Column<Invoice>[] = [
    {
      key: "number",
      header: t("invoices.invoice"),
      cell: (invoice) => (
        <Link
          href={`/admin/invoices/${invoice.orderReference}`}
          className="text-ink font-mono font-medium"
        >
          {invoice.number}
        </Link>
      ),
      sortValue: (invoice) => invoice.number,
    },
    {
      key: "order",
      header: t("col.order"),
      cell: (invoice) => (
        <Link href={`/admin/orders/${invoice.orderReference}`} className="text-brand">
          {invoice.orderReference}
        </Link>
      ),
      sortValue: (invoice) => invoice.orderReference,
    },
    {
      key: "customer",
      header: t("invoices.billedTo"),
      cell: (invoice) => (
        <span>
          <span className="text-ink block">{invoice.billTo.name}</span>
          <span className="text-mist block text-[0.6875rem]">{invoice.billTo.email}</span>
        </span>
      ),
      sortValue: (invoice) => invoice.billTo.name,
    },
    {
      key: "issued",
      header: t("invoices.issued"),
      cell: (invoice) => <span className="text-smoke">{formatDate(invoice.issuedAt)}</span>,
      sortValue: (invoice) => invoice.issuedAt,
    },
    {
      key: "status",
      header: t("col.status"),
      cell: (invoice) => <InvoiceStatusPill status={invoice.status} />,
      sortValue: (invoice) => invoice.status,
    },
    {
      key: "tax",
      header: t("col.tax"),
      align: "end",
      cell: (invoice) => (
        <span className="text-smoke tabular-nums">{formatPrice(invoice.tax, invoice.currency)}</span>
      ),
      sortValue: (invoice) => invoice.tax,
    },
    {
      key: "total",
      header: t("col.total"),
      align: "end",
      cell: (invoice) => (
        <span className="text-ink font-medium tabular-nums">
          {formatPrice(invoice.total, invoice.currency)}
        </span>
      ),
      sortValue: (invoice) => invoice.total,
    },
  ];

  return (
    <>
      <AdminPageHeader
        title={t("invoices.title")}
        description={t("invoices.subtitle")}
        actions={
          <ExportMenu
            rows={rows}
            columns={[
              { header: t("invoices.invoice"), value: (i) => i.number, width: 18 },
              { header: t("col.order"), value: (i) => i.orderReference, width: 14 },
              { header: t("invoices.issued"), value: (i) => new Date(i.issuedAt), format: "date", width: 18 },
              { header: t("col.status"), value: (i) => i.status },
              { header: t("col.customer"), value: (i) => i.billTo.name, width: 24 },
              { header: t("col.email"), value: (i) => i.billTo.email, width: 28 },
              { header: t("col.city"), value: (i) => i.billTo.city },
              { header: t("col.subtotal"), value: (i) => i.subtotal, format: "currency" },
              { header: t("order.discount"), value: (i) => i.discount, format: "currency" },
              { header: t("col.shipping"), value: (i) => i.shipping, format: "currency" },
              { header: taxLabel(locale), value: (i) => i.tax, format: "currency" },
              { header: t("col.total"), value: (i) => i.total, format: "currency" },
              { header: t("col.payment"), value: (i) => i.paymentMethod },
            ]}
            filename="net-sale-invoices"
            title={t("invoices.ledger")}
          />
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t("invoices.count")} value={stats.count.toLocaleString("en-GB")} />
        <StatTile label={t("invoices.netBilled")} value={formatPrice(stats.net, "JOD")} emphasis />
        <StatTile label={t("invoices.taxCollected")} value={formatPrice(stats.tax, "JOD")} />
        <StatTile label={t("invoices.credited")} value={formatPrice(stats.credited, "JOD")} />
      </div>

      <div className="mb-4 flex justify-end">
        <label className="relative">
          <span className="sr-only">{t("invoices.searchLabel")}</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("invoices.searchPlaceholder")}
            className="border-line focus:border-brand bg-paper-raised text-ink placeholder:text-mist w-72 rounded-pill border px-4 py-2 text-[0.8125rem] outline-none transition-colors"
          />
        </label>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(invoice) => invoice.id}
        onRowClick={(invoice) => router.push(`/admin/invoices/${invoice.orderReference}`)}
        initialSort={{ key: "issued", dir: "desc" }}
        empty={search ? t("common.noMatch") : t("invoices.empty")}
      />
    </>
  );
}
