const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

/**
 * Deleting products for good — one, or a whole selection.
 *
 * A product is not one document. It is a row, a set of files, its reviews, its
 * stock alerts, an entry in collections, a line in other products' upsell
 * lists and an id in strangers' wishlists. What is pinned here is that all of
 * those go, that **orders do not**, and that a photograph another product
 * still uses is left alone.
 *
 * The batch has its own failure worth pinning, and it is the reason the
 * planning function is plural: two products sharing an image, deleted
 * together, must not each keep it "because the other one uses it".
 *
 * Run with:
 *
 *     npm run test:product-delete
 */

function loadTs(relative, mocks, cache = new Map()) {
  const filename = path.resolve(__dirname, "..", relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith("@/")) return loadTs(`src/${name.slice(2)}.ts`, mocks, cache);
    if (name.startsWith(".")) {
      return loadTs(path.resolve(path.dirname(filename), `${name}.ts`), mocks, cache);
    }
    return require(name);
  };
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
  return module.exports;
}

const url = (file) => `https://firebasestorage.googleapis.com/v0/b/b/o/products%2F${file}?alt=media`;
const SHARED = url("shared.jpg");
const OWN = url("coat-1.jpg");
const DEMO = "/demo/coat.svg";

const COAT = {
  id: "coat",
  slug: "atelier-wool-coat",
  title: { en: "Atelier Wool Coat", ar: "معطف" },
  images: [{ url: OWN }, { url: SHARED }, { url: DEMO }],
  designs: [],
  upsellIds: [],
  crossSellIds: [],
};

/**
 * A Firestore and a Storage bucket, close enough to the real ones' *shapes*
 * that the route's queries mean what they mean in production.
 *
 * `in` and `array-contains-any` are honoured rather than ignored: a harness
 * that returns everything for every query would pass a route that filed every
 * review under the wrong product.
 */
