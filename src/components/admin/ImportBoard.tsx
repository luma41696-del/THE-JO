"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getIdToken } from "@/lib/firebase/auth";
import { cn } from "@/lib/utils";
import { t as pick } from "@/lib/format";
import {
  IMPORT_FIELDS,
  TEMPLATE_HEADERS,
  autoMap,
  parseDelimited,
  parseRow,
  planImport,
  type ExistingProduct,
  type ImportFieldId,
  type ImportPlan,
  type ParsedRow,
  type PlannedRow,
} from "@/lib/import";
import { AdminPageHeader } from "./AdminShell";
import { useAdminLocale } from "./AdminLocale";
import { Panel } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import { Link } from "@/components/ui/Link";
import type { Product } from "@/types";

/**
 * The import screen.
 *
 * Three steps, and the order is the whole point: read the file, confirm what
 * each column means, then look at what will happen — and only then write. An
 * importer that goes straight from "choose file" to "done" is one nobody can
 * trust with a catalogue, because the first time they find out it mapped the
 * price column to stock is when the shop is selling at 4 JOD.
 *
 * The file never leaves the browser. It is parsed here, and what goes to the
 * server is the *rows*, which the server validates and plans again against the
 * catalogue as it is at that moment. Sending the file itself would need an
 * upload path, and would make a five-megabyte spreadsheet the serverless
 * function's problem for no gain: the browser already has it open.
 */

type Step = "choose" | "map" | "review" | "running" | "finished";

interface JobSummary {
  id: string;
  filename?: string;
  total?: number;
  applied?: number;
  created?: number;
  updated?: number;
  failed?: number;
  status?: "running" | "done" | "undone";
  startedAt?: number;
}

/** One slice per request. Matches the route's own cap. */
const SLICE = 50;

