import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { Panel } from "./AdminUI";
import type { ErrorReport } from "@/lib/monitoring/fingerprint";

/**
 * What is breaking, for whom, and how often.
 *
 * Grouped rather than a feed: a bad deploy produces one crash per visitor, and
 * a scrolling list of identical entries hides the second, rarer bug under the
 * obvious one. Each row is one fault on one route, with a count.
 *
 * Sorted by **count**, not recency. The most recent error is rarely the most
 * important one; the one that has happened four hundred times is.
 */
export function ErrorReports({ reports }: { reports: (ErrorReport & { resolved?: boolean })[] }) {
  const open = reports.filter((r) => !r.resolved);
  const total = open.reduce((sum, r) => sum + r.count, 0);

  return (
    <Panel
      title="Errors"
      description={
        open.length === 0
          ? "Nothing has crashed."
          : `${open.length} distinct ${open.length === 1 ? "fault" : "faults"}, ${total} ${
              total === 1 ? "occurrence" : "occurrences"
            }.`
      }
    >
      {open.length === 0 ? (
        <p className="text-mist text-[0.8125rem]">
          Error boundaries report here automatically. An empty list means no
          page has thrown since reporting was switched on — not that nothing is
          being watched.
        </p>
      ) : (
        <ul className="divide-line divide-y">
          {open.slice(0, 12).map((report) => (
            <li key={report.fingerprint} className="flex items-start gap-3 py-2.5">
              <span
                className={cn(
                  "rounded-xs mt-0.5 w-12 shrink-0 px-2 py-1 text-center text-[0.75rem] font-semibold tabular-nums",
                  // A fault seen once is a curiosity; one seen often is work.
                  report.count >= 10 ? "bg-alert/12 text-alert" : "bg-sand text-ink",
                )}
              >
                {report.count}
              </span>

              <span className="min-w-0 flex-1">
                <span className="text-ink block truncate text-[0.8125rem] font-medium">
                  {report.message}
                </span>
                <span className="text-smoke block truncate text-[0.75rem]">
                  {report.route} · {report.browser} · {report.locale}
                  {report.boundary === "global" && " · global boundary"}
                </span>
                <span className="text-mist block text-[0.6875rem]">
                  first {formatDate(report.firstSeenAt)} · last{" "}
                  {formatDate(report.lastSeenAt)}
                  {/* The digest is what matches a server log line. */}
                  {report.digest && ` · ${report.digest}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
