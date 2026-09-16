const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { Firestore, FieldValue } = require("firebase-admin/firestore");

// Exercise the real route and helpers. The real SDK validates each write,
// but batches are never committed: no credentials or live records are used.
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

function fixture(initial = null, role = "admin") {
  const sdk = new Firestore({ projectId: "product-save-regression" });
  const state = { document: initial, writes: 0, audits: [] };
  const ref = {
    id: "product-1",
    async get() { return { exists: state.document !== null }; },
    async set(data, options) {
      // This reproduces the exact Firestore undefined-value rejection.
      sdk.batch().set(sdk.doc("products/product-1"), data, options);
      assert.deepEqual(options, { merge: true });
      state.document = { ...state.document };
      for (const [key, value] of Object.entries(data)) {
        if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) {
          delete state.document[key];
        } else {
          state.document[key] = value;
        }
      }
      state.writes += 1;
    },
  };
  const products = {
    where() { return this; },
    limit() { return this; },
    async get() { return { empty: true, docs: [] }; },
    doc() { return ref; },
  };
  const route = loadTs("src/app/api/admin/products/route.ts", {
    "@/lib/firebase/admin": {
      isAdminConfigured: () => true,
      verifyRequest: async () => role ? { uid: "merchant", role, email: null } : null,
      getAdminDb: () => ({ collection: (name) => {
        if (name === "products") return products;
        assert.equal(name, "auditLog");
        return { add: async (data) => {
          sdk.batch().set(sdk.doc("auditLog/test"), data);
          state.audits.push(data);
        } };
      } }),
    },
    "@/lib/catalog": { getCategories: async () => [] },
  });
  async function save(overrides = {}) {
    const response = await route.POST(new Request("https://shop.example/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(initial ? { id: "product-1" } : {}),
        title: { en: "Test product", ar: "منتج تجريبي" },
        slug: "test-product", price: 10, totalStock: 3, type: "simple",
        ...overrides,
      }),
    }));
    return { status: response.status, body: await response.json() };
  }
  return { state, save };
}

const optionalFields = ["gtin", "subtitle", "compareAtPrice", "maxPerOrder"];
const populated = {
  gtin: "4006381333931", subtitle: { en: "Cotton", ar: "قطن" },
  compareAtPrice: 20, maxPerOrder: 2,
};
const empty = { gtin: null, subtitle: { en: "", ar: "" }, compareAtPrice: null, maxPerOrder: null };

test("a blank barcode alone does not block saving the other completed fields", async () => {
  const f = fixture();
  const result = await f.save({ ...populated, gtin: null });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(Object.hasOwn(f.state.document, "gtin"), false);
  assert.deepEqual(f.state.document.subtitle, populated.subtitle);
});

test("create simple and variable products with empty or absent optional fields", async () => {
  for (const type of ["simple", "variable"]) {
    for (const fields of [{}, empty]) {
      const f = fixture();
      const result = await f.save({ ...fields, type });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.persisted, true);
      for (const key of optionalFields) assert.equal(Object.hasOwn(f.state.document, key), false);
      assert.equal(f.state.document.totalStock, 3);
      assert.equal(f.state.audits.length, 1);
    }
  }
});

test("valid optional values are saved; clearing them removes old data", async () => {
  const f = fixture({ ...populated, unrelated: "preserved" });
  let result = await f.save({ ...populated, gtin: ` ${populated.gtin} ` });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  for (const key of optionalFields) assert.deepEqual(f.state.document[key], populated[key]);
  result = await f.save(empty);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  for (const key of optionalFields) assert.equal(Object.hasOwn(f.state.document, key), false);
  assert.equal(f.state.document.unrelated, "preserved");
});

test("omitted optional fields are preserved on edit, zero values clear limits and compare-at price", async () => {
  const f = fixture({ ...populated });
  let result = await f.save();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  for (const key of optionalFields) assert.deepEqual(f.state.document[key], populated[key]);
  result = await f.save({ compareAtPrice: 0, maxPerOrder: 0 });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(Object.hasOwn(f.state.document, "compareAtPrice"), false);
  assert.equal(Object.hasOwn(f.state.document, "maxPerOrder"), false);
  assert.equal(f.state.document.gtin, populated.gtin);
});

