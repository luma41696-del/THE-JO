import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { revalidateAll } from "@/lib/revalidate";
import { slugify } from "@/lib/utils";
import type { Localized, ShippingMethod, ShippingZone } from "@/types";

/**
 * Delivery methods and zones.
 *
 * A method is *how* — standard, express, pickup. A zone is *where* — Amman is
 * next door, Aqaba is four hours of road. Keeping them apart is what lets a
 * shop charge express-to-Aqaba without inventing a fourth method, and it is
 * why they share one route: a merchant editing carriage is thinking about one
 * table, not two screens.
 *
 * Everything here decides what a customer is charged, so nothing is stored as
 * sent. A negative surcharge would pay people to order; an unbounded one would
 * quietly eat a basket.
 */

interface Body {
  methods?: ShippingMethod[];
  zones?: ShippingZone[];
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function localized(value: unknown, field: string): Localized {
  const v = value as { en?: unknown; ar?: unknown } | undefined;
  const en = typeof v?.en === "string" ? v.en.trim() : "";
  const ar = typeof v?.ar === "string" ? v.ar.trim() : "";
  if (!en || !ar) throw new Error(`${field} needs a name in both English and Arabic.`);
  return { en: en.slice(0, 80), ar: ar.slice(0, 80) };
}

function amount(value: unknown, field: string, max = 1000): number {
  const n = Number(value ?? 0);
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

  let methods: ShippingMethod[] = [];
  let zones: ShippingZone[] = [];

  try {
    methods = (Array.isArray(body.methods) ? body.methods : []).slice(0, 12).map((m) => {
      const min = Math.round(amount(m.minDays, "Fastest day", 90));
      const max = Math.round(amount(m.maxDays, "Slowest day", 90));
      if (min > max) {
        throw new Error(`"${m.name?.en ?? m.id}" cannot arrive before it is sent.`);
      }
      return {
        id: slugify(String(m.id ?? m.name?.en ?? "")) || "method",
        speed: m.speed,
        name: localized(m.name, "Delivery method"),
        ...(m.description ? { description: localized(m.description, "Description") } : {}),
        price: amount(m.price, "Price", 10000),
        minDays: min,
        maxDays: max,
        ...(m.freeAbove === undefined || m.freeAbove === null
          ? {}
          : { freeAbove: amount(m.freeAbove, "Free above", 100000) }),
        ...(m.classPriceOverrides ? { classPriceOverrides: m.classPriceOverrides } : {}),
      } satisfies ShippingMethod;
    });

    zones = (Array.isArray(body.zones) ? body.zones : []).slice(0, 60).map((z, index) => {
      /*
       * Areas are stored trimmed but **not** lower-cased: they are shown back
       * to the merchant in this form, and a table that silently rewrites
       * "Amman" as "amman" reads as a bug. `zoneFor` folds case when matching.
       */
      const areas = (Array.isArray(z.areas) ? z.areas : [])
        .map((a) => String(a).trim())
        .filter(Boolean)
        .slice(0, 80);

      return {
        id: slugify(String(z.id ?? z.name?.en ?? "")) || `zone-${index + 1}`,
        name: localized(z.name, "Zone"),
        areas,
        surcharge: amount(z.surcharge, "Zone surcharge"),
        ...(z.freeAbove === undefined || z.freeAbove === null
          ? {}
          : { freeAbove: amount(z.freeAbove, "Zone free-delivery threshold", 100000) }),
        ...(z.excluded ? { excluded: true } : {}),
        ...(z.extraDays ? { extraDays: Math.round(amount(z.extraDays, "Extra days", 60)) } : {}),
        order: index,
      } satisfies ShippingZone;
    });

    /*
     * One area may belong to one zone. Two zones claiming "Amman" would make
     * the charge depend on document order, which is not a rule anybody could
     * explain to a customer who was charged the higher one.
     */
    const seen = new Map<string, string>();
    for (const zone of zones) {
      for (const area of zone.areas) {
        const key = area.toLowerCase();
        const owner = seen.get(key);
        if (owner && owner !== zone.id) {
          return bad(`"${area}" is listed in both ${owner} and ${zone.id}.`);
        }
        seen.set(key, zone.id);
      }
    }
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Those rates are not valid.");
  }

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false, validated: { methods, zones } });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin") {
    return bad("Only an administrator can change delivery rates.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const batch = db.batch();

    /*
     * Deleted rows are really deleted. A zone removed from the form but left
     * in the database would keep charging for an area the merchant believes
     * they stopped serving.
     */
    for (const [name, rows] of [
      ["shippingMethods", methods],
      ["shippingZones", zones],
    ] as const) {
      const existing = await db.collection(name).get();
      const keep = new Set(rows.map((r) => r.id));
      for (const doc of existing.docs) {
        if (!keep.has(doc.id)) batch.delete(doc.ref);
      }
      for (const row of rows) {
        batch.set(db.collection(name).doc(row.id), row);
      }
    }

    await batch.commit();

    await db.collection("auditLog").add({
      action: "shipping.update",
      methods: methods.length,
      zones: zones.length,
      excludedZones: zones.filter((z) => z.excluded).map((z) => z.id),
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    revalidateAll();
    return NextResponse.json({ ok: true, persisted: true });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Rates could not be saved.", 500);
  }
}
