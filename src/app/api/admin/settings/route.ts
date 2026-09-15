import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { revalidateAll } from "@/lib/revalidate";
import type { StoreSettings } from "@/data/site-content";

/**
 * Store settings.
 *
 * One document, `settings/store`, holding the facts that appear in sentences
 * all over the shop: the free-delivery threshold, the return window, the
 * contact details, the social links.
 *
 * Every one of them is a **promise to a customer**, which is why this route
 * validates rather than stores what it is handed. A threshold of -50 would
 * render as "free delivery over -50 JOD"; a `javascript:` social href would be
 * a stored XSS in the footer of every page.
 */

interface Body {
  freeShippingThreshold?: number;
  returnWindowDays?: number;
  standardDeliveryDays?: [number, number];
  contact?: StoreSettings["contact"];
  social?: { label: string; href: string }[];
  legal?: StoreSettings["legal"];
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function localized(value: unknown, field: string) {
  const v = value as { en?: unknown; ar?: unknown } | undefined;
  const en = typeof v?.en === "string" ? v.en.trim() : "";
  const ar = typeof v?.ar === "string" ? v.ar.trim() : "";
  // Both languages or neither — the shop is bilingual, and a field filled in
  // one language renders as a gap on the other site.
  if (!en || !ar) throw new Error(`${field} is required in both English and Arabic.`);
  return { en: en.slice(0, 300), ar: ar.slice(0, 300) };
}

function positive(value: unknown, field: string, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) {
    throw new Error(`${field} must be between 0 and ${max}.`);
  }
  return Math.round(n * 1000) / 1000;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  let payload: StoreSettings;
  try {
    const min = positive(body.standardDeliveryDays?.[0], "Fastest delivery day", 60);
    const max = positive(body.standardDeliveryDays?.[1], "Slowest delivery day", 60);
    if (min > max) {
      // Quoting "5–3 days" is the kind of thing nobody notices in an admin
      // form and everybody notices on a product page.
      return bad("The fastest delivery day cannot be later than the slowest.");
    }

    const email = String(body.contact?.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return bad("The contact email does not look like an address.");
    }

    const phone = String(body.contact?.phone ?? "").trim();
    if (phone.length < 6) return bad("The contact phone number is too short to dial.");

    const social = Array.isArray(body.social)
      ? body.social
          .filter((link) => link && String(link.label).trim() && String(link.href).trim())
          .map((link) => ({ label: String(link.label).trim().slice(0, 40), href: String(link.href).trim() }))
          .slice(0, 8)
      : [];

    /*
     * http(s) only. A `javascript:` or `data:` href here would be rendered as
     * a link in the footer of every page on the site — a stored XSS that
     * arrived through a form the merchant trusts.
     */
    const badLink = social.find((link) => !/^https?:\/\//i.test(link.href));
    if (badLink) {
      return bad(`"${badLink.label}" must be a full http(s) link.`);
    }

    const whatsapp = String(body.contact?.whatsapp ?? "").trim();

    payload = {
      freeShippingThreshold: positive(body.freeShippingThreshold, "Free delivery threshold", 100000),
      returnWindowDays: Math.round(positive(body.returnWindowDays, "Return window", 365)),
      standardDeliveryDays: [Math.round(min), Math.round(max)],
      contact: {
        email,
        phone: phone.slice(0, 40),
        ...(whatsapp ? { whatsapp: whatsapp.slice(0, 40) } : {}),
        hours: localized(body.contact?.hours, "Opening hours"),
        address: localized(body.contact?.address, "Address"),
      },
      social,
      legal: {
        tradingName: String(body.legal?.tradingName ?? "").trim().slice(0, 120) || "net sale",
        country: localized(body.legal?.country, "Country"),
      },
    };
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Those settings are not valid.");
  }

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false, validated: payload });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  // Settings are shop-wide promises, so they are admin-only — staff can edit
  // a product, but the return window is a policy decision.
  if (caller.role !== "admin") {
    return bad("Only an administrator can change store settings.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    await db.collection("settings").doc("store").set(payload, { merge: true });

    await db.collection("auditLog").add({
      action: "settings.update",
      // The values themselves, so a "who changed the free-delivery threshold"
      // question has an answer without a database archaeology session.
      freeShippingThreshold: payload.freeShippingThreshold,
      returnWindowDays: payload.returnWindowDays,
      contactEmail: payload.contact.email,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    // Every page composes a sentence from these, so every page is stale.
    revalidateAll();

    return NextResponse.json({ ok: true, persisted: true });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Settings could not be saved.", 500);
  }
}
