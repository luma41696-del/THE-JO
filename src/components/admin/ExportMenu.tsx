"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { exportToCsv, exportToExcel, printRoute, type ExportColumn } from "@/lib/admin/export";
import type { CurrencyCode } from "@/types";

/**
 * Export control.
 *
 * One button, three destinations, and the labels say what each is *for* rather
 * than only what it is — "Excel (.xlsx)" with "numbers stay numbers" beneath it
 * tells an operator which one to pick without having to try both.
 *
 * The busy state matters more than it looks: ExcelJS is a ~1MB dynamic import,
 * so the first export on a cold page has real latency, and a button that
 * appears to do nothing for a second gets clicked three more times.
 */
export function ExportMenu<T>({
  rows,
  columns,
  filename,
  title,
  currency = "JOD",
  printHref,
  label = "Export",
}: {
  rows: T[];
  columns: ExportColumn<T>[];
  filename: string;
  title?: string;
  currency?: CurrencyCode;
  /** Print-styled route for the PDF option. Omitted, the option is hidden. */
  printHref?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(kind: "xlsx" | "csv" | "pdf") {
    setBusy(kind);
    try {
      if (kind === "xlsx") {
        await exportToExcel({ rows, columns, filename, currency, title });
      } else if (kind === "csv") {
        exportToCsv({ rows, columns, filename });
      } else if (printHref) {
        printRoute(printHref);
      }
    } finally {
      setBusy(null);
      setOpen(false);
    }
  }

  const options = [
    {
      kind: "xlsx" as const,
      label: "Excel (.xlsx)",
      hint: "Formatted, numbers stay numbers",
      icon: <SheetIcon />,
    },
    {
      kind: "csv" as const,
      label: "CSV",
      hint: "Plain text, for other systems",
      icon: <CsvIcon />,
    },
    ...(printHref
      ? [
          {
            kind: "pdf" as const,
            label: "PDF",
            hint: "Print-ready, correct Arabic",
            icon: <PdfIcon />,
          },
        ]
      : []),
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={rows.length === 0}
        className={cn(
          "border-line bg-paper-raised text-ink inline-flex cursor-pointer items-center gap-2",
          "rounded-pill border px-4 py-2 text-[0.8125rem] transition-all duration-200",
          "hover:border-ink/35 hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-45",
        )}
        data-cursor="hover"
      >
        <DownloadIcon />
        {label}
        <span className="text-mist tabular-nums">{rows.length}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className="bg-paper-raised border-line shadow-float absolute end-0 z-40 mt-2 w-64 rounded-lg border p-1.5"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE.brand }}
          >
            {options.map((option) => (
              <button
                key={option.kind}
                type="button"
                role="menuitem"
                onClick={() => void run(option.kind)}
                disabled={busy !== null}
                className={cn(
                  "hover:bg-paper-sunken flex w-full cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 text-start transition-colors",
                  busy === option.kind && "bg-paper-sunken",
                )}
                data-cursor="hover"
              >
                <span className="text-mist mt-0.5 shrink-0">{option.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-ink block text-[0.8125rem] font-medium">
                    {option.label}
                  </span>
                  <span className="text-mist block text-[0.6875rem]">{option.hint}</span>
                </span>
                {busy === option.kind && (
                  <span className="border-brand mt-1 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-t-transparent" />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2v8m0 0 3-3m-3 3L5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 11.5v1a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SheetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 6.5h11M6.5 6.5v7" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function CsvIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2.5h5l3 3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 2.5V6h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.5 2h4l3.5 3.5V13a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8.5 2v3.5H12" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5.8 11.2c1.6-.5 3-2.4 3-3.6 0-.6-.8-.7-.9 0-.2 1.2 1.4 4 3.3 3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
