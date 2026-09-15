import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { withComputedPaths } from "@/lib/categories";
import { revalidateNavigation } from "@/lib/revalidate";
import { slugify } from "@/lib/utils";
import type { Category, Localized, ProductImage } from "@/types";

/**
 * Category writes.
 *
 * The tree is stored flat — each node carries a `parentId` and a denormalised
 * `path` — so a write is not just a document update. Reparenting a category
 * changes the ancestry of everything beneath it *and* the `categoryPath` on
 * every product filed under any of them, and those are what listings filter
 * on. Doing half of that leaves products unreachable from their own
 * department, so the whole cascade runs in one batch.
 */

interface Body {
  id?: string;
  slug?: string;
  name?: Localized;
  description?: Localized | null;
  parentId?: string | null;
  image?: ProductImage | null;
  order?: number;
  featured?: boolean;
  showInNav?: boolean;
  hidden?: boolean;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function localized(value: Localized | undefined | null, field: string): Localized | null {
  if (!value) return null;
  if (typeof value.en !== "string" || typeof value.ar !== "string") return null;
  if (!value.en.trim() || !value.ar.trim()) {
    throw new Error(`${field} is required in both English and Arabic.`);
  }
  return { en: value.en.trim(), ar: value.ar.trim() };
}

function image(value: ProductImage | null | undefined): ProductImage | undefined {
  if (!value || typeof value.url !== "string") return undefined;
  const ok =
    value.url.startsWith("/demo/") ||
    value.url.includes("firebasestorage.googleapis.com") ||
    value.url.includes(".firebasestorage.app");
  if (!ok) return undefined;
  return {
    url: value.url,
    alt: typeof value.alt === "string" ? value.alt.trim().slice(0, 300) : "",
    width: Number.isFinite(Number(value.width)) ? Math.round(Number(value.width)) : 400,
    height: Number.isFinite(Number(value.height)) ? Math.round(Number(value.height)) : 520,
  };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request body.");
  }

  let name: Localized | null;
  let description: Localized | null;
  try {
    name = localized(body.name, "Name");
    description = body.description ? localized(body.description, "Description") : null;
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Invalid text.");
  }
  if (!name) return bad("A name is required in both languages.");

  const slug = slugify(body.slug ?? name.en);
  if (!slug) return bad("A usable slug is required.");

  const parentId = body.parentId ? String(body.parentId) : null;

