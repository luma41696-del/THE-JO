import { MAX_ATTEMPTS, type TryOnJob } from "./provider";

/**
 * Who may ask for a try-on, how often, and what the shop is agreeing to pay.
 *
 * Every other feature in this shop is free to run. This one costs roughly USD
 * 0.04–0.10 per image to somebody else's account, which changes what "a bug"
 * means: a loop that retries forever is not a slow page, it is an invoice. So
 * the limits here are not product polish, they are the spending control, and
 * they are pure so the arithmetic can be checked without calling anything.
 *
 * Three separate limits, because they stop three different things:
 *
 *  - **Per day** stops one curious customer spending an afternoon on it.
 *  - **Per month** stops the same customer doing that every day.
 *  - **One at a time** stops a double-tapped button, or a page left open with
 *    a polling loop, turning into two paid calls for one intention.
 *
 * And one rule that matters more than the three: a call that never reached the
 * provider never counts. Charging somebody's daily allowance for an attempt
 * the shop refused before spending anything is the kind of small unfairness
 * that makes a feature feel broken.
 */

/** Per account, per rolling day. Generous enough to try a few pieces on. */
export const DAILY_LIMIT = 5;

/** Per account, per rolling 30 days. */
export const MONTHLY_LIMIT = 30;

/** How long a job may sit in `running` before it is presumed dead. */
export const STALE_RUNNING_MS = 5 * 60 * 1000;

const DAY = 24 * 60 * 60 * 1000;

export type QuotaRefusal =
  | "no-consent"
  | "daily-limit"
  | "monthly-limit"
  | "already-running"
  | "not-configured";

export interface QuotaVerdict {
  ok: boolean;
  reason?: QuotaRefusal;
  message: { en: string; ar: string };
  /** What is left today, for the panel to show before the button is pressed. */
  remainingToday: number;
  remainingMonth: number;
}

/**
 * Did this job actually cost anything?
 *
 * A job the shop refused before it reached the provider — no credentials, a
 * bad image, a refusal — spent nothing, and counting it would charge a
 * customer's allowance for work nobody did. Only a job that produced a result,
 * or that failed *after* the call went out, is a call.
 *
 * `not-configured` is the one that matters in practice: with no provider set
 * up, every attempt lands there, and without this rule a customer would burn
 * their whole month discovering the feature is off.
 */
export function wasBilled(job: Pick<TryOnJob, "state" | "attempts" | "error">): boolean {
  if (job.state === "not-configured") return false;
  if (job.state === "done") return true;
  if (job.state === "failed") {
    /*
     * A failure that never left the building. These error strings come from
     * `callProvider`'s own pre-flight, which runs before the OAuth exchange
     * and before any bytes are sent.
     */
    const error = (job.error ?? "").toLowerCase();
    if (error.includes("no try-on provider")) return false;
    if (error.includes("needs the account")) return false;
    if (error.includes("too large") || error.includes("not an accepted")) return false;
    return true;
  }
  // queued and running have not produced anything yet, but a running job is
  // holding the one concurrent slot — that is a separate limit, below.
  return job.state === "running";
}

/** A job still occupying the one-at-a-time slot. */
export function isActive(job: Pick<TryOnJob, "state" | "updatedAt">, now = Date.now()): boolean {
  if (job.state !== "queued" && job.state !== "running") return false;
  /*
   * A job that has been "running" for five minutes is not running: the process
   * that owned it is gone. Without this, one crashed request locks the
   * customer out of the feature permanently, and the only fix is a support
   * ticket.
   */
  return now - job.updatedAt < STALE_RUNNING_MS;
}

/**
 * May this account start a try-on right now?
 *
 * `consented` is the customer's own agreement to have their photograph sent to
 * a third party — separate from any cookie banner, because it is a different
 * ask about a different thing. It is checked first: no amount of remaining
 * quota makes it acceptable to send a picture of somebody's body to an
 * external model they did not agree to.
 */
export function canStart({
  jobs,
  consented,
  providerConfigured,
  now = Date.now(),
}: {
  jobs: Pick<TryOnJob, "state" | "attempts" | "error" | "createdAt" | "updatedAt">[];
  consented: boolean;
  providerConfigured: boolean;
  now?: number;
}): QuotaVerdict {
  const billed = jobs.filter((job) => wasBilled(job));
  const today = billed.filter((job) => now - job.createdAt < DAY).length;
  const month = billed.filter((job) => now - job.createdAt < 30 * DAY).length;

  const remainingToday = Math.max(0, DAILY_LIMIT - today);
  const remainingMonth = Math.max(0, MONTHLY_LIMIT - month);

  if (!consented) {
    return {
      ok: false,
      reason: "no-consent",
      remainingToday,
      remainingMonth,
      message: {
        en: "Agree to send your photo to the try-on service before we can generate anything.",
        ar: "وافق على إرسال صورتك إلى خدمة القياس قبل أن نتمكّن من إنشاء أي صورة.",
      },
    };
  }

  /*
   * Said before the attempt, not after. With no provider configured a try-on
   * cannot happen, and letting somebody upload a photograph of themselves to
   * find that out is the worst possible order to do it in.
   */
  if (!providerConfigured) {
    return {
      ok: false,
      reason: "not-configured",
      remainingToday,
      remainingMonth,
      message: {
        en: "The try-on service is not switched on in this shop yet.",
        ar: "خدمة القياس الافتراضي غير مُفعّلة في هذا المتجر بعد.",
      },
    };
  }

  if (jobs.some((job) => isActive(job, now))) {
    return {
      ok: false,
      reason: "already-running",
      remainingToday,
      remainingMonth,
      message: {
        en: "One try-on is already running. It will be ready in a moment.",
        ar: "هناك قياس قيد التنفيذ. سيجهز بعد لحظات.",
      },
    };
  }

  if (remainingToday <= 0) {
    return {
      ok: false,
      reason: "daily-limit",
      remainingToday,
      remainingMonth,
      message: {
        en: `That is ${DAILY_LIMIT} try-ons today. The allowance resets tomorrow.`,
        ar: `هذه ${DAILY_LIMIT} عمليات قياس اليوم. يتجدّد الرصيد غدًا.`,
      },
    };
  }

  if (remainingMonth <= 0) {
    return {
      ok: false,
      reason: "monthly-limit",
      remainingToday,
      remainingMonth,
      message: {
        en: `That is ${MONTHLY_LIMIT} try-ons this month.`,
        ar: `هذه ${MONTHLY_LIMIT} عملية قياس هذا الشهر.`,
      },
    };
  }

  return {
    ok: true,
    remainingToday,
    remainingMonth,
    message: { en: "Ready.", ar: "جاهز." },
  };
}

/* -------------------------------------------------------------------------- */
/*  Expiry                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Results past their retention date.
 *
 * The consent text promises the image is not kept indefinitely, so something
 * has to actually remove it. Returned as a list rather than deleted here, for
 * the same reason the alert sweep is a plan: the caller writes, and a pure
 * function can be checked.
 */
export function expiredJobs<T extends Pick<TryOnJob, "expiresAt" | "state">>(
  jobs: T[],
  now = Date.now(),
): T[] {
  return jobs.filter((job) => job.expiresAt > 0 && job.expiresAt <= now);
}

/** A job that failed and is worth another go, given the attempt cap. */
export function retriable(job: Pick<TryOnJob, "state" | "attempts">): boolean {
  return job.state === "failed" && job.attempts < MAX_ATTEMPTS;
}