test("switching to a variable product clears the parent barcode and accepts sparse nested records", async () => {
  const f = fixture({ ...populated });
  const result = await f.save({
    type: "variable",
    images: [{ url: "/demo/tee.svg" }],
    variants: [{ sku: "TEE-S", colorId: "black", sizeId: "s", designId: "palm", stock: 2 }],
    designs: [{ id: "palm", name: { en: "Palm", ar: "نخلة" }, thumbnail: { url: "/demo/palm.svg" } }],
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(Object.hasOwn(f.state.document, "gtin"), false);
  assert.equal(Object.hasOwn(f.state.document.variants[0], "gtin"), false);
  assert.equal(f.state.document.variants[0].stock, 2);
  assert.equal(f.state.document.totalStock, 2);
  assert.equal(f.state.document.designs[0].id, "palm");
});

test("invalid barcodes and unauthorized requests still cannot save", async () => {
  const f = fixture();
  assert.equal((await f.save({ gtin: "4006381333932" })).status, 400);
  assert.equal(f.state.writes, 0);
  for (const role of [null, "customer"]) {
    const denied = fixture(null, role);
    assert.equal((await denied.save(empty)).status, role ? 403 : 401);
    assert.equal(denied.state.writes, 0);
  }
});

/* -------------------------------------------------------------------------- */
/*  Attributes and the variant table                                          */
/* -------------------------------------------------------------------------- */

const capacityAxis = {
  id: "capacity",
  name: { en: "Capacity", ar: "السعة" },
  kind: "custom",
  values: [
    { id: "1-5l", label: { en: "1.5 L", ar: "١٫٥ ل" } },
    { id: "1-7l", label: { en: "1.7 L", ar: "١٫٧ ل" } },
  ],
};

test("axes beyond colour and size are stored, and clearing them removes the old ones", async () => {
  const f = fixture();
  let result = await f.save({ type: "variable", attributes: [capacityAxis] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(f.state.document.attributes[0].id, "capacity");
  assert.equal(f.state.document.attributes[0].values.length, 2);
  // Position is assigned by the route so the column order is the array order,
  // rather than whatever the client happened to send.
  assert.equal(f.state.document.attributes[0].position, 0);

  result = await f.save({ type: "variable", attributes: null });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(Object.hasOwn(f.state.document, "attributes"), false);
});

test("omitting the axes leaves the stored ones alone", async () => {
  const f = fixture({ attributes: [capacityAxis] });
  const result = await f.save({ type: "variable" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(f.state.document.attributes[0].id, "capacity");
});

test("two axes sharing an id are refused rather than silently merged", async () => {
  const f = fixture();
  const result = await f.save({
    type: "variable",
    attributes: [capacityAxis, { ...capacityAxis, name: { en: "Volume", ar: "الحجم" } }],
  });
  assert.equal(result.status, 400);
  assert.equal(f.state.writes, 0);
});

test("a variant carries its own sale price and its attribute values", async () => {
  const f = fixture();
  const result = await f.save({
    type: "variable",
    price: 30,
    attributes: [capacityAxis],
    variants: [
      { sku: "KET-15", colorId: "", sizeId: "", stock: 4, priceOverride: 30, salePrice: 24.5, attributes: { capacity: "1-5l" } },
    ],
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const row = f.state.document.variants[0];
  assert.equal(row.salePrice, 24.5);
  assert.deepEqual(row.attributes, { capacity: "1-5l" });
});

/*
 * The rule the whole table is built around: a price is the only thing a row
 * needs. A kettle sold in one capacity has no colour and no size, and a route
 * that insisted on them would make the row unsaveable.
 */
test("a row with a price and nothing else is saved", async () => {
  const f = fixture();
  const result = await f.save({
    type: "variable",
    variants: [{ sku: "", colorId: "", sizeId: "", stock: 0, priceOverride: 12 }],
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(f.state.document.variants[0].priceOverride, 12);
});

test("a blank sale price is left off the row rather than written as zero", async () => {
  const f = fixture();
  const result = await f.save({
    type: "variable",
    variants: [{ sku: "A", colorId: "", sizeId: "", stock: 1, salePrice: null }],
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(Object.hasOwn(f.state.document.variants[0], "salePrice"), false);
});

test("a row saved without a code is stored under one built from its values", async () => {
  const f = fixture();
  const result = await f.save({
    type: "variable",
    sku: "KET",
    attributes: [capacityAxis],
    variants: [
      { sku: "", colorId: "", sizeId: "", stock: 2, attributes: { capacity: "1-5l" } },
      { sku: "", colorId: "", sizeId: "", stock: 5, attributes: { capacity: "1-7l" } },
    ],
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(
    f.state.document.variants.map((v) => v.sku),
    ["KET-1-5L", "KET-1-7L"],
  );
  assert.equal(f.state.document.totalStock, 7);
});
