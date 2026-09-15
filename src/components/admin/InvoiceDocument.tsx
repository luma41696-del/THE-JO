"use client";

import { useState } from "react";

import { Link } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { formatDate, formatPrice, t as pick } from "@/lib/format";
import { taxLabel } from "@/lib/pricing";
import { useAdminLocale } from "./AdminLocale";
import { printToPdf } from "@/lib/admin/export";
import { NetSaleMark } from "@/components/brand/NetSaleMark";
import { Button } from "@/components/ui/Button";
import { AdminPageHeader } from "./AdminShell";
import type { StoreSettings } from "@/data/site-content";
import type { Invoice, Locale } from "@/types";

/**
 * Invoice document.
 *
 * The PDF is produced by **printing this page**, not by a JS PDF library, and
 * that is a deliberate engineering decision rather than a shortcut.
 *
 * Arabic needs bidirectional reordering and contextual glyph shaping — the same
 * letter takes a different form at the start, middle and end of a word.
 * `jsPDF`, `pdfmake` and the rest do neither: they lay out glyphs
 * left-to-right in isolated forms, so an Arabic invoice comes out reversed and
 * disconnected. Technically a PDF; unusable as a document.
 *
 * The browser already contains a correct text engine. Printing through it gives
 * perfect Arabic shaping, real font embedding, selectable text, and accurate
 * page breaks — for zero dependencies. The `@media print` rules below strip the
 * admin chrome so what prints is the document alone.
 *
 * The customer's own language is the default, because the invoice is for them.
 */
