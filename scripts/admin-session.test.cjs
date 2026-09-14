const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

process.env.NODE_ENV = "production";

// Exercise the real route/data modules with an isolated Auth/Firestore backend.
// No credentials, network requests or production records are used.
function loadTs(relative, mocks) {
  const filename = path.join(__dirname, "..", relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
  return module.exports;
}

function sessionFixture() {
  const jar = new Map();
  const state = { role: "admin", disabled: false, revoked: false, issued: 0 };
  const token = { uid: "owner", role: "admin", auth_time: Date.now() / 1000 };
  const auth = {
    async verifyIdToken(value, checkRevoked) {
      assert.equal(checkRevoked, true);
      if (value !== "valid-token" || state.revoked) throw new Error("invalid token");
      return token;
    },
    async verifySessionCookie(value, checkRevoked) {
      assert.equal(checkRevoked, true);
      if (value !== "valid-cookie" || state.revoked) throw new Error("invalid cookie");
      return token;
    },
    async getUser() { return { disabled: state.disabled, customClaims: { role: state.role } }; },
    async createSessionCookie() { state.issued += 1; return "valid-cookie"; },
  };
  const admin = { getAdminAuth: () => auth, isAdminConfigured: () => true };
  const headers = { cookies: async () => ({ get: (key) => jar.has(key) ? { value: jar.get(key) } : undefined }) };
  const session = loadTs("src/lib/firebase/session.ts", {
    "server-only": {},
    react: { cache: (fn) => fn },
    "next/headers": headers,
    "next/navigation": { redirect: (location) => { throw new Error(`REDIRECT:${location}`); } },
    "./admin": admin,
  });
  const route = loadTs("src/app/api/auth/session/route.ts", {
    "next/headers": headers,
    "@/lib/firebase/admin": admin,
    "@/lib/firebase/session": session,
  });
  const request = (method = "POST", origin = "https://shop.example", bearer = "valid-token") =>
    new Request("https://shop.example/api/auth/session", {
      method,
      headers: { Origin: origin, Authorization: `Bearer ${bearer}` },
    });
  return { jar, state, token, session, route, request };
}

test("staff login issues a secure HttpOnly cookie; cross-site login/logout are refused", async () => {
  const f = sessionFixture();
  const response = await f.route.POST(f.request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).admin, true);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /jo-admin-session=valid-cookie/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.equal((await f.route.POST(f.request("POST", "https://evil.example"))).status, 403);
  assert.equal((await f.route.DELETE(f.request("DELETE", "https://evil.example"))).status, 403);
  assert.equal((await f.route.POST(f.request("POST", ""))).status, 403);
  assert.equal(f.state.issued, 1);
  const logout = await f.route.DELETE(f.request("DELETE"));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/i);
});

test("invalid, removed-role and revoked identities cannot create/read an admin session", async () => {
  const f = sessionFixture();
  assert.equal((await f.route.POST(f.request("POST", "https://shop.example", "bad"))).status, 401);
  await assert.rejects(f.session.requireAdminSession(), /REDIRECT:\/en\/login/);
  f.jar.set("jo-admin-session", "valid-cookie");
  assert.equal((await f.session.requireAdminSession()).uid, "owner");
  f.state.role = "customer";
  assert.equal((await (await f.route.POST(f.request())).json()).admin, false);
  await assert.rejects(f.session.requireAdminSession(), /REDIRECT/);
  f.state.role = "admin";
  f.state.revoked = true;
  assert.equal((await f.route.POST(f.request())).status, 401);
  await assert.rejects(f.session.requireAdminSession(), /REDIRECT/);
  assert.equal(f.state.issued, 0);
});

test("old client logins require reauthentication unless renewing a valid matching cookie", async () => {
  const f = sessionFixture();
  f.token.auth_time -= 3600;
  assert.equal((await f.route.POST(f.request())).status, 401);
  f.jar.set("jo-admin-session", "valid-cookie");
  assert.equal((await f.route.POST(f.request())).status, 200);
});

function dataFixture(allowed, documents = []) {
  const state = { reads: 0 };
  class Timestamp { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } }
  const chain = { orderBy() { return this; }, limit() { return this; }, async get() { return { docs: documents }; } };
  const data = loadTs("src/lib/admin/data.ts", {
    "server-only": {},
    react: { cache: (fn) => fn },
    "firebase-admin/firestore": { Timestamp },
    "@/lib/firebase/admin": { getAdminDb: () => {
      state.reads += 1;
      return { collection: () => chain };
    } },
    "@/lib/firebase/session": { requireAdminSession: async () => {
      if (!allowed) throw new Error("REDIRECT:login");
      return { uid: "owner", role: "admin" };
    } },
    "@/data/demo": { demoProducts: [], demoCategories: [], demoOffers: [], demoBanners: [] },
    "@/data/demo-operations": { demoOrders: [{ id: "DEMO" }], demoInvoices: [], demoTickets: [], demoCustomers: [{ uid: "DEMO" }] },
  });
  return { data, state, Timestamp };
}

test("every admin collection reader rejects anonymous requests before any database read", async () => {
  const { data, state } = dataFixture(false);
  for (const name of ["getAdminOrders", "getAdminInvoices", "getAdminTickets", "getAdminCustomers", "getAdminProducts", "getAdminCategories", "getAdminOffers", "getAdminBanners"]) {
    await assert.rejects(data[name](), /REDIRECT/);
  }
  assert.equal(state.reads, 0);
});

test("authenticated reads serialize nested timestamps and preserve genuinely empty live data", async () => {
  const documents = [];
  const { data, Timestamp } = dataFixture(true, documents);
  assert.deepEqual(await data.getAdminOrders(), { rows: [], live: true });
  assert.deepEqual(await data.getAdminCustomers(), []);
  documents.push({ id: "order-1", data: () => ({
    reference: "JO-TEST",
    createdAt: new Timestamp(1234),
    updatedAt: new Date(5678),
    timeline: [{ at: new Timestamp(9999) }],
  }) });
  assert.deepEqual(await data.getAdminOrders(), {
    rows: [{ id: "order-1", reference: "JO-TEST", createdAt: 1234, updatedAt: 5678, timeline: [{ at: 9999 }] }],
    live: true,
  });
});