function harness({
  role = "admin",
  products = [],
  collections = [],
  wishlists = [],
  reviews = [{ id: "r1", productId: "coat" }],
  alerts = [{ id: "a1", productId: "coat" }],
  orders = [],
  failOn = null,
} = {}) {
  const done = { deleted: [], arrayRemoves: [], filesDeleted: [], audits: [], revalidated: 0 };

  const catalogue = [COAT, ...products];
  const byId = new Map(catalogue.map((product) => [product.id, product]));

  const rows = {
    products: catalogue.map((product) => ({ id: product.id, data: () => product })),
    reviews: reviews.map((row) => ({ id: row.id, ref: { id: row.id }, data: () => row })),
    stockAlerts: alerts.map((row) => ({ id: row.id, ref: { id: row.id }, data: () => row })),
    collections: collections.map((row) =>
      typeof row === "string"
        ? { id: row, ref: { id: row }, data: () => ({ productIds: ["coat"] }) }
        : { id: row.id, ref: { id: row.id }, data: () => row },
    ),
    users: wishlists.map((row) =>
      typeof row === "string"
        ? { id: row, ref: { id: row }, data: () => ({ wishlist: ["coat"] }) }
        : { id: row.id, ref: { id: row.id }, data: () => row },
    ),
    orders: orders.map((items, i) => ({ id: `o${i}`, data: () => ({ items }) })),
    auditLog: [],
    media: [],
  };

  // The three filters the route actually uses, applied for real.
  function matches(doc, filters) {
    return filters.every(([field, op, value]) => {
      const data = doc.data();
      if (op === "in") return value.includes(data[field]);
      if (op === "array-contains-any") {
        return (data[field] ?? []).some((entry) => value.includes(entry));
      }
      if (op === "array-contains") return (data[field] ?? []).includes(value);
      return data[field] === value;
    });
  }

  const db = {
    collection: (name) => {
      const build = (filters) => ({
        doc: (id) => ({
          id,
          get: async () => ({
            exists: name === "products" && byId.has(id),
            id,
            data: () => (name === "products" ? byId.get(id) : {}),
          }),
          delete: async () => {
            if (name === "products" && id === failOn) throw new Error("Storage is unreachable.");
            done.deleted.push(`${name}/${id}`);
          },
        }),
        where: (...filter) => build([...filters, filter]),
        limit: () => build(filters),
        get: async () => {
          const docs = (rows[name] ?? []).filter((doc) => matches(doc, filters));
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
        add: async (row) => done.audits.push(row),
      });
      return build([]);
    },
    batch: () => ({
      delete: (ref) => done.deleted.push(ref.id),
      set: (ref, data) => done.arrayRemoves.push({ id: ref.id, fields: Object.keys(data) }),
      commit: async () => {},
    }),
  };

  const route = loadTs("src/app/api/admin/products/delete/route.ts", {
    "@/lib/firebase/admin": {
      isAdminConfigured: () => true,
      verifyRequest: async () => (role ? { uid: "bossxyz", email: "b@x.com", role } : null),
      getAdminDb: () => db,
      getAdminApp: () => ({}),
    },
    "firebase-admin/storage": {
      getStorage: () => ({
        bucket: () => ({
          file: (p) => ({
            delete: async () => {
              done.filesDeleted.push(p);
            },
          }),
        }),
      }),
    },
    "@/lib/revalidate": {
      revalidateAll: () => {
        done.revalidated += 1;
      },
    },
    "@/lib/security/rate-limit": {
      RULES: { content: { limit: 20, windowSeconds: 300 } },
      callerKey: () => "ip:test",
      rateLimit: async () => ({ ok: true, remaining: 20, retryAfter: 0 }),
      tooManyRequests: () => new Response("{}", { status: 429 }),
    },
    "server-only": {},
  });

  const endpoint = "https://netsale.shop/api/admin/products/delete";
  const post = async (body) => {
    const r = await route.POST(
      new Request(endpoint, { method: "POST", body: JSON.stringify(body) }),
    );
    return { status: r.status, body: await r.json() };
  };

  return {
    done,
    plan: async (id = "coat") => {
      const r = await route.GET(new Request(`${endpoint}?id=${id}`));
      return { status: r.status, body: await r.json() };
    },
    remove: async (id = "coat") => {
      const r = await route.DELETE(new Request(`${endpoint}?id=${id}`, { method: "DELETE" }));
      return { status: r.status, body: await r.json() };
    },
    preview: (ids) => post({ ids, preview: true }),
    removeMany: (ids) => post({ ids }),
  };
}

/* -------------------------------------------------------------------------- */
/*  One product                                                                */
/* -------------------------------------------------------------------------- */

test("the plan is readable before anything is deleted", async () => {
  const h = harness();
  const result = await h.plan();

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(h.done.deleted.length, 0, "GET must not delete anything");
  assert.equal(h.done.filesDeleted.length, 0);
  assert.ok(result.body.summary.en.length > 0);
  assert.ok(result.body.summary.ar.length > 0);
});

/*
 * One photograph can sit on several products through the media library.
 * Removing a shared one leaves a hole on a live page that nobody notices
 * until a customer does.
 */
test("an image another product still uses is kept, and reported", async () => {
  const h = harness({ products: [{ id: "blazer", images: [{ url: SHARED }], designs: [] }] });
  const result = await h.plan();

  const kept = result.body.plan.filesKept.map((f) => f.path);
  assert.deepEqual(kept, ["products/shared.jpg"]);
  assert.deepEqual(result.body.plan.filesToDelete, ["products/coat-1.jpg"]);
  assert.deepEqual(result.body.plan.filesKept[0].usedBy, ["blazer"]);
});

test("a seeded demo asset is not counted as a file to delete", async () => {
  const h = harness();
  const result = await h.plan();
  // `/demo/…` has no object behind it, so "deleted" would be a claim about
  // nothing.
  assert.ok(!result.body.plan.filesToDelete.some((p) => p.includes("demo")));
});

test("deleting removes the product, its reviews, its alerts and its own files", async () => {
  const h = harness();
  const result = await h.remove();

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(h.done.deleted.includes("products/coat"), "the product row goes");
  assert.ok(h.done.deleted.includes("r1"), "its reviews go");
  assert.ok(h.done.deleted.includes("a1"), "its stock alerts go");
  // No other product uses either file here, so both go. The shared-image case
  // is covered above.
  assert.deepEqual(h.done.filesDeleted.sort(), ["products/coat-1.jpg", "products/shared.jpg"]);
  assert.equal(h.done.revalidated, 1, "cached pages are rebuilt");
});

test("another product's review is not swept up with this one's", async () => {
  const h = harness({
    products: [{ id: "scarf", images: [], designs: [] }],
    reviews: [
      { id: "r1", productId: "coat" },
      { id: "r-scarf", productId: "scarf" },
    ],
  });
  await h.remove();

  assert.ok(h.done.deleted.includes("r1"));
  assert.ok(!h.done.deleted.includes("r-scarf"), "the scarf keeps its review");
});

test("it is taken out of collections and wishlists rather than deleting them", async () => {
  const h = harness({ collections: ["autumn"], wishlists: ["u1", "u2"] });
  await h.remove();

  const touched = h.done.arrayRemoves.map((r) => r.id);
  assert.ok(touched.includes("autumn"));
  assert.ok(touched.includes("u1") && touched.includes("u2"));
  // The customer's wishlist document survives; only the id leaves it.
  assert.ok(!h.done.deleted.includes("u1"));
});

test("other products stop pointing at it", async () => {
  const h = harness({
    products: [{ id: "scarf", images: [], designs: [], upsellIds: ["coat"] }],
  });
  await h.remove();

  const scarf = h.done.arrayRemoves.find((r) => r.id === "scarf");
  assert.ok(scarf, "the linked product is updated");
  assert.deepEqual(scarf.fields.sort(), ["crossSellIds", "upsellIds"]);
});

/*
 * A cart line carries its own copy of the title, image, SKU and price. Orders
 * are accounting records, and a shop that erases the product out from under a
 * paid invoice has broken its own books to tidy a catalogue.
 */
test("past orders are counted and never touched", async () => {
  const h = harness({ orders: [[{ productId: "coat" }], [{ productId: "other" }]] });
  const result = await h.remove();

  assert.equal(result.body.plan.orderCount, 1);
  assert.ok(!h.done.deleted.some((d) => d.startsWith("orders/")), "no order is deleted");
  assert.ok(!h.done.arrayRemoves.some((r) => r.id.startsWith("o")), "and none is rewritten");
});

/* -------------------------------------------------------------------------- */
/*  A selection                                                                */
/* -------------------------------------------------------------------------- */

test("a preview of a selection deletes nothing and counts everything", async () => {
  const h = harness({
    products: [{ id: "blazer", slug: "blazer", images: [{ url: url("b.jpg") }], designs: [] }],
    reviews: [
      { id: "r1", productId: "coat" },
      { id: "r2", productId: "blazer" },
    ],
  });
  const result = await h.preview(["coat", "blazer"]);

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.count, 2);
  assert.equal(h.done.deleted.length, 0, "a preview must not delete");
  assert.equal(h.done.filesDeleted.length, 0);
  assert.deepEqual(result.body.plan.reviewIds.sort(), ["r1", "r2"]);
  assert.match(result.body.summary.en, /2 products/);
  assert.ok(result.body.summary.ar.length > 0);
});

