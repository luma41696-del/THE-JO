/**
 * Category tree.
 *
 * Firestore stores categories flat, each with a `parentId` and a denormalised
 * `path`. That is the right storage shape — a document read never has to walk
 * a tree — but every piece of UI wants the nested shape instead. These helpers
 * are the one place the flat list becomes a tree, so the nav, the category
 * page, the breadcrumb and the shop filter all agree on ordering and depth.
 */

import type { Category, CategoryNode, Locale, Product } from "@/types";

/* -------------------------------------------------------------------------- */
/*  Building                                                                  */
/* -------------------------------------------------------------------------- */

function byOrder(a: Category, b: Category) {
  return a.order - b.order || a.id.localeCompare(b.id);
}

/**
 * Nest a flat list into a tree.
 *
 * A category whose `parentId` names a category that is not in the list is
 * promoted to the root rather than dropped. Losing a whole department because
 * its parent was archived is a far worse failure than showing it one level too
 * high, and an orphan is otherwise invisible and very hard to notice.
 */
export function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const c of categories) byId.set(c.id, { ...c, children: [] });

  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortDeep = (nodes: CategoryNode[]) => {
    nodes.sort(byOrder);
    for (const n of nodes) sortDeep(n.children);
  };
  sortDeep(roots);

  return roots;
}

/** Top-level departments only. */
export function rootCategories(categories: Category[]): Category[] {
  return categories.filter((c) => !c.parentId).sort(byOrder);
}

/** Direct children of one category. */
export function childrenOf(categories: Category[], parentId: string): Category[] {
  return categories.filter((c) => c.parentId === parentId).sort(byOrder);
}

/**
 * A category and everything beneath it, as ids.
 *
 * Uses the denormalised `path`, so it is one pass regardless of depth and
 * cannot loop on a cycle — which a parent-pointer walk can, if an admin ever
 * sets a category's parent to its own child.
 */
export function descendantIds(categories: Category[], rootId: string): string[] {
  return categories.filter((c) => c.id === rootId || c.path.includes(rootId)).map((c) => c.id);
}

/** Root-first ancestry including the category itself — the breadcrumb trail. */
export function categoryTrail(categories: Category[], categoryId: string): Category[] {
  const target = categories.find((c) => c.id === categoryId);
  if (!target) return [];
  const byId = new Map(categories.map((c) => [c.id, c]));
  return target.path
    .map((id) => byId.get(id))
    .filter((c): c is Category => Boolean(c));
}

/* -------------------------------------------------------------------------- */
/*  Writing the denormalised fields                                           */
/* -------------------------------------------------------------------------- */

/**
 * Compute `path` and `depth` for every category from its `parentId`.
 *
 * Run this whenever the tree is edited. It is also the guard against a cycle:
 * a chain longer than the category count means a loop, and the walk stops
 * rather than hanging the request.
 */
export function withComputedPaths(
  categories: Omit<Category, "path" | "depth">[],
): Category[] {
  const byId = new Map(categories.map((c) => [c.id, c]));

  return categories.map((c) => {
    const path: string[] = [];
    let cursor: (typeof categories)[number] | undefined = c;
    let guard = 0;

    while (cursor && guard < categories.length + 1) {
      path.unshift(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      guard += 1;
    }

    return { ...c, path, depth: path.length - 1 };
  });
}

/**
 * The `categoryPath` to stamp on a product, so a query for a department
 * matches everything filed under its subcategories.
 */
export function categoryPathFor(categories: Category[], categoryId: string): string[] {
  const category = categories.find((c) => c.id === categoryId);
  return category ? category.path : [categoryId];
}

/* -------------------------------------------------------------------------- */
/*  Counting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Product counts that roll up: a department reports everything in its
 * subcategories, not just products filed directly against it — which, in a
 * well-run catalogue, is usually none.
 */
export function withRolledUpCounts(categories: Category[], products: Product[]): Category[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    if (product.status !== "active") continue;
    // Increment every ancestor, which `categoryPath` already enumerates.
    for (const id of product.categoryPath) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return categories.map((c) => ({ ...c, productCount: counts.get(c.id) ?? 0 }));
}

/* -------------------------------------------------------------------------- */
/*  Display                                                                   */
/* -------------------------------------------------------------------------- */

/** "Outerwear / Coats" — for admin tables and search results. */
export function categoryLabel(
  categories: Category[],
  categoryId: string,
  locale: Locale,
): string {
  const trail = categoryTrail(categories, categoryId);
  if (trail.length === 0) return categoryId;
  return trail.map((c) => c.name[locale]).join(" / ");
}
