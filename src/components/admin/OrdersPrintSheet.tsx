"use client";

import { useEffect, useState } from "react";

import { printToPdf } from "@/lib/admin/export";
import { PAPERS, type Paper, type PaperWidth } from "@/lib/receipt";
import { Link } from "@/components/ui/Link";
import { Button } from "@/components/ui/Button";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { Choice } from "./OrderReceipt";
import { ReceiptStrip } from "./ReceiptStrip";
import type { Locale, Order } from "@/types";
import type { StoreSettings } from "@/data/site-content";

/**
 * Every order on the board, in one print job.
 *
 * The morning routine this exists for: filter the board to what needs picking,
 * press print once, and take the stack to the bench. Printing them one at a
 * time is the same number of receipts and twenty times the clicking.
 *
 * Each receipt gets its own page, and the page is sized so the printer cuts
 * between them. On a roll that is a fixed page per receipt rather than the
 * measured one a single receipt gets — a batch cannot have a different page
 * height per item, because `@page` is a property of the document, not of an
 * element. The fixed height is generous, so a long order is never cut through
 * its own total; the slack feeds as blank paper between receipts.
 */
export function OrdersPrintSheet({
  orders,
  settings,
  omitted,
  filterLabel,
}: {
  orders: Order[];
  settings: StoreSettings;
  /** Orders the cap left out, so the screen can say so rather than hide it. */
  omitted: number;
  filterLabel: string;
}) {
  const { t, rtl } = useAdminLocale();
  const [width, setWidth] = useState<PaperWidth | "a4">("80mm");
  const [locale, setLocale] = useState<Locale>("ar");
  const [ready, setReady] = useState(false);

  // Fonts change every strip's height; a batch printed before they land is a
  // stack of receipts cut through their footers.
  useEffect(() => {
    let live = true;
    const done = () => live && setReady(true);
    if (document.fonts?.ready) void document.fonts.ready.then(done);
    else done();
    return () => {
      live = false;
    };
  }, []);

  const paper: Paper = width === "a4" ? PAPERS["80mm"] : PAPERS[width];

  /*
   * One page per receipt.
   *
   * A roll gets a fixed tall page — 200mm holds a long order comfortably, and
   * the unused length feeds through as the gap the operator tears at. A4 gets
   * a real A4 page with each strip centred on it, which is what a shop without
   * a thermal printer wants.
   */
  const pageRule =
    width === "a4"
      ? "@page { size: A4; margin: 12mm; }"
      : `@page { size: ${paper.width} 200mm; margin: 0; }`;

  return (
    <>
      <div className="print:hidden">
        <AdminPageHeader
          title={rtl ? "طباعة الطلبات" : "Print orders"}
          description={
            rtl
              ? `${orders.length} طلباً · ${filterLabel}`
              : `${orders.length} orders · ${filterLabel}`
          }
          actions={
            <>
              <Link href="/admin/orders">
                <Button variant="ghost" size="sm">
                  ← {t("orders.title")}
                </Button>
              </Link>
              <Button
                variant="secondary"
                size="sm"
                disabled={orders.length === 0}
                onClick={printToPdf}
              >
                {rtl ? `اطبع ${orders.length}` : `Print ${orders.length}`}
              </Button>
            </>
          }
        />

        <div className="border-line bg-paper-raised mb-5 flex flex-wrap items-center gap-5 rounded-lg border p-4">
          <Choice
            label={rtl ? "الورق" : "Paper"}
            value={width}
            options={[
              ...Object.values(PAPERS).map((p) => ({ id: p.id, label: p.label })),
              { id: "a4", label: "A4" },
            ]}
            onChange={(next) => setWidth(next as PaperWidth | "a4")}
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
          <p className="text-mist max-w-sm text-[0.75rem]">
            {rtl
              ? "كل طلب على صفحة. اضبط الهوامش على «بلا» وألغِ الترويسة والتذييل."
              : "One order per page. Set margins to None and turn off headers and footers."}
          </p>
        </div>

        {/*
          Said out loud rather than quietly trimmed. An operator who filtered to
          412 orders and got 200 needs to know which 200 and why.
        */}
        {omitted > 0 && (
          <p role="status" className="text-alert mb-5 text-[0.8125rem]">
            {rtl
              ? `يُطبع أحدث ${orders.length} طلباً. ${omitted} طلباً أقدم خارج هذه الدفعة — ضيّق التصفية لطباعتها.`
              : `Printing the newest ${orders.length}. ${omitted} older orders are not in this batch — narrow the filter to reach them.`}
          </p>
        )}

        {orders.length === 0 && (
          <p className="text-mist text-[0.8125rem]">
            {rtl ? "لا طلبات في هذه التصفية." : "No orders match this filter."}
          </p>
        )}

        {!ready && orders.length > 0 && (
          <p role="status" className="text-mist mb-5 text-[0.8125rem]">
            {rtl ? "يُحضّر…" : "Preparing…"}
          </p>
        )}
      </div>

      <style>{pageRule}</style>

      <div className="ns-receipt-batch">
        {orders.map((order) => (
          <div key={order.id} className="ns-receipt-page">
            <ReceiptStrip order={order} settings={settings} locale={locale} paper={paper} />
          </div>
        ))}
      </div>
    </>
  );
}
