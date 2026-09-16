"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { printToPdf } from "@/lib/admin/export";
import { PAPERS, type PaperWidth } from "@/lib/receipt";
import { Link } from "@/components/ui/Link";
import { Button } from "@/components/ui/Button";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { ReceiptStrip } from "./ReceiptStrip";
import type { Locale, Order } from "@/types";
import type { StoreSettings } from "@/data/site-content";

/**
 * The counter receipt for one order.
 *
 * Printed on a thermal roll, which is a different medium from the A4 invoice
 * next door and not a smaller version of it. The invoice is a tax document
 * somebody files; this is a strip of paper handed across a counter, read once,
 * and often scanned.
 *
 * Printing goes through the browser for the same reason the invoice does:
 * Arabic needs bidirectional reordering and contextual shaping, and the
 * browser's text engine is the only one here that does both. A raw ESC/POS
 * byte stream would be faster to the printer and would print Arabic as
 * disconnected letters in the wrong order — which is the whole customer base.
 *
 * Any thermal printer with a system driver — Epson, Xprinter, Star, Rongta —
 * appears as a normal printer, and the measured `@page` below is what tells it
 * to cut at the end of the content. The strip itself is `ReceiptStrip`, shared
 * with the batch that prints a whole day's orders.
 */
export function OrderReceipt({ order, settings }: { order: Order; settings: StoreSettings }) {
  const { t } = useAdminLocale();

  /*
   * The customer's own language. A receipt is handed to the person who
   * ordered, and the shop is bilingual — an Arabic customer should not be
   * given an English receipt because the operator's admin is in English.
   */
  const [locale, setLocale] = useState<Locale>(order.locale ?? "ar");
  const [width, setWidth] = useState<PaperWidth>("80mm");

  const paper = PAPERS[width];
  const rtl = locale === "ar";

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
      setPageHeight(Math.max(40, Math.ceil((node.scrollHeight / 96) * 25.4 + 4)));
    };

    measure();

    // Fonts land after first paint and change the height; a receipt measured
    // before they do is cut through its own footer.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [paper.id, locale, order.id]);

  useEffect(() => {
    document.fonts?.ready.then(() => {
      const node = strip.current;
      if (!node) return;
      setPageHeight(Math.max(40, Math.ceil((node.scrollHeight / 96) * 25.4 + 4)));
    });
  }, [paper.id, locale]);

  return (
    <>
      <div className="print:hidden">
        <AdminPageHeader
          title={`${rtl ? "إيصال" : "Receipt"} · ${order.reference}`}
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

      {/* Two lengths, never a length and `auto` — see the measurement above.
          Until the first measure lands, a tall page is safer than a short one:
          too long feeds spare paper, too short truncates the total. */}
      <style>{`@page { size: ${paper.width} ${pageHeight ?? 297}mm; margin: 0; }`}</style>

      <ReceiptStrip
        order={order}
        settings={settings}
        locale={locale}
        paper={paper}
        innerRef={strip}
      />
    </>
  );
}

/** A small segmented control, shared with the batch print screen. */
export function Choice({
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
