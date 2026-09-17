const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

/**
 * Blocking and deleting customer accounts.
 *
 * Every test here is about something that must *not* happen. Deleting an
 * account cannot be undone by anyone, including Google, so the guards around
 * it are the feature — the happy path is three lines of Firebase SDK.
 *
 * Run with:
 *
 *     npm run test:customer-admin
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

/** The route, with a scripted caller and a fake Auth + Firestore behind it. */
function harness({ role = "admin", callerUid = "boss", target = {} } = {}) {
  const done = { updated: [], deleted: [], revoked: [], audits: [], orderWrites: 0 };

  const user = {
    uid: "cust-1",
    email: "customer@example.com",
    disabled: false,
    customClaims: {},
    ...target,
  };

  const auth = {
    getUser: async (uid) => {
      if (uid !== user.uid) throw new Error("no such user");
      return user;
    },
    updateUser: async (uid, patch) => done.updated.push({ uid, ...patch }),
    deleteUser: async (uid) => done.deleted.push(uid),
    revokeRefreshTokens: async (uid) => done.revoked.push(uid),
  };

  const orderDocs = [{ ref: { id: "o1" } }, { ref: { id: "o2" } }];
  const db = {
    collection: (name) => {
      if (name === "auditLog") return { add: async (row) => done.audits.push(row) };
      if (name === "orders") {
        return { where: () => ({ get: async () => ({ docs: orderDocs, size: orderDocs.length }) }) };
      }
      return {
        doc: () => ({
          set: async () => {},
          delete: async () => {},
        }),
      };
    },
    batch: () => ({
      set: () => {
        done.orderWrites += 1;
      },
      commit: async () => {},
    }),
  };

  const route = loadTs("src/app/api/admin/customers/route.ts", {
    "@/lib/firebase/admin": {
      isAdminConfigured: () => true,
      verifyRequest: async () =>
        role ? { uid: callerUid, email: "boss@example.com", role } : null,
      getAdminAuth: () => auth,
      getAdminDb: () => db,
    },
    "@/lib/security/rate-limit": {
      RULES: { content: { limit: 99, windowSeconds: 60 } },
      callerKey: () => "ip:test",
      rateLimit: async () => ({ ok: true, remaining: 99, retryAfter: 0 }),
      tooManyRequests: () => new Response("{}", { status: 429 }),
    },
    "server-only": {},
  });

  async function call(bodyIn) {
    const response = await route.POST(
      new Request("https://shop.example/api/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyIn),
      }),
    );
    return { status: response.status, body: await response.json(), done };
  }

  return { call, done };
}

/* -------------------------------------------------------------------------- */

test("an administrator can block, and existing sessions are revoked", async () => {
  const h = harness();
  const result = await h.call({ uid: "cust-1", action: "block" });

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(h.done.updated, [{ uid: "cust-1", disabled: true }]);
  /*
   * Without this the customer stays signed in on whatever device they are
   * holding until their token expires — up to an hour of access after being
   * blocked.
   */
  assert.deepEqual(h.done.revoked, ["cust-1"]);
});

test("unblocking does not revoke anything", async () => {
  const h = harness({ target: { disabled: true } });
  const result = await h.call({ uid: "cust-1", action: "unblock" });

  assert.equal(result.status, 200);
  assert.deepEqual(h.done.updated, [{ uid: "cust-1", disabled: false }]);
  assert.deepEqual(h.done.revoked, []);
});

test("staff may block but may not delete", async () => {
  const blocking = harness({ role: "staff" });
  assert.equal((await blocking.call({ uid: "cust-1", action: "block" })).status, 200);

  const deleting = harness({ role: "staff" });
  const refused = await deleting.call({ uid: "cust-1", action: "delete" });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /administrator/i);
  assert.deepEqual(deleting.done.deleted, [], "nothing may be deleted");
});

test("a customer cannot manage customers, and neither can a stranger", async () => {
  for (const role of ["customer", null]) {
    const h = harness({ role });
    const result = await h.call({ uid: "cust-1", action: "block" });
    assert.equal(result.status, role ? 403 : 401, String(role));
    assert.deepEqual(h.done.updated, []);
  }
});

/*
 * Locking the only administrator out of the shop is a one-click mistake with
 * no way back in from the admin itself.
 */
test("nobody can block or delete their own account", async () => {
  for (const action of ["block", "delete"]) {
    const h = harness({ callerUid: "cust-1" });
    const result = await h.call({ uid: "cust-1", action });
    assert.equal(result.status, 400, action);
    assert.match(result.body.error, /your own account/i);
    assert.deepEqual(h.done.updated, []);
    assert.deepEqual(h.done.deleted, []);
  }
});

/*
 * Staff accounts belong to the Access screen, which knows about roles and
 * about not removing the last administrator. Letting them be blocked from the
 * customers board would route around all of that.
 */
test("staff and admin accounts are not manageable from here", async () => {
  for (const role of ["staff", "admin"]) {
    const h = harness({ target: { customClaims: { role } } });
    const result = await h.call({ uid: "cust-1", action: "block" });
    assert.equal(result.status, 400, role);
    assert.match(result.body.error, /Access screen/i);
    assert.deepEqual(h.done.updated, []);
  }
});

test("an unknown account is a 404, not a silent success", async () => {
  const h = harness();
  const result = await h.call({ uid: "nobody", action: "block" });
  assert.equal(result.status, 404);
});

test("an unknown action is refused", async () => {
  const h = harness();
  assert.equal((await h.call({ uid: "cust-1", action: "purge" })).status, 400);
  assert.equal((await h.call({ action: "block" })).status, 400);
});

/* -------------------------------------------------------------------------- */

/*
 * An order is an accounting record: it is on an invoice and in the shop's tax
 * return. Deleting the customer row out from under a paid invoice breaks the
 * books to satisfy a request that redaction honours just as well.
 */
test("deleting removes the account but keeps the orders, redacted", async () => {
  const h = harness();
  const result = await h.call({ uid: "cust-1", action: "delete" });

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(h.done.deleted, ["cust-1"], "the sign-in account goes");
  assert.deepEqual(h.done.revoked, ["cust-1"], "and its sessions with it");
  assert.equal(h.done.orderWrites, 2, "both orders are rewritten, not removed");
  assert.equal(result.body.ordersRedacted, 2);
});

test("every action is written to the audit log with who did it", async () => {
  for (const action of ["block", "unblock", "delete"]) {
    const h = harness();
    await h.call({ uid: "cust-1", action });
    assert.equal(h.done.audits.length, 1, action);
    assert.equal(h.done.audits[0].action, `customer.${action}`);
    assert.equal(h.done.audits[0].targetUid, "cust-1");
    assert.equal(h.done.audits[0].actorUid, "boss");
    assert.ok(h.done.audits[0].at instanceof Date);
  }
});
