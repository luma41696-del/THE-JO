import type { Locale } from "@/types";

/**
 * Closing the shop.
 *
 * A switch that takes the storefront down is the most dangerous control in an
 * admin, and not because it is complicated. It is dangerous because of what
 * happens *around* it: somebody closes for twenty minutes of stock-taking,
 * gets called away, and the shop is dark until a customer asks. So the state
 * carries its own reopening time, and the admin carries a banner that cannot
 * be dismissed while it is on.
 *
 * ## Two axes, not one list
 *
 * "Closed for maintenance" and "closed while we restock" are different
 * closures. One means nobody should see the site; the other usually means
 * *look all you like, you just cannot order yet*. Flattening them into one
 * list of reasons forces every reason to behave the same way.
 *
 *   - `state` decides what happens: open, browsing only, or shut.
 *   - `reason` decides what it says.
 *
 * ## What is never closed
 *
 * The admin, and the routes that sign somebody in to it. A closure that takes
 * the admin with it cannot be undone from the admin, and there is no second
 * way in — see `ALWAYS_OPEN`.
 */

export type StorefrontState = "open" | "browse-only" | "closed";

export type ClosureReason =
  | "maintenance"
  | "restocking"
  | "holiday"
  | "busy"
  | "stocktake"
  | "custom";

export interface StorefrontSettings {
  state: StorefrontState;
  reason: ClosureReason;
  /** Shown instead of the reason's own wording when it is set. */
  message?: { en: string; ar: string };
  /**
   * When the shop lets itself back in.
   *
   * Reached, the closure lifts with nobody touching anything. This is the
   * whole answer to "closed for twenty minutes" becoming "closed for two
   * days", and it is also what `Retry-After` is built from.
   */
  reopensAt?: number;
  /** For the audit trail and the admin banner. */
  closedBy?: string;
  closedAt?: number;
}

export const DEFAULT_STOREFRONT: StorefrontSettings = {
  state: "open",
  reason: "maintenance",
};

/**
 * Paths a closure never touches.
 *
 * `/admin` so the shop can be reopened. `/api/admin` because the admin's own
 * screens are useless without it. `/api/auth` because reopening requires
 * signing in, and a closure that logs the owner out is one nobody can lift.
 *
 * Checked by prefix, so `/admin` and `/admin/anything` both match and
 * `/administrator-blog` does not.
 */
export const ALWAYS_OPEN = ["/admin", "/api/admin", "/api/auth", "/api/errors"];

