import { strict as assert } from "node:assert";
import { afterEach, describe, test } from "node:test";

import {
  MAX_INLINE_BYTES,
  VTO_MODEL,
  buildPredictBody,
  callProvider,
  isAcceptedImage,
  ownsFittingPath,
  predictEndpoint,
  providerStatus,
  readPrediction,
  resultObjectPath,
  retryDelay,
  shouldRetry,
  withinInlineLimit,
  type TryOnJob,
} from "../src/lib/fitting/provider";

/**
 * The Vertex AI Virtual Try-On integration, in the parts that can be checked
 * without spending money.
 *
 * The network call itself is one `fetch`; everything that decides *what* is
 * sent, *whether* it may be sent, and *what is done with the answer* is pure
 * and is asserted here — including the request body's exact shape, because a
 * misplaced nesting level in that schema is a 400 that only shows up in
 * production, at cost, on a customer's wait.
 *
 * The file needs `server-only` resolved the way a Server Component resolves
 * it, hence the react-server condition:
 *
 *     npm run test:vto
 */

/* -------------------------------------------------------------------------- */
/*  Configuration                                                             */
/* -------------------------------------------------------------------------- */

const ENV_KEYS = [
  "VTO_PROVIDER",
  "VTO_PROJECT_ID",
  "VTO_LOCATION",
  "VTO_SERVICE_ACCOUNT_JSON",
  "VTO_API_KEY",
] as const;

/** A credential-shaped string. Not a key — it is never parsed in these tests. */
const FAKE_CREDENTIAL = JSON.stringify({
  type: "service_account",
  client_email: "vto@the-jo-shop.iam.gserviceaccount.com",
  private_key: "not-a-key",
});

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("providerStatus", () => {
  test("an unset provider is not configured", () => {
    setEnv({});
    const status = providerStatus();
    assert.equal(status.configured, false);
    assert.equal(status.provider, "none");
    assert.deepEqual(status.missing, ["VTO_PROVIDER"]);
  });

  test("vertex-vto with a project and a service account is configured", () => {
    setEnv({
      VTO_PROVIDER: "vertex-vto",
      VTO_PROJECT_ID: "the-jo-shop",
      VTO_LOCATION: "me-central1",
      VTO_SERVICE_ACCOUNT_JSON: FAKE_CREDENTIAL,
    });

    const status = providerStatus();
    assert.equal(status.configured, true);
    assert.equal(status.provider, "vertex-vto");
    assert.deepEqual(status.missing, []);
  });

  test("an API key is no longer a requirement — and never asked for", () => {
    /*
     * `VTO_API_KEY` is gone on purpose: an API key cannot call `:predict` on
     * Vertex AI at all, and a key in a query string ends up in access logs.
     * A shop that still has the old variable set and nothing else must not
     * read as configured.
     */
    setEnv({
      VTO_PROVIDER: "vertex-vto",
      VTO_PROJECT_ID: "the-jo-shop",
      VTO_API_KEY: "AIza-old-key",
    });

    const status = providerStatus();
    assert.equal(status.configured, false);
    assert.deepEqual(status.missing, ["VTO_SERVICE_ACCOUNT_JSON"]);
    assert.equal(status.missing.includes("VTO_API_KEY"), false);

    // And the credential alone, with no API key anywhere, is enough.
    setEnv({
      VTO_PROVIDER: "vertex-vto",
      VTO_PROJECT_ID: "the-jo-shop",
      VTO_SERVICE_ACCOUNT_JSON: FAKE_CREDENTIAL,
    });
    assert.equal(providerStatus().configured, true);
  });

  test("each missing piece is named separately", () => {
    setEnv({ VTO_PROVIDER: "vertex-vto" });
    assert.deepEqual(providerStatus().missing, ["VTO_PROJECT_ID", "VTO_SERVICE_ACCOUNT_JSON"]);

    setEnv({ VTO_PROVIDER: "vertex-vto", VTO_SERVICE_ACCOUNT_JSON: FAKE_CREDENTIAL });
    assert.deepEqual(providerStatus().missing, ["VTO_PROJECT_ID"]);
  });

  test("the status never carries the credential itself", () => {
    /*
     * This list is rendered to the customer in the fitting room when the
     * feature is off. The one value behind it is a private key.
     */
    setEnv({
      VTO_PROVIDER: "vertex-vto",
      VTO_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "vto@example.com",
        private_key: "-----BEGIN PRIVATE KEY-----SECRET-----END PRIVATE KEY-----",
      }),
    });

    const serialised = JSON.stringify(providerStatus());
    assert.equal(serialised.includes("SECRET"), false);
    assert.equal(serialised.includes("PRIVATE KEY"), false);
    assert.equal(serialised.includes("vto@example.com"), false);
  });
});

