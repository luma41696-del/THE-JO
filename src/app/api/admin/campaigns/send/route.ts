import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { notifyStatus, send } from "@/lib/notify/provider";
import { unsubscribeLink, unsubscribeStatus } from "@/lib/email/unsubscribe";
import { buildCampaignEmail, type CampaignDraft } from "@/lib/email/campaign-email";
import { RULES, callerKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import {
  isPlausibleEmail,
  normaliseEmail,
  resolveAudience,
  type Recipient,
  type SegmentId,
} from "@/lib/admin/campaign-audience";
import { readSegment, readSuppressed } from "@/lib/admin/campaign-audience.server";
import type { Locale } from "@/types";

/**
 * Send a campaign.
 *
 * The one route in this feature that spends money and reaches real people, so
 * it is the one with the most refusals in front of it.
 *
 * ## What it refuses, and why each one
 *
 *  - **Not an administrator.** Staff run the shop; a message to every customer
 *    is not a shop operation.
 *  - **No `CAMPAIGN_SECRET`.** Without it there is no unsubscribe link, and
 *    `buildCampaignEmail` will not produce an email at all. Checked here too
 *    so the answer is a sentence naming the variable rather than "0 sent".
 *  - **No mail provider.** Nothing would leave. Said plainly instead of
 *    reporting a successful send of nothing.
 *  - **More than one group per request.** A campaign to a thousand people is
 *    many requests, in turn, with the progress shown — one request would be
 *    killed by a function timeout partway through, and a timeout is the one
 *    failure that cannot say who was already emailed.
 *
 * ## Test sends go to one address and skip the audience entirely
 *
 * `test: true` sends to the address the operator typed, and reads no customer
 * data at all — not the segment, not the suppression list. Trying a draft
 * should never be one mistyped field away from mailing the shop's customers.
 *
 * ## What is recorded
 *
 * One `campaignSends` document per run, holding the draft, the segment, the
 * counts and the failures — not the addresses. The question afterwards is
 * "what went out, to how many, and what bounced", and keeping a copy of the
 * customer list on every campaign answers none of it while doubling the
 * places that list exists.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recipients per request.
 *
 * Sized for the provider's own pace and the platform's function timeout rather
 * than for the shop: at roughly a request each, fifty is a few seconds.
 */
const GROUP = 50;

/** Messages in flight at once. Polite to the provider, quick enough. */
const CONCURRENCY = 5;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

interface Body {
  draft?: Partial<CampaignDraft>;
  segment?: SegmentId;
  /** Send one copy to this address and stop. */
  test?: boolean;
  testTo?: string;
  /** Recipients already done in this run, so the next group skips them. */
  offset?: number;
}

function readDraft(input: Partial<CampaignDraft> | undefined): CampaignDraft | null {
  const draft = input ?? {};
  const subject = (draft.subject ?? "").trim();
  const heading = (draft.heading ?? "").trim();
  if (!subject || !heading) return null;

  return {
    subject,
    preheader: draft.preheader?.trim(),
    heading,
    body: draft.body ?? "",
    ctaLabel: draft.ctaLabel?.trim(),
    ctaUrl: draft.ctaUrl?.trim(),
    heroUrl: draft.heroUrl?.trim(),
    products: draft.products ?? [],
    locale: draft.locale === "en" ? "en" : "ar",
  };
}

interface Outcome {
  email: string;
  ok: boolean;
  error?: string;
}

/** Send to one group, a few at a time, and report each one. */
async function deliver(draft: CampaignDraft, recipients: Recipient[]): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];

  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    const slice = recipients.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      slice.map(async (recipient): Promise<Outcome> => {
        /*
         * The recipient's own language, not the draft's, when they have one.
         * A customer who set the shop to Arabic gets the Arabic greeting even
         * if the campaign was written in the English tab.
         */
        const locale: Locale = recipient.locale ?? draft.locale;
        const link = unsubscribeLink(recipient.email, locale);

        const email = buildCampaignEmail(
          { ...draft, locale },
          { email: recipient.email, name: recipient.name, unsubscribeUrl: link },
        );
        if (!email) {
          return { email: recipient.email, ok: false, error: "No unsubscribe link could be made." };
        }

        const result = await send({
          to: recipient.email,
          subject: email.subject,
          body: email.text,
          html: email.html,
          locale,
        });

        return result.ok
          ? { email: recipient.email, ok: true }
          : { email: recipient.email, ok: false, error: result.error };
      }),
    );
    outcomes.push(...settled);
  }

  return outcomes;
}