export function InvoiceDocument({
  invoice,
  settings,
}: {
  invoice: Invoice;
  /**
   * The shop's own details, from store settings.
   *
   * These were hard-coded — and had already drifted: the invoice said
   * `hello@netsale.jo` while every other page said `hello@netsale.shop`. A
   * wrong address on a tax document is the worst place for that particular
   * class of bug, because it is the copy a customer keeps.
   */
  settings: StoreSettings;
}) {
  const { t } = useAdminLocale();
  const [locale, setLocale] = useState<Locale>("en");
  const rtl = locale === "ar";

  const L = {
    invoice: rtl ? "فاتورة" : "Invoice",
    billedTo: rtl ? "فاتورة إلى" : "Billed to",
    from: rtl ? "من" : "From",
    issued: rtl ? "تاريخ الإصدار" : "Issued",
    order: rtl ? "رقم الطلب" : "Order",
    description: rtl ? "الوصف" : "Description",
    sku: rtl ? "الرمز" : "SKU",
    qty: rtl ? "الكمية" : "Qty",
    unit: rtl ? "سعر الوحدة" : "Unit price",
    amount: rtl ? "المبلغ" : "Amount",
    subtotal: rtl ? "المجموع الفرعي" : "Subtotal",
    discount: rtl ? "الخصم" : "Discount",
    shipping: rtl ? "التوصيل" : "Delivery",
    tax: taxLabel(locale),
    total: rtl ? "الإجمالي" : "Total",
    paidBy: rtl ? "طريقة الدفع" : "Paid by",
    thanks: rtl ? "شكراً لتسوّقك من نت سيل." : "Thank you for shopping with net sale.",
    terms: rtl
      ? "تم إصدار هذه الفاتورة إلكترونياً وهي صالحة دون توقيع."
      : "This invoice was issued electronically and is valid without a signature.",
    credited: rtl ? "فاتورة دائنة" : "Credited",
  };

  return (
    <>
      {/* Screen-only chrome */}
      <div className="print:hidden">
        <AdminPageHeader
          title={invoice.number}
          description={`${L.order} ${invoice.orderReference} · ${formatDate(invoice.issuedAt, locale)}`}
          actions={
            <>
              <Link href="/admin/invoices">
                <Button variant="ghost" size="sm">
                  ← Invoices
                </Button>
              </Link>
              <div className="border-line inline-flex overflow-hidden rounded-pill border">
                {(["en", "ar"] as Locale[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLocale(code)}
                    className={cn(
                      "cursor-pointer px-3.5 py-2 text-[0.75rem] transition-colors",
                      locale === code ? "bg-ink text-white" : "text-ink-muted hover:bg-paper-sunken",
                    )}
                    data-cursor="hover"
                  >
                    {code === "ar" ? "العربية" : "English"}
                  </button>
                ))}
              </div>
              <Button variant="brand" size="sm" onClick={printToPdf}>
                {t("inv.savePdf")}
              </Button>
            </>
          }
        />
        <p className="text-mist mb-4 max-w-2xl text-[0.75rem]">
          &ldquo;Save as PDF&rdquo; opens your browser&apos;s print dialogue — choose <em>Save as
          PDF</em> as the destination. This route is what gets printed, so Arabic keeps its correct
          shaping and the text stays selectable.
        </p>
      </div>

      {/* The document itself */}
      <article
        dir={rtl ? "rtl" : "ltr"}
        lang={rtl ? "ar" : "en"}
        className={cn(
          "bg-paper-raised border-line mx-auto max-w-3xl rounded-lg border p-10",
          "print:max-w-none print:rounded-none print:border-0 print:p-0",
          rtl && "font-arabic",
        )}
      >
        <header className="border-line flex items-start justify-between gap-8 border-b pb-8">
          <div>
            <NetSaleMark className="h-12 w-12" title={null} />
            <p className="font-display text-ink mt-3 text-[0.9375rem] font-semibold tracking-[0.14em] uppercase">
              net&nbsp;sale
            </p>
            <p className="text-smoke mt-2 text-[0.75rem] leading-relaxed">
              {settings.legal.tradingName}
              <br />
              {pick(settings.legal.country, locale)}
              <br />
              {settings.contact.email}
            </p>
          </div>

          <div className={cn(rtl ? "text-start" : "text-end")}>
            <p className="font-display text-ink text-2xl font-semibold">{L.invoice}</p>
            <p className="text-ink mt-1 font-mono text-[0.875rem]">{invoice.number}</p>
            {invoice.status === "credited" && (
              <p className="bg-sand text-ink-muted mt-2 inline-block rounded-xs px-2 py-1 text-[0.6875rem]">
                {L.credited}
              </p>
            )}
            <dl className="mt-4 space-y-1 text-[0.75rem]">
              <div className="flex justify-between gap-6">
                <dt className="text-mist">{L.issued}</dt>
                <dd className="text-ink tabular-nums">{formatDate(invoice.issuedAt, locale)}</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-mist">{L.order}</dt>
                <dd className="text-ink font-mono">{invoice.orderReference}</dd>
              </div>
            </dl>
          </div>
        </header>

        <section className="border-line grid gap-8 border-b py-8 sm:grid-cols-2">
          <div>
            <p className="text-mist mb-2 text-[0.625rem] font-medium tracking-[0.14em] uppercase">
              {L.billedTo}
            </p>
            <p className="text-ink text-[0.875rem] leading-relaxed">
              {invoice.billTo.name}
              <br />
              {invoice.billTo.line1}
              {invoice.billTo.line2 ? <>, {invoice.billTo.line2}</> : null}
              <br />
              {invoice.billTo.city}, {invoice.billTo.countryCode}
              <br />
              <span className="text-smoke">{invoice.billTo.email}</span>
              {invoice.billTo.phone && (
                <>
                  <br />
                  <span className="text-smoke tabular-nums">{invoice.billTo.phone}</span>
                </>
              )}
            </p>
          </div>

          <div className={cn(rtl ? "sm:text-start" : "sm:text-end")}>
            <p className="text-mist mb-2 text-[0.625rem] font-medium tracking-[0.14em] uppercase">
              {L.paidBy}
            </p>
            <p className="text-ink text-[0.875rem] capitalize">
              {invoice.paymentMethod.replace("-", " ")}
            </p>
          </div>
        </section>

        <table className="mt-8 w-full text-[0.8125rem]">
          <thead>
            <tr className="border-line border-b">
              <th
                className={cn(
                  "text-mist pb-2 text-[0.625rem] font-medium tracking-[0.12em] uppercase",
                  rtl ? "text-end" : "text-start",
                )}
              >
                {L.description}
              </th>
              <th className="text-mist pb-2 text-center text-[0.625rem] font-medium tracking-[0.12em] uppercase">
                {L.qty}
              </th>
              <th
                className={cn(
                  "text-mist pb-2 text-[0.625rem] font-medium tracking-[0.12em] uppercase",
                  rtl ? "text-start" : "text-end",
                )}
              >
                {L.unit}
              </th>
              <th
                className={cn(
                  "text-mist pb-2 text-[0.625rem] font-medium tracking-[0.12em] uppercase",
                  rtl ? "text-start" : "text-end",
                )}
              >
                {L.amount}
              </th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {invoice.lines.map((line) => (
              <tr key={line.sku}>
                <td className={cn("py-3", rtl ? "text-end" : "text-start")}>
                  <span className="text-ink block">{pick(line.description, locale)}</span>
                  <span className="text-mist block font-mono text-[0.6875rem]">{line.sku}</span>
                </td>
                <td className="py-3 text-center tabular-nums">{line.quantity}</td>
                <td className={cn("py-3 tabular-nums", rtl ? "text-start" : "text-end")}>
                  {formatPrice(line.unitPrice, invoice.currency, locale)}
                </td>
                <td
                  className={cn(
                    "text-ink py-3 font-medium tabular-nums",
                    rtl ? "text-start" : "text-end",
                  )}
                >
                  {formatPrice(line.total, invoice.currency, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={cn("mt-6 flex", rtl ? "justify-start" : "justify-end")}>
          <dl className="w-64 space-y-2 text-[0.8125rem]">
            <Row label={L.subtotal} value={formatPrice(invoice.subtotal, invoice.currency, locale)} />
            {invoice.discount > 0 && (
              <Row
                label={L.discount}
                value={`−${formatPrice(invoice.discount, invoice.currency, locale)}`}
              />
            )}
            <Row
              label={L.shipping}
              value={formatPrice(invoice.shipping, invoice.currency, locale)}
            />
            <Row label={L.tax} value={formatPrice(invoice.tax, invoice.currency, locale)} />
            <div className="border-line flex items-baseline justify-between border-t pt-3">
              <dt className="font-display text-ink font-semibold">{L.total}</dt>
              <dd className="font-display text-ink text-lg font-semibold tabular-nums">
                {formatPrice(invoice.total, invoice.currency, locale)}
              </dd>
            </div>
          </dl>
        </div>

        <footer className="border-line text-mist mt-10 border-t pt-6 text-[0.6875rem] leading-relaxed">
          <p className="text-ink-muted">{L.thanks}</p>
          <p className="mt-1">{L.terms}</p>
        </footer>
      </article>

      {/* Print rules live in `globals.css` under `@media print` — A4 margins,
          admin chrome hidden, and colour adjustment forced so the brand mark
          is not dropped by the browser's ink-saving default. */}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-smoke">{label}</dt>
      <dd className="text-ink tabular-nums">{value}</dd>
    </div>
  );
}