/*
 * The batch's own bug, and the reason `buildPlans` is plural.
 *
 * Planned one at a time, each of these two products sees the *other* still
 * holding the shared photograph, so each keeps it — and the file outlives both
 * with nothing left pointing at it.
 */
test("an image shared by two products in the same selection is deleted, not kept", async () => {
  const h = harness({
    products: [{ id: "blazer", slug: "blazer", images: [{ url: SHARED }], designs: [] }],
  });

  const result = await h.preview(["coat", "blazer"]);
  assert.deepEqual(result.body.plan.filesKept, [], "nothing is left pointing at it");
  assert.ok(result.body.plan.filesToDelete.includes("products/shared.jpg"));

  await h.removeMany(["coat", "blazer"]);
  assert.ok(h.done.filesDeleted.includes("products/shared.jpg"), "and it actually goes");
});

test("an image shared with a product outside the selection is still kept", async () => {
  const h = harness({
    products: [
      { id: "blazer", slug: "blazer", images: [{ url: SHARED }], designs: [] },
      { id: "scarf", slug: "scarf", images: [{ url: SHARED }], designs: [] },
    ],
  });
  const result = await h.preview(["coat", "blazer"]);

  const kept = result.body.plan.filesKept.map((f) => f.path);
  assert.deepEqual(kept, ["products/shared.jpg"]);
  assert.deepEqual(result.body.plan.filesKept[0].usedBy, ["scarf"]);
  assert.ok(!result.body.plan.filesToDelete.includes("products/shared.jpg"));
});