export async function POST(request: Request) {
  const limit = await rateLimit(`campaign-send:${callerKey(request)}`, RULES.messaging);
  if (!limit.ok) return tooManyRequests(limit);

  if (!isAdminConfigured()) return bad("Firebase Admin is not configured here.", 503);
  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin") {
    return bad("Only an administrator can send a campaign.", 403);
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  const draft = readDraft(body.draft);
  if (!draft) return bad("A subject and a heading are needed before this can be sent.");

  const provider = notifyStatus();
  if (!provider.configured) {
    return bad(`No mail provider configured (missing ${provider.missing.join(", ")}).`, 503);
  }

  const unsubscribe = unsubscribeStatus();
  if (!unsubscribe.ready) {
    return bad(
      `A campaign needs a working unsubscribe link (missing ${unsubscribe.missing.join(", ")}).`,
      503,
    );
  }

  /* ---- a test send touches no customer data ---------------------------- */

  if (body.test) {
    const to = normaliseEmail(body.testTo ?? "");
    if (!isPlausibleEmail(to)) return bad("Enter an address to send the test to.");

    const [outcome] = await deliver(draft, [
      { email: to, locale: draft.locale, source: "account" },
    ]);

    if (!outcome?.ok) return bad(outcome?.error ?? "The test could not be sent.", 502);
    return NextResponse.json({ ok: true, test: true, sent: 1 });
  }

  /* ---- the real thing --------------------------------------------------- */

  const segment: SegmentId =
    body.segment === "subscribers" || body.segment === "all-customers"
      ? body.segment
      : "opted-in";

  const { getAdminDb } = await import("@/lib/firebase/admin");
  const db = getAdminDb();

  const [candidates, suppressed] = await Promise.all([
    readSegment(db, segment),
    readSuppressed(db),
  ]);

  /*
   * Resolved fresh on every group rather than carried in the request. A list
   * the client sent back could have been edited, and somebody who unsubscribed
   * between the first group and the fourth must not be in the fourth.
   */
  const { recipients } = resolveAudience(candidates, suppressed);
  if (recipients.length === 0) return bad("Nobody in that group can be emailed.", 400);

  const offset = Math.max(0, Math.floor(body.offset ?? 0));
  const group = recipients.slice(offset, offset + GROUP);
  if (group.length === 0) {
    return NextResponse.json({ ok: true, done: true, total: recipients.length, sent: 0, failed: [] });
  }

  const outcomes = await deliver(draft, group);
  const sent = outcomes.filter((outcome) => outcome.ok).length;
  const failed = outcomes.filter((outcome) => !outcome.ok);
  const done = offset + group.length >= recipients.length;

  try {
    await db.collection("campaignSends").add({
      subject: draft.subject,
      heading: draft.heading,
      locale: draft.locale,
      segment,
      offset,
      requested: group.length,
      sent,
      failed: failed.length,
      // The provider's own words, kept for the operator. No addresses.
      errors: [...new Set(failed.map((failure) => failure.error ?? "unknown"))].slice(0, 5),
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });
  } catch (error) {
    // The send already happened. Failing to write the log must not report it
    // as a failure — that would invite a retry that emails everybody twice.
    console.error("[net sale] campaign send could not be recorded:", error);
  }

  return NextResponse.json({
    ok: true,
    total: recipients.length,
    offset,
    sent,
    /* Addresses are returned here and nowhere persisted: the operator needs to
       know which ones bounced to do anything about them. */
    failed,
    nextOffset: done ? null : offset + group.length,
    done,
  });
}
