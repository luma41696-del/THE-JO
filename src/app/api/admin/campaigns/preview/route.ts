import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { buildCampaignEmail, type CampaignDraft } from "@/lib/email/campaign-email";
import { absoluteUrl } from "@/lib/site";
import type { Locale } from "@/types";

/**
 * Render a campaign without sending it.
 *
 * Pure rendering behind an admin check, so the composer can show the real
 * email — the same builder, the same escaping, the same layout — while the
 * draft is still being written. A preview produced by different code from the
 * send is a preview of nothing.
 *
 * ## The unsubscribe link here is a sample
 *
 * A real one is signed for a real address. Nobody is being emailed, so this
 * uses a clearly-marked placeholder rather than minting a working token for an
 * address the operator typed into a preview box — a signed link is a
 * credential, and it should be created where it is used and nowhere else.
 *
 * That has a consequence worth stating: **the preview works even when
 * `CAMPAIGN_SECRET` is missing**, and the send does not. The composer asks the
 * audience endpoint whether a send is possible; it does not infer it from a
 * preview having rendered.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE_UNSUBSCRIBE = absoluteUrl("ar/unsubscribe?e=sample%40example.com&t=preview");

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Firebase Admin is not configured here." },
      { status: 503 },
    );
  }
  const caller = await verifyRequest(request);
  if (!caller) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (caller.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Only an administrator can send a campaign." },
      { status: 403 },
    );
  }

  let body: { draft?: Partial<CampaignDraft>; name?: string };
  try {
    body = (await request.json()) as { draft?: Partial<CampaignDraft>; name?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request body." }, { status: 400 });
  }

  const draft = body.draft ?? {};
  const locale: Locale = draft.locale === "en" ? "en" : "ar";

  const email = buildCampaignEmail(
    {
      subject: draft.subject ?? "",
      preheader: draft.preheader,
      heading: draft.heading ?? "",
      body: draft.body ?? "",
      ctaLabel: draft.ctaLabel,
      ctaUrl: draft.ctaUrl,
      heroUrl: draft.heroUrl,
      products: draft.products ?? [],
      locale,
    },
    {
      email: "sample@example.com",
      name: body.name ?? "",
      unsubscribeUrl: SAMPLE_UNSUBSCRIBE,
    },
  );

  if (!email) {
    // The builder refuses an empty subject or heading. Saying which is missing
    // is more use than "could not render".
    return NextResponse.json(
      { ok: false, error: "A subject and a heading are needed before this can be previewed." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, ...email, sampleUnsubscribe: true });
}
