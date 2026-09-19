"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/Button";
import type { CustomerSummary } from "@/lib/admin/data";

/**
 * Blocking and deleting one customer account.
 *
 * The two are presented differently on purpose. Blocking is a switch: it reads
 * as reversible because it is. Deleting asks the operator to type the email
 * address first — not as ceremony, but because the row under the cursor is not
 * always the row they think it is, and this is the one action in the admin
 * that nothing can undo.
 *
 * What deletion actually does is spelled out in the dialog rather than left to
 * be discovered: the sign-in account and the personal details go, the orders
 * stay with the details redacted. An operator who expects "delete" to erase
 * the invoices too should find that out here, not from an accountant.
 *
 * ## Blocking the connection as well
 *
 * An administrator blocking an account is also offered the addresses it has
 * signed in from. That is the whole reason those addresses are recorded:
 * disabling a login stops that login, and the person registers again in a
 * minute.
 *
 * The boxes are **unticked by default**, and not out of timidity. An address
 * block reaches people who are not the target — a mobile carrier puts
 * thousands of subscribers behind one — so it is a thing to choose each time
 * rather than a thing that happens because a dialog was dismissed quickly.
 */
export function CustomerActions({
  customer,
  canDelete,
  labels,
}: {
  customer: CustomerSummary;
  /** Deleting is an administrator's job; blocking is not. */
  canDelete: boolean;
  labels: {
    block: string;
    unblock: string;
    delete: string;
    blocked: string;
    blockTitle: string;
    blockBody: string;
    alsoBlockIp: string;
    alsoBlockIpHint: string;
    noAddresses: string;
    lastSeen: string;
    signIns: string;
    blockGo: string;
    blocking: string;
    cancel: string;
    ipBlocked: string;
    ipFailed: string;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addresses = customer.signInIps ?? [];

  async function run(action: "block" | "unblock" | "delete") {
    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/customers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ uid: customer.uid, action }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "That did not work.");

      setConfirming(false);
      setTyped("");
      // The list is rendered on the server, so the new state comes from there
      // rather than from a guess made here.
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Block the account, then whichever addresses were ticked.
   *
   * In that order, and the order matters: the account block is the one that
   * always works and always matters. If an address block fails - the range is
   * reserved, it covers the operator's own connection, the write is refused -
   * the account is still blocked and the message says which half happened.
   * Doing the addresses first could leave customers locked out by a rule added
   * for an account that then failed to block.
   */
  async function blockWithAddresses() {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const token = await getIdToken().catch(() => null);
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const account = await fetch("/api/admin/customers", {
        method: "POST",
        headers,
        body: JSON.stringify({ uid: customer.uid, action: "block" }),
      });
      const accountData = (await account.json()) as { ok?: boolean; error?: string };
      if (!account.ok || !accountData.ok) {
        throw new Error(accountData.error ?? "That did not work.");
      }

      const refused: string[] = [];
      let blocked = 0;
      for (const ip of chosen) {
        const response = await fetch("/api/admin/ip-blocks", {
          method: "POST",
          headers,
          body: JSON.stringify({
            ip,
            uid: customer.uid,
            reason: `Blocked with the account ${customer.email || customer.uid}`,
          }),
        });
        const data = (await response.json()) as { ok?: boolean; error?: string };
        if (response.ok && data.ok) blocked += 1;
        else refused.push(data.error ?? ip);
      }

      setBlocking(false);
      setChosen([]);
      if (refused.length > 0) {
        setError(labels.ipFailed.replace("{n}", refused.join(" \u00b7 ")));
      } else if (blocked > 0) {
        setNotice(labels.ipBlocked.replace("{n}", String(blocked)));
      }
      router.refresh();
    } catch (blockError) {
      setError(blockError instanceof Error ? blockError.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="flex items-center justify-end gap-2">
        {customer.disabled && (
          <span className="bg-alert/10 text-alert rounded-xs px-1.5 py-0.5 text-[0.625rem]">
            {labels.blocked}
          </span>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            /*
             * Unblocking is one click, always - putting a dialog in front of
             * undoing something is friction on the safe direction.
             *
             * Blocking gets the dialog only for an administrator, who is the
             * only one the address route will accept. For staff it stays the
             * single click it has always been.
             */
            if (customer.disabled) void run("unblock");
            else if (canDelete) {
              setChosen([]);
              setNotice(null);
              setError(null);
              setBlocking(true);
            } else void run("block");
          }}
          className="text-mist hover:text-ink cursor-pointer text-[0.75rem] transition-colors disabled:opacity-40"
          data-cursor="hover"
        >
          {customer.disabled ? labels.unblock : labels.block}
        </button>

        {canDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="text-mist hover:text-alert cursor-pointer text-[0.75rem] transition-colors disabled:opacity-40"
            data-cursor="hover"
          >
            {labels.delete}
          </button>
        )}
      </span>

      {error && (
        <p role="alert" className="text-alert mt-1 text-end text-[0.6875rem]">
          {error}
        </p>
      )}

      {notice && !error && (
        <p role="status" className="text-mint mt-1 text-end text-[0.6875rem]">
          {notice}
        </p>
      )}

      {blocking && (
        <div className="fixed inset-0 z-[200] grid place-items-center p-4">
          <button
            type="button"
            aria-label={labels.cancel}
            onClick={() => !busy && setBlocking(false)}
            className="bg-ink/40 absolute inset-0 cursor-default"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={labels.blockTitle}
            className="bg-paper-raised border-line rounded-xl shadow-float relative w-full max-w-md border p-5"
          >
            <h3 className="font-display text-ink text-[0.9375rem] font-semibold">
              {labels.blockTitle} — {customer.name}
            </h3>
            <p className="text-ink-muted mt-3 text-[0.8125rem] leading-relaxed">
              {labels.blockBody}
            </p>

            <div className="border-line mt-4 border-t pt-4">
              <p className="text-ink text-[0.8125rem] font-medium">{labels.alsoBlockIp}</p>
              <p className="text-mist mt-1 text-[0.6875rem] leading-relaxed">
                {labels.alsoBlockIpHint}
              </p>

              {addresses.length === 0 ? (
                <p className="text-mist mt-3 text-[0.75rem]">{labels.noAddresses}</p>
              ) : (
                <ul className="mt-3 grid gap-1.5">
                  {addresses.map((entry) => (
                    <li key={entry.ip}>
                      <label className="flex cursor-pointer items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={chosen.includes(entry.ip)}
                          onChange={(event) =>
                            setChosen((current) =>
                              event.target.checked
                                ? [...current, entry.ip]
                                : current.filter((x) => x !== entry.ip),
                            )
                          }
                          className="accent-alert h-3.5 w-3.5"
                        />
                        <span className="text-ink font-mono text-[0.8125rem]" dir="ltr">
                          {entry.ip}
                        </span>
                        <span className="text-mist text-[0.6875rem]">
                          {entry.count} {labels.signIns}
                          {entry.last
                            ? ` \u00b7 ${labels.lastSeen} ${new Date(entry.last).toLocaleDateString()}`
                            : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setBlocking(false)}>
                {labels.cancel}
              </Button>
              <Button
                variant="brand"
                size="sm"
                loading={busy}
                onClick={() => void blockWithAddresses()}
              >
                {busy ? labels.blocking : labels.blockGo}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-[200] grid place-items-center p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setConfirming(false)}
            className="bg-ink/40 absolute inset-0 cursor-default"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={labels.delete}
            className="bg-paper-raised border-line rounded-xl shadow-float relative w-full max-w-md border p-5"
          >
            <h3 className="font-display text-ink text-[0.9375rem] font-semibold">
              {labels.delete} — {customer.name}
            </h3>

            {/* Said plainly, because "delete" means different things to
                different people and one of them involves the shop's books. */}
            <ul className="text-ink-muted mt-3 grid gap-1.5 text-[0.8125rem]">
              <li>· The sign-in account is removed and cannot be restored.</li>
              <li>· Addresses, wishlist and fit profile are deleted.</li>
              <li>
                · Orders are <strong className="text-ink">kept</strong> for the accounts, with the
                name, email, phone and address replaced.
              </li>
            </ul>

            <label className="mt-4 block">
              <span className="text-ink-muted mb-1.5 block text-[0.75rem]">
                Type <span className="text-ink font-mono">{customer.email || customer.uid}</span> to
                confirm
              </span>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                className="border-line focus:border-alert bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <button
                type="button"
                // The typed address has to match. A misread row is the failure
                // this is guarding against, not a misclick.
                disabled={busy || typed.trim() !== (customer.email || customer.uid)}
                onClick={() => void run("delete")}
                className={cn(
                  "rounded-pill bg-alert cursor-pointer px-4 py-2 text-[0.8125rem] font-medium text-white",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
                data-cursor="hover"
              >
                {busy ? "Deleting…" : labels.delete}
              </button>
            </div>

            {error && (
              <p role="alert" className="text-alert mt-3 text-[0.8125rem]">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
