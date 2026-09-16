const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

/**
 * Reading a Google Sheet, on the server.
 *
 * The interesting case is not the happy one. A sheet that is not shared does
 * not answer 403 — it answers **200 with Google's sign-in page**, and a client
 * that trusts the status hands a lump of HTML to a CSV parser and reports "no
 * columns found". The merchant then goes looking at their column headers
 * instead of at their sharing settings.
 *
 * Run with:
 *
 *     npm run test:sheets-import
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

const SHEET = "https://docs.google.com/spreadsheets/d/1AbCdEf/edit#gid=0";

/** The route, with a signed-in caller and a scripted answer from Google. */
function harness({ role = "admin", configured = true, reply } = {}) {
  const calls = [];
  const route = loadTs("src/app/api/admin/sheets/route.ts", {
    "@/lib/firebase/admin": {
      isAdminConfigured: () => configured,
      verifyRequest: async () => (role ? { uid: "merchant", role, email: null } : null),
    },
  });

  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push(String(url));
    return reply(String(url), init);
  };

  async function read(url = SHEET) {
    try {
      const response = await route.POST(
        new Request("https://shop.example/api/admin/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        }),
      );
      return { status: response.status, body: await response.json() };
    } finally {
      global.fetch = realFetch;
    }
  }

  return { read, calls };
}

const ok = (body, type = "text/csv") =>
  new Response(body, { status: 200, headers: { "Content-Type": type } });

test("a shared sheet comes back as its CSV", async () => {
  const h = harness({ reply: () => ok("Colour,Stock\r\nWhite,4\r\n") });
  const result = await h.read();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.csv, "Colour,Stock\r\nWhite,4\r\n");
  // The export endpoint, not the page the merchant copied.
  assert.match(h.calls[0], /\/export\?format=csv/);
});

test("an unshared sheet is named as unshared, not as an empty one", async () => {
  const h = harness({
    // What Google actually returns: the sign-in page, with a 200.
    reply: () => ok("<!DOCTYPE html><html><head><title>Sign in</title>", "text/html"),
  });
  const result = await h.read();
  assert.equal(result.status, 403);
  assert.match(result.body.error, /not shared/i);
  assert.match(result.body.error, /Anyone with the link/i);
});

test("a Drive file link is told what it is rather than called invalid", async () => {
  const h = harness({ reply: () => ok("") });
  const result = await h.read("https://drive.google.com/file/d/1AbCdEf/view");
  assert.equal(result.status, 400);
  assert.match(result.body.error, /Drive file link/i);
  assert.equal(h.calls.length, 0);
});

test("anything that is not a sheet is refused before a request is made", async () => {
  const h = harness({ reply: () => ok("") });
  const result = await h.read("https://example.com/prices.csv");
  assert.equal(result.status, 400);
  assert.equal(h.calls.length, 0);
});

test("an empty sheet is reported as empty", async () => {
  const h = harness({ reply: () => ok("   \n") });
  const result = await h.read();
  assert.equal(result.status, 400);
  assert.match(result.body.error, /empty/i);
});

test("a 404 from Google is not passed on as a generic failure", async () => {
  const h = harness({ reply: () => new Response("", { status: 404 }) });
  const result = await h.read();
  assert.equal(result.status, 502);
  assert.match(result.body.error, /could not be found/i);
});

test("a timeout says so, so the merchant retries instead of re-sharing", async () => {
  const h = harness({
    reply: () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    },
  });
  const result = await h.read();
  assert.equal(result.status, 502);
  assert.match(result.body.error, /did not answer in time/i);
});

test("importing is staff work, and unauthenticated callers get nowhere", async () => {
  for (const [role, status] of [
    [null, 401],
    ["customer", 403],
    ["staff", 200],
  ]) {
    const h = harness({ role, reply: () => ok("A,B\r\n1,2\r\n") });
    const result = await h.read();
    assert.equal(result.status, status, `${role} → ${JSON.stringify(result.body)}`);
    if (status !== 200) assert.equal(h.calls.length, 0);
  }
});

test("with Firebase Admin absent the route says so instead of pretending", async () => {
  const h = harness({ configured: false, reply: () => ok("") });
  const result = await h.read();
  assert.equal(result.status, 503);
  assert.equal(h.calls.length, 0);
});

/*
 * The key is optional by design: a link-shared sheet needs none, and requiring
 * one would put a Google Cloud project between a merchant and their own stock
 * sheet. It is read when set and never demanded.
 */
test("no API key is needed, and one is used when it is set", async () => {
  const before = process.env.GOOGLE_SHEETS_API_KEY;

  delete process.env.GOOGLE_SHEETS_API_KEY;
  let h = harness({ reply: () => ok("A\r\n1\r\n") });
  assert.equal((await h.read()).status, 200);
  assert.equal(h.calls[0].includes("key="), false);

  process.env.GOOGLE_SHEETS_API_KEY = "test-key-not-a-real-one";
  h = harness({ reply: () => ok("A\r\n1\r\n") });
  assert.equal((await h.read()).status, 200);
  assert.match(h.calls[0], /key=test-key-not-a-real-one/);

  if (before === undefined) delete process.env.GOOGLE_SHEETS_API_KEY;
  else process.env.GOOGLE_SHEETS_API_KEY = before;
});
