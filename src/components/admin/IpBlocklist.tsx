"use client";

import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { getIdToken } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminUI";
import { useAdminLocale } from "./AdminLocale";

/**
 * The address blocklist.
 *
 * The warning sits above the field, not below the list, because it changes
 * whether somebody should use this at all: a mobile network puts thousands of
 * subscribers behind one address, so blocking it reaches people who did
 * nothing. Told afterwards, that is an apology; told first, it is a decision.
 *
 * The operator's own address is shown for the same reason. The realistic
 * mistake is not a typo — it is reading an address out of a log, not noticing
 * it is the office's own, and blocking it. The server refuses that outright;
 * showing the address is what stops them trying.
 */

interface Block {
  text: string;
  reason?: string | null;
  uid?: string | null;
  addedBy?: string | null;
  addedAt?: number | null;
}

const field =
  "border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-full rounded-md border px-3 py-2 text-[0.8125rem] outline-none transition-colors";

export function IpBlocklist() {
  const { t, rtl } = useAdminLocale();

  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [yours, setYours] = useState<string | null>(null);
  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getIdToken().catch(() => null);
    return token
      ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      : { "Content-Type": "application/json" };
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/ip-blocks", { headers: await authHeaders() });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        blocks?: Block[];
        yours?: string | null;
      };
      if (response.status === 403) {
        // Staff can see the shop; this panel is not theirs. Said once, quietly.
        setDenied(true);
        setBlocks([]);
        return;
      }
      if (!response.ok || !data.ok) throw new Error(data.error ?? "That could not be read.");
      setBlocks(data.blocks ?? []);
      setYours(data.yours ?? null);
      setError(null);
    } catch (failure) {
      /*
       * Left null, not emptied. An empty array renders "Nothing is blocked",
       * which is a claim about the list — and the list is exactly what could
       * not be read. The error is the only honest thing to show.
       */
      setBlocks(null);
      setError(failure instanceof Error ? failure.message : "That could not be read.");
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/ip-blocks", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ ip, reason }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "That did not work.");
      setIp("");
      setReason("");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(text: string) {
    setRemoving(text);
    setError(null);
    try {
      const response = await fetch(`/api/admin/ip-blocks?ip=${encodeURIComponent(text)}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "That did not work.");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work.");
    } finally {
      setRemoving(null);
    }
  }

  if (denied) {
    return (
      <Panel title={t("ipb.title")}>
        <p className="text-mist text-[0.8125rem]">{t("ipb.adminOnly")}</p>
      </Panel>
    );
  }

  return (
    <Panel title={t("ipb.title")} description={t("ipb.hint")}>
      {/*
        Above the field, because it changes whether to use this at all.
      */}
      <p className="border-line bg-paper-sunken text-ink-muted mb-4 rounded-md border px-3 py-2.5 text-[0.75rem] leading-relaxed">
        {t("ipb.warning")}
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="min-w-[180px] flex-1">
          <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{t("ipb.address")}</span>
          <input
            value={ip}
            onChange={(event) => setIp(event.target.value)}
            dir="ltr"
            placeholder="203.0.113.9"
            className={cn(field, "font-mono text-[0.75rem]")}
          />
        </label>
        <label className="min-w-[180px] flex-[2]">
          <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{t("ipb.reason")}</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={field}
            maxLength={300}
          />
        </label>
        <Button variant="brand" size="sm" loading={busy} disabled={!ip.trim()} onClick={() => void add()}>
          {busy ? t("ipb.adding") : t("ipb.add")}
        </Button>
      </div>

      <p className="text-mist mb-4 text-[0.6875rem] leading-relaxed">
        {t("ipb.addressHint")} · {t("ipb.delay")}
      </p>

      {yours && (
        <p className="text-mist mb-4 text-[0.6875rem]">
          {t("ipb.yours")}{" "}
          <span className="text-ink font-mono" dir="ltr">
            {yours}
          </span>
          . {t("ipb.yoursHint")}
        </p>
      )}

      {error && (
        <p role="alert" className="text-alert mb-4 text-[0.8125rem] leading-relaxed">
          {error}
        </p>
      )}

      {blocks === null ? (
        // Nothing is said while loading, and nothing is said after a failure —
        // the error above has already said it.
        !error && <p className="text-mist text-[0.75rem]">…</p>
      ) : blocks.length === 0 ? (
        <p className="text-mist text-[0.8125rem]">{t("ipb.empty")}</p>
      ) : (
        <ul className="border-line divide-line divide-y border-t">
          {blocks.map((block) => (
            <li key={block.text} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="text-ink font-mono text-[0.8125rem]" dir="ltr">
                {block.text}
              </span>
              {block.reason && (
                <span className="text-ink-muted flex-1 text-[0.75rem]">{block.reason}</span>
              )}
              <span className="text-mist ms-auto text-[0.6875rem]">
                {block.addedBy && (
                  <>
                    {t("ipb.addedBy")} <span dir="ltr">{block.addedBy}</span>
                  </>
                )}
                {block.addedAt ? ` · ${new Date(block.addedAt).toLocaleDateString(rtl ? "ar-JO" : "en-GB")}` : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                loading={removing === block.text}
                onClick={() => void remove(block.text)}
              >
                {t("ipb.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