/*
 * Summing the products' own counts would report this single order as two,
 * which is wrong in the one direction that matters: the number is in the
 * dialog to be recognised.
 */
test("one order holding two of the selected products is counted once", async () => {
  const h = harness({
    products: [{ id: "blazer", slug: "blazer", images: [], designs: [] }],
    orders: [[{ productId: "coat" }, { productId: "blazer" }]],
  });
  const result = await h.preview(["coat", "blazer"]);

  assert.equal(result.body.plan.orderCount, 1);
  assert.match(result.body.summary.en, /1 past order keeps?|1 past order/);
});

test("a file shared inside the selection is counted once, not twice", async () => {
  const h = harness({
    products: [{ id: "blazer", slug: "blazer", images: [{ url: SHARED }], designs: [] }],
  });
  const result = await h.preview(["coat", "blazer"]);

  const shared = result.body.plan.filesToDelete.filter((p) => p === "products/shared.jpg");
  assert.equal(shared.length, 1);
});

test("deleting a selection removes every one of them", async () => {
  const h = harness({
    products: [
      { id: "blazer", slug: "blazer", images: [], designs: [] },
      { id: "scarf", slug: "scarf", images: [], designs: [] },
    ],
  });
  const result = await h.removeMany(["coat", "blazer", "scarf"]);

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.deleted, 3);
  assert.deepEqual(result.body.failed, []);
  for (const id of ["coat", "blazer", "scarf"]) {
    assert.ok(h.done.deleted.includes(`products/${id}`), `${id} goes`);
  }
  assert.equal(h.done.revalidated, 1, "the storefront is rebuilt once, not per product");
});

/*
 * "Thirty-six went, these three did not" is an answer somebody can act on.
 * A single failure that hides the thirty-six is not.
 */
test("a product that fails is named, and the rest still go", async () => {
  const h = harness({
    products: [
      { id: "blazer", slug: "blazer", images: [], designs: [] },
      { id: "scarf", slug: "scarf", images: [], designs: [] },
    ],
    failOn: "blazer",
  });
  const result = await h.removeMany(["coat", "blazer", "scarf"]);

  assert.equal(result.body.deleted, 2);
  assert.equal(result.body.failed.length, 1);
  assert.equal(result.body.failed[0].id, "blazer");
  assert.match(result.body.failed[0].error, /unreachable/i);
  assert.ok(h.done.deleted.includes("products/coat"));
  assert.ok(h.done.deleted.includes("products/scarf"));
});

test("ids that no longer exist are reported, not silently dropped", async () => {
  const h = harness();
  const result = await h.removeMany(["coat", "ghost"]);

  assert.equal(result.body.deleted, 1);
  assert.deepEqual(result.body.missing, ["ghost"]);
});

test("a selection of nothing but ghosts is a 404", async () => {
  const h = harness();
  const result = await h.removeMany(["ghost", "phantom"]);
  assert.equal(result.status, 404);
  assert.equal(h.done.deleted.length, 0);
});

test("a linked product that is itself being deleted is not written to", async () => {
  const h = harness({
    products: [{ id: "blazer", slug: "blazer", images: [], designs: [], upsellIds: ["coat"] }],
  });
  const result = await h.preview(["coat", "blazer"]);

  // Cleaning blazer's upsell list is a write nobody will ever read.
  assert.deepEqual(result.body.plan.linkedProductIds, []);
});

