const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

/**
 * Deleting a product for good.
 *
 * A product is not one document — it is a row, a set of files, its reviews,
 * its stock alerts, an entry in collections, a line in other products' upsell
 * lists and an id in strangers' wishlists. What is pinned here is that all of
 * those go, that **orders do not**, and that a photograph another product
 * still uses is left alone.
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

const SHARED = "https://firebasestorage.googleapis.com/v0/b/b/o/products%2Fshared.jpg?alt=media";
const OWN = "https://firebasestorage.googleapis.com/v0/b/b/o/products%2Fcoat-1.jpg?alt=media";
const DEMO = "/demo/coat.svg";

function harness({ role = "admin", otherProducts = [], collections = [], wishlists = [], reviews = ["r1"], alerts = ["a1"], orders = [] } = {}) {
  const done = { deleted: [], arrayRemoves: [], filesDeleted: [], audits: [], revalidated: 0 };

  const product = {
    id: "coat",
    slug: "atelier-wool-coat",
    title: { en: "Atelier Wool Coat", ar: "معطف" },
    images: [{ url: OWN }, { url: SHARED }, { url: DEMO }],
    designs: [],
    upsellIds: [],
    crossSellIds: [],
  };

  const docsOf = (ids) => ids.map((id) => ({ id, ref: { id }, data: () => ({}) }));

  const productDocs = [
    { id: "coat", data: () => product },
    ...otherProducts.map((p) => ({ id: p.id, data: () => p })),
  ];

  const db = {
    collection: (name) => {
      const api = {
        doc: (id) => ({
          id,
          get: async () => ({
            exists: name === "products" && id === "coat",
            id,
            data: () => (name === "products" && id === "coat" ? product : {}),
          }),
          delete: async () => {
            done.deleted.push(`${name}/${id}`);
          },
        }),
        where: () => api,
        limit: () => api,
        get: async () => {
          if (name === "products") return { docs: productDocs, size: productDocs.length, empty: false };
          if (name === "reviews") return { docs: docsOf(reviews), size: reviews.length, empty: !reviews.length };
          if (name === "stockAlerts") return { docs: docsOf(alerts), size: alerts.length, empty: !alerts.length };
          if (name === "collections") return { docs: docsOf(collections), size: collections.length, empty: !collections.length };
          if (name === "users") return { docs: docsOf(wishlists), size: wishlists.length, empty: !wishlists.length };
          if (name === "orders") {
            const docs = orders.map((items, i) => ({ id: `o${i}`, data: () => ({ items }) }));
            return { docs, size: docs.length, empty: docs.length === 0 };
          }
          return { docs: [], size: 0, empty: true };
        },
        add: async (row) => done.audits.push(row),
      };
      return api;
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
      verifyRequest: async () => (role ? { uid: "boss", email: "b@x.com", role } : null),
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

  const url = "https://netsale.shop/api/admin/products/delete?id=coat";
  return {
    done,
    plan: async () => {
      const r = await route.GET(new Request(url));
      return { status: r.status, body: await r.json() };
    },
    remove: async (id = "coat") => {
      const r = await route.DELETE(
        new Request(`https://netsale.shop/api/admin/products/delete?id=${id}`, { method: "DELETE" }),
      );
      return { status: r.status, body: await r.json() };
    },
  };
}

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
  const h = harness({
    otherProducts: [{ id: "blazer", images: [{ url: SHARED }], designs: [] }],
  });
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
  // No other product uses either file here, so both go. The shared-image
  // case is covered above.
  assert.deepEqual(h.done.filesDeleted.sort(), ["products/coat-1.jpg", "products/shared.jpg"]);
  assert.equal(h.done.revalidated, 1, "cached pages are rebuilt");
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
    otherProducts: [{ id: "scarf", images: [], designs: [], upsellIds: ["coat"] }],
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

test("staff cannot delete — archiving is theirs, this is not", async () => {
  const h = harness({ role: "staff" });
  const result = await h.remove();

  assert.equal(result.status, 403);
  assert.match(result.body.error, /administrator/i);
  assert.equal(h.done.deleted.length, 0);
  assert.equal(h.done.filesDeleted.length, 0);
});

test("a customer and a stranger get nothing", async () => {
  for (const role of ["customer", null]) {
    const h = harness({ role });
    const result = await h.remove();
    assert.equal(result.status, role ? 403 : 401, String(role));
    assert.equal(h.done.deleted.length, 0);
  }
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
  assert.equal(entry.actorUid, "boss");
  assert.ok(entry.at instanceof Date);
});