  const payload = {
    slug,
    name,
    ...(description ? { description } : {}),
    parentId,
    ...(image(body.image) ? { image: image(body.image) } : {}),
    order: Math.max(0, Math.floor(Number(body.order ?? 0))),
    featured: body.featured === true,
    showInNav: body.showInNav !== false,
    hidden: body.hidden === true,
    updatedAt: new Date(),
  };

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false, validated: payload });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to edit categories.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();

    const snap = await db.collection("categories").get();
    const existing = snap.docs.map((d) => ({ ...(d.data() as Category), id: d.id }));

    const id = body.id ?? slug;

    /*
     * A cycle would make the tree infinite, and the guard has to look at
     * *descendants*, not just the direct parent: setting Outerwear's parent to
     * Coats is only wrong because Coats is already beneath it.
     */
    if (parentId) {
      if (parentId === id) return bad("A category cannot be its own parent.");
      const descendants = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const c of existing) {
          if (c.parentId && descendants.has(c.parentId) && !descendants.has(c.id)) {
            descendants.add(c.id);
            grew = true;
          }
        }
      }
      if (descendants.has(parentId)) {
        return bad("That would put the category inside one of its own subcategories.");
      }
    }

    // A slug is a public URL; two categories sharing one is a broken link.
    const clash = existing.find((c) => c.slug === slug && c.id !== id);
    if (clash) return bad(`The slug "${slug}" is already used by another category.`);

    /*
     * Recompute the whole tree's paths, then write back only what changed.
     * Cheap at this size, and correct by construction — the alternative is
     * walking upward from the edited node and hoping nothing else moved.
     */
    const merged = [
      // `path` and `depth` are stripped because they are about to be
      // recomputed for the whole tree; keeping the stale ones would let an
      // old ancestry win the merge.
      ...existing.filter((c) => c.id !== id).map((c) => {
        const rest = { ...c } as Partial<Category>;
        delete rest.path;
        delete rest.depth;
        return rest;
      }),
      { ...payload, id },
    ];
    const recomputed = withComputedPaths(merged as Omit<Category, "path" | "depth">[]);

    const batch = db.batch();
    for (const category of recomputed) {
      const before = existing.find((c) => c.id === category.id);
      const changed =
        category.id === id ||
        before?.path?.join("/") !== category.path.join("/") ||
        before?.depth !== category.depth;
      if (!changed) continue;

      batch.set(
        db.collection("categories").doc(category.id),
        {
          ...(category.id === id ? payload : {}),
          path: category.path,
          depth: category.depth,
          ...(before ? {} : { createdAt: new Date(), productCount: 0 }),
        },
        { merge: true },
      );
    }

    /*
     * Products carry their own denormalised ancestry, and it is what a listing
     * filtered on a department matches against. Leaving it stale after a
     * reparent is how a product vanishes from the very department it was just
     * moved into.
     */
    const byId = new Map(recomputed.map((c) => [c.id, c]));
    const moved = new Set(
      recomputed
        .filter((c) => {
          const before = existing.find((e) => e.id === c.id);
          return !before || before.path?.join("/") !== c.path.join("/");
        })
        .map((c) => c.id),
    );

    if (moved.size > 0) {
      const products = await db.collection("products").get();
      for (const doc of products.docs) {
        const categoryId = String(doc.data().categoryId ?? "");
        if (!moved.has(categoryId)) continue;
        const node = byId.get(categoryId);
        if (!node) continue;
        batch.update(doc.ref, { categoryPath: node.path });
      }
    }

    await batch.commit();

    await db.collection("auditLog").add({
      action: body.id ? "category.update" : "category.create",
      categoryId: id,
      slug,
      parentId,
      repathed: moved.size,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    revalidateNavigation();
    return NextResponse.json({ ok: true, persisted: true, id, repathed: moved.size });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The category could not be saved.", 500);
  }
}

/**
 * Reorder and visibility, in bulk.
 *
 * Dragging a list into a new order produces one change per row; sending them
 * one at a time means a half-applied order if the third request fails.
 */
export async function PATCH(request: Request) {
  let body: { updates?: { id: string; order?: number; hidden?: boolean; showInNav?: boolean }[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("Malformed request body.");
  }

  const updates = Array.isArray(body.updates) ? body.updates.slice(0, 200) : [];
  if (updates.length === 0) return bad("Nothing to change.");

  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, persisted: false, validated: updates });
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account does not have permission to edit categories.", 403);
  }

  try {
    const { getAdminDb } = await import("@/lib/firebase/admin");
    const db = getAdminDb();
    const batch = db.batch();

    for (const update of updates) {
      if (!update?.id) continue;
      batch.update(db.collection("categories").doc(String(update.id)), {
        ...(update.order === undefined ? {} : { order: Math.max(0, Math.floor(Number(update.order))) }),
        ...(update.hidden === undefined ? {} : { hidden: update.hidden === true }),
        ...(update.showInNav === undefined ? {} : { showInNav: update.showInNav === true }),
        updatedAt: new Date(),
      });
    }

    await batch.commit();

    await db.collection("auditLog").add({
      action: "category.bulk",
      count: updates.length,
      actorUid: caller.uid,
      actorEmail: caller.email,
      at: new Date(),
    });

    revalidateNavigation();
    return NextResponse.json({ ok: true, persisted: true, count: updates.length });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "The categories could not be updated.", 500);
  }
}
