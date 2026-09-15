import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { EVENT_LABEL } from "@/lib/notify/templates";
import { Panel } from "./AdminUI";
import type { Notification } from "@/types";

/**
 * What the shop told this customer, and whether it arrived.
 *
 * The reason this screen exists rather than a quiet log file: a notification
 * that fails is invisible to everyone. The customer does not know a message
 * was meant to come, and the operator has no reason to suspect one did not.
 * So every attempt is shown with its outcome — including "not sent", which is
 * the honest state when no mail provider is configured and is deliberately
 * not dressed up as a failure.
 */
export function NotificationLog({
  notifications,
  providerConfigured,
}: {
  notifications: Notification[];
  providerConfigured: boolean;
}) {
  return (
    <Panel
      title="Messages"
      description={
        providerConfigured
          ? "What was sent to this customer about this order."
          : "No mail provider is configured, so nothing is being sent."
      }
    >
      {notifications.length === 0 ? (
        <p className="text-mist text-[0.8125rem]">
          Nothing yet. A message goes out when the order is paid, dispatched,
          delivered or refunded.
        </p>
      ) : (
        <ul className="divide-line divide-y">
          {notifications.map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-2.5">
              <span
                className={cn(
                  "rounded-xs mt-0.5 w-20 shrink-0 px-2 py-1 text-center text-[0.625rem] font-semibold tracking-[0.06em] uppercase",
                  item.state === "sent" && "bg-mint/12 text-mint",
                  item.state === "failed" && "bg-alert/12 text-alert",
                  // Not an error colour: an unconfigured channel is a setup
                  // task, and painting it red sends someone hunting a bug.
                  item.state === "skipped" && "bg-paper-sunken text-smoke",
                  item.state === "queued" && "bg-sand text-ink",
                )}
              >
                {item.state === "skipped" ? "not sent" : item.state}
              </span>

              <span className="min-w-0 flex-1">
                <span className="text-ink block text-[0.8125rem] font-medium">
                  {EVENT_LABEL[item.event].en}
                </span>
                <span className="text-smoke block truncate text-[0.75rem]">{item.subject}</span>
                {/* The provider's own words, not a sanitised summary —
                    "domain not verified" is actionable, "failed" is not. */}
                {item.error && (
                  <span className="text-alert mt-0.5 block text-[0.75rem]">{item.error}</span>
                )}
                <span className="text-mist mt-0.5 block text-[0.6875rem]">
                  {item.to} ·{" "}
                  {item.sentAt ? formatDate(item.sentAt) : formatDate(item.queuedAt)}
                  {item.attempts > 1 && ` · ${item.attempts} attempts`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
