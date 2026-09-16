"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { printToPdf } from "@/lib/admin/export";
import { PAPERS, buildReceipt, code128, type PaperWidth } from "@/lib/receipt";
import { Link } from "@/components/ui/Link";
import { Button } from "@/components/ui/Button";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import type { Locale, Order } from "@/types";
import type { StoreSettings } from "@/data/site-content";

/**
 * The counter receipt.
 *
 * Printed on a thermal roll, which is a different medium from the A4 invoice
 * next door and not a smaller version of it. The invoice is a tax document
 * somebody files; this is a strip of paper handed across a counter, read once,
 * and often scanned. So it carries the reference as bars, the units as a count
 * the packer can tick against, and nothing else that does not earn its
 * millimetres.
 *
 * Printing goes through the browser for the same reason the invoice does:
 * Arabic needs bidirectional reordering and contextual shaping, and the
 * browser's text engine is the only one here that does both. A raw ESC/POS
 * byte stream would be faster to the printer and would print Arabic as
 * disconnected letters in the wrong order — which is the whole customer base.
 *
 * The driver does the rest. Any thermal printer with a system driver — Epson,
 * Xprinter, Star, Rongta — appears as a normal printer, and `@page size` in
 * millimetres with an `auto` height is what tells it to cut at the end of the
 * content rather than at the end of an imaginary page.
 */