test("every row of a batch carries the same batch id", async () => {
  const h = harness({ products: [{ id: "blazer", slug: "blazer", images: [], designs: [] }] });
  const result = await h.removeMany(["coat", "blazer"]);

  const rows = h.done.audits.filter((a) => a.action === "product.delete");
  assert.equal(rows.length, 2, "one row per product, so each is findable on its own");
  assert.equal(rows[0].batchId, result.body.batchId);
  assert.equal(rows[1].batchId, result.body.batchId);
});

test("more than 25 at once is refused rather than half-done", async () => {
  const h = harness();
  const ids = Array.from({ length: 26 }, (_, i) => `p${i}`);
  const result = await h.removeMany(ids);

  assert.equal(result.status, 400);
  assert.match(result.body.error, /at most 25/i);
  assert.equal(h.done.deleted.length, 0);
});

test("a preview may cover far more than a deletion, but not unboundedly", async () => {
  const h = harness();
  const ok = await h.preview(Array.from({ length: 26 }, (_, i) => (i ? `p${i}` : "coat")));
  assert.equal(ok.status, 200, "26 is fine to look at");

  const tooMany = await h.preview(Array.from({ length: 201 }, (_, i) => `p${i}`));
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /200/);
});

/* -------------------------------------------------------------------------- */
/*  Who may                                                                    */
/* -------------------------------------------------------------------------- */

test("staff cannot delete — archiving is theirs, this is not", async () => {
  const h = harness({ role: "staff" });
  const result = await h.remove();

  assert.equal(result.status, 403);
  assert.match(result.body.error, /administrator/i);
  assert.equal(h.done.deleted.length, 0);
  assert.equal(h.done.filesDeleted.length, 0);
});

test("staff cannot delete a selection either", async () => {
  const h = harness({ role: "staff" });
  const result = await h.removeMany(["coat"]);

  assert.equal(result.status, 403);
  assert.match(result.body.error, /administrator/i);
  assert.equal(h.done.deleted.length, 0);
});

test("staff cannot even read what a selection would remove", async () => {
  const h = harness({ role: "staff" });
  assert.equal((await h.preview(["coat"])).status, 403);
});

test("a customer and a stranger get nothing", async () => {
  for (const role of ["customer", null]) {
    const h = harness({ role });
    assert.equal((await h.remove()).status, role ? 403 : 401, String(role));
    assert.equal((await h.removeMany(["coat"])).status, role ? 403 : 401, String(role));
    assert.equal(h.done.deleted.length, 0);
  }
});

/*
 * Who is asking, before what they are asking about. A stranger sending two
 * hundred ids is told they are not signed in, not told what the ceiling is.
 */
test("a stranger over the batch limit is refused for being a stranger", async () => {
  const h = harness({ role: null });
  const result = await h.removeMany(Array.from({ length: 99 }, (_, i) => `p${i}`));

  assert.equal(result.status, 401);
  assert.doesNotMatch(result.body.error, /25/);
});

test("reading the plan is gated the same way", async () => {
  const h = harness({ role: "staff" });
  assert.equal((await h.plan()).status, 403);
});

test("an unknown product is a 404, not a silent success", async () => {
  const h = harness();
  const result = await h.remove("ghost");
  assert.equal(result.status, 404);
  assert.equal(h.done.deleted.length, 0);
});

test("the deletion is written to the audit log with what it removed", async () => {
  const h = harness({ collections: ["autumn"], wishlists: ["u1"] });
  await h.remove();

  const entry = h.done.audits.find((a) => a.action === "product.delete");
  assert.ok(entry, "an audit row exists");
  assert.equal(entry.productId, "coat");
  assert.equal(entry.slug, "atelier-wool-coat");
  assert.equal(entry.reviewsDeleted, 1);
  assert.equal(entry.wishlistsCleaned, 1);
  assert.equal(entry.actorUid, "bossxyz");
  assert.ok(entry.at instanceof Date);
});