/* -------------------------------------------------------------------------- */
/*  The request                                                               */
/* -------------------------------------------------------------------------- */

describe("the Vertex contract", () => {
  test("the endpoint is the GA model in the configured region", () => {
    assert.equal(VTO_MODEL, "virtual-try-on-001");
    assert.equal(
      predictEndpoint("the-jo-shop", "me-central1"),
      "https://me-central1-aiplatform.googleapis.com/v1/projects/the-jo-shop" +
        "/locations/me-central1/publishers/google/models/virtual-try-on-001:predict",
    );
  });

  test("the model name is pinned, not the old floating one", () => {
    assert.equal(predictEndpoint("p", "l").includes("virtual-try-on-001"), true);
    assert.equal(/models\/virtual-try-on:predict/.test(predictEndpoint("p", "l")), false);
  });

  test("the body matches Google's schema exactly", () => {
    const body = buildPredictBody(
      { base64: "PERSON", mimeType: "image/jpeg" },
      { base64: "PRODUCT", mimeType: "image/png" },
    );

    // Written out in full rather than spot-checked: the nesting *is* the
    // contract, and `personImage.bytesBase64Encoded` — one level too shallow —
    // is a 400 that no type would have caught.
    assert.deepEqual(body, {
      instances: [
        {
          personImage: { image: { bytesBase64Encoded: "PERSON" } },
          productImages: [{ image: { bytesBase64Encoded: "PRODUCT" } }],
        },
      ],
      parameters: { sampleCount: 1 },
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  What may be sent                                                          */
/* -------------------------------------------------------------------------- */

describe("image validation", () => {
  test("JPEG and PNG only", () => {
    assert.equal(isAcceptedImage("image/jpeg"), true);
    assert.equal(isAcceptedImage("image/png"), true);
    // Accepted by the storage rules, not by this model.
    assert.equal(isAcceptedImage("image/webp"), false);
    assert.equal(isAcceptedImage("image/avif"), false);
    assert.equal(isAcceptedImage("image/gif"), false);
    // Never, anywhere in this project.
    assert.equal(isAcceptedImage("image/svg+xml"), false);
    assert.equal(isAcceptedImage(""), false);
    assert.equal(isAcceptedImage(null), false);
    assert.equal(isAcceptedImage(undefined), false);
  });

  test("a content type with parameters still reads correctly", () => {
    // Storage and CDNs both hand these back with a charset attached.
    assert.equal(isAcceptedImage("image/jpeg; charset=binary"), true);
    assert.equal(isAcceptedImage("IMAGE/PNG"), true);
  });

  test("the inline limit is Google's 7MB, checked before the request", () => {
    assert.equal(MAX_INLINE_BYTES, 7 * 1024 * 1024);
    assert.equal(withinInlineLimit(MAX_INLINE_BYTES), true);
    assert.equal(withinInlineLimit(MAX_INLINE_BYTES + 1), false);
    // An empty or unknown size is not "small enough".
    assert.equal(withinInlineLimit(0), false);
    assert.equal(withinInlineLimit(Number.NaN), false);
  });
});

describe("ownsFittingPath", () => {
  test("a customer's own photograph passes", () => {
    assert.equal(ownsFittingPath("owner", "users/owner/fitting/photo.jpg"), true);
  });

  test("another account's photograph does not", () => {
    /*
     * The check that matters. The Admin SDK bypasses the storage rules, so
     * without this a caller that ever accepted a path from a request could
     * have the server read a stranger's body photograph and run it through a
     * paid model.
     */
    assert.equal(ownsFittingPath("owner", "users/victim/fitting/photo.jpg"), false);
    assert.equal(ownsFittingPath("owner", "users/owner2/fitting/photo.jpg"), false);
  });

  test("traversal and sibling folders do not", () => {
    assert.equal(ownsFittingPath("owner", "users/owner/fitting/../../victim/fitting/p.jpg"), false);
    assert.equal(ownsFittingPath("owner", "users/owner/avatar/photo.jpg"), false);
    assert.equal(ownsFittingPath("owner", "products/leaked.jpg"), false);
    assert.equal(ownsFittingPath("", "users//fitting/photo.jpg"), false);
    assert.equal(ownsFittingPath("owner", ""), false);
  });

  test("a subfolder does not — the storage rules match one segment", () => {
    // `match /users/{uid}/fitting/{fileName}` is a single segment, so a file
    // under `fitting/results/` is one its owner could never read back.
    assert.equal(ownsFittingPath("owner", "users/owner/fitting/results/out.png"), false);
  });
});

/* -------------------------------------------------------------------------- */
/*  Where the result goes                                                     */
/* -------------------------------------------------------------------------- */

describe("resultObjectPath", () => {
  test("lands in the owner-only folder the rules already cover", () => {
    const path = resultObjectPath("owner", "image/png", "job-1");
    assert.equal(path, "users/owner/fitting/try-on-job-1.png");
    // The property that matters: the owner can read their own result back.
    assert.equal(ownsFittingPath("owner", path), true);
  });

  test("the extension follows the returned type", () => {
    assert.equal(resultObjectPath("u", "image/png", "t").endsWith(".png"), true);
    assert.equal(resultObjectPath("u", "image/jpeg", "t").endsWith(".jpg"), true);
  });

  test("a hostile token cannot escape the folder", () => {
    const path = resultObjectPath("owner", "image/png", "../../victim/fitting/x");
    assert.equal(path.includes(".."), false);
    assert.equal(ownsFittingPath("owner", path), true);
  });

  test("results are distinguishable from the photograph they came from", () => {
    // `deleteFittingPhotos` removes everything in the folder, so both go when
    // the customer asks — the prefix is for humans reading the bucket.
    assert.equal(resultObjectPath("u", "image/png", "t").includes("/try-on-"), true);
  });
});

/* -------------------------------------------------------------------------- */
/*  The answer                                                                */
/* -------------------------------------------------------------------------- */

describe("readPrediction", () => {
  test("reads the image and its type", () => {
    const read = readPrediction({
      predictions: [{ bytesBase64Encoded: "AAAA", mimeType: "image/png" }],
    });
    assert.equal(read.ok, true);
    assert.equal(read.ok && read.base64, "AAAA");
    assert.equal(read.ok && read.mimeType, "image/png");
  });

  test("defaults the type when Vertex omits it", () => {
    const read = readPrediction({ predictions: [{ bytesBase64Encoded: "AAAA" }] });
    assert.equal(read.ok && read.mimeType, "image/png");
  });

  test("a safety-filtered response is an error, not an empty success", () => {
    /*
     * The case that looks like success and is not. Vertex returns a prediction
     * carrying `raiFilteredReason` and no image; treating that as "something
     * went wrong" would retry it three times for the same answer.
     */
    const read = readPrediction({
      predictions: [{ raiFilteredReason: "Person detection failed." }],
    });
    assert.equal(read.ok, false);
    assert.equal(!read.ok && read.error.includes("Person detection failed."), true);
  });

  test("an empty or malformed response is refused", () => {
    assert.equal(readPrediction({}).ok, false);
    assert.equal(readPrediction({ predictions: [] }).ok, false);
    assert.equal(readPrediction({ predictions: [{}] }).ok, false);
    assert.equal(readPrediction(null).ok, false);
    assert.equal(readPrediction("nonsense").ok, false);
  });

  test("an unexpected image type is refused rather than stored", () => {
    const read = readPrediction({
      predictions: [{ bytesBase64Encoded: "AAAA", mimeType: "image/svg+xml" }],
    });
    assert.equal(read.ok, false);
  });
});

/* -------------------------------------------------------------------------- */
/*  Refusing to run                                                           */
/* -------------------------------------------------------------------------- */

describe("callProvider", () => {
  test("refuses, without a network call, when nothing is configured", async () => {
    setEnv({});
    const result = await callProvider({
      uid: "owner",
      personImagePath: "users/owner/fitting/photo.jpg",
      productImageUrl: "https://example.com/coat.jpg",
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error.includes("VTO_PROVIDER"), true);
  });

  test("names what is missing, and never the credential", async () => {
    setEnv({ VTO_PROVIDER: "vertex-vto", VTO_SERVICE_ACCOUNT_JSON: FAKE_CREDENTIAL });
    const result = await callProvider({
      uid: "owner",
      personImagePath: "users/owner/fitting/photo.jpg",
      productImageUrl: "https://example.com/coat.jpg",
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error.includes("VTO_PROJECT_ID"), true);
    assert.equal(!result.ok && result.error.includes("service_account"), false);
    assert.equal(!result.ok && result.error.includes("private_key"), false);
  });

  test("a job with no account is refused before anything is read", async () => {
    setEnv({
      VTO_PROVIDER: "vertex-vto",
      VTO_PROJECT_ID: "the-jo-shop",
      VTO_SERVICE_ACCOUNT_JSON: FAKE_CREDENTIAL,
    });
    const result = await callProvider({
      uid: "",
      personImagePath: "users/owner/fitting/photo.jpg",
      productImageUrl: "https://example.com/coat.jpg",
    });
    assert.equal(result.ok, false);
  });
});

/* -------------------------------------------------------------------------- */
/*  The retry architecture, unchanged                                         */
/* -------------------------------------------------------------------------- */

function job(over: Partial<TryOnJob> = {}): TryOnJob {
  return {
    id: "j1",
    uid: "owner",
    productId: "p1",
    state: "failed",
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
    expiresAt: 0,
    ...over,
  };
}

describe("shouldRetry", () => {
  test("a transport failure is retried", () => {
    assert.equal(shouldRetry(job({ error: "Vertex returned 503: backend unavailable" })), true);
  });

  test("a credential, permission or quota failure is not", () => {
    // The wording in `callProvider` is chosen so these match: retrying a bad
    // service account three times makes the customer wait three times as long
    // for the same answer.
    assert.equal(shouldRetry(job({ error: "Credential or permission rejected by Vertex: 403" })), false);
    assert.equal(shouldRetry(job({ error: "Vertex quota exhausted: 429" })), false);
    assert.equal(
      shouldRetry(job({ error: "Permission denied: that photo does not belong to this account." })),
      false,
    );
    assert.equal(
      shouldRetry(job({ error: "No try-on provider is configured (missing VTO_PROJECT_ID)." })),
      false,
    );
  });

  test("attempts and state still bound it", () => {
    assert.equal(shouldRetry(job({ attempts: 3, error: "503" })), false);
    assert.equal(shouldRetry(job({ state: "done", error: "503" })), false);
    assert.equal(shouldRetry(job({ state: "queued" })), false);
  });
});

test("retryDelay backs off and is capped", () => {
  assert.equal(retryDelay(1), 2_000);
  assert.equal(retryDelay(2), 4_000);
  assert.equal(retryDelay(3), 8_000);
  assert.equal(retryDelay(99), 30_000);
  assert.equal(retryDelay(0), 2_000);
});