export function OrderReceipt({
  order,
  settings,
}: {
  order: Order;
  settings: StoreSettings;
}) {
  const { t } = useAdminLocale();

  /*
   * The customer's own language, as the invoice does. A receipt is handed to
   * the person who ordered, and the shop is bilingual — an Arabic customer
   * should not be given an English receipt because the operator's admin is in
   * English.
   */
  const [locale, setLocale] = useState<Locale>(order.locale ?? "ar");
  const [width, setWidth] = useState<PaperWidth>("80mm");

  const paper = PAPERS[width];

  /*
   * The page has to be measured, because CSS cannot express a roll.
   *
   * `@page { size: 80mm auto }` is the obvious thing to write and it is
   * **invalid**: `size` takes `auto`, one length, two lengths, or a named page
   * size — a length paired with `auto` is not in the grammar, so the whole
   * declaration is dropped and the receipt prints on whatever the driver's
   * default page is. That is how an 80mm receipt comes out centred on A4.
   *
   * So the height is taken from the rendered strip and written into the rule.
   * The page is then exactly as long as the receipt, and the printer feeds and
   * cuts at the end of the content instead of at the end of an imaginary page.
   */
  const strip = useRef<HTMLDivElement>(null);
  const [pageHeight, setPageHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = strip.current;
    if (!node) return;

    const measure = () => {
      // px at 96dpi to mm, plus a few millimetres so the last line is not
      // flush against the cut.
      const mm = (node.scrollHeight / 96) * 25.4 + 4;
      setPageHeight(Math.max(40, Math.ceil(mm)));
    };

    measure();

    // Fonts land after first paint and change the height; a receipt measured
    // before they do is cut through its own footer.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [paper.id, locale, order.id]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.fonts?.ready.then(() => {
      const node = strip.current;
      if (!node) return;
      setPageHeight(Math.max(40, Math.ceil((node.scrollHeight / 96) * 25.4 + 4)));
    });
  }, [paper.id, locale]);
  const receipt = buildReceipt(order, locale, paper);
  const bars = code128(receipt.reference);
  const rtl = locale === "ar";

  const L = {
    receipt: rtl ? "إيصال" : "Receipt",
    order: rtl ? "طلب" : "Order",
    items: rtl ? "الأصناف" : "Items",
    units: rtl ? "قطعة" : "units",
    payment: rtl ? "الدفع" : "Payment",
    delivery: rtl ? "التوصيل" : "Delivery",
    customer: rtl ? "الزبون" : "Customer",
    thanks: rtl ? "شكراً لتسوّقك معنا" : "Thank you for shopping with us",
    returns: rtl
      ? `الإرجاع خلال ${settings.returnWindowDays} يوماً مع هذا الإيصال`
      : `Returns within ${settings.returnWindowDays} days with this receipt`,
  };

  return (
    <>
      <div className="print:hidden">
        <AdminPageHeader
          title={`${L.receipt} · ${order.reference}`}
          description={
            rtl
              ? "للطباعة على طابعة حرارية. اختر الطابعة وورقها في نافذة الطباعة."
              : "For a thermal printer. Pick the printer and its paper in the print dialog."
          }
          actions={
            <>
              <Link href={`/admin/orders/${order.reference}`}>
                <Button variant="ghost" size="sm">
                  ← {t("order.backToOrder")}
                </Button>
              </Link>
              <Button variant="secondary" size="sm" onClick={printToPdf}>
                {rtl ? "اطبع" : "Print"}
              </Button>
            </>
          }
        />

        {/* ---- the two choices that change the paper ---------------------- */}
        <div className="border-line bg-paper-raised mb-5 flex flex-wrap items-center gap-5 rounded-lg border p-4">
          <Choice
            label={rtl ? "عرض الورق" : "Paper width"}
            value={width}
            options={Object.values(PAPERS).map((p) => ({ id: p.id, label: p.label }))}
            onChange={(next) => setWidth(next as PaperWidth)}
          />
          <Choice
            label={rtl ? "اللغة" : "Language"}
            value={locale}
            options={[
              { id: "ar", label: "العربية" },
              { id: "en", label: "English" },
            ]}
            onChange={(next) => setLocale(next as Locale)}
          />
          <p className="text-mist text-[0.75rem]">
            {rtl
              ? "اضبط الهوامش على «بلا» وألغِ الترويسة والتذييل في نافذة الطباعة."
              : "Set margins to None and turn off headers and footers in the print dialog."}
          </p>
        </div>
      </div>

      {/*
        The roll.

        `--receipt-width` drives both the on-screen preview and the `@page`
        size, so what the operator sees is the width that prints. Screen shows
        it on a card; print strips everything but the strip itself.
      */}
      <div
        ref={strip}
        className="ns-receipt"
        style={{ "--receipt-width": paper.printable } as React.CSSProperties}
        dir={rtl ? "rtl" : "ltr"}
        lang={locale}
      >
        {/* Two lengths, never a length and `auto` — see the measurement above.
            Until the first measure lands, a tall page is safer than a short
            one: too long feeds spare paper, too short truncates the total. */}
        <style>{`@page { size: ${paper.width} ${pageHeight ?? 297}mm; margin: 0; }`}</style>

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
          <Fact label={rtl ? "التاريخ" : "Date"} value={formatDate(receipt.placedAt, locale)} />
          {receipt.customer.name && <Fact label={L.customer} value={receipt.customer.name} />}
          {receipt.customer.phone && (
            <Fact label={rtl ? "هاتف" : "Phone"} value={receipt.customer.phone} ltr />
          )}
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
              {/* Quantity × unit price, so a customer can check the arithmetic
                  of a line they are querying without the till. */}
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
            <div key={line.label} className={cn("ns-receipt-row", line.emphasis && "is-total")}>
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

          This is what makes it a counter receipt rather than a narrow invoice:
          a returning customer hands it over and the scanner finds the order,
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
    </>
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
function Ltr({ children }: { children: React.ReactNode }) {
  return (
    <bdi dir="ltr" className="ns-receipt-ltr">
      {children}
    </bdi>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <span className="text-mist mb-1.5 block text-[0.625rem] tracking-[0.1em] uppercase">
        {label}
      </span>
      <div className="flex gap-1.5" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            className={cn(
              "rounded-pill cursor-pointer border px-3 py-1.5 text-[0.75rem] transition-colors",
              value === option.id
                ? "border-ink bg-ink text-white"
                : "border-line text-ink-muted hover:border-ink/45",
            )}
            data-cursor="hover"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
