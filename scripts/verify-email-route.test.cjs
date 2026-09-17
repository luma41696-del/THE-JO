const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

/**
 * The server route that sends the branded verification email.
 *
 * What is pinned here is who is refused and what happens when the mail
 * provider is missing or broken — because the link this route mints is a
 * credential. Anyone holding it can confirm that address, so the rules about
 * who may ask for one are the feature.
 *
 * Run with:
 *
 *     npm run test:verify-email-route
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

const LINK =
  "https://the-jo-shop.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=SECRET&apiKey=K";

function harness({
  role = "customer",
  signedIn = true,
  user = {},
  providerConfigured = true,
  sendResult = { ok: true, id: "msg_1" },
  linkThrows = null,
  limited = false,
} = {}) {
  const seen = { sends: [], linkRequests: [] };

  const account = {
    uid: "cust-1",
    email: "customer@example.com",
    displayName: "Lina Haddad",
    emailVerified: false,
    providerData: [{ providerId: "password" }],
    ...user,
  };

  const route = loadTs("src/app/api/auth/verify-email/route.ts", {
    "@/lib/firebase/admin": {
      isAdminConfigured: () => true,
      verifyRequest: async () =>
        signedIn ? { uid: account.uid, email: account.email, role } : null,
      getAdminAuth: () => ({
        getUser: async () => account,
        generateEmailVerificationLink: async (email, settings) => {
          if (linkThrows) throw linkThrows;
          seen.linkRequests.push({ email, settings });
          return LINK;
        },
      }),
    },
    "@/lib/notify/provider": {
      notifyStatus: () =>
        providerConfigured
          ? { configured: true, provider: "resend", missing: [] }
          : { configured: false, provider: "none", missing: ["NOTIFY_PROVIDER"] },
      send: async (input) => {
        seen.sends.push(input);
        return sendResult;
      },
    },
    "@/lib/security/rate-limit": {
      RULES: { messaging: { limit: 5, windowSeconds: 300 } },
      callerKey: () => "uid:cust-1",
      rateLimit: async () => ({ ok: !limited, remaining: 0, retryAfter: 120 }),
      tooManyRequests: () =>
        new Response(JSON.stringify({ ok: false, error: "Too many requests." }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "120" },
        }),
    },
    "@/lib/site": { absoluteUrl: (p) => `https://netsale.shop/${p}` },
    "server-only": {},
  });

  async function call(body = { locale: "ar" }) {
    const response = await route.POST(
      new Request("https://netsale.shop/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json(), seen };
  }

  return { call, seen };
}

/* -------------------------------------------------------------------------- */

test("a signed-in email/password customer gets exactly one branded email", async () => {
  const h = harness();
  const result = await h.call();

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.sent, true);
  assert.equal(result.body.branded, true);
  assert.equal(h.seen.sends.length, 1, "one email, not two");
  assert.equal(h.seen.sends[0].to, "customer@example.com");
  // Both parts: a message with no text alternative scores worse with every
  // spam filter there is.
  assert.ok(h.seen.sends[0].html.includes("تأكيد البريد الإلكتروني"));
  assert.ok(h.seen.sends[0].body.includes(LINK));
});

/*
 * The link is minted for the caller's own account and nobody else's. Taking an
 * address from the body would make this a way to have the shop email a
 * confirmation link to a stranger.
 */
test("the link is minted for the signed-in account, not for an address in the body", async () => {
  const h = harness();
  await h.call({ locale: "ar", email: "victim@example.com" });

  assert.equal(h.seen.linkRequests.length, 1);
  assert.equal(h.seen.linkRequests[0].email, "customer@example.com");
});

test("a stranger gets nothing", async () => {
  const h = harness({ signedIn: false });
  const result = await h.call();
  assert.equal(result.status, 401);
  assert.equal(h.seen.sends.length, 0);
});

/*
 * Google already proved the address — that is what signing in with it means.
 */
