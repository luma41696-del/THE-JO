const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const test = require("node:test");

// Vercel's CommonJS loader cannot require ESM-only jose 6. Keep this check
// running with --no-experimental-require-module until the upstream fix ships:
// https://github.com/auth0/node-jwks-rsa/issues/507
test("Firebase Admin entrypoints load without synchronous ESM support", () => {
  for (const entrypoint of ["app", "auth", "firestore", "app-check"]) {
    assert.doesNotThrow(() => require(`firebase-admin/${entrypoint}`));
  }
});

test("JWKS keys verify valid RSA signatures and reject tampered tokens", async () => {
  const jwksClient = require("jwks-rsa");
  const jwt = require("jsonwebtoken");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = {
    ...publicKey.export({ format: "jwk" }),
    kid: "runtime-test",
    alg: "RS256",
    use: "sig",
  };
  const client = jwksClient({
    jwksUri: "https://example.invalid/jwks",
    fetcher: async () => ({ keys: [key] }),
  });
  const signingKeys = await client.getSigningKeys();
  assert.equal(signingKeys.length, 1);
  assert.equal(signingKeys[0].kid, key.kid);
  const token = jwt.sign({ sub: "runtime-test-user" }, privateKey, {
    algorithm: "RS256",
    keyid: key.kid,
    expiresIn: "1m",
  });
  const verificationKey = signingKeys[0].getPublicKey();
  assert.equal(jwt.verify(token, verificationKey, { algorithms: ["RS256"] }).sub, "runtime-test-user");
  const parts = token.split(".");
  parts[1] = Buffer.from(JSON.stringify({ sub: "tampered-user" })).toString("base64url");
  assert.throws(() => jwt.verify(parts.join("."), verificationKey, { algorithms: ["RS256"] }), /invalid signature/);
});