export function isAlwaysOpen(pathname: string): boolean {
  return ALWAYS_OPEN.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * The state right now, which is not always the state that was stored.
 *
 * A closure with a reopening time in the past is open. Resolved here rather
 * than by a scheduled job, because a job that fails leaves the shop shut and
 * nothing to notice it — where this way the closure expires simply by time
 * passing, on every request, with no moving parts.
 */
export function currentState(
  settings: StorefrontSettings,
  now: number = Date.now(),
): StorefrontState {
  if (settings.state === "open") return "open";
  if (settings.reopensAt && settings.reopensAt <= now) return "open";
  return settings.state;
}

/** Seconds until the shop reopens, for `Retry-After`. */
export function retryAfterSeconds(
  settings: StorefrontSettings,
  now: number = Date.now(),
): number {
  /*
   * An hour when nothing is scheduled. `Retry-After` is a hint to crawlers
   * about when to come back; too short and they hammer a shop that is
   * deliberately down, too long and a reopened shop waits to be re-crawled.
   */
  if (!settings.reopensAt) return 3600;
  return Math.max(60, Math.ceil((settings.reopensAt - now) / 1000));
}

/* -------------------------------------------------------------------------- */
/*  Wording                                                                   */
/* -------------------------------------------------------------------------- */

interface Copy {
  heading: { en: string; ar: string };
  body: { en: string; ar: string };
}

/**
 * What each reason says by default.
 *
 * Written so none of them needs an apology or a promise. "Back shortly" is a
 * promise the shop cannot keep from a settings form; "we are closed right now"
 * is true whatever happens next.
 */
export const REASON_COPY: Record<ClosureReason, Copy> = {
  maintenance: {
    heading: { en: "We are working on the shop", ar: "نعمل على المتجر" },
    body: {
      en: "Net Sale is closed for a short while so we can make some changes. Nothing in your account or your orders is affected.",
      ar: "نت سيل مغلق لفترة قصيرة لإجراء بعض التعديلات. لا شيء في حسابك أو طلباتك يتأثر.",
    },
  },
  restocking: {
    heading: { en: "We are restocking", ar: "نجدّد الأصناف" },
    body: {
      en: "New pieces are going onto the rails. Have a look around — ordering opens again shortly.",
      ar: "قطع جديدة تُضاف إلى الرفوف. تصفّح كما تحب — الطلب يُفتح من جديد قريباً.",
    },
  },
  holiday: {
    heading: { en: "We are closed for the holiday", ar: "مغلق بمناسبة العطلة" },
    body: {
      en: "Net Sale is closed for the holiday. Orders already placed are safe and will be sent when we are back.",
      ar: "نت سيل مغلق بمناسبة العطلة. الطلبات المُقدَّمة محفوظة وسترسل عند عودتنا.",
    },
  },
  busy: {
    heading: { en: "More orders than we can pack", ar: "طلبات أكثر مما نستطيع تجهيزه" },
    body: {
      en: "We have paused new orders so the ones already placed go out on time.",
      ar: "أوقفنا الطلبات الجديدة مؤقتاً كي تخرج الطلبات القائمة في وقتها.",
    },
  },
  stocktake: {
    heading: { en: "We are counting stock", ar: "نجري جرداً للمخزون" },
    body: {
      en: "The shop is closed while we count what is on the shelves, so nothing is sold twice.",
      ar: "المتجر مغلق أثناء جرد ما على الرفوف، حتى لا يُباع الشيء نفسه مرتين.",
    },
  },
  custom: {
    heading: { en: "We are closed right now", ar: "المتجر مغلق حالياً" },
    body: {
      en: "Net Sale is not taking orders at the moment.",
      ar: "نت سيل لا يستقبل طلبات في الوقت الحالي.",
    },
  },
};

/** The heading and body to show, custom wording taking precedence. */
export function closureCopy(
  settings: StorefrontSettings,
  locale: Locale,
): { heading: string; body: string } {
  const preset = REASON_COPY[settings.reason] ?? REASON_COPY.custom;
  const custom = settings.message?.[locale]?.trim();
  return {
    heading: preset.heading[locale],
    // Only the body is overridden. A custom heading as well would let the
    // whole page become one long paragraph with no shape to it.
    body: custom || preset.body[locale],
  };
}

/** Labels for the admin's own picker. */
export const STATE_LABELS: Record<StorefrontState, { en: string; ar: string }> = {
  open: { en: "Open", ar: "مفتوح" },
  "browse-only": { en: "Browsing only", ar: "التصفّح فقط" },
  closed: { en: "Closed", ar: "مغلق" },
};

export const STATE_NOTES: Record<StorefrontState, { en: string; ar: string }> = {
  open: { en: "Everything works.", ar: "كل شيء يعمل." },
  "browse-only": {
    en: "The shop can be browsed and the basket filled, but checkout is refused. Use this while restocking or when you are behind on packing.",
    ar: "يمكن تصفّح المتجر وملء السلة، لكن إتمام الطلب مرفوض. استخدمه أثناء تجديد الأصناف أو عند تأخّر التجهيز.",
  },
  closed: {
    en: "Visitors see a closed notice instead of the shop. The admin stays open — you can always get back in.",
    ar: "يرى الزوار إشعار الإغلاق بدل المتجر. لوحة الإدارة تبقى مفتوحة — يمكنك الدخول دائماً.",
  },
};

export const REASON_LABELS: Record<ClosureReason, { en: string; ar: string }> = {
  maintenance: { en: "Maintenance", ar: "صيانة" },
  restocking: { en: "Restocking", ar: "تجديد الأصناف" },
  holiday: { en: "Holiday", ar: "عطلة" },
  busy: { en: "Too busy to pack", ar: "ضغط على التجهيز" },
  stocktake: { en: "Stocktake", ar: "جرد المخزون" },
  custom: { en: "Something else", ar: "سبب آخر" },
};

/* -------------------------------------------------------------------------- */

const STATES: StorefrontState[] = ["open", "browse-only", "closed"];
const REASONS = Object.keys(REASON_COPY) as ClosureReason[];

/**
 * Read whatever is stored, or whatever was posted, into usable settings.
 *
 * `dropExpired` is the difference between the two callers, and getting it
 * wrong breaks the feature silently:
 *
 *  - **Writing** (`true`): a reopening time already in the past is a mistake
 *    in the form, and storing it would leave the document saying closed while
 *    the shop resolved to open.
 *  - **Reading** (`false`, the default): the stored time must survive, because
 *    `currentState` is what acts on it. Dropping it on the way out means a
 *    closure with a reopening time never reopens — the state stays `closed`
 *    with nothing left to lift it.
 *
 * That second case is not hypothetical. It was the behaviour until a closure
 * set to lift a minute ago was still serving 503.
 */
export function sanitiseStorefront(
  input: unknown,
  { dropExpired = false }: { dropExpired?: boolean } = {},
): StorefrontSettings {
  const raw = (input ?? {}) as Partial<StorefrontSettings>;

  const state = STATES.includes(raw.state as StorefrontState)
    ? (raw.state as StorefrontState)
    : "open";
  const reason = REASONS.includes(raw.reason as ClosureReason)
    ? (raw.reason as ClosureReason)
    : "maintenance";

  const text = (value: unknown) =>
    typeof value === "string" ? value.trim().slice(0, 400) : "";

  const en = text(raw.message?.en);
  const ar = text(raw.message?.ar);

  const stamp =
    typeof raw.reopensAt === "number" && Number.isFinite(raw.reopensAt) && raw.reopensAt > 0
      ? raw.reopensAt
      : undefined;

  // See the note above: dropped when writing, kept when reading.
  const reopensAt = dropExpired && stamp && stamp <= Date.now() ? undefined : stamp;

  return {
    state,
    reason,
    ...(en || ar ? { message: { en, ar } } : {}),
    ...(reopensAt ? { reopensAt } : {}),
  };
}