test("a Google account is refused and no email is sent", async () => {
  const h = harness({ user: { providerData: [{ providerId: "google.com" }] } });
  const result = await h.call();

  assert.equal(result.status, 400);
  assert.match(result.body.error, /Google/);
  assert.equal(h.seen.sends.length, 0, "Google users must never receive one");
  assert.equal(h.seen.linkRequests.length, 0, "and no link is even minted");
});

test("an account with both providers is still treated as federated", async () => {
  const h = harness({
    user: { providerData: [{ providerId: "password" }, { providerId: "google.com" }] },
  });
  assert.equal((await h.call()).status, 400);
  assert.equal(h.seen.sends.length, 0);
});

test("an already-confirmed address gets no second email", async () => {
  const h = harness({ user: { emailVerified: true } });
  const result = await h.call();

  assert.equal(result.status, 200);
  assert.equal(result.body.alreadyVerified, true);
  assert.equal(result.body.sent, false);
  assert.equal(h.seen.sends.length, 0);
});

/* -------------------------------------------------------------------------- */

/*
 * The cooldown is the customer's answer. Falling back to Firebase here would
 * route around it and send the second email the limit exists to prevent.
 */
test("a rate-limited caller is refused, and is not offered the fallback", async () => {
  const h = harness({ limited: true });
  const result = await h.call();

  assert.equal(result.status, 429);
  assert.equal(result.body.fallback, undefined);
  assert.equal(h.seen.sends.length, 0);
});

/*
 * `fallback: true` is the contract with the client: "this route cannot, use
 * Firebase's own send". It is what keeps the plain flow available while the
 * branded one is being set up, so no sign-up is ever left with no email.
 */
test("no mail provider means fall back, not fail", async () => {
  const h = harness({ providerConfigured: false });
  const result = await h.call();

  assert.equal(result.status, 503);
  assert.equal(result.body.fallback, true);
  assert.match(result.body.error, /NOTIFY_PROVIDER/);
  assert.equal(h.seen.sends.length, 0);
});

test("a provider that refuses the send falls back too, carrying its own words", async () => {
  const h = harness({
    sendResult: { ok: false, error: "403: The netsale.shop domain is not verified.", retryable: false },
  });
  const result = await h.call();

  assert.equal(result.status, 502);
  assert.equal(result.body.fallback, true);
  // "Domain not verified" is actionable; "send failed" is not.
  assert.match(result.body.error, /not verified/);
});

test("a link that cannot be generated falls back rather than sending nothing", async () => {
  const h = harness({
    linkThrows: Object.assign(new Error("nope"), { code: "auth/invalid-continue-uri" }),
  });
  const result = await h.call();

  assert.equal(result.status, 502);
  assert.equal(result.body.fallback, true);
  assert.equal(result.body.code, "auth/invalid-continue-uri");
  assert.equal(h.seen.sends.length, 0);
});

/* -------------------------------------------------------------------------- */

test("the confirmed customer is sent back to their account page", async () => {
  const h = harness();
  await h.call({ locale: "ar" });

  assert.equal(
    h.seen.linkRequests[0].settings.url,
    "https://netsale.shop/ar/account?verified=1",
  );
  // Handled by Firebase's own page, not by the app.
  assert.equal(h.seen.linkRequests[0].settings.handleCodeInApp, false);
});

test("the redirect follows the requested language, and defaults to Arabic", async () => {
  const english = harness();
  await english.call({ locale: "en" });
  assert.match(english.seen.linkRequests[0].settings.url, /\/en\/account\?verified=1$/);

  const fallback = harness();
  await fallback.call({});
  assert.match(fallback.seen.linkRequests[0].settings.url, /\/ar\/account\?verified=1$/);
});

/*
 * The link *is* the credential. Anyone holding it can confirm that address, so
 * it must never reach a log, an error body, or an analytics event.
 */
test("the verification link never appears in the response body", async () => {
  for (const options of [
    {},
    { sendResult: { ok: false, error: "boom", retryable: true } },
  ]) {
    const h = harness(options);
    const result = await h.call();
    const serialised = JSON.stringify(result.body);
    assert.ok(!serialised.includes("oobCode"), "no code");
    assert.ok(!serialised.includes(LINK), "no link");
  }
});
