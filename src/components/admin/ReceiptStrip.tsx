"use client";

import { formatDate } from "@/lib/format";
import { buildReceipt, code128, type Paper } from "@/lib/receipt";
import type { Locale, Order } from "@/types";
import type { StoreSettings } from "@/data/site-content";

/**
 * One receipt, as it prints.
 *
 * Extracted so the single-order page and the batch that prints a whole day's
 * orders render the *same* strip. Two copies of this markup would drift within
 * a month, and the version the warehouse actually prints would be whichever
 * one nobody looked at.
 *
 * Deliberately owns no `@page` rule. Page size is a document-level property
 * and the two callers need different ones — a measured roll for a single
 * receipt, a fixed page for a batch — so whoever renders this decides.
 */
export function ReceiptStrip({
  order,
  settings,
  locale,
  paper,
  innerRef,
}: {
  order: Order;
  settings: StoreSettings;
  locale: Locale;
  paper: Paper;
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  const receipt = buildReceipt(order, locale, paper);
  const bars = code128(receipt.reference);
  const rtl = locale === "ar";

  const L = {
    order: rtl ? "طلب" : "Order",
    date: rtl ? "التاريخ" : "Date",
    customer: rtl ? "الزبون" : "Customer",
    phone: rtl ? "هاتف" : "Phone",
    items: rtl ? "الأصناف" : "Items",
    units: rtl ? "قطعة" : "units",
    payment: rtl ? "الدفع" : "Payment",
    delivery: rtl ? "التوصيل" : "Delivery",
    thanks: rtl ? "شكراً لتسوّقك معنا" : "Thank you for shopping with us",
    returns: rtl
      ? `الإرجاع خلال ${settings.returnWindowDays} يوماً مع هذا الإيصال`
      : `Returns within ${settings.returnWindowDays} days with this receipt`,
  };

  return (
    <div
      ref={innerRef}
      className="ns-receipt"
      style={{ "--receipt-width": paper.printable } as React.CSSProperties}
      dir={rtl ? "rtl" : "ltr"}
      lang={locale}
    >
      <header className="ns-receipt-head">
        <p className="ns-receipt-shop">{settings.legal.tradingName}</p>
        <p className="ns-receipt-meta">
          <Ltr>{settings.contact.phone}</Ltr>
        </p>
        <p className="ns-receipt-meta">
          <Ltr>{settings.contact.email}</Ltr>
        </p>
      </header>

      <Rule />

      <dl className="ns-receipt-facts">
        <Fact label={L.order} value={receipt.reference} ltr />
        <Fact label={L.date} value={formatDate(receipt.placedAt, locale)} />
        {receipt.customer.name && <Fact label={L.customer} value={receipt.customer.name} />}
        {receipt.customer.phone && <Fact label={L.phone} value={receipt.customer.phone} ltr />}
        <Fact label={L.delivery} value={receipt.delivery} />
        <Fact label={L.payment} value={receipt.payment} />
      </dl>

      <Rule />

      <ul className="ns-receipt-lines">
        {receipt.lines.map((line, index) => (
          <li key={`${line.sku}-${index}`}>
            <div className="ns-receipt-row">
              <span className="ns-receipt-name">{line.name}</span>
              <span className="ns-receipt-amount">{line.total}</span>
            </div>
            {line.options && <p className="ns-receipt-sub">{line.options}</p>}
            {/* Quantity × unit price, so a customer querying a line can check
                the arithmetic without the till. */}
            <p className="ns-receipt-sub">
              {line.quantity} × {line.unitPrice}
              <span className="ns-receipt-sku">
                {" · "}
                <Ltr>{line.sku}</Ltr>
              </span>
            </p>
          </li>
        ))}
      </ul>

      <Rule />

      <dl className="ns-receipt-totals">
        {receipt.totals.map((line) => (
          <div
            key={line.label}
            className={line.emphasis ? "ns-receipt-row is-total" : "ns-receipt-row"}
          >
            <dt>{line.label}</dt>
            <dd className="ns-receipt-amount">{line.value}</dd>
          </div>
        ))}
      </dl>

      <p className="ns-receipt-units">
        {L.items}: {receipt.lines.length} · {receipt.units} {L.units}
      </p>

      {/*
        The reference, as bars.

        What makes it a counter receipt rather than a narrow invoice: a
        returning customer hands it over and the scanner finds the order,
        instead of somebody typing NS-7K4M2X and getting a character wrong.
        The text under it is not decoration — it is what a smudged or failed
        scan falls back to.
      */}
      {bars && (
        <figure className="ns-receipt-barcode">
          <svg
            viewBox={`0 0 ${bars.modules} 40`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Barcode ${bars.text}`}
          >
            {(() => {
              const rects: React.ReactElement[] = [];
              let x = 0;
              bars.bars.forEach((moduleWidth, index) => {
                // Even indices are bars, odd are spaces — the encoding
                // alternates, starting with a bar.
                if (index % 2 === 0) {
                  rects.push(
                    <rect key={index} x={x} y={0} width={moduleWidth} height={40} fill="#000" />,
                  );
                }
                x += moduleWidth;
              });
              return rects;
            })()}
          </svg>
          <figcaption>{bars.text}</figcaption>
        </figure>
      )}

      <footer className="ns-receipt-foot">
        <p>{L.thanks}</p>
        <p>{L.returns}</p>
        <p>
          <Ltr>{settings.contact.email}</Ltr>
        </p>
      </footer>
    </div>
  );
}

function Rule() {
  // A dashed rule rather than a filled bar: a solid block on a thermal head is
  // a lot of heat for a line nobody reads.
  return <div className="ns-receipt-rule" aria-hidden="true" />;
}

function Fact({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="ns-receipt-row">
      <dt>{label}</dt>
      <dd>{ltr ? <Ltr>{value}</Ltr> : value}</dd>
    </div>
  );
}

/**
 * A value that is only ever left-to-right, isolated from the paragraph.
 *
 * On an Arabic receipt the phone `+962 7 9000 0000` renders as
 * `0000 9000 7 962+` without this — bidi keeps each digit run internally
 * left-to-right but lays the runs out right-to-left, so the number comes out
 * in pieces, reversed, with the plus on the wrong end. A courier cannot dial
 * it and nobody proofreads a printed phone number.
 *
 * `dir` alone is not enough: it has to be an *isolate*, or the surrounding
 * Arabic still reorders the run as a whole.
 */
export function Ltr({ children }: { children: React.ReactNode }) {
  return (
    <bdi dir="ltr" className="ns-receipt-ltr">
      {children}
    </bdi>
  );
}
