"use client";

import { useCallback, useEffect, useState } from "react";

import { getIdToken } from "@/lib/firebase/auth";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/Button";
import type { Locale } from "@/types";

/**
 * Running a try-on, and saying honestly when one cannot be run.
 *
 * The state this panel spends most of its life in is "not switched on", and
 * that is the state it is written around. A try-on costs real money per image
 * to an external provider; with no credentials configured there is nothing to
 * call, and the only correct thing to show is that — not a spinner, not a
 * sample image, not a queue that never drains.
 *
 * The rule the whole feature rests on: **nothing is ever invented**. A
 * plausible placeholder presented as a try-on would be believed, and it would
 * be a picture of somebody else wearing the garment.
 *
 * The allowance is shown before the button rather than enforced after it. A
 * limit discovered at submit time reads as the shop changing its mind.
 */

interface Job {
  id: string;
  productId: string;
  state: "queued" | "running" | "done" | "failed" | "not-configured";
  resultPath: string | null;
  error: string | null;
  createdAt: number;
}

interface Status {
  ok?: boolean;
  canStart?: boolean;
  reason?: string | null;
  message?: { en: string; ar: string };
  remainingToday?: number;
  remainingMonth?: number;
  providerConfigured?: boolean;
  jobs?: Job[];
}

export function TryOnPanel({
  productId,
  personImagePath,
  locale = "en",
}: {
  productId: string | null;
  /** The stored photo's object path, or null if none has been uploaded. */
  personImagePath: string | null;
  locale?: Locale;
}) {
  const rtl = locale === "ar";
  const { user } = useAuth();

  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/fitting/try-on", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = (await response.json()) as Status;
      if (response.ok && body.ok) setStatus(body);
    } catch {
      /* The rest of the fitting room still works without this panel. */
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startTryOn() {
    if (busy || !productId || !personImagePath) return;
    setBusy(true);
    setError(null);

    try {
      const token = await getIdToken().catch(() => null);
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const created = await fetch("/api/fitting/try-on", {
        method: "POST",
        headers,
        body: JSON.stringify({ productId, personImagePath }),
      });
      const createdBody = (await created.json()) as {
        ok?: boolean;
        jobId?: string;
        error?: string;
        errorAr?: string;
      };
      if (!created.ok || !createdBody.ok) {
        throw new Error((rtl ? createdBody.errorAr : createdBody.error) ?? "");
      }

      /*
       * Creating and running are two calls because the model takes five to
       * twenty seconds — long enough that one request doing both dies against
       * a serverless timeout, after the provider has already been paid. The
       * job exists before the run, so a timeout here loses nothing.
       */
      const ran = await fetch("/api/fitting/try-on", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "run", jobId: createdBody.jobId }),
      });
      const ranBody = (await ran.json()) as { ok?: boolean; error?: string };
      if (!ran.ok || !ranBody.ok) throw new Error(ranBody.error ?? "");

      await load();
    } catch (startError) {
      setError(
        startError instanceof Error && startError.message
          ? startError.message
          : rtl
            ? "تعذّر تشغيل القياس."
            : "That try-on could not be run.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(jobId: string) {
    try {
      const token = await getIdToken().catch(() => null);
      await fetch("/api/fitting/try-on", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jobId }),
      });
      await load();
    } catch {
      setError(rtl ? "تعذّر الحذف." : "That could not be deleted.");
    }
  }

  if (!user) return null;

  const reasonText = status?.message ? (rtl ? status.message.ar : status.message.en) : null;

  return (
    <section className="border-line mt-6 border-t pt-5">
      <h3 className="font-display text-ink text-[1.0625rem] font-semibold">
        {rtl ? "جرّبها على صورتك" : "See it on you"}
      </h3>

      {/*
        The unavailable state, said plainly and first. A shop that shows a
        button for something it cannot do wastes the customer's photo upload
        to teach them that.
      */}
      {status && !status.providerConfigured && (
        <p className="text-smoke mt-2 text-[0.8125rem]">
          {rtl
            ? "خدمة القياس الافتراضي غير مُفعّلة في هذا المتجر بعد. لن نعرض صورة مُركّبة بدلاً منها."
            : "The try-on service is not switched on in this shop yet. We will not show a mocked-up image instead."}
        </p>
      )}

      {status?.providerConfigured && (
        <>
          <p className="text-smoke mt-1 text-[0.8125rem]">
            {rtl
              ? `تبقّى لك ${status.remainingToday ?? 0} اليوم.`
              : `${status.remainingToday ?? 0} left today.`}
          </p>

          {!personImagePath && (
            <p className="text-mist mt-2 text-[0.8125rem]">
              {rtl ? "ارفع صورة أولاً." : "Upload a photo first."}
            </p>
          )}

          {reasonText && !status.canStart && (
            <p className="text-mist mt-2 text-[0.8125rem]">{reasonText}</p>
          )}

          <Button
            variant="brand"
            size="sm"
            className="mt-3"
            loading={busy}
            disabled={!status.canStart || !productId || !personImagePath}
            onClick={() => void startTryOn()}
          >
            {rtl ? "شغّل القياس" : "Run try-on"}
          </Button>
        </>
      )}

      {error && (
        <p role="alert" className="text-alert mt-3 text-[0.8125rem]">
          {error}
        </p>
      )}

      {status?.jobs && status.jobs.length > 0 && (
        <ul className="divide-line mt-4 divide-y">
          {status.jobs.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-ink-muted min-w-0 flex-1 truncate text-[0.8125rem]">
                {job.state === "done"
                  ? rtl
                    ? "جاهزة"
                    : "Ready"
                  : job.state === "not-configured"
                    ? rtl
                      ? "الخدمة غير مُفعّلة"
                      : "Service not switched on"
                    : job.state === "failed"
                      ? (job.error ?? (rtl ? "فشل" : "Failed"))
                      : rtl
                        ? "قيد التنفيذ"
                        : "Running"}
              </span>
              <button
                type="button"
                onClick={() => void remove(job.id)}
                className="text-mist hover:text-alert cursor-pointer text-[0.75rem]"
                data-cursor="hover"
              >
                {rtl ? "احذف" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
