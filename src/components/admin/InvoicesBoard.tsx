"use client";

import { useMemo, useState } from "react";

import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { formatDate, formatPrice } from "@/lib/format";
import { AdminPageHeader } from "./AdminShell";
import { DataTable, InvoiceStatusPill, StatTile, type Column } from "./AdminUI";
import { ExportMenu } from "./ExportMenu";
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
      header: "Invoice",
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
      header: "Order",
      cell: (invoice) => (
        <Link href={`/admin/orders/${invoice.orderReference}`} className="text-brand">
          {invoice.orderReference}
        </Link>
      ),
      sortValue: (invoice) => invoice.orderReference,
    },
    {
      key: "customer",
      header: "Billed to",
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
      header: "Issued",
      cell: (invoice) => <span className="text-smoke">{formatDate(invoice.issuedAt)}</span>,
      sortValue: (invoice) => invoice.issuedAt,
    },
    {
      key: "status",
      header: "Status",
      cell: (invoice) => <InvoiceStatusPill status={invoice.status} />,
      sortValue: (invoice) => invoice.status,
    },
    {
      key: "tax",
      header: "Tax",
      align: "end",
      cell: (invoice) => (
        <span className="text-smoke tabular-nums">{formatPrice(invoice.tax, invoice.currency)}</span>
      ),
      sortValue: (invoice) => invoice.tax,
    },
    {
      key: "total",
      header: "Total",
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
        title="Invoices"
        description="Sequential and gapless. A credited invoice is reversed, never removed."
        actions={
          <ExportMenu
            rows={rows}
            columns={[
              { header: "Invoice", value: (i) => i.number, width: 18 },
              { header: "Order", value: (i) => i.orderReference, width: 14 },
              { header: "Issued", value: (i) => new Date(i.issuedAt), format: "date", width: 18 },
              { header: "Status", value: (i) => i.status },
              { header: "Customer", value: (i) => i.billTo.name, width: 24 },
              { header: "Email", value: (i) => i.billTo.email, width: 28 },
              { header: "City", value: (i) => i.billTo.city },
              { header: "Subtotal", value: (i) => i.subtotal, format: "currency" },
              { header: "Discount", value: (i) => i.discount, format: "currency" },
              { header: "Shipping", value: (i) => i.shipping, format: "currency" },
              { header: "Tax (16%)", value: (i) => i.tax, format: "currency" },
              { header: "Total", value: (i) => i.total, format: "currency" },
              { header: "Payment", value: (i) => i.paymentMethod },
            ]}
            filename="net-sale-invoices"
            title="net sale — invoice ledger"
          />
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Invoices" value={stats.count.toLocaleString("en-GB")} />
        <StatTile label="Net billed" value={formatPrice(stats.net, "JOD")} emphasis />
        <StatTile label="Tax collected" value={formatPrice(stats.tax, "JOD")} />
        <StatTile label="Credited" value={formatPrice(stats.credited, "JOD")} />
      </div>

      <div className="mb-4 flex justify-end">
        <label className="relative">
          <span className="sr-only">Search invoices</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Invoice number, order, customer…"
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
        empty={search ? `Nothing matches "${search}".` : "No invoices yet."}
      />
    </>
  );
}
