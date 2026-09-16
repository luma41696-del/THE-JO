const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

/**
 * Removing a delivery method.
 *
 * The board could change what a method costs but never that it exists, so a
 * shop that stopped doing boutique pickup had no way to say so. Now it can —
 * and the one thing that must not be possible is removing the last one, which
 * would leave the checkout with an empty delivery step and no way to order.
 *
 * Run with:
 *
 *     npm run test:shipping-methods
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

const STANDARD = {
  id: "standard",
  speed: "standard",
  name: { en: "Standard", ar: "عادي" },
  price: 3,
  minDays: 2,
  maxDays: 4,
};

const PICKUP = {
  id: "pickup",
  speed: "pickup",
  name: { en: "Boutique pickup", ar: "استلام من المتجر" },
  price: 0,
  minDays: 0,
  maxDays: 0,
};

/** The route with no Firebase behind it: validation runs, nothing is written. */
function harness() {
  const route = loadTs("src/app/api/admin/shipping/route.ts", {
    "@/lib/firebase/admin": {
      isAdminConfigured: () => false,
      verifyRequest: async () => ({ uid: "merchant", role: "admin", email: null }),
    },
    // Pulled in transitively and refuses to load outside a server component.
    "server-only": {},
  });

  return async function save(body) {
    const response = await route.POST(
      new Request("https://shop.example/api/admin/shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
}

test("a method the merchant removed is gone from what gets written", async () => {
  const save = harness();
  const result = await save({ methods: [STANDARD], zones: [] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(
    result.body.validated.methods.map((m) => m.id),
    ["standard"],
  );
});

test("both survive when both are kept", async () => {
  const save = harness();
  const result = await save({ methods: [PICKUP, STANDARD], zones: [] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(
    result.body.validated.methods.map((m) => m.id),
    ["pickup", "standard"],
  );
});

/*
 * The button is disabled at one method, but a disabled button is a courtesy,
 * not a rule: the request can still be made by hand, and a shop that takes no
 * orders is one Save away without this.
 */
test("the last delivery method cannot be removed", async () => {
  const save = harness();
  const result = await save({ methods: [], zones: [] });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /at least one delivery method/i);
});

test("a body with no methods at all is refused the same way", async () => {
  const save = harness();
  const result = await save({ zones: [] });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /at least one delivery method/i);
});
