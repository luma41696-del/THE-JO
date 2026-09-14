"use client";

import type { CurrencyCode } from "@/types";
import { minorUnits } from "@/lib/format";

/**
 * Exports.
 *
 * Two formats, chosen for two different jobs:
 *
 * **Excel (.xlsx)** — for anything that will be worked on: reconciliation,
 * accounting, a pivot table. Written with ExcelJS so numbers arrive as numbers
 * with a real currency format, not as text that the recipient has to re-type
 * before they can sum a column. CSV is offered alongside for systems that want
 * a dumb pipe.
 *
 * **PDF** — for anything that will be *sent*: an invoice, a statement. This is
 * produced by a print-styled route plus the browser's own print-to-PDF rather
 * than a JS PDF library, and that is a deliberate engineering decision, not a
 * shortcut. Arabic needs bidirectional reordering and contextual glyph shaping;
 * `jsPDF` and friends do neither, so an Arabic invoice comes out as isolated
 * letterforms in reverse — technically a PDF, and unusable. The browser already
 * has a correct text engine. Using it gives perfect Arabic, real font
 * embedding, and selectable text, for no dependency at all.
 *
 * ExcelJS is ~1MB, so it is dynamically imported at the moment of use and never
 * enters the page bundle.
 */

export interface ExportColumn<T> {
  header: string;
  /** Keep this primitive — a React node cannot go in a spreadsheet cell. */
  value: (row: T) => string | number | Date | null;
  width?: number;
  /** `currency` and `number` arrive as real numbers with a cell format. */
  format?: "text" | "number" | "currency" | "date";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in Safari; one frame is enough.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/*  Excel                                                                     */
/* -------------------------------------------------------------------------- */

export async function exportToExcel<T>({
  rows,
  columns,
  filename,
  sheetName = "Export",
  currency = "JOD",
  title,
}: {
  rows: T[];
  columns: ExportColumn<T>[];
  filename: string;
  sheetName?: string;
  currency?: CurrencyCode;
  title?: string;
}) {
  const ExcelJS = (await import("exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "net sale";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: title ? 3 : 1 }],
  });

  if (title) {
    const titleRow = sheet.addRow([title]);
    titleRow.font = { bold: true, size: 14, color: { argb: "FF1B1717" } };
    sheet.mergeCells(1, 1, 1, columns.length);
    sheet.addRow([`Generated ${new Date().toLocaleString("en-GB")}`]).font = {
      size: 9,
      color: { argb: "FF6F6765" },
    };
    sheet.mergeCells(2, 1, 2, columns.length);
    sheet.addRow([]);
  }

  const header = sheet.addRow(columns.map((c) => c.header));
  header.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCE1212" } };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF810000" } } };
  });
  header.height = 22;

  // JOD carries three decimals; a 2dp format would silently round every figure.
  const digits = minorUnits(currency);
  const currencyFormat = `#,##0.${"0".repeat(digits)} "${currency}"`;

  for (const row of rows) {
    const excelRow = sheet.addRow(columns.map((column) => column.value(row)));

    columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      if (column.format === "currency") {
        cell.numFmt = currencyFormat;
        cell.alignment = { horizontal: "right" };
      } else if (column.format === "number") {
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right" };
      } else if (column.format === "date") {
        cell.numFmt = "dd/mm/yyyy hh:mm";
      }
    });
  }

  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width =
      column.width ?? Math.max(12, Math.min(42, column.header.length + 8));
  });

  // An auto-filter is the first thing anyone reaches for in an export.
  const headerRowNumber = title ? 4 : 1;
  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber + rows.length, column: columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${filename}-${stamp()}.xlsx`,
  );
}

/* -------------------------------------------------------------------------- */
/*  CSV                                                                       */
/* -------------------------------------------------------------------------- */

function csvCell(value: string | number | Date | null) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportToCsv<T>({
  rows,
  columns,
  filename,
}: {
  rows: T[];
  columns: ExportColumn<T>[];
  filename: string;
}) {
  const lines = [
    columns.map((c) => csvCell(c.header)).join(","),
    ...rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(",")),
  ];

  // The BOM is what makes Excel open UTF-8 correctly on Windows — without it,
  // every Arabic name in the file arrives as mojibake.
  const blob = new Blob([`﻿${lines.join("\r\n")}`], {
    type: "text/csv;charset=utf-8;",
  });
  triggerDownload(blob, `${filename}-${stamp()}.csv`);
}

/* -------------------------------------------------------------------------- */
/*  PDF                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Print the current page to PDF.
 *
 * Used on the print-styled invoice and report routes. The caller is responsible
 * for having a `@media print` stylesheet that hides the chrome — otherwise the
 * operator gets a PDF of the sidebar.
 */
export function printToPdf() {
  window.print();
}

/**
 * Open a print-styled route in a hidden iframe and print it, so the operator
 * never loses the page they were on.
 */
export function printRoute(href: string) {
  const existing = document.getElementById("ns-print-frame");
  existing?.remove();

  const frame = document.createElement("iframe");
  frame.id = "ns-print-frame";
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.src = href;

  frame.onload = () => {
    // A frame that prints before its fonts and images resolve produces a page
    // with the fallback face and empty boxes.
    const win = frame.contentWindow;
    if (!win) return;
    const go = () => {
      win.focus();
      win.print();
    };
    if (win.document.readyState === "complete") setTimeout(go, 250);
    else win.addEventListener("load", () => setTimeout(go, 250));
  };

  document.body.appendChild(frame);
}