export function ImportBoard({ products }: { products: Product[] }) {
  const { t, locale } = useAdminLocale();

  const [step, setStep] = useState<Step>("choose");
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [cells, setCells] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(ImportFieldId | null)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<{ created: number; updated: number; failed: number } | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const [recent, setRecent] = useState<JobSummary[]>([]);

  /* ---- the catalogue, as the planner sees it --------------------------- */

  const catalogue = useMemo<ExistingProduct[]>(
    () =>
      products.map((product) => ({
        id: product.id,
        slug: product.slug,
        sku: product.sku,
        title: product.title,
        description: product.description,
        price: product.price,
        compareAtPrice: product.compareAtPrice,
        totalStock: product.totalStock,
        categoryId: product.categoryId,
        status: product.status,
        tags: product.tags,
        type: product.type,
        gtin: product.gtin,
      })),
    [products],
  );

  const parsed = useMemo<ParsedRow[]>(
    () => cells.map((row, index) => parseRow(row, mapping, index + 2)),
    [cells, mapping],
  );

  const plan = useMemo<ImportPlan | null>(
    () => (parsed.length > 0 ? planImport(parsed, catalogue) : null),
    [parsed, catalogue],
  );

  /* ---- unfinished jobs ------------------------------------------------- */

  const loadRecent = useCallback(async () => {
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/products/import", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await response.json()) as { ok?: boolean; jobs?: JobSummary[] };
      if (data.ok) setRecent(data.jobs ?? []);
    } catch {
      /* The list is a convenience; failing to read it is not worth an alarm. */
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  /* ---- reading the file ------------------------------------------------ */

  async function readFile(file: File) {
    setError(null);
    setFilename(file.name);
    try {
      const rows = file.name.toLowerCase().endsWith(".xlsx")
        ? await readWorkbook(file)
        : parseDelimited(await file.text());

      if (rows.length < 2) {
        setError(t("imp.noRows"));
        return;
      }

      const head = rows[0]!.map((cell) => cell.trim());
      setHeaders(head);
      setCells(rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== "")));
      setMapping(autoMap(head));
      setStep("map");
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : t("imp.readFailed"));
    }
  }

  /**
   * Read an .xlsx in the browser.
   *
   * ExcelJS is already a dependency for exports and is about a megabyte, so it
   * is imported at the moment a spreadsheet is actually chosen rather than
   * shipped to everybody who opens this screen. Cells come back as their typed
   * values — a date stays a date, a number stays a number — and are rendered
   * to text here so the rest of the pipeline sees exactly what a CSV would
   * have given it, and behaves identically.
   */
  async function readWorkbook(file: File): Promise<string[][]> {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error(t("imp.noRows"));

    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const values: string[] = [];
      // `row.values` is 1-based with a hole at index 0, and a trailing empty
      // cell is simply absent — so the width is taken from the sheet, not from
      // the array, or the columns shift left on any row with a blank at the end.
      for (let col = 1; col <= sheet.columnCount; col += 1) {
        const cell = row.getCell(col);
        values.push(cellText(cell.value));
      }
      rows.push(values);
    });
    return rows;
  }

  /* ---- applying -------------------------------------------------------- */

  async function apply(resumeJobId?: string, from = 0) {
    if (!plan) return;

    const applicable = plan.rows.filter(
      (row) => row.action === "create" || row.action === "update",
    );
    if (applicable.length === 0) {
      setError(t("imp.nothingToDo"));
      return;
    }

    const id = resumeJobId ?? `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setJobId(id);
    setStep("running");
    setBusy(true);
    setInterrupted(false);
    setError(null);

    let created = 0;
    let updated = 0;
    let failed = 0;
    let offset = from;

    try {
      const token = await getIdToken().catch(() => null);

      while (offset < applicable.length) {
        const slice = applicable.slice(offset, offset + SLICE);
        const response = await fetch("/api/admin/products/import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            jobId: id,
            filename,
            total: applicable.length,
            offset,
            // Only the parsed values travel — the server plans again itself.
            rows: slice.map((row) => ({ line: row.line, values: row.values, problems: [] })),
          }),
        });

        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          created?: number;
          updated?: number;
          outcomes?: { ok: boolean }[];
        };
        if (!response.ok || !data.ok) throw new Error(data.error ?? t("imp.readFailed"));

        created += data.created ?? 0;
        updated += data.updated ?? 0;
        failed += (data.outcomes ?? []).filter((outcome) => !outcome.ok).length;

        offset += slice.length;
        setDone(offset);
      }

      setResult({ created, updated, failed });
      setStep("finished");
      void loadRecent();
    } catch (applyError) {
      /*
       * Half-done is a state, not a failure. The rows already written are
       * written; the job knows how far it got, and Resume carries on from
       * there rather than starting again and creating everything twice.
       */
      setInterrupted(true);
      setDone(offset);
      setError(applyError instanceof Error ? applyError.message : t("imp.readFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function undoJob(id: string) {
    setBusy(true);
    setError(null);
    setUndoNote(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/products/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: "undo", jobId: id }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        restored?: number;
        deleted?: number;
        kept?: string[];
      };
      if (!response.ok || !data.ok) throw new Error(data.error ?? t("imp.undoFailed"));

      const parts = [
        t("imp.undone")
          .replace("{restored}", String(data.restored ?? 0))
          .replace("{deleted}", String(data.deleted ?? 0)),
      ];
      // Named rather than buried: a product left alone because somebody edited
      // it is the one thing about an undo that is not obvious.
      if (data.kept && data.kept.length > 0) {
        parts.push(t("imp.undoKept").replace("{n}", String(data.kept.length)));
      }
      setUndoNote(parts.join(" "));
      setResult(null);
      void loadRecent();
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : t("imp.undoFailed"));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("choose");
    setFilename("");
    setHeaders([]);
    setCells([]);
    setMapping([]);
    setJobId(null);
    setDone(0);
    setResult(null);
    setInterrupted(false);
    setError(null);
    setUndoNote(null);
  }

  /* ---- the template ---------------------------------------------------- */

  function downloadTemplate(withProducts: boolean) {
    const labels = TEMPLATE_HEADERS.map(
      (id) => IMPORT_FIELDS.find((field) => field.id === id)!.label.en,
    );
    const rows = withProducts
      ? products.map((product) =>
          TEMPLATE_HEADERS.map((id) => templateCell(product, id)),
        )
      : [];

    const csv = [labels, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");

    // The BOM is what makes Excel open UTF-8 correctly on Windows; without it
    // every Arabic name comes back as mojibake and the round trip corrupts the
    // catalogue it was meant to edit.
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = withProducts ? "net-sale-catalogue.csv" : "net-sale-import-template.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }

  /* ---- render ---------------------------------------------------------- */

  const shown = plan
    ? onlyProblems
      ? plan.rows.filter((row) => row.action === "error" || row.action === "duplicate")
      : plan.rows
    : [];

  return (
    <>
      <AdminPageHeader
        title={t("imp.title")}
        description={t("imp.subtitle")}
        actions={
          <Link href="/admin/products">
            <Button variant="ghost" size="sm">
              {t("pe.catalogue")}
            </Button>
          </Link>
        }
      />

      {error && (
        <p role="alert" className="text-alert mb-3 text-[0.8125rem]">
          {error}
        </p>
      )}
      {undoNote && (
        <p role="status" className="text-mint mb-3 text-[0.8125rem]">
          {undoNote}
        </p>
      )}

      {step === "choose" && (
        <div className="grid gap-4">
          <Panel title={t("imp.pickFile")} description={t("imp.dropHint")}>
            <div className="flex flex-wrap items-center gap-3">
              <label className="bg-ink rounded-pill cursor-pointer px-4 py-2 text-[0.8125rem] font-medium text-white">
                {t("imp.pickFile")}
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,.xlsx,text/csv"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readFile(file);
                    event.target.value = "";
                  }}
                />
              </label>

              <button
                type="button"
                onClick={() => downloadTemplate(false)}
                className="border-line hover:border-ink text-ink rounded-pill cursor-pointer border px-4 py-2 text-[0.8125rem] transition-colors"
                data-cursor="hover"
              >
                {t("imp.template")}
              </button>

              {/*
                The catalogue as a file the importer reads back unchanged.
                Export, edit in Excel, import: the round trip is the feature,
                and it only works if the columns match on both sides.
              */}
              <button
                type="button"
                onClick={() => downloadTemplate(true)}
                className="border-line hover:border-ink text-ink rounded-pill cursor-pointer border px-4 py-2 text-[0.8125rem] transition-colors"
                data-cursor="hover"
              >
                {t("imp.exportAll")}
              </button>
            </div>
          </Panel>

          {recent.length > 0 && (
            <Panel title={t("imp.recent")}>
              <ul className="divide-line divide-y">
                {recent.map((job) => (
                  <li key={job.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[0.8125rem]">
                    <span className="text-ink min-w-0 flex-1 truncate">
                      {job.filename || job.id}
                    </span>
                    <span className="text-mist tabular-nums">
                      {job.applied ?? 0}/{job.total ?? 0} {t("imp.rowsWord")}
                    </span>
                    <span
                      className={cn(
                        "rounded-pill px-2.5 py-1 text-[0.6875rem]",
                        job.status === "done"
                          ? "bg-mint/12 text-mint"
                          : job.status === "undone"
                            ? "bg-paper-sunken text-mist"
                            : "bg-alert/10 text-alert",
                      )}
                    >
                      {job.status === "done"
                        ? t("imp.status.done")
                        : job.status === "undone"
                          ? t("imp.status.undone")
                          : t("imp.status.running")}
                    </span>
                    {job.status !== "undone" && (job.created ?? 0) + (job.updated ?? 0) > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void undoJob(job.id)}
                        className="text-alert hover:underline cursor-pointer text-[0.75rem] disabled:opacity-40"
                        data-cursor="hover"
                      >
                        {busy ? t("imp.undoing") : t("imp.undo")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      {step === "map" && (
        <Panel
          title={t("imp.step.map")}
          description={`${filename} · ${cells.length} ${t("imp.rowsWord")}`}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={reset}>
                {t("imp.startOver")}
              </Button>
              <Button variant="brand" size="sm" onClick={() => setStep("review")}>
                {t("imp.step.review")}
              </Button>
            </>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="text-mist text-[0.625rem] tracking-[0.12em] uppercase">
                  <th className="px-3 py-2 text-start">{t("imp.column")}</th>
                  <th className="px-3 py-2 text-start">{t("imp.sample")}</th>
                  <th className="px-3 py-2 text-start">{t("imp.mapsTo")}</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {headers.map((header, index) => (
                  <tr key={`${header}-${index}`}>
                    <td className="text-ink px-3 py-2 font-medium">{header || "—"}</td>
                    <td className="text-mist max-w-[16rem] truncate px-3 py-2">
                      {cells[0]?.[index] || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={mapping[index] ?? ""}
                        aria-label={`${t("imp.mapsTo")}: ${header}`}
                        onChange={(event) => {
                          const value = (event.target.value || null) as ImportFieldId | null;
                          setMapping((current) =>
                            current.map((existing, i) =>
                              // A field can only come from one column. Letting two
                              // columns claim `price` means one of them silently
                              // loses, and which one depends on column order.
                              i === index ? value : existing === value && value ? null : existing,
                            ),
                          );
                        }}
                        className="border-line focus:border-brand bg-paper text-ink rounded-md border px-2.5 py-1.5 text-[0.75rem] outline-none"
                      >
                        <option value="">{t("imp.ignore")}</option>
                        {IMPORT_FIELDS.map((field) => (
                          <option key={field.id} value={field.id}>
                            {pick(field.label, locale)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-mist mt-3 text-[0.75rem]">{t("imp.unmapped")}</p>
        </Panel>
      )}

      {step === "review" && plan && (
        <div className="grid gap-4">
          <Panel
            title={t("imp.step.review")}
            description={filename}
            actions={
              <>
                <Button variant="ghost" size="sm" onClick={() => setStep("map")}>
                  {t("imp.step.map")}
                </Button>
                <Button
                  variant="brand"
                  size="sm"
                  loading={busy}
                  onClick={() => void apply()}
                  disabled={plan.creates + plan.updates === 0}
                >
                  {t("imp.apply")}
                </Button>
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Tally n={plan.creates} label={t("imp.creates")} tone="mint" />
              <Tally n={plan.updates} label={t("imp.updates")} tone="brand" />
              <Tally n={plan.unchanged} label={t("imp.unchanged")} tone="mist" />
              <Tally n={plan.duplicates} label={t("imp.duplicates")} tone="mist" />
              <Tally n={plan.errors} label={t("imp.errors")} tone="alert" />
            </div>

            {plan.errors > 0 && (
              <p className="text-mist mt-3 text-[0.75rem]">{t("imp.errorsBlock")}</p>
            )}
            {plan.creates + plan.updates === 0 && (
              <p className="text-mist mt-3 text-[0.8125rem]">{t("imp.nothingToDo")}</p>
            )}
          </Panel>

          <Panel
            title={`${shown.length} ${t("imp.rowsWord")}`}
            actions={
              <label className="text-ink-muted flex items-center gap-2 text-[0.75rem]">
                <input
                  type="checkbox"
                  checked={onlyProblems}
                  onChange={(event) => setOnlyProblems(event.target.checked)}
                  className="accent-brand h-3.5 w-3.5 cursor-pointer"
                />
                {t("imp.onlyErrors")}
              </label>
            }
            padded={false}
          >
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-[0.8125rem]">
                <thead className="bg-paper-sunken sticky top-0">
                  <tr className="text-mist text-[0.625rem] tracking-[0.12em] uppercase">
                    <th className="px-4 py-2 text-start">{t("imp.line")}</th>
                    <th className="px-4 py-2 text-start">{t("imp.willDo")}</th>
                    <th className="px-4 py-2 text-start">{t("imp.detail")}</th>
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {shown.map((row) => (
                    <tr key={row.line}>
                      <td className="text-mist px-4 py-2 tabular-nums">{row.line}</td>
                      <td className="px-4 py-2">
                        <ActionPill row={row} />
                      </td>
                      <td className="px-4 py-2">
                        <RowDetail row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {(step === "running" || step === "finished") && (
        <Panel title={t("imp.title")} description={filename}>
          <p className="text-ink text-[0.9375rem] tabular-nums">
            {t("imp.progress")
              .replace("{done}", String(done))
              .replace(
                "{total}",
                String(
                  plan?.rows.filter((row) => row.action === "create" || row.action === "update")
                    .length ?? 0,
                ),
              )}
          </p>

          {interrupted && (
            <>
              <p className="text-alert mt-3 text-[0.8125rem]">{t("imp.failedSlice")}</p>
              <Button
                variant="brand"
                size="sm"
                className="mt-3"
                loading={busy}
                onClick={() => void apply(jobId ?? undefined, done)}
              >
                {t("imp.resume")}
              </Button>
            </>
          )}

          {result && (
            <div className="mt-3 grid gap-3">
              <p className="text-mint text-[0.8125rem]">
                {t("imp.done")
                  .replace("{created}", String(result.created))
                  .replace("{updated}", String(result.updated))}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={reset}>
                  {t("imp.startOver")}
                </Button>
                {jobId && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void undoJob(jobId)}
                    className="border-alert text-alert rounded-pill cursor-pointer border px-4 py-2 text-[0.8125rem] transition-opacity disabled:opacity-40"
                    data-cursor="hover"
                  >
                    {busy ? t("imp.undoing") : t("imp.undo")}
                  </button>
                )}
              </div>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One figure from the plan.
 *
 * The tones are written out rather than composed as `text-${tone}`. Tailwind
 * finds classes by scanning the source for literal strings, so an interpolated
 * one is never generated — the class lands in the HTML and does nothing, and
 * the count renders in the default ink. It looks like a styling slip and is
 * actually a build-time one, which is why it is worth the verbosity.
 */
const TALLY_TONES = {
  mint: "text-mint",
  brand: "text-brand-deep",
  mist: "text-mist",
  alert: "text-alert",
} as const;

function Tally({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone: keyof typeof TALLY_TONES;
}) {
  return (
    <div className="border-line rounded-md border px-3 py-2.5">
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          n === 0 ? "text-mist" : TALLY_TONES[tone],
        )}
      >
        {n}
      </p>
      <p className="text-mist text-[0.6875rem]">{label}</p>
    </div>
  );
}

function ActionPill({ row }: { row: PlannedRow }) {
  const { t } = useAdminLocale();
  const unchanged = row.action === "update" && (row.changes?.length ?? 0) === 0;

  const [label, tone] = unchanged
    ? [t("imp.act.skip"), "bg-paper-sunken text-mist"]
    : row.action === "create"
      ? [t("imp.act.create"), "bg-mint/12 text-mint"]
      : row.action === "update"
        ? [t("imp.act.update"), "bg-brand-mist text-brand-deep"]
        : row.action === "duplicate"
          ? [t("imp.act.duplicate"), "bg-paper-sunken text-smoke"]
          : [t("imp.act.error"), "bg-alert/10 text-alert"];

  return (
    <span className={cn("rounded-pill inline-flex px-2.5 py-1 text-[0.6875rem] font-medium", tone)}>
      {label}
    </span>
  );
}

/** What this row will actually do, in words rather than as a diff of objects. */
function RowDetail({ row }: { row: PlannedRow }) {
  const { t, locale } = useAdminLocale();

  if (row.action === "error") {
    return (
      <ul className="text-alert grid gap-0.5 text-[0.75rem]">
        {row.problems.map((problem, index) => (
          <li key={index}>{pick(problem.message, locale)}</li>
        ))}
      </ul>
    );
  }

  if (row.action === "duplicate") {
    return (
      <span className="text-smoke text-[0.75rem]">
        {t("imp.line")} {row.duplicateOfLine}
      </span>
    );
  }

  if (row.action === "create") {
    const title = row.values.titleEn ?? row.values.titleAr ?? "";
    return <span className="text-ink-muted text-[0.75rem]">{String(title)}</span>;
  }

  if (!row.changes || row.changes.length === 0) {
    return <span className="text-mist text-[0.75rem]">—</span>;
  }

  return (
    <span className="text-ink-muted grid gap-0.5 text-[0.75rem]">
      <span className="text-mist text-[0.6875rem]">
        {t("imp.matchedBy")} {row.matchedBy}
      </span>
      {row.changes.map((change) => {
        const field = IMPORT_FIELDS.find((candidate) => candidate.id === change.field);
        return (
          <span key={change.field}>
            {field ? pick(field.label, locale) : change.field}:{" "}
            <span className="text-mist line-through">{display(change.from)}</span>{" "}
            <span className="text-ink">{display(change.to)}</span>
          </span>
        );
      })}
    </span>
  );
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** An ExcelJS cell rendered the way a CSV would have written it. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const rich = value as { text?: string; result?: unknown; richText?: { text: string }[] };
    // A formula cell carries its computed result; a hyperlink and rich text
    // carry their display text. Taking `String(value)` on any of them yields
    // "[object Object]" in the middle of the merchant's data.
    if (Array.isArray(rich.richText)) return rich.richText.map((part) => part.text).join("");
    if (rich.result !== undefined) return String(rich.result);
    if (rich.text !== undefined) return rich.text;
    return "";
  }
  return String(value);
}

function templateCell(product: Product, field: ImportFieldId): string | number {
  switch (field) {
    case "id":
      return product.id;
    case "slug":
      return product.slug;
    case "titleEn":
      return product.title?.en ?? "";
    case "titleAr":
      return product.title?.ar ?? "";
    case "categoryId":
      return product.categoryId;
    case "price":
      return product.price;
    case "compareAtPrice":
      return product.compareAtPrice ?? "";
    case "totalStock":
      return product.totalStock;
    case "sku":
      return product.sku ?? "";
    case "gtin":
      return product.gtin ?? "";
    case "tags":
      return (product.tags ?? []).join(", ");
    case "status":
      return product.status;
    case "type":
      return product.type;
    default:
      return "";
  }
}

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
